#!/usr/bin/env node
// Autonomous recurring-debit scheduler. Queries due on-chain subscriptions and
// fires autocharge(id) for each — signed by a RELAYER account that only pays the
// XLM fee (never custodies funds; money moves buyer→merchant via the standing
// SEP-41 allowance the buyer approved once). This is the off-chain half of v0.2.
//
// Mechanism proven end-to-end on testnet 2026-06-03 (autocharge tx 40e19a7a…),
// relayer-sourced, no buyer signature.
//
// SAFE BY DEFAULT: dry-run (lists due subs, charges nothing). To actually charge:
//   CHARGE=1  (and CONFIRM_MAINNET=1 when STELLAR_NETWORK=mainnet — real money).
//
// Run (cron, e.g. every 10 min):
//   STELLAR_NETWORK=mainnet \
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//   RELAYER_SECRET=S… \
//   CHARGE=1 CONFIRM_MAINNET=1 \
//   NODE_PATH=apps/web/node_modules node scripts/autocharge-scheduler.mjs

import * as S from "../apps/web/node_modules/@stellar/stellar-sdk/lib/index.js";
const { rpc, Keypair, Networks, TransactionBuilder, Contract, nativeToScVal, xdr, BASE_FEE } = S;

const NET = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const IS_MAINNET = NET === "mainnet" || NET === "public";
const PASSPHRASE = IS_MAINNET ? Networks.PUBLIC : Networks.TESTNET;
const RPC_URL = process.env.RPC || (IS_MAINNET ? "https://soroban-mainnet.stellar.org" : "https://soroban-testnet.stellar.org");
// v0.4 contract (autocharge + attestation gate + 2.97% platform fee), mainnet, deployed 2026-06-05.
const DEFAULT_CONTRACT = process.env.CONTRACT || "CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RELAYER_SECRET = process.env.RELAYER_SECRET;
const DO_CHARGE = process.env.CHARGE === "1";
const EXPLORER = `https://stellar.expert/explorer/${IS_MAINNET ? "public" : "testnet"}/tx/`;

const server = new rpc.Server(RPC_URL);
const log = (...a) => console.log(...a);
const die = (m) => { console.error("✗ " + m); process.exit(1); };

async function fetchDueSubscriptions() {
  if (!SUPABASE_URL || !SERVICE_KEY) die("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required to find due subs.");
  const now = new Date().toISOString();
  // active, on-chain bound, and due (next_charge_at <= now)
  const q = `${SUPABASE_URL}/rest/v1/subscriptions` +
    `?status=eq.active&soroban_subscription_id=not.is.null` +
    `&next_charge_at=lte.${now}` +
    `&select=id,soroban_contract_id,soroban_subscription_id,next_charge_at,charges_done,max_periods`;
  const r = await fetch(q, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) die(`supabase query ${r.status}: ${await r.text()}`);
  return r.json();
}

async function autocharge(relayer, contractId, nonceHex) {
  const nonce = Buffer.from(nonceHex.replace(/^0x/, ""), "hex");
  if (nonce.length !== 32) throw new Error(`bad nonce length ${nonce.length}`);
  const c = new Contract(contractId);
  const src = await server.getAccount(relayer.publicKey());
  const tx = new TransactionBuilder(src, { fee: String(Number(BASE_FEE) * 100), networkPassphrase: PASSPHRASE })
    .addOperation(c.call("autocharge", xdr.ScVal.scvBytes(nonce)))
    .setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`sim: ${sim.error}`);
  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(relayer);
  const sent = await server.sendTransaction(assembled);
  if (sent.status === "ERROR") throw new Error(`send: ${JSON.stringify(sent.errorResult ?? sent)}`);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && res.status === "NOT_FOUND"; i++) { await new Promise(r => setTimeout(r, 1000)); res = await server.getTransaction(sent.hash); }
  return { hash: sent.hash, status: res.status };
}

async function main() {
  if (IS_MAINNET && DO_CHARGE && process.env.CONFIRM_MAINNET !== "1")
    die("Refusing to charge on mainnet without CONFIRM_MAINNET=1 (real money).");

  const due = await fetchDueSubscriptions();
  log(`due on-chain subscriptions: ${due.length} (network=${NET}, mode=${DO_CHARGE ? "CHARGE" : "DRY-RUN"})`);
  if (!due.length) return;

  if (!DO_CHARGE) {
    for (const s of due) log(`  [dry-run] sub ${s.id} · nonce ${String(s.soroban_subscription_id).slice(0, 12)}… · due ${s.next_charge_at} · ${s.charges_done}/${s.max_periods || "∞"}`);
    log("Set CHARGE=1 to fire autocharge for each (relayer-signed).");
    return;
  }

  if (!RELAYER_SECRET) die("RELAYER_SECRET required to charge.");
  const relayer = Keypair.fromSecret(RELAYER_SECRET);
  log(`relayer (fee payer, not buyer): ${relayer.publicKey()}\n`);

  let ok = 0, fail = 0;
  for (const s of due) {
    const contractId = s.soroban_contract_id || DEFAULT_CONTRACT;
    try {
      const r = await autocharge(relayer, contractId, s.soroban_subscription_id);
      if (r.status === "SUCCESS") { ok++; log(`✓ sub ${s.id} → ${EXPLORER}${r.hash}`); }
      else { fail++; log(`✗ sub ${s.id} → ${r.status} ${EXPLORER}${r.hash}`); }
    } catch (e) {
      fail++; log(`✗ sub ${s.id} → ${e?.message ?? e}`);
    }
  }
  log(`\ndone: ${ok} charged, ${fail} failed.`);
}

main().catch(e => { console.error("FAILED:", e?.message ?? e); process.exit(1); });
