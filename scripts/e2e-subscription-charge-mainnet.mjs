#!/usr/bin/env node
// REAL recurring charge on Stellar MAINNET against the live subscription contract
// (CBJMQ6ZY…EVQN). This is the minimal path that closes the gap the contract tests
// leave open: contracts/subscription tests use `mock_all_auths_allowing_non_root_auth`,
// which BYPASSES auth verification. This script signs with a REAL keypair, so the
// host actually checks:
//   - charge()'s require_auth_for_args((id, token, merchant, amount))  [lib.rs:172]
//   - the nested SEP-41 token.transfer(buyer→merchant, amount)         [lib.rs:208]
// validating the end-to-end auth chain that the regression test cannot.
//
// Design: buyer == transaction source. Soroban auto-authorizes a source account's
// require_auth via the envelope signature, so a single funded wallet (yours) signs
// both create() and charge() with no manual auth entries. Counterparty (merchant)
// is a separate address. Tiny USDC amounts (cents).
//
// ⚠️ REAL MONEY ON MAINNET. IRREVERSIBLE. Guarded behind CONFIRM_MAINNET=1.
//
// Run (from repo root):
//   CONFIRM_MAINNET=1 \
//   BUYER_SECRET=S... \
//   MERCHANT_ADDR=G... \
//   AMOUNT_STROOPS=500000 \           # 0.05 USDC (7 decimals); default below
//   NODE_PATH=apps/web/node_modules \
//   node scripts/e2e-subscription-charge-mainnet.mjs
//
// Prerequisites (script preflights and tells you what's missing):
//   • BUYER account: funded with XLM (fees) + USDC trustline + USDC balance ≥ amount
//   • MERCHANT account: exists + USDC trustline (SAC transfer needs recipient trustline)

import * as S from "../apps/web/node_modules/@stellar/stellar-sdk/lib/index.js";
import { randomBytes } from "node:crypto";

const {
  rpc, xdr, Keypair, Networks, TransactionBuilder, Address, Asset,
  Contract, nativeToScVal, scValToNative, BASE_FEE, Horizon,
} = S;

// ---- config (env-driven; never embed secrets) ----
const CONFIRM   = process.env.CONFIRM_MAINNET === "1";
const RPC_URL   = process.env.RPC || "https://soroban-rpc.mainnet.stellar.gateway.fm";
const HORIZON   = process.env.HORIZON || "https://horizon.stellar.org";
const PASSPHRASE = Networks.PUBLIC;
const CONTRACT  = process.env.CONTRACT || "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
const USDC_ISSUER = process.env.USDC_ISSUER || "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"; // Circle USDC mainnet issuer
const BUYER_SECRET = process.env.BUYER_SECRET;
const MERCHANT_ADDR = process.env.MERCHANT_ADDR;
const AMOUNT = process.env.AMOUNT_STROOPS || "500000";     // 0.05 USDC (1 USDC = 10_000_000)
const PERIOD = Number(process.env.PERIOD_SECONDS || "86400");   // contract minimum is 86_400 (1 day)
const MAX_PERIODS = Number(process.env.MAX_PERIODS || "12");
const EXPLORER = "https://stellar.expert/explorer/public/tx/";

const server = new rpc.Server(RPC_URL, { allowHttp: false });
const horizon = new Horizon.Server(HORIZON);
const log = (...a) => console.log(...a);

function die(msg) { console.error("✗ " + msg); process.exit(1); }
const addr = (g) => new Address(g).toScVal();
const i128 = (n) => nativeToScVal(BigInt(n), { type: "i128" });
const u64  = (n) => nativeToScVal(n, { type: "u64" });
const u32  = (n) => nativeToScVal(n, { type: "u32" });
const bytesN = (buf) => xdr.ScVal.scvBytes(buf);

async function preflight(buyerPub, usdcSac) {
  log("=== preflight (mainnet) ===");
  // buyer account + balances
  let buyer;
  try { buyer = await horizon.loadAccount(buyerPub); }
  catch { die(`BUYER ${buyerPub} not found on mainnet — fund it with XLM first.`); }
  const xlm = buyer.balances.find(b => b.asset_type === "native");
  const usdc = buyer.balances.find(b => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
  log(`  buyer XLM: ${xlm?.balance ?? "0"}`);
  if (Number(xlm?.balance ?? 0) < 1) die("buyer needs ≥ ~1 XLM for Soroban fees.");
  if (!usdc) die(`buyer has NO USDC trustline (issuer ${USDC_ISSUER.slice(0,8)}…). Add it, then fund USDC.`);
  log(`  buyer USDC: ${usdc.balance}`);
  if (BigInt(Math.round(Number(usdc.balance) * 1e7)) < BigInt(AMOUNT)) die(`buyer USDC balance < amount (${AMOUNT} stroops).`);
  // merchant account + trustline
  let merch;
  try { merch = await horizon.loadAccount(MERCHANT_ADDR); }
  catch { die(`MERCHANT ${MERCHANT_ADDR} not found on mainnet — it must exist.`); }
  if (!merch.balances.find(b => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER))
    die("merchant has NO USDC trustline — SAC transfer will fail. Add it on the merchant account.");
  log(`  merchant USDC trustline: ok`);
  log(`  USDC SAC: ${usdcSac}`);
  log("=== preflight ok ===\n");
}

async function invoke(buyer, fnName, args, label) {
  const c = new Contract(CONTRACT);
  const src = await server.getAccount(buyer.publicKey());
  const tx = new TransactionBuilder(src, { fee: String(Number(BASE_FEE) * 100), networkPassphrase: PASSPHRASE })
    .addOperation(c.call(fnName, ...args)).setTimeout(60).build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) die(`[${label}] simulation failed: ${sim.error}`);
  // buyer == source → require_auth covered by the envelope signature; assemble + sign.
  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(buyer);
  const sent = await server.sendTransaction(assembled);
  if (sent.status === "ERROR") die(`[${label}] send error: ${JSON.stringify(sent.errorResult ?? sent)}`);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && res.status === "NOT_FOUND"; i++) { await new Promise(r => setTimeout(r, 1000)); res = await server.getTransaction(sent.hash); }
  log(`[${label}] ${res.status} · tx ${sent.hash}`);
  log(`  ${EXPLORER}${sent.hash}`);
  if (res.status !== "SUCCESS") die(`[${label}] tx not SUCCESS (${res.status}).`);
  let ret; try { ret = res.returnValue ? scValToNative(res.returnValue) : undefined; } catch { /* ignore */ }
  return { hash: sent.hash, ret };
}

async function main() {
  if (!CONFIRM) die("Refusing to run without CONFIRM_MAINNET=1 (this spends REAL money on mainnet).");
  if (!BUYER_SECRET) die("BUYER_SECRET required (S… of a funded mainnet wallet; signs as buyer+source).");
  if (!MERCHANT_ADDR) die("MERCHANT_ADDR required (G… recipient with a USDC trustline).");
  if (PERIOD < 86400) die("PERIOD_SECONDS must be ≥ 86400 (contract minimum).");

  const buyer = Keypair.fromSecret(BUYER_SECRET);
  const usdcSac = new Asset("USDC", USDC_ISSUER).contractId(PASSPHRASE);
  log("MAINNET · subscription contract:", CONTRACT);
  log("buyer (==source):", buyer.publicKey());
  log("merchant:", MERCHANT_ADDR);
  log("amount (stroops):", AMOUNT, `(~${(Number(AMOUNT) / 1e7).toFixed(4)} USDC)\n`);

  await preflight(buyer.publicKey(), usdcSac);

  // 1) create — buyer authorizes the subscription; id == the 32-byte nonce we pass.
  const nonce = randomBytes(32);
  log("=== 1/2 create() ===");
  const created = await invoke(buyer, "create", [
    addr(buyer.publicKey()),
    addr(MERCHANT_ADDR),
    addr(usdcSac),
    i128(AMOUNT),
    u64(PERIOD),
    u32(MAX_PERIODS),
    u64(0),            // expires_at = 0 (no expiry)
    bytesN(nonce),
  ], "create");
  const idHex = nonce.toString("hex");
  log(`  subscription id: ${idHex}\n`);

  // 2) charge — REAL money moves. Exercises require_auth_for_args + nested transfer.
  log("=== 2/2 charge() — REAL USDC transfer ===");
  const charged = await invoke(buyer, "charge", [bytesN(nonce)], "charge");

  log("\n=== RESULT (MAINNET) ===");
  log("create tx:", `${EXPLORER}${created.hash}`);
  log("charge tx:", `${EXPLORER}${charged.hash}`);
  log("↑ the charge tx is your real recurring-billing settlement on Stellar mainnet,");
  log("  signed by a real wallet (not mock_all_auths). This is the §6 gap, closed.");
  log("\nTo demonstrate RECURRENCE: re-run charge() after the period elapses (≥1 day).");
  log("A second charge within the period correctly fails with PeriodNotElapsed (#3).");
}

main().catch(e => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
