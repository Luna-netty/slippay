#!/usr/bin/env node
// Provision a self-contained A2A testnet world: a test-USDC issuer, seller A,
// buyer B. Funds all via friendbot, sets trustlines, issues test USDC to B.
// Zero real value — a closed loop to prove the agent-to-agent payment circuit.
//
// Writes apps/listener/.a2a-testnet.json (gitignored) with keys + addresses and
// prints the env to run the seller + buyer. Run: node apps/listener/a2a-testnet-setup.mjs

import {
  Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE,
} from "@stellar/stellar-sdk";
import { writeFileSync } from "node:fs";

const HORIZON = "https://horizon-testnet.stellar.org";
const NET = Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function friendbot(pk, label) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${pk}`);
  if (!r.ok) throw new Error(`friendbot failed for ${label}: ${r.status}`);
  console.log(`✓ funded ${label} ${pk.slice(0, 8)}…`);
}

async function submit(sourceKp, buildOps, label) {
  const acc = await horizon.loadAccount(sourceKp.publicKey());
  const b = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NET });
  buildOps(b);
  const tx = b.setTimeout(60).build();
  tx.sign(sourceKp);
  const res = await horizon.submitTransaction(tx);
  console.log(`✓ ${label} · ${res.hash.slice(0, 10)}…`);
  return res.hash;
}

async function main() {
  const issuer = Keypair.random();
  const seller = Keypair.random();
  const buyer = Keypair.random();
  console.log("issuer:", issuer.publicKey());
  console.log("seller (A):", seller.publicKey());
  console.log("buyer  (B):", buyer.publicKey());

  await friendbot(issuer.publicKey(), "issuer");
  await friendbot(seller.publicKey(), "seller");
  await friendbot(buyer.publicKey(), "buyer");
  await sleep(2000);

  const USDC = new Asset("USDC", issuer.publicKey());

  // Trustlines: seller + buyer trust the test USDC.
  await submit(seller, (b) => b.addOperation(Operation.changeTrust({ asset: USDC })), "seller trustline");
  await submit(buyer, (b) => b.addOperation(Operation.changeTrust({ asset: USDC })), "buyer trustline");

  // Issue test USDC to the buyer so it can pay.
  await submit(issuer, (b) => b.addOperation(Operation.payment({ destination: buyer.publicKey(), asset: USDC, amount: "10" })), "issue 10 USDC to buyer");

  const out = {
    network: "testnet",
    issuer: { public: issuer.publicKey(), secret: issuer.secret() },
    seller: { public: seller.publicKey(), secret: seller.secret() },
    buyer: { public: buyer.publicKey(), secret: buyer.secret() },
    usdc_issuer: issuer.publicKey(),
  };
  writeFileSync(new URL("./.a2a-testnet.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log("\n✓ wrote apps/listener/.a2a-testnet.json");
  console.log("\n--- run the seller (terminal 1) ---");
  console.log(`A2A_SELLER_SECRET=${seller.secret()} A2A_USDC_ISSUER=${issuer.publicKey()} A2A_AMOUNT=0.01 PORT=8788 node apps/listener/a2a-seller.mjs`);
  console.log("\n--- run the buyer (terminal 2) ---");
  console.log(`A2A_ENDPOINT=http://localhost:8788/datum A2A_NETWORK=testnet A2A_BUYER_SECRET=${buyer.secret()} A2A_AGENT_ID=buyer-b A2A_MAX_PER_TX=0.10 SLIPPAY_ATTESTER_SECRET=$(openssl rand -hex 32) A2A_REGISTRY=apps/listener/a2a-registry.jsonl node apps/listener/a2a-buyer.mjs`);
}

main().catch((e) => { console.error("setup failed:", e?.response?.data ?? e?.message ?? e); process.exit(1); });
