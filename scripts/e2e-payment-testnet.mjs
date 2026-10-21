#!/usr/bin/env node
// End-to-end payment validation against the live slippay backend.
// Validates the full chain: subscription → charge → buyer Stellar payment →
// listener Horizon SSE → matcher → reconciler → subscription.charged webhook.
//
// Prereq: prod listener must accept the test issuer. Set on the server:
//   STELLAR_USDC_ISSUER_OVERRIDE=<issuer_pubkey>
// then `pm2 restart slippay-listener --update-env`. The script prints the
// override pubkey at the top so you can copy it.
//
// Run from /home/galmanus/projects/slippay/apps/listener (for module resolution):
//   node ../../scripts/e2e-payment-testnet.mjs
//
// Required env: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (or use defaults)

import { Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE, Memo } from "@stellar/stellar-sdk";

const API = process.env.API ?? "https://api.slippay.cc";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://nhddnulzsaubewvzspkh.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oZGRudWx6c2F1YmV3dnpzcGtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0Mjk0NDcsImV4cCI6MjA5NDAwNTQ0N30.oes6AVHX3bh7YnnwQzbOMlvy6i4h1ETonSUyc7V58HI";
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required (export from your secret manager)");
  process.exit(1);
}

const HORIZON = "https://horizon-testnet.stellar.org";
const horizon = new Horizon.Server(HORIZON);

function ok(label, ...rest) { console.log(`✓ ${label}`, ...rest); }
function info(...rest) { console.log("·", ...rest); }
function fail(label, ...rest) { console.error(`✗ ${label}`, ...rest); process.exit(1); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function friendbot(addr) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${addr}`);
  if (!r.ok && r.status !== 400) fail("friendbot", await r.text());
}

async function addTrustline(holder, asset) {
  const acc = await horizon.loadAccount(holder.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset })).setTimeout(60).build();
  tx.sign(holder);
  await horizon.submitTransaction(tx);
}

async function mint(issuer, dest, asset, amount) {
  const acc = await horizon.loadAccount(issuer.publicKey());
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: dest, asset, amount })).setTimeout(60).build();
  tx.sign(issuer);
  return await horizon.submitTransaction(tx);
}

async function payWithMemo(buyer, dest, asset, amount, memoHex) {
  const acc = await horizon.loadAccount(buyer.publicKey());
  const tx = new TransactionBuilder(acc, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    memo: Memo.hash(Buffer.from(memoHex, "hex")),
  })
    .addOperation(Operation.payment({ destination: dest, asset, amount }))
    .setTimeout(60).build();
  tx.sign(buyer);
  return await horizon.submitTransaction(tx);
}

async function main() {
  // 1. Generate fresh keypairs.
  const issuer   = Keypair.random();
  const buyer    = Keypair.random();
  const merchant = Keypair.random();
  const usdc     = new Asset("USDC", issuer.publicKey());

  console.log("\n=== TEST KEYPAIRS ===");
  console.log("ISSUER  pub: ", issuer.publicKey());
  console.log("BUYER   pub: ", buyer.publicKey());
  console.log("MERCHANT pub:", merchant.publicKey());
  console.log("\n⚠  Set on prod listener .env then `pm2 restart slippay-listener --update-env`:");
  console.log(`    STELLAR_USDC_ISSUER_OVERRIDE=${issuer.publicKey()}`);
  console.log("\nProceeding with Stellar testnet setup...\n");

  // 2. Friendbot all
  info("friendbot all 3 accounts (parallel)...");
  await Promise.all([friendbot(issuer.publicKey()), friendbot(buyer.publicKey()), friendbot(merchant.publicKey())]);
  await sleep(3000);
  ok("funded");

  // 3. Trustlines (sequential to avoid sequence collisions)
  info("adding trustlines...");
  await addTrustline(buyer, usdc);
  await addTrustline(merchant, usdc);
  ok("trustlines added");

  // 4. Mint USDC to buyer
  info("minting 1000 USDC to buyer...");
  const mintRes = await mint(issuer, buyer.publicKey(), usdc, "1000");
  ok("mint", { hash: mintRes.hash });

  // 5. Block until user has updated prod listener with the override.
  console.log("\n⏸  PAUSE: did you update prod listener with STELLAR_USDC_ISSUER_OVERRIDE?");
  console.log("   If yes, the script continues. If no, ctrl-C, fix it, re-run.");
  console.log("   Continuing in 10s...\n");
  await sleep(10_000);

  // 6. Create slippay merchant (admin user signup -> JWT -> POST /v1/merchants).
  const stamp = Date.now();
  const email = `e2e-pay-${stamp}@bluewaveai.online`;
  const password = `pw-${stamp}-aB!9xyz`;

  info("admin-creating supabase user...");
  const adminCreate = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { "apikey": SUPABASE_SERVICE, "Authorization": `Bearer ${SUPABASE_SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const adminBody = await adminCreate.json();
  if (!adminCreate.ok) fail("admin create", adminCreate.status, adminBody);
  ok("supabase user", { email });

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json();
  const jwt = loginBody.access_token;
  ok("logged in");

  info("creating slippay merchant with merchant.publicKey() as receive address...");
  const merchResp = await fetch(`${API}/api/v1/merchants`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: `E2E Pay ${stamp}`,
      stellar_address: merchant.publicKey(),
    }),
  });
  const merchBody = await merchResp.json();
  if (!merchResp.ok) fail("merchant create", merchResp.status, merchBody);
  const apiKey = merchBody.api_key;
  const merchantId = merchBody.merchant.id;
  ok("merchant", { id: merchantId, address: merchant.publicKey().slice(0,8) + "..." });

  const auth = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // 7. Create subscription + first charge → order with memo
  info("creating subscription...");
  const subResp = await fetch(`${API}/api/v1/subscriptions`, {
    method: "POST", headers: auth,
    body: JSON.stringify({
      external_ref: `e2e-pay-${stamp}`,
      asset_code: "USDC",
      brl_amount: "29.90",
      period_seconds: 86_400 * 30,
      max_periods: 12,
    }),
  });
  const sub = (await subResp.json()).subscription;
  ok("subscription", { id: sub.id });

  info("triggering first charge → materialize order...");
  const chargeResp = await fetch(`${API}/api/v1/subscriptions/${sub.id}/charge`, { method: "POST", headers: auth });
  const charge = await chargeResp.json();
  const order = charge.order;
  ok("order", { id: order.id, usdc: order.usdc_amount, memo: order.memo.slice(0,16) + "..." });

  // 8. Buyer pays the merchant USDC with the order memo.
  info("buyer paying USDC to merchant with order memo...");
  const payRes = await payWithMemo(buyer, merchant.publicKey(), usdc, order.usdc_amount, order.memo);
  ok("payment submitted", { hash: payRes.hash });

  // 9. Poll the slippay api for the order's status flipping to "paid".
  const orderUrl = `${API}/api/v1/orders/${order.id}`;
  let paid = false; let lastSeen = "pending";
  for (let i = 0; i < 60; i++) {  // up to ~60s
    const r = await fetch(orderUrl);
    const j = await r.json();
    lastSeen = j.order?.status ?? "??";
    if (lastSeen === "paid") { paid = true; break; }
    await sleep(1000);
  }
  if (!paid) fail("order never reached paid", { lastSeen });
  ok("order PAID by listener", { tx_hash: order.tx_hash });

  // 10. Verify subscription bookkeeping bumped + webhook delivery enqueued.
  await sleep(2000);
  const subAfter = await (await fetch(`${API}/api/v1/subscriptions/${sub.id}`, { headers: auth })).json();
  if (subAfter.subscription.charges_done !== 1) {
    fail("charges_done not bumped", subAfter.subscription);
  }
  ok("subscription.charges_done = 1", subAfter.subscription);

  // 11. Verify subscription.charged webhook event recorded
  const sb = await fetch(`${SUPABASE_URL}/rest/v1/webhook_deliveries?order_id=eq.${order.id}&select=type,status,attempts,payload`, {
    headers: { "apikey": SUPABASE_SERVICE, "Authorization": `Bearer ${SUPABASE_SERVICE}` },
  });
  const webhooks = await sb.json();
  if (!Array.isArray(webhooks) || webhooks.length === 0) fail("no webhook entries", webhooks);
  const subCharged = webhooks.find(w => w.type === "subscription.charged");
  if (!subCharged) fail("subscription.charged webhook NOT enqueued", webhooks);
  ok("webhook subscription.charged enqueued", { type: subCharged.type, status: subCharged.status });

  console.log("\n✅ FULL E2E CHAIN VALIDATED");
  console.log("   subscription → charge → payment → listener → reconciler → webhook");
  console.log("\n⚠  REMINDER: unset STELLAR_USDC_ISSUER_OVERRIDE on prod listener after testing.");
}

main().catch(e => { console.error("E2E payment failed:", e); process.exit(1); });
