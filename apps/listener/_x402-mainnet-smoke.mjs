#!/usr/bin/env node
// End-to-end x402 mainnet smoke:
//   1. GET /v1/x402/stellar-builder-playbook (expect 402 + memo + payTo)
//   2. Sign + submit USDC payment from deployer to merchant with that memo
//   3. Poll the endpoint until 200 with unlocked content (listener confirmed)
//
// Run from apps/listener/.

import {
  Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset,
  BASE_FEE, Memo,
} from "@stellar/stellar-sdk";
import { execSync } from "node:child_process";

const HORIZON = "https://horizon.stellar.org";
const NET = Networks.PUBLIC;
const API_BASE = "https://api.slippay.cc/api";
const SLUG = "stellar-builder-playbook";

const horizon = new Horizon.Server(HORIZON);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadSecret(name) {
  return Keypair.fromSecret(execSync(`stellar keys secret ${name}`, { encoding: "utf8" }).trim());
}

async function main() {
  const buyer = loadSecret("slippay-mainnet-deployer");
  console.log("buyer (deployer):", buyer.publicKey());

  // 1. GET 402
  const r1 = await fetch(`${API_BASE}/v1/x402/${SLUG}`);
  if (r1.status !== 402) {
    console.error(`unexpected status ${r1.status}:`, await r1.text());
    process.exit(1);
  }
  const body = await r1.json();
  const req = body.accepts[0];
  console.log("✓ 402 received");
  console.log("  payTo:", req.payTo);
  console.log("  memo:", req.payload.memo);
  console.log("  amount:", req.payload.amount, req.payload.assetCode);

  // 2. Build USDC payment with the issued memo
  const asset = new Asset(req.payload.assetCode, req.payload.assetIssuer);
  const memoBytes = Buffer.from(req.payload.memo, "hex");
  if (memoBytes.length !== 32) throw new Error("bad memo length");

  const buyerAcc = await horizon.loadAccount(buyer.publicKey());
  const tx = new TransactionBuilder(buyerAcc, { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(Operation.payment({
      destination: req.payTo,
      asset,
      amount: req.payload.amount,
    }))
    .addMemo(Memo.hash(memoBytes))
    .setTimeout(120).build();
  tx.sign(buyer);
  const submitted = await horizon.submitTransaction(tx);
  console.log(`✓ payment submitted · tx: ${submitted.hash}`);
  console.log(`  https://stellar.expert/explorer/public/tx/${submitted.hash}`);

  // 3. Poll the endpoint
  console.log("polling /v1/x402 for status flip…");
  const start = Date.now();
  while (Date.now() - start < 45_000) {
    await sleep(2000);
    const r = await fetch(`${API_BASE}/v1/x402/${SLUG}`);
    if (r.status === 200) {
      const content = await r.text();
      console.log("✓ UNLOCKED in", ((Date.now() - start) / 1000).toFixed(1), "s");
      console.log("\ncontent:\n", content.slice(0, 500));
      return;
    }
    process.stdout.write(".");
  }
  console.error("\n✗ timeout · listener did not confirm in 45s");
  process.exit(2);
}

main().catch(e => { console.error("smoke failed:", e?.response?.data ?? e); process.exit(1); });
