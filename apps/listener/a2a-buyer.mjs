#!/usr/bin/env node
// A2A buyer — the autonomous payer (the only "glue" in the A2A circuit).
//
// Agent B, on its own: GET a seller's x402 endpoint -> 402 (price) -> DECIDE within
// its signed mandate -> pay USDC on Stellar -> re-present -> get the good. No human
// in the loop after launch. Spec: docs/superpowers/specs/2026-06-25-a2a-payment-circuit.md
//
// The mandate IS the integrity surface (attestX402): the agent commits an allowed
// recipient + per-tx cap + velocity once (the human authorization at the root); each
// payment gets an in-surface ed25519 attestation, which is also the signed registry
// record. Fail-closed: out of surface -> refuse to pay.
//
// Run (testnet):
//   A2A_ENDPOINT=https://api.slippay.cc/api/v1/x402/<slug> \
//   A2A_NETWORK=testnet A2A_BUYER_SECRET=S... A2A_AGENT_ID=buyer-b \
//   A2A_MAX_PER_TX=0.10 A2A_MAX_PER_WINDOW=5 A2A_WINDOW_SECONDS=86400 \
//   SLIPPAY_ATTESTER_SECRET=<hex32> node apps/listener/a2a-buyer.mjs

import {
  Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE, Memo,
} from "@stellar/stellar-sdk";
import { appendFileSync } from "node:fs";
import { attestX402 } from "../../packages/slippay-attester/src/x402.mjs";
import { commitSurface, publicKeyHex, hexToBytes } from "../../packages/slippay-attester/src/oracle.mjs";

export const USDC_DECIMALS = 7; // Stellar USDC = 7 dp (stroops/base units)

// ---- pure helpers (unit-tested) -------------------------------------------

/** Decimal USDC string -> base units (stroops) string. Strict; rejects junk. */
export function toStroops(decimal) {
  const s = String(decimal);
  if (!/^\d+(\.\d{1,7})?$/.test(s)) throw new Error(`bad amount: ${decimal}`);
  const [i, f = ""] = s.split(".");
  const frac = (f + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return (BigInt(i) * 10n ** BigInt(USDC_DECIMALS) + BigInt(frac)).toString();
}

/** Extract the binding fields from an x402 402 body (accepts[0]). */
export function parse402(body) {
  const a = body?.accepts?.[0];
  if (!a) throw new Error("402 body has no accepts[0]");
  const p = a.payload ?? {};
  if (!a.payTo || !p.amount || !p.memo) throw new Error("402 missing payTo/amount/memo");
  return {
    payTo: a.payTo,
    amount: String(p.amount),            // decimal USDC
    assetCode: p.assetCode ?? "USDC",
    assetIssuer: p.assetIssuer,
    memo: p.memo,                        // 32-byte hex
    resource: a.resource ?? p.resource ?? "",
  };
}

/** x402 PaymentRequirements (base-unit amount) for attestX402. */
export function requirementsFrom(parsed, network, resourceUrl) {
  return {
    payTo: parsed.payTo,
    maxAmountRequired: toStroops(parsed.amount),  // base units — matches surface cap
    asset: parsed.assetCode,
    network,
    resource: resourceUrl,
    scheme: "exact",
  };
}

// ---- IO ---------------------------------------------------------------------

const netCfg = (n) => n === "public"
  ? { horizon: "https://horizon.stellar.org", passphrase: Networks.PUBLIC, explorer: "public" }
  : { horizon: "https://horizon-testnet.stellar.org", passphrase: Networks.TESTNET, explorer: "testnet" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function payUsdc({ buyer, parsed, cfg }) {
  const horizon = new Horizon.Server(cfg.horizon);
  const asset = new Asset(parsed.assetCode, parsed.assetIssuer);
  const memoBytes = Buffer.from(parsed.memo, "hex");
  if (memoBytes.length !== 32) throw new Error("bad memo length (need 32-byte hash)");
  const acc = await horizon.loadAccount(buyer.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: cfg.passphrase })
    .addOperation(Operation.payment({ destination: parsed.payTo, asset, amount: parsed.amount }))
    .addMemo(Memo.hash(memoBytes))
    .setTimeout(120).build();
  tx.sign(buyer);
  const res = await horizon.submitTransaction(tx);
  return res.hash;
}

/** The autonomous loop. Returns a result object; never throws on a refusal. */
export async function runBuyer(cfg) {
  const net = netCfg(cfg.network);
  const buyer = Keypair.fromSecret(cfg.buyerSecret);
  const attesterPriv = hexToBytes(cfg.attesterSecretHex);
  const log = (...a) => cfg.quiet || console.log(...a);

  // 1. GET -> 402
  const r1 = await fetch(cfg.endpoint);
  if (r1.status !== 402) {
    return { ok: false, stage: "get", reason: `expected 402, got ${r1.status}` };
  }
  const parsed = parse402(await r1.json());
  log(`✓ 402 · ${parsed.amount} ${parsed.assetCode} -> ${parsed.payTo.slice(0, 8)}…`);

  // 2. Mandate: commit the surface (allowed recipient = this seller, cap = max/tx),
  //    then attest. Out of surface => refuse (fail-closed). This is the decision.
  commitSurface({
    agent_id: cfg.agentId,
    allowed_recipients: [parsed.payTo],
    max_amount: toStroops(cfg.maxPerTx),
    max_per_window: cfg.maxPerWindow,
    window_seconds: cfg.windowSeconds,
  });
  const requirements = requirementsFrom(parsed, cfg.network === "public" ? "stellar" : "stellar-testnet", cfg.endpoint);
  const att = await attestX402({ agent_id: cfg.agentId, requirements }, attesterPriv);
  if (!att.ok) {
    log(`✗ refused (out of mandate): ${att.reason}`);
    return { ok: false, stage: "mandate", reason: att.reason, parsed };
  }
  log(`✓ in-mandate · attested (nonce ${att.nonce})`);

  // 3. Pay USDC autonomously
  const txHash = await payUsdc({ buyer, parsed, cfg: net });
  log(`✓ paid · ${net.explorer} tx ${txHash}`);

  // 4. Re-present until the good is released
  let content = null;
  const start = Date.now();
  while (Date.now() - start < (cfg.pollMs ?? 45_000)) {
    await sleep(2000);
    const r = await fetch(cfg.endpoint);
    if (r.status === 200) { content = await r.text(); break; }
  }

  // 5. Signed registry record (who, how much, why, under which mandate, proof)
  const record = {
    ts: new Date().toISOString(),
    agent_id: cfg.agentId,
    resource: parsed.resource || cfg.endpoint,
    payTo: parsed.payTo,
    amount: parsed.amount,
    asset: parsed.assetCode,
    network: cfg.network,
    mandate: { max_per_tx: cfg.maxPerTx, max_per_window: cfg.maxPerWindow, window_seconds: cfg.windowSeconds },
    attestation: { action_hash: att.action_hash, not_after: att.not_after, nonce: att.nonce, signature: att.signature, attester_pubkey: await publicKeyHex(attesterPriv) },
    tx_hash: txHash,
    delivered: content != null,
  };
  if (cfg.registryPath) appendFileSync(cfg.registryPath, JSON.stringify(record) + "\n");

  return { ok: content != null, stage: content != null ? "done" : "settle_timeout", txHash, content, record };
}

// ---- CLI --------------------------------------------------------------------

function cfgFromEnv() {
  const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
  return {
    endpoint: need("A2A_ENDPOINT"),
    network: process.env.A2A_NETWORK ?? "testnet",
    buyerSecret: need("A2A_BUYER_SECRET"),
    attesterSecretHex: need("SLIPPAY_ATTESTER_SECRET"),
    agentId: process.env.A2A_AGENT_ID ?? "a2a-buyer",
    maxPerTx: process.env.A2A_MAX_PER_TX ?? "0.10",
    maxPerWindow: Number(process.env.A2A_MAX_PER_WINDOW ?? "5"),
    windowSeconds: Number(process.env.A2A_WINDOW_SECONDS ?? "86400"),
    registryPath: process.env.A2A_REGISTRY ?? "a2a-registry.jsonl",
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runBuyer(cfgFromEnv())
    .then((r) => {
      if (r.ok) { console.log(`\n✓ A2A complete · delivered. registry: ${process.env.A2A_REGISTRY ?? "a2a-registry.jsonl"}`); console.log(r.content?.slice(0, 300)); }
      else { console.error(`\n✗ A2A halted at ${r.stage}: ${r.reason ?? "settlement timeout"}`); process.exit(2); }
    })
    .catch((e) => { console.error("a2a-buyer failed:", e?.response?.data ?? e?.message ?? e); process.exit(1); });
}
