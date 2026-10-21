// Gas-sponsor relayer for the biometric (passkey) payment flow.
//
// WHY: a Soroban transaction needs a CLASSIC source account to pay the network
// fee — a contract (the passkey smart-wallet) cannot be a tx source. To keep
// the zero-friction biometric UX (Face ID only, no wallet-connect), the
// platform sponsors that fee. This relayer is the sponsor.
//
// NON-CUSTODIAL OF USER FUNDS: the relayer's key pays GAS only. The user's
// money lives in their passkey smart-wallet and moves ONLY when the on-chain
// __check_auth verifies a real WebAuthn (Face ID) assertion carried in the tx.
// The relayer never authorizes a transfer — it signs the OUTER envelope (fee)
// and submits. If this endpoint is abused, the worst case is wasted gas, not
// stolen funds — bounded by: (1) it ONLY signs txs whose source is the sponsor,
// (2) ONLY a single op that is either a slippay-wasm contract deploy OR a
// `transfer` FROM a contract address on the native SAC with amount <= cap, and
// (3) tx fee <= cap. Plus rate limiting.
//
// The browser builds the (unsigned) tx with the sponsor as source + the passkey
// auth entry attached, then POSTs the XDR here; we validate, sign, submit.

import { Hono } from "hono";
import { hexToBuf } from "@slippay/shared";
import { rateLimit } from "../middleware/rate_limit.ts";
import {
  Address, Asset, BASE_FEE, Keypair, Networks, Operation,
  nativeToScVal, rpc as SorobanRpc, TransactionBuilder, xdr,
} from "npm:@stellar/stellar-sdk@13";

const NET = (Deno.env.get("RELAYER_NETWORK") ?? Deno.env.get("STELLAR_NETWORK") ?? "testnet").toLowerCase();
const IS_MAINNET = NET === "mainnet" || NET === "public";
const PASSPHRASE = IS_MAINNET ? Networks.PUBLIC : Networks.TESTNET;
const RPC_URL = Deno.env.get("RELAYER_RPC")
  ?? (IS_MAINNET
    ? "https://soroban-rpc.mainnet.stellar.gateway.fm"
    : "https://soroban-testnet.stellar.org");

// The sponsor account secret (a SMALL gas float — NOT user funds). Absent =>
// relayer disabled (503), so deploying the route is safe before funding it.
const SPONSOR_SECRET = Deno.env.get("RELAYER_SECRET") ?? "";
// The slippay smart-wallet wasm hash the relayer is willing to deploy.
const WASM_HASH_HEX = (Deno.env.get("RELAYER_WASM_HASH") ?? "").toLowerCase();
// Per-payment amount ceiling (stroops). Default 0.5 XLM — a demo bound.
const AMOUNT_CAP = BigInt(Deno.env.get("RELAYER_AMOUNT_CAP") ?? "5000000");
// Max network fee the relayer will pay per tx (stroops). Default 2 XLM.
const FEE_CAP = BigInt(Deno.env.get("RELAYER_FEE_CAP") ?? "20000000");

const r = new Hono();

// Unauthenticated (the payer side has no API key) → strict per-IP limiter.
// Keyed on the trusted (rightmost) XFF hop via the shared limiter.
r.use("/*", rateLimit({ capacity: 12, refillPerSec: 0.1, scope: "relayer" }));

function sponsor(): Keypair | null {
  if (!SPONSOR_SECRET) return null;
  try { return Keypair.fromSecret(SPONSOR_SECRET); } catch { return null; }
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// GET /v1/relayer/info — the browser needs the sponsor pubkey (to set as tx
// source) + the wasm hash + network. Read-only, no secret leaked.
r.get("/info", (c) => {
  const kp = sponsor();
  if (!kp) return c.json({ error: "relayer_not_configured" }, 503);
  return c.json({
    sponsor: kp.publicKey(),
    network: IS_MAINNET ? "PUBLIC" : "TESTNET",
    rpc: RPC_URL,
    wasm_hash: WASM_HASH_HEX || null,
    amount_cap: AMOUNT_CAP.toString(),
  });
});

// Demo float the relayer fronts into a freshly-deployed wallet (stroops) + the
// wallet's constructor absolute per-charge ceiling.
const FUND_AMOUNT = Deno.env.get("RELAYER_FUND_AMOUNT") ?? "2000000"; // 0.2 XLM
const MAX_ABS = Deno.env.get("RELAYER_MAX_ABS") ?? "1000000000";

const hexToBytes = hexToBuf;
async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toB = (u: Uint8Array): any => u; // stellar-sdk accepts Uint8Array at runtime

// Sign with the sponsor + submit + poll to settlement. Returns the tx result.
async function signSubmit(
  server: InstanceType<typeof SorobanRpc.Server>,
  // deno-lint-ignore no-explicit-any
  tx: any,
  kp: Keypair,
): Promise<{ ok: boolean; reason?: string; returnValue?: xdr.ScVal }> {
  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) return { ok: false, reason: "sim: " + sim.error };
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
  assembled.sign(kp);
  const sent = await server.sendTransaction(assembled);
  if (sent.status === "ERROR") return { ok: false, reason: "send_error" };
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && res.status === "NOT_FOUND"; i++) {
    await new Promise((rr) => setTimeout(rr, 1000));
    res = await server.getTransaction(sent.hash);
  }
  if (res.status !== "SUCCESS") return { ok: false, reason: "status_" + res.status };
  return { ok: true, returnValue: (res as { returnValue?: xdr.ScVal }).returnValue };
}

// POST /v1/relayer/deploy { passkey_pubkey_hex, cred_id_hex } — the relayer
// deploys a smart-wallet bound to the device passkey (relayer = source + admin,
// pays the deploy fee) and fronts a small XLM float into it (demo). Built and
// signed entirely by the relayer (it controls the construction), so no XDR
// validation is needed here — the only spend is the bounded FUND_AMOUNT + gas.
r.post("/deploy", async (c) => {
  const kp = sponsor();
  if (!kp) return c.json({ error: "relayer_not_configured" }, 503);
  if (!WASM_HASH_HEX) return c.json({ error: "wasm_hash_not_configured" }, 503);

  let body: { passkey_pubkey_hex?: string; cred_id_hex?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_json" }, 400); }
  if (!body.passkey_pubkey_hex || !body.cred_id_hex) {
    return c.json({ error: "missing_passkey_fields" }, 400);
  }
  let pubKey: Uint8Array, credId: Uint8Array;
  try { pubKey = hexToBytes(body.passkey_pubkey_hex); credId = hexToBytes(body.cred_id_hex); }
  catch { return c.json({ error: "bad_hex" }, 400); }
  if (pubKey.length !== 65 || pubKey[0] !== 0x04) {
    return c.json({ error: "bad_passkey_pubkey" }, 400);
  }

  const server = new SorobanRpc.Server(RPC_URL);
  const admin = kp.publicKey();
  const credId32 = await sha256(credId);

  // 1. Deploy the wallet bound to the passkey.
  const ctorArgs: xdr.ScVal[] = [
    xdr.ScVal.scvBytes(toB(pubKey)),
    xdr.ScVal.scvBytes(toB(credId32)),
    new Address(admin).toScVal(),
    nativeToScVal(BigInt(MAX_ABS), { type: "i128" }),
  ];
  const deployOp = Operation.createCustomContract({
    address: new Address(admin),
    wasmHash: toB(hexToBytes(WASM_HASH_HEX)),
    salt: toB(crypto.getRandomValues(new Uint8Array(32))),
    constructorArgs: ctorArgs,
  });
  const src1 = await server.getAccount(admin);
  const dtx = new TransactionBuilder(src1, {
    fee: String(Number(BASE_FEE) * 1000), networkPassphrase: PASSPHRASE,
  }).addOperation(deployOp).setTimeout(60).build();
  const d = await signSubmit(server, dtx, kp);
  if (!d.ok || !d.returnValue) return c.json({ error: "deploy_failed", reason: d.reason }, 502);
  const walletId = Address.fromScVal(d.returnValue).toString();

  // 2. Front the demo float into the wallet (sponsor → wallet, native SAC).
  const sac = Asset.native().contractId(PASSPHRASE);
  const fundOp = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
      contractAddress: new Address(sac).toScAddress(),
      functionName: "transfer",
      args: [
        new Address(admin).toScVal(),
        new Address(walletId).toScVal(),
        nativeToScVal(BigInt(FUND_AMOUNT), { type: "i128" }),
      ],
    })),
    auth: [],
  });
  const src2 = await server.getAccount(admin);
  const ftx = new TransactionBuilder(src2, {
    fee: String(Number(BASE_FEE) * 100), networkPassphrase: PASSPHRASE,
  }).addOperation(fundOp).setTimeout(60).build();
  const f = await signSubmit(server, ftx, kp);
  if (!f.ok) return c.json({ error: "fund_failed", reason: f.reason, wallet_id: walletId }, 502);

  return c.json({ wallet_id: walletId, funded: FUND_AMOUNT });
});

interface Verdict { ok: boolean; reason?: string }

// THE trust boundary: decide whether a tx is a legitimate slippay op the
// sponsor will pay gas for. Fail-closed on anything unexpected.
function validateSponsorable(txXdr: string, sponsorPubkey: string): Verdict {
  let tx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    tx = TransactionBuilder.fromXDR(txXdr, PASSPHRASE);
  } catch (e) {
    return { ok: false, reason: `bad_xdr: ${String((e as Error).message ?? e)}` };
  }
  // FeeBump not accepted — we want the plain tx whose source we control.
  if ("innerTransaction" in tx) return { ok: false, reason: "fee_bump_not_accepted" };
  if (tx.source !== sponsorPubkey) return { ok: false, reason: "source_not_sponsor" };
  if (BigInt(tx.fee) > FEE_CAP) return { ok: false, reason: "fee_over_cap" };
  if (tx.operations.length !== 1) return { ok: false, reason: "must_be_single_op" };

  const op = tx.operations[0] as { type: string; func?: xdr.HostFunction };
  if (op.type !== "invokeHostFunction" || !op.func) {
    return { ok: false, reason: "not_invoke_host_function" };
  }
  const hf = op.func;
  const kind = hf.switch().name;

  // (a) Deploy of the slippay passkey wallet — wasm hash must match.
  if (kind === "hostFunctionTypeCreateContractV2" || kind === "hostFunctionTypeCreateContract") {
    try {
      const cc = kind === "hostFunctionTypeCreateContractV2"
        ? hf.createContractV2()
        : hf.createContract();
      const exec = cc.executable();
      if (exec.switch().name !== "contractExecutableWasm") {
        return { ok: false, reason: "deploy_not_wasm" };
      }
      const wasmHash = hex(new Uint8Array(exec.wasmHash()));
      if (!WASM_HASH_HEX || wasmHash !== WASM_HASH_HEX) {
        return { ok: false, reason: "wrong_wasm_hash" };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: `deploy_parse: ${String((e as Error).message ?? e)}` };
    }
  }

  // (b) A `transfer` FROM a contract (a passkey wallet) on a SAC, amount <= cap.
  if (kind === "hostFunctionTypeInvokeContract") {
    try {
      const ic = hf.invokeContract();
      if (ic.functionName().toString() !== "transfer") {
        return { ok: false, reason: "not_transfer" };
      }
      const args = ic.args();
      if (args.length !== 3) return { ok: false, reason: "bad_transfer_args" };
      // from (args[0]) must be a CONTRACT address — i.e. a passkey wallet,
      // never a classic account the relayer could be tricked into draining.
      const from = args[0];
      if (from.switch().name !== "scvAddress"
        || from.address().switch().name !== "scAddressTypeContract") {
        return { ok: false, reason: "from_not_contract" };
      }
      // amount (args[2]) i128 <= cap.
      const amt = args[2];
      if (amt.switch().name !== "scvI128") return { ok: false, reason: "amount_not_i128" };
      const parts = amt.i128();
      const hi = BigInt(parts.hi().toString());
      const lo = BigInt(parts.lo().toString());
      const amount = (hi << 64n) + lo;
      if (amount <= 0n) return { ok: false, reason: "amount_not_positive" };
      if (amount > AMOUNT_CAP) return { ok: false, reason: "amount_over_cap" };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: `transfer_parse: ${String((e as Error).message ?? e)}` };
    }
  }

  return { ok: false, reason: `unsupported_host_function: ${kind}` };
}

// POST /v1/relayer/submit { xdr } — validate, sign the envelope (pay gas),
// submit, return the settled tx hash.
r.post("/submit", async (c) => {
  const kp = sponsor();
  if (!kp) return c.json({ error: "relayer_not_configured" }, 503);

  let body: { xdr?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad_json" }, 400); }
  if (!body.xdr || typeof body.xdr !== "string") {
    return c.json({ error: "missing_xdr" }, 400);
  }

  const verdict = validateSponsorable(body.xdr, kp.publicKey());
  if (!verdict.ok) return c.json({ error: "rejected", reason: verdict.reason }, 403);

  const tx = TransactionBuilder.fromXDR(body.xdr, PASSPHRASE);
  tx.sign(kp);

  const server = new SorobanRpc.Server(RPC_URL);
  let hash: string;
  try {
    const sent = await server.sendTransaction(tx);
    hash = sent.hash;
    if (sent.status === "ERROR") {
      return c.json({ error: "send_error", detail: JSON.stringify(sent.errorResult ?? {}) }, 502);
    }
  } catch (e) {
    return c.json({ error: "send_failed", detail: String((e as Error).message ?? e) }, 502);
  }

  // Poll for settlement (Soroban is async).
  let res = await server.getTransaction(hash);
  for (let i = 0; i < 30 && res.status === "NOT_FOUND"; i++) {
    await new Promise((rr) => setTimeout(rr, 1000));
    res = await server.getTransaction(hash);
  }
  if (res.status !== "SUCCESS") {
    return c.json({ error: "not_confirmed", status: res.status, hash }, 502);
  }
  return c.json({ hash });
});

export default r;
