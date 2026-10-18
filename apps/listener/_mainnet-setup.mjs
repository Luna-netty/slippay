#!/usr/bin/env node
// One-shot mainnet setup for x402 demo + smoke testing.
//
// Sequence:
//   1. Deployer creates merchant account (5 XLM starting balance)
//   2. Deployer opens USDC trustline
//   3. Merchant opens USDC trustline
//   4. Deployer swaps ~5 XLM → ~$0.5 USDC via path-payment on SDF DEX
//
// All txs land on Stellar PUBLIC. Run from apps/listener dir for sdk path.

import {
  Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset,
  BASE_FEE, Memo,
} from "@stellar/stellar-sdk";
import { execSync } from "node:child_process";

const HORIZON = "https://horizon.stellar.org";
const NET = Networks.PUBLIC;
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = new Asset("USDC", USDC_ISSUER);
const XLM = Asset.native();

function loadSecret(name) {
  // Delegate seed-phrase → S... derivation to the stellar CLI, which
  // already knows the right derivation path (m/44'/148'/0').
  const sk = execSync(`stellar keys secret ${name}`, { encoding: "utf8" }).trim();
  return Keypair.fromSecret(sk);
}

const horizon = new Horizon.Server(HORIZON);
const ok = (l, ...r) => console.log("✓", l, ...r);

async function submit(tx, ...signers) {
  for (const s of signers) tx.sign(s);
  return await horizon.submitTransaction(tx);
}

async function main() {
  const deployer = loadSecret("slippay-mainnet-deployer");
  const merchant = loadSecret("slippay-mainnet-merchant");
  console.log("deployer:", deployer.publicKey());
  console.log("merchant:", merchant.publicKey());

  // Check current balances first
  let merchantExists = false;
  try {
    await horizon.loadAccount(merchant.publicKey());
    merchantExists = true;
  } catch { /* not yet created */ }

  // 1. Create merchant account if missing
  if (!merchantExists) {
    const src = await horizon.loadAccount(deployer.publicKey());
    const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: NET })
      .addOperation(Operation.createAccount({
        destination: merchant.publicKey(),
        startingBalance: "5",
      }))
      .setTimeout(120).build();
    const r = await submit(tx, deployer);
    ok("merchant account created · tx:", r.hash);
  } else {
    ok("merchant account already exists");
  }

  // 2. Deployer USDC trustline (if missing)
  const deployerAcc = await horizon.loadAccount(deployer.publicKey());
  const deployerHasTrust = deployerAcc.balances.some(b =>
    b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
  if (!deployerHasTrust) {
    const tx = new TransactionBuilder(deployerAcc, { fee: BASE_FEE, networkPassphrase: NET })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(120).build();
    const r = await submit(tx, deployer);
    ok("deployer USDC trustline opened · tx:", r.hash);
  } else {
    ok("deployer already has USDC trustline");
  }

  // 3. Merchant USDC trustline
  const merchantAcc = await horizon.loadAccount(merchant.publicKey());
  const merchantHasTrust = merchantAcc.balances.some(b =>
    b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
  if (!merchantHasTrust) {
    const tx = new TransactionBuilder(merchantAcc, { fee: BASE_FEE, networkPassphrase: NET })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(120).build();
    const r = await submit(tx, merchant);
    ok("merchant USDC trustline opened · tx:", r.hash);
  } else {
    ok("merchant already has USDC trustline");
  }

  // 4. Path payment: deployer XLM → deployer USDC, ~$0.5
  const fresh = await horizon.loadAccount(deployer.publicKey());
  const usdcBal = parseFloat(fresh.balances.find(b => b.asset_code === "USDC")?.balance ?? "0");
  if (usdcBal < 0.4) {
    // Need ~$0.5 USDC. Send max 6 XLM, receive 0.5 USDC. Path = direct.
    const tx = new TransactionBuilder(fresh, { fee: BASE_FEE, networkPassphrase: NET })
      .addOperation(Operation.pathPaymentStrictReceive({
        sendAsset: XLM,
        sendMax: "6",            // max 6 XLM to spend
        destination: deployer.publicKey(),
        destAsset: USDC,
        destAmount: "0.5",       // receive exactly 0.5 USDC
        path: [],                 // direct XLM→USDC orderbook
      }))
      .setTimeout(120).build();
    try {
      const r = await submit(tx, deployer);
      ok("path-payment XLM→USDC · 0.5 USDC acquired · tx:", r.hash);
    } catch (e) {
      console.error("path payment failed (orderbook?):", e.response?.data?.extras?.result_codes ?? e.message);
      process.exit(1);
    }
  } else {
    ok("deployer already holds ≥0.4 USDC, skipping swap");
  }

  // Final state
  const finalDeployer = await horizon.loadAccount(deployer.publicKey());
  const finalMerchant = await horizon.loadAccount(merchant.publicKey());
  console.log("\n=== FINAL STATE ===");
  console.log("deployer:");
  finalDeployer.balances.forEach(b => console.log(`  ${b.asset_type === "native" ? "XLM" : b.asset_code}: ${b.balance}`));
  console.log("merchant:");
  finalMerchant.balances.forEach(b => console.log(`  ${b.asset_type === "native" ? "XLM" : b.asset_code}: ${b.balance}`));
}

main().catch(e => { console.error("setup failed:", e?.response?.data ?? e); process.exit(1); });
