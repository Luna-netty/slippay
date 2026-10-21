#!/usr/bin/env node
// Provision the local end-user checkout demo on Stellar TESTNET.
//
// Generates a self-controlled USDC issuer + merchant + platform + buyer,
// funds them via friendbot, sets USDC trustlines, and mints USDC to the
// buyer. Outputs every keypair + the env values to wire into the web app
// and the listener.
//
// Run from apps/listener:  node _provision-demo.mjs
import {
  Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE,
} from "@stellar/stellar-sdk";

const HORIZON = "https://horizon-testnet.stellar.org";
const NET = Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ASSET_CODE = "USDC";

async function fund(addr) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${addr}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot ${addr}: ${r.status}`);
}

async function trust(kp, asset) {
  const acc = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60).build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
}

async function pay(fromKp, toPub, asset, amount) {
  const acc = await horizon.loadAccount(fromKp.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(Operation.payment({ destination: toPub, asset, amount }))
    .setTimeout(60).build();
  tx.sign(fromKp);
  await horizon.submitTransaction(tx);
}

async function main() {
  const issuer = Keypair.random();
  const merchant = Keypair.random();
  const platform = Keypair.random();
  const buyer = Keypair.random();

  console.error("· funding 4 accounts via friendbot...");
  await Promise.all([issuer, merchant, platform, buyer].map((k) => fund(k.publicKey())));
  await sleep(4000);

  const usdc = new Asset(ASSET_CODE, issuer.publicKey());

  console.error("· setting USDC trustlines (merchant, platform, buyer)...");
  for (const kp of [merchant, platform, buyer]) await trust(kp, usdc);

  console.error("· minting 5000 USDC to buyer...");
  await pay(issuer, buyer.publicKey(), usdc, "5000");

  const out = {
    issuer: { pub: issuer.publicKey(), secret: issuer.secret() },
    merchant: { pub: merchant.publicKey(), secret: merchant.secret() },
    platform: { pub: platform.publicKey(), secret: platform.secret() },
    buyer: { pub: buyer.publicKey(), secret: buyer.secret() },
  };
  console.log(JSON.stringify(out, null, 2));
  console.error("\n✅ provisioned. buyer holds 5000 USDC:" + issuer.publicKey().slice(0, 8));
}

main().catch((e) => { console.error("provision failed:", e?.response?.data ?? e); process.exit(1); });
