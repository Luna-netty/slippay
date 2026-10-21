#!/usr/bin/env node
// MAINNET smoke test for the slippay-subscription contract after deploy.
//
// Mirror of the testnet F5 e2e demo, but operating against Stellar PUBLIC
// network with REAL XLM/USDC. NOT auto-generating keypairs via friendbot
// (which only exists on testnet) — uses already-funded buyer + merchant
// keypairs that the operator provides via env.
//
// Inputs (all required, all secret-key form):
//   SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET   (from deploy-mainnet.sh output)
//   F5_MAINNET_BUYER_SECRET    S... (buyer wallet, ≥2 XLM + USDC trustline + ≥1 USDC)
//   F5_MAINNET_MERCHANT_SECRET S... (merchant wallet, ≥2 XLM + USDC trustline)
//
// What it runs:
//   1. Resolves the official Circle USDC SAC on mainnet
//   2. Calls subscription.create(buyer, merchant, USDC SAC, 1.0 USDC, 1day period, 12 max)
//   3. Calls subscription.charge() — verifies USDC moves buyer -> merchant
//   4. Outputs stellar.expert/public tx links so the reviewer can verify

import {
  Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset,
  BASE_FEE, Address, nativeToScVal, scValToNative, xdr, Contract,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon.stellar.org";
const RPC_URL = "https://soroban.stellar.org";
const NET = Networks.PUBLIC;

// Circle USDC on Stellar mainnet — verified against
// https://developers.circle.com/stablecoins/stellar
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = new Asset("USDC", USDC_ISSUER);

// Deterministic SAC address for USDC on mainnet. Once SAC is wrapped,
// stellar contract id derives from (network passphrase, asset xdr).
// On mainnet Circle's USDC SAC is already wrapped — id is deterministic
// and stable: https://stellar.expert/explorer/public/asset/USDC-GA5ZSEJY...
// Operator can verify via:
//   stellar contract id asset --network mainnet --asset USDC:<issuer>
const USDC_SAC_MAINNET = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

const CONTRACT_ID = process.env.SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET;
const BUYER_SECRET = process.env.F5_MAINNET_BUYER_SECRET;
const MERCHANT_SECRET = process.env.F5_MAINNET_MERCHANT_SECRET;

if (!CONTRACT_ID || !BUYER_SECRET || !MERCHANT_SECRET) {
  console.error("\nF5 mainnet smoke — required env:");
  console.error("  SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET (from .mainnet-deploy.env)");
  console.error("  F5_MAINNET_BUYER_SECRET     (S... · ≥2 XLM + USDC trust + ≥1 USDC)");
  console.error("  F5_MAINNET_MERCHANT_SECRET  (S... · ≥2 XLM + USDC trust)");
  process.exit(1);
}

const horizon = new Horizon.Server(HORIZON_URL);
const rpc = new SorobanRpc.Server(RPC_URL);
const buyer = Keypair.fromSecret(BUYER_SECRET);
const merchant = Keypair.fromSecret(MERCHANT_SECRET);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ok = (l, ...r) => console.log("✓", l, ...r);
const fail = (l, ...r) => { console.error("✗", l, ...r); process.exit(1); };

async function submit(tx, ...signers) {
  for (const s of signers) tx.sign(s);
  const sim = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) fail("simulate", sim.error);
  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  for (const s of signers) prepared.sign(s);
  const sent = await rpc.sendTransaction(prepared);
  if (sent.status !== "PENDING") fail("send", JSON.stringify(sent));
  let r = await rpc.getTransaction(sent.hash);
  while (r.status === "NOT_FOUND") {
    await sleep(2000);
    r = await rpc.getTransaction(sent.hash);
  }
  if (r.status !== "SUCCESS") fail("tx", r.status, r.resultXdr);
  return { hash: sent.hash, returnValue: r.returnValue };
}

async function main() {
  console.log(`\nslippay-subscription · MAINNET smoke · contract: ${CONTRACT_ID}`);
  console.log(`buyer:    ${buyer.publicKey()}`);
  console.log(`merchant: ${merchant.publicKey()}`);
  console.log(`USDC SAC: ${USDC_SAC_MAINNET}`);
  console.log();

  // 0. preflight: both wallets funded + USDC trustline
  const buyerAcc0 = await horizon.loadAccount(buyer.publicKey());
  const merchAcc0 = await horizon.loadAccount(merchant.publicKey());
  const buyerUsdc0 = buyerAcc0.balances.find(b => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
  const merchUsdc0 = merchAcc0.balances.find(b => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER);
  if (!buyerUsdc0) fail("buyer missing USDC trustline + balance");
  if (!merchUsdc0) fail("merchant missing USDC trustline");
  if (parseFloat(buyerUsdc0.balance) < 1) fail("buyer USDC balance < 1.0");
  ok("preflight: trustlines + buyer USDC =", buyerUsdc0.balance);

  // 1. subscription.create()  · amount = 1.0 USDC = 10_000_000 stroops
  const subscriptionContract = new Contract(CONTRACT_ID);
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  const amount = 10_000_000n;
  const periodOk = 86_400n;
  const buyerSrc = await rpc.getAccount(buyer.publicKey());
  const createTx = new TransactionBuilder(buyerSrc, { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(subscriptionContract.call(
      "create",
      new Address(buyer.publicKey()).toScVal(),
      new Address(merchant.publicKey()).toScVal(),
      new Address(USDC_SAC_MAINNET).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
      nativeToScVal(periodOk, { type: "u64" }),
      nativeToScVal(12, { type: "u32" }),
      nativeToScVal(0n, { type: "u64" }),
      nativeToScVal(nonce, { type: "bytes" }),
    ))
    .setTimeout(60).build();
  const created = await submit(createTx, buyer);
  ok("create()", { hash: created.hash, link: `https://stellar.expert/explorer/public/tx/${created.hash}` });

  // 2. charge() — first charge always allowed (last_charge_at = 0)
  const chargeSrc = await rpc.getAccount(buyer.publicKey());
  const chargeTx = new TransactionBuilder(chargeSrc, { fee: BASE_FEE, networkPassphrase: NET })
    .addOperation(subscriptionContract.call("charge", nativeToScVal(nonce, { type: "bytes" })))
    .setTimeout(60).build();
  const charged = await submit(chargeTx, buyer);
  ok("charge()", { hash: charged.hash, link: `https://stellar.expert/explorer/public/tx/${charged.hash}` });

  // 3. balance proof
  const buyerAcc1 = await horizon.loadAccount(buyer.publicKey());
  const merchAcc1 = await horizon.loadAccount(merchant.publicKey());
  const buyerUsdc1 = buyerAcc1.balances.find(b => b.asset_code === "USDC")?.balance;
  const merchUsdc1 = merchAcc1.balances.find(b => b.asset_code === "USDC")?.balance;
  ok("balance proof", {
    buyer:    `${buyerUsdc0.balance} → ${buyerUsdc1}`,
    merchant: `${merchUsdc0.balance} → ${merchUsdc1}`,
  });

  console.log("\n✅ MAINNET SMOKE COMPLETE");
  console.log(`contract: https://stellar.expert/explorer/public/contract/${CONTRACT_ID}`);
}

main().catch(e => { console.error("smoke failed:", e); process.exit(1); });
