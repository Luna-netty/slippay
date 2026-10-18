#!/usr/bin/env node
// Attested autonomous scheduler — the machine that charges itself THROUGH the
// integrity gate. For each due subscription it: (1) reads charges_done on-chain,
// (2) produces a fresh ed25519 attestation over domain||id||charges_done||not_after,
// (3) submits autocharge_attested via the relayer (gas only). Fail-closed: a sub
// without the matching attester, an expired/tampered attestation, or a period not
// elapsed is rejected on-chain.
//
// Keys (env): ATTESTER_SECRET (the ed25519 key whose pubkey is bound via
// set_attester on each sub), RELAYER_SECRET (pays gas, no fund control).
// Subs: SUB_IDS (comma-separated 64-hex ids) for explicit runs, or Supabase.
// SAFE: dry-run by default; CHARGE=1 to actually fire.
//
//   CONTRACT=C… ATTESTER_SECRET=S… RELAYER_SECRET=S… SUB_IDS=<hex> \
//   STELLAR_NETWORK=public CHARGE=1 CONFIRM_MAINNET=1 \
//   NODE_PATH=apps/web/node_modules node scripts/attested-scheduler.mjs

import * as S from "../apps/web/node_modules/@stellar/stellar-sdk/lib/index.js";
const { rpc, Keypair, Networks, TransactionBuilder, Contract, nativeToScVal, scValToNative, xdr, BASE_FEE, hash } = S;

const NET = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
const IS_MAINNET = NET === "public" || NET === "mainnet" || NET === "pubnet";
const PASS = IS_MAINNET ? Networks.PUBLIC : Networks.TESTNET;
const RPC_URL = process.env.RPC || (IS_MAINNET ? "https://mainnet.sorobanrpc.com" : "https://soroban-testnet.stellar.org");
const CONTRACT = process.env.CONTRACT || "CCT3KJXRUO3HJJ2GLTW2MISSQVUEKOPUG3B4YQH75TCGKAOC4P6FIKUF";
const DOMAIN_TAG = process.env.DOMAIN_TAG || "v5-gate";
const DOMAIN = process.env.DOMAIN_HEX
  ? Buffer.from(process.env.DOMAIN_HEX, "hex")
  : hash(Buffer.from(`slippay-domain-${DOMAIN_TAG}|${PASS}`));
const NOT_AFTER_WINDOW = Number(process.env.NOT_AFTER_WINDOW || "3600");
const DO_CHARGE = process.env.CHARGE === "1";
const server = new rpc.Server(RPC_URL);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const die = (m) => { console.error("FATAL:", m); process.exit(1); };

async function subIds() {
  if (process.env.SUB_IDS) return process.env.SUB_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { log("no SUB_IDS and no Supabase creds — nothing to do."); return []; }
  // Active, due subs. Non-gated ones fail at SIMULATION (AttesterNotSet) and
  // never submit, so no gas is wasted — safe to scan all. (No `network` column
  // exists on `subscriptions`; this deployment is single-network per box.)
  const q = `${url}/rest/v1/subscriptions?status=eq.active&next_charge_at=lte.${new Date().toISOString()}&select=soroban_subscription_id`;
  try {
    const r = await fetch(q, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    if (!r.ok) { log(`supabase ${r.status} — skipping this run`); return []; }
    return (await r.json()).map((s) => s.soroban_subscription_id).filter(Boolean);
  } catch (e) { log("supabase error — skipping this run:", e.message); return []; }
}

// read the sub's current charges_done on-chain (the value the contract will
// expect the attestation to be bound to — single-use per charge).
async function chargesDone(idHex) {
  const c = new Contract(CONTRACT);
  const src = await server.getAccount(Keypair.random().publicKey()).catch(() => null);
  // simulate doesn't need a funded source; use a throwaway via a built tx
  const probe = Keypair.random();
  let acct; try { acct = await server.getAccount(probe.publicKey()); } catch { acct = new S.Account(probe.publicKey(), "0"); }
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(c.call("get", xdr.ScVal.scvBytes(Buffer.from(idHex, "hex"))))
    .setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error("get() sim failed: " + sim.error);
  const sub = scValToNative(sim.result.retval);
  return Number(sub.charges_done);
}

function attest(attester, idHex, cd, notAfter) {
  const id = Buffer.from(idHex, "hex");
  const cdb = Buffer.alloc(4); cdb.writeUInt32BE(cd >>> 0);
  const nab = Buffer.alloc(8); nab.writeBigUInt64BE(BigInt(notAfter));
  const msg = Buffer.concat([DOMAIN, id, cdb, nab]);
  return attester.sign(msg); // ed25519 → 64-byte Buffer
}

async function submit(relayer, op) {
  const acct = await server.getAccount(relayer.publicKey());
  const tx = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 100), networkPassphrase: PASS })
    .addOperation(op).setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return { ok: false, reason: sim.error };
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(relayer);
  const sent = await server.sendTransaction(prepared);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && res.status === "NOT_FOUND"; i++) { await new Promise((r) => setTimeout(r, 1500)); res = await server.getTransaction(sent.hash); }
  return { ok: res.status === "SUCCESS", reason: res.status, hash: sent.hash };
}

async function main() {
  if (IS_MAINNET && DO_CHARGE && process.env.CONFIRM_MAINNET !== "1") die("Refusing to charge mainnet without CONFIRM_MAINNET=1.");
  if (!process.env.ATTESTER_SECRET) die("ATTESTER_SECRET required.");
  const attester = Keypair.fromSecret(process.env.ATTESTER_SECRET);
  log(`attested scheduler · net=${NET} · contract=${CONTRACT} · domain=${DOMAIN.toString("hex").slice(0, 12)}… · mode=${DO_CHARGE ? "CHARGE" : "DRY-RUN"}`);

  const ids = await subIds();
  log(`subscriptions to process: ${ids.length}`);
  if (!ids.length) return;

  if (!DO_CHARGE) { for (const id of ids) log(`  [dry-run] ${id.slice(0, 16)}…`); log("Set CHARGE=1 to fire attested charges."); return; }
  if (!process.env.RELAYER_SECRET) die("RELAYER_SECRET required to charge.");
  const relayer = Keypair.fromSecret(process.env.RELAYER_SECRET);
  const c = new Contract(CONTRACT);
  const now = Math.floor(Date.now() / 1000);

  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      const cd = await chargesDone(id);
      const notAfter = now + NOT_AFTER_WINDOW;
      const sig = attest(attester, id, cd, notAfter);
      const op = c.call("autocharge_attested", xdr.ScVal.scvBytes(Buffer.from(id, "hex")), nativeToScVal(BigInt(notAfter), { type: "u64" }), xdr.ScVal.scvBytes(sig));
      const r = await submit(relayer, op);
      if (r.ok) { ok++; log(`  ✓ charged ${id.slice(0, 16)}… (cd ${cd}) tx ${r.hash}`); }
      else { fail++; log(`  ✗ ${id.slice(0, 16)}… rejected: ${r.reason}`); }
    } catch (e) { fail++; log(`  ✗ ${id.slice(0, 16)}… error: ${e.message}`); }
  }
  log(`done: ${ok} charged, ${fail} skipped/failed`);
}
main().catch((e) => die(e?.message ?? String(e)));
