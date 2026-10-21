// chainVerify — read the OBLIGATION and the PAYMENT straight from Stellar, so the
// /comprovante verdict needs ZERO trust in the URL.
//
// Two independent reads, both on-chain:
//   1. readObligation(net, contractId, subId)
//        → Soroban RPC simulateTransaction of a read-only `get(id)` on the
//          subscription contract, then scValToNative the returned Subscription
//          struct. Gives {merchant, token, amount(stroops), status}. This is the
//          CLAIM, but taken from chain instead of from a forgeable query param.
//   2. readTransfer(net, txhash)
//        → Horizon EFFECTS of the tx (no XDR parsing). `account_credited` carries
//          the real recipient + amount + asset; the matching `*_debited` effect
//          carries the payer. This reads CLASSIC *and* Soroban/contract transfers
//          (the contract_debited/account_credited pair a SAC transfer emits) — so
//          contract payments get a real amount, killing the old fake-amber.
//
// Verdict (judge): green iff the transfer the chain recorded satisfies the
// obligation the chain stores — recipient == obligation.merchant, amounts equal,
// asset == obligation.token (resolved to its SAC), and the obligation is in a
// state consistent with having been charged. Any mismatch is surfaced explicitly.

import { Account, Asset, Contract, Networks, StrKey, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

export type Net = "public" | "testnet";

export const HORIZON: Record<Net, string> = {
  public: "https://horizon.stellar.org",
  testnet: "https://horizon-testnet.stellar.org",
};
const SOROBAN_RPC: Record<Net, string> = {
  // Mainnet RPC via gateway.fm (same endpoint passkey.ts uses); testnet is the
  // canonical SDF RPC.
  public: "https://soroban-rpc.mainnet.stellar.gateway.fm",
  testnet: "https://soroban-testnet.stellar.org",
};
const PASSPHRASE: Record<Net, string> = {
  public: Networks.PUBLIC,
  testnet: Networks.TESTNET,
};

// Default subscription contract on mainnet. Overridable via ?contract= so the
// same page verifies testnet deployments.
export const DEFAULT_SUB_CONTRACT: Record<Net, string | undefined> = {
  public: "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN",
  testnet: undefined,
};

const STROOPS_PER_UNIT = 10_000_000n; // 1e7 — Stellar's fixed 7-decimal scale

/** Mirror of the contract's `Status` enum (lib.rs). scValToNative renders the
 *  contracttype enum as its variant name string. */
export type ObligationStatus = "Active" | "Paused" | "Cancelled" | "Expired" | "unknown";

export interface Obligation {
  merchant: string;       // G… or C… address the obligation pays
  token: string;          // C… token (SEP-41) contract address
  amountStroops: bigint;  // i128, in stroops (7-decimal)
  status: ObligationStatus;
}

export interface Transfer {
  to: string;             // recipient (account_credited)
  from?: string;          // payer (account_debited / contract_debited.account)
  fromContract?: string;  // contract id when the debit came from a contract (Soroban)
  amount: string;         // human units, e.g. "0.3000000"
  amountStroops: bigint;  // same value in stroops, for exact integer comparison
  assetType: string;      // "native" | "credit_alphanum4" | "credit_alphanum12"
  assetCode: string;      // "XLM" | "USDC" | …
  assetIssuer?: string;   // G… issuer for non-native
  /** SAC contract id of this asset on `net` — the bridge to obligation.token. */
  sac: string;
}

/** Is `s` a syntactically valid Stellar contract id (C…32-byte)? */
export function isContractId(s: string): boolean {
  try { return StrKey.isValidContract(s); } catch { return false; }
}

/** Decode a sub id (?sub=) into the 32-byte BytesN the contract keys on.
 *  Accepts 64-hex (optionally 0x-prefixed) or base64 (44 chars, std or url). */
export function subIdToBytes(raw: string): Uint8Array {
  const s = raw.trim();
  const hex = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  // base64 / base64url
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (out.length !== 32) throw new Error(`sub id must decode to 32 bytes, got ${out.length}`);
  return out;
}

/** Format stroops as a 7-decimal human string (matches Horizon's amount format). */
export function stroopsToUnits(stroops: bigint): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const whole = v / STROOPS_PER_UNIT;
  const frac = (v % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Parse a human "0.3000000" amount into exact stroops (integer, no float). */
export function unitsToStroops(units: string): bigint {
  const m = units.trim().match(/^(-?)(\d+)(?:\.(\d{1,7}))?$/);
  if (!m) throw new Error(`bad amount: ${units}`);
  const sign = m[1] === "-" ? -1n : 1n;
  const whole = BigInt(m[2] ?? "0");
  const frac = BigInt((m[3] ?? "").padEnd(7, "0"));
  return sign * (whole * STROOPS_PER_UNIT + frac);
}

/** SAC contract id for a Horizon-style asset descriptor on `net`. */
export function sacFor(net: Net, assetType: string, code: string, issuer?: string): string {
  const asset = assetType === "native" ? Asset.native() : new Asset(code, issuer!);
  return asset.contractId(PASSPHRASE[net]);
}

/**
 * Read the on-chain obligation via a read-only `get(id)` simulation.
 * No signing, no submission — simulateTransaction returns the contract's
 * return value, which we decode with scValToNative.
 */
export async function readObligation(net: Net, contractId: string, subId: string): Promise<Obligation> {
  if (!isContractId(contractId)) throw new Error("invalid contract id");
  const server = new rpc.Server(SOROBAN_RPC[net], { allowHttp: false });
  const idBytes = subIdToBytes(subId);
  const contract = new Contract(contractId);
  // A read-only invocation still needs a source account for the envelope; any
  // valid account works since we never submit. Use the all-zero account id.
  const sourceAcct = StrKey.encodeEd25519PublicKey(new Uint8Array(32) as unknown as Buffer);
  const account = new Account(sourceAcct, "0");
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: PASSPHRASE[net] })
    .addOperation(contract.call("get", xdr.ScVal.scvBytes(idBytes as unknown as Buffer)))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error("obligation read failed: " + sim.error);
  const retval = sim.result?.retval;
  if (!retval) throw new Error("obligation read returned no value");

  // scValToNative turns the Subscription struct into a plain object keyed by the
  // struct field names; Address fields become strkey strings, i128 a bigint,
  // and the Status enum its variant name.
  const sub = scValToNative(retval) as Record<string, unknown>;
  const merchant = String(sub.merchant ?? "");
  const token = String(sub.token ?? "");
  const amountStroops = toBigInt(sub.amount);
  const status = normalizeStatus(sub.status);
  if (!merchant || !token) throw new Error("obligation missing merchant/token");
  return { merchant, token, amountStroops, status };
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") return BigInt(v);
  throw new Error("amount is not numeric");
}

function normalizeStatus(v: unknown): ObligationStatus {
  // scValToNative may yield the variant name ("Active") or, for a unit-variant
  // enum, the index. Handle both.
  if (typeof v === "string") {
    const s = v as ObligationStatus;
    if (["Active", "Paused", "Cancelled", "Expired"].includes(s)) return s;
    return "unknown";
  }
  if (typeof v === "number" || typeof v === "bigint") {
    return (["Active", "Paused", "Cancelled", "Expired"][Number(v)] as ObligationStatus) ?? "unknown";
  }
  return "unknown";
}

/**
 * Read the actual transfer from Horizon EFFECTS — works for classic payments
 * AND Soroban/contract (SAC) transfers, no XDR parsing. Returns undefined if no
 * credit effect exists (e.g. a non-transfer tx).
 */
export async function readTransfer(net: Net, txhash: string): Promise<Transfer | undefined> {
  const res = await fetch(`${HORIZON[net]}/transactions/${txhash}/effects?limit=100`);
  if (!res.ok) return undefined;
  const json = await res.json();
  const recs: EffectRecord[] = json?._embedded?.records ?? [];

  const credit = recs.find((e) => e.type === "account_credited");
  if (!credit || credit.amount == null) return undefined;

  // The matching debit gives us the payer. Prefer the same-amount/same-asset
  // debit so a multi-effect tx still pairs correctly.
  const debit = recs.find(
    (e) =>
      (e.type === "account_debited" || e.type === "contract_debited") &&
      e.amount === credit.amount &&
      e.asset_type === credit.asset_type &&
      (e.asset_code ?? "") === (credit.asset_code ?? ""),
  ) ?? recs.find((e) => e.type === "account_debited" || e.type === "contract_debited");

  const assetType = credit.asset_type ?? "native";
  const assetCode = assetType === "native" ? "XLM" : (credit.asset_code ?? "?");
  const assetIssuer = assetType === "native" ? undefined : credit.asset_issuer;
  let sac = "";
  try { sac = sacFor(net, assetType, assetCode, assetIssuer); } catch { sac = ""; }

  return {
    to: credit.account ?? "",
    from: debit?.type === "account_debited" ? debit.account : debit?.account,
    fromContract: debit?.type === "contract_debited" ? debit.contract ?? debit.account : undefined,
    amount: credit.amount,
    amountStroops: unitsToStroops(credit.amount),
    assetType,
    assetCode,
    assetIssuer,
    sac,
  };
}

interface EffectRecord {
  type: string;
  account?: string;
  contract?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

export type Mismatch = "recipient" | "amount" | "asset" | "status";

export interface ObligationVerdict {
  ok: boolean;
  mismatches: Mismatch[];
  recipientOk: boolean;
  amountOk: boolean;
  assetOk: boolean;
  statusOk: boolean;
  /** obligation.token resolved/compared to the transfer's SAC for display. */
  obligationSac: string;
}

/**
 * THE JUDGE — green iff the on-chain transfer satisfies the on-chain obligation.
 * Zero inputs from the URL: every comparison is chain-read vs chain-read.
 *
 *   recipient : transfer.to            == obligation.merchant
 *   amount    : transfer.amountStroops == obligation.amountStroops (exact i128)
 *   asset     : transfer.sac           == obligation.token (token is a C… SAC/SEP-41
 *               contract; we already resolved the transfer's asset to its SAC)
 *   status    : obligation.status is Active or Paused. A charged sub stays Active
 *               (charge() does not flip status); Cancelled/Expired means the
 *               obligation is no longer live, so a payment against it is suspect.
 */
export function judgeObligation(o: Obligation, t: Transfer): ObligationVerdict {
  const recipientOk = !!t.to && t.to === o.merchant;
  const amountOk = t.amountStroops === o.amountStroops;
  // token on the obligation is a contract id; if it equals the transfer's SAC the
  // asset matches. (Resolves native XLM and issued assets uniformly.)
  const assetOk = !!t.sac && t.sac === o.token;
  const statusOk = o.status === "Active" || o.status === "Paused";

  const mismatches: Mismatch[] = [];
  if (!recipientOk) mismatches.push("recipient");
  if (!amountOk) mismatches.push("amount");
  if (!assetOk) mismatches.push("asset");
  if (!statusOk) mismatches.push("status");

  return {
    ok: mismatches.length === 0,
    mismatches,
    recipientOk,
    amountOk,
    assetOk,
    statusOk,
    obligationSac: o.token,
  };
}
