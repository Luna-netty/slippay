/**
 * Global setup for e2e testnet smoke.
 * Runs once before all tests in the e2e suite.
 *
 * Responsibilities:
 * - Generate fresh keypairs (buyer, merchant, platform, issuer)
 * - Fund all via Friendbot
 * - Set up trustlines (buyer, merchant, platform → test USDC)
 * - Mint 1000 test USDC to buyer
 * - Write keypairs to /tmp/e2e-keys.json for the test file to consume
 * - Set STELLAR_USDC_ISSUER_OVERRIDE in process.env so the matcher uses
 *   the test issuer instead of Circle's testnet issuer
 */

import { writeFileSync } from "fs";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON_URL);

async function friendbot(pub: string, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    const r = await fetch(`https://friendbot.stellar.org/?addr=${pub}`);
    if (r.ok) return;
    const body = await r.text();
    // If account already funded, that's fine
    if (body.includes("op_already_exists") || body.includes("createAccountAlreadyExist")) return;
    if (i < retries - 1) {
      console.warn(`[globalSetup] friendbot attempt ${i + 1} failed for ${pub}: ${r.status} — retrying in 3s`);
      await new Promise(res => setTimeout(res, 3000));
    } else {
      throw new Error(`friendbot failed for ${pub}: ${r.status} ${body}`);
    }
  }
}

async function addTrustline(holder: Keypair, asset: Asset): Promise<void> {
  const acc = await horizon.loadAccount(holder.publicKey());
  // Check if trustline already exists
  const existingTrustline = (acc.balances as Array<{ asset_code?: string; asset_issuer?: string }>)
    .find(b => b.asset_code === asset.code && b.asset_issuer === asset.issuer);
  if (existingTrustline) {
    console.log(`[globalSetup] trustline already exists for ${holder.publicKey().slice(0,8)}...`);
    return;
  }
  const builder = new TransactionBuilder(acc, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60);
  const tx = builder.build();
  tx.sign(holder);
  await horizon.submitTransaction(tx);
}

export async function setup(): Promise<void> {
  console.log("[globalSetup] generating keypairs...");
  const buyer = Keypair.random();
  const merchant = Keypair.random();
  const platform = Keypair.random();
  const issuer = Keypair.random();

  const usdc = new Asset("USDC", issuer.publicKey());

  console.log("[globalSetup] funding via Friendbot (parallel)...");
  // Fund in parallel but friendbot may rate-limit; stagger if needed
  await Promise.all([
    friendbot(buyer.publicKey()),
    friendbot(merchant.publicKey()),
    friendbot(platform.publicKey()),
    friendbot(issuer.publicKey()),
  ]);
  console.log("[globalSetup] all accounts funded");

  // Small delay to let ledger settle
  await new Promise(res => setTimeout(res, 3000));

  // Add trustlines sequentially to avoid sequence number collisions
  console.log("[globalSetup] adding trustlines...");
  await addTrustline(buyer, usdc);
  await addTrustline(merchant, usdc);
  await addTrustline(platform, usdc);
  console.log("[globalSetup] trustlines set");

  // Issuer mints 1000 USDC to buyer
  console.log("[globalSetup] minting 1000 test USDC to buyer...");
  const issuerAcc = await horizon.loadAccount(issuer.publicKey());
  const mintBuilder = new TransactionBuilder(issuerAcc, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: buyer.publicKey(),
        asset: usdc,
        amount: "1000",
      }),
    )
    .setTimeout(60);
  const mintTx = mintBuilder.build();
  mintTx.sign(issuer);
  const mintRes = await horizon.submitTransaction(mintTx);
  console.log(`[globalSetup] mint tx: ${(mintRes as { hash: string }).hash}`);

  // Set override so matcher accepts our test issuer
  process.env.STELLAR_USDC_ISSUER_OVERRIDE = issuer.publicKey();

  // Write keypairs to /tmp for the test to consume
  const keys = {
    buyer: { publicKey: buyer.publicKey(), secretKey: buyer.secret() },
    merchant: { publicKey: merchant.publicKey(), secretKey: merchant.secret() },
    platform: { publicKey: platform.publicKey(), secretKey: platform.secret() },
    issuer: { publicKey: issuer.publicKey(), secretKey: issuer.secret() },
  };
  writeFileSync("/tmp/e2e-keys.json", JSON.stringify(keys, null, 2));
  console.log("[globalSetup] keypairs written to /tmp/e2e-keys.json");
  console.log(`[globalSetup] STELLAR_USDC_ISSUER_OVERRIDE=${issuer.publicKey()}`);
}

export async function teardown(): Promise<void> {
  // nothing to tear down; testnet accounts are ephemeral
}
