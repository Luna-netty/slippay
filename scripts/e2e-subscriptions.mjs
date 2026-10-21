#!/usr/bin/env node
// End-to-end smoke test for slippay subscriptions in production.
// 1. Sign up a fresh Supabase auth user
// 2. Create a merchant via JWT (POST /v1/merchants)
// 3. Use returned API key to:
//    - POST /v1/subscriptions
//    - POST /v1/subscriptions/:id/charge → expect order
//    - GET  /v1/subscriptions
//    - POST /v1/subscriptions/:id/cancel
// All against https://api.slippay.cc
//
// Run from /home/galmanus/projects/slippay/apps/listener (for module resolution):
//   node ../../scripts/e2e-subscriptions.mjs

const API = process.env.API ?? "https://api.slippay.cc";
const SUPABASE_URL = "https://nhddnulzsaubewvzspkh.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oZGRudWx6c2F1YmV3dnpzcGtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0Mjk0NDcsImV4cCI6MjA5NDAwNTQ0N30.oes6AVHX3bh7YnnwQzbOMlvy6i4h1ETonSUyc7V58HI";
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY env var required (this script never embeds the secret)");
  process.exit(1);
}

function ok(label, ...rest) { console.log(`✓ ${label}`, ...rest); }
function fail(label, ...rest) { console.error(`✗ ${label}`, ...rest); process.exit(1); }

async function main() {
  const stamp = Date.now();
  const email = `e2e-sub-${stamp}@bluewaveai.online`;
  const password = `pw-${stamp}-aB!9xyz`;

  // 1. admin-create user (bypasses email validation/confirmation)
  const adminCreate = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_SERVICE,
      "Authorization": `Bearer ${SUPABASE_SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const adminBody = await adminCreate.json();
  if (!adminCreate.ok) fail("admin user create", adminCreate.status, adminBody);
  const userId = adminBody.id;
  ok("admin user created", { userId, email });

  // 2. login to grab JWT
  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json();
  if (!login.ok) fail("login", login.status, loginBody);
  const jwt = loginBody.access_token;
  if (!jwt) fail("no jwt in login response", loginBody);
  ok("login", { jwt_prefix: jwt.slice(0, 20) });

  // 3. create merchant
  const merchResp = await fetch(`${API}/api/v1/merchants`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: `E2E ${stamp}`,
      stellar_address: "GDCJ5VBKPOSZM74FWK6CELWZYZN7BRXWRHRMOIP2GJKLC5XVFG5VCV7T",
      webhook_url: "https://example.com/webhooks/slippay",
    }),
  });
  const merchBody = await merchResp.json();
  if (!merchResp.ok) fail("merchant create", merchResp.status, merchBody);
  const apiKey = merchBody.api_key;
  const merchantId = merchBody.merchant?.id;
  if (!apiKey) fail("no api_key", merchBody);
  ok("merchant", { id: merchantId, prefix: apiKey.slice(0, 16) });

  const auth = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // 3. create subscription
  const subResp = await fetch(`${API}/api/v1/subscriptions`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      external_ref: `e2e-sub-${stamp}`,
      buyer_email: "buyer@example.com",
      asset_code: "USDC",
      brl_amount: "29.90",
      period_seconds: 86400 * 30,  // 30 days
      max_periods: 12,
    }),
  });
  const subBody = await subResp.json();
  if (subResp.status !== 201) fail("subscription create", subResp.status, subBody);
  const subId = subBody.subscription.id;
  ok("subscription created", { id: subId, brl: subBody.subscription.brl_amount, period_days: subBody.subscription.period_seconds / 86400 });

  // 4. charge → expect order
  const chargeResp = await fetch(`${API}/api/v1/subscriptions/${subId}/charge`, {
    method: "POST", headers: auth,
  });
  const chargeBody = await chargeResp.json();
  if (chargeResp.status !== 201) fail("first charge", chargeResp.status, chargeBody);
  const orderId = chargeBody.order.id;
  ok("first charge → order", {
    order_id: orderId,
    usdc: chargeBody.order.usdc_amount,
    memo: chargeBody.order.memo,
    checkout: chargeBody.checkout_url,
    idempotent: chargeBody.idempotent,
  });

  // 5. second charge within same period → idempotent (returns same order)
  const chargeAgain = await fetch(`${API}/api/v1/subscriptions/${subId}/charge`, {
    method: "POST", headers: auth,
  });
  const againBody = await chargeAgain.json();
  if (!againBody.idempotent || againBody.order.id !== orderId) {
    fail("idempotency broken", { idempotent: againBody.idempotent, same_order: againBody.order?.id === orderId, body: againBody });
  }
  ok("idempotent on time", { same_order: true, status: chargeAgain.status });

  // 6. list
  const listResp = await fetch(`${API}/api/v1/subscriptions`, { headers: auth });
  const listBody = await listResp.json();
  if (!listResp.ok || !Array.isArray(listBody.subscriptions) || listBody.subscriptions.length === 0) {
    fail("list", listResp.status, listBody);
  }
  ok("list", { count: listBody.subscriptions.length });

  // 7. cancel
  const cancelResp = await fetch(`${API}/api/v1/subscriptions/${subId}/cancel`, {
    method: "POST", headers: auth,
  });
  const cancelBody = await cancelResp.json();
  if (!cancelResp.ok || cancelBody.subscription.status !== "cancelled") {
    fail("cancel", cancelResp.status, cancelBody);
  }
  ok("cancel", { status: cancelBody.subscription.status });

  // 8. charge after cancel → 409
  const after = await fetch(`${API}/api/v1/subscriptions/${subId}/charge`, {
    method: "POST", headers: auth,
  });
  if (after.status !== 409) fail("post-cancel charge should be 409", after.status);
  ok("post-cancel charge blocked", { status: 409 });

  console.log("\n✅ ALL CHECKS PASSED");
}

main().catch(e => { console.error("E2E failed:", e); process.exit(1); });
