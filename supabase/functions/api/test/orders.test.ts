import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { req } from "./_helpers.ts";
import { serviceClient } from "../lib/supabase.ts";

async function createMerchant() {
  const sb = serviceClient();
  const email = `m-${crypto.randomUUID()}@slippay.test`;
  const { data: u, error: errCreate } = await sb.auth.admin.createUser({ email, email_confirm: true, password: "test-password-1234" });
  if (errCreate) throw errCreate;
  const { data: s, error: errSign } = await sb.auth.signInWithPassword({ email, password: "test-password-1234" });
  if (errSign) throw errSign;
  const create = await req("/v1/merchants", {
    method: "POST",
    headers: { authorization: `Bearer ${s.session!.access_token}`, "content-type": "application/json" },
    // A checksum-valid ed25519 address. "G" + "A".repeat(55) has the right
    // shape but a bad CRC16, so POST /v1/merchants answered 400 and this
    // helper returned an error body with no api_key — every caller then sent
    // "Bearer undefined" and got 401.
    body: JSON.stringify({
      display_name: "T",
      stellar_address: "GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P",
    }),
  });
  return await create.json();
}

Deno.test("POST /v1/orders without api key returns 401", async () => {
  const res = await req("/v1/orders", { method: "POST", body: JSON.stringify({ brl_amount: "10.00" }) });
  assertEquals(res.status, 401);
});

Deno.test("POST /v1/orders creates order, returns checkout_url + memo + usdc_amount", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const m = await createMerchant();
  const res = await req("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "100.00", external_ref: "cart_1" }),
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assert(body.order.id);
  assertEquals(body.order.status, "pending");
  assert(body.order.memo.length === 64);
  assert(parseFloat(body.order.usdc_amount) > 0);
  assert(body.checkout_url.includes(body.order.id));
});

Deno.test("POST /v1/orders rejects invalid amount", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const m = await createMerchant();
  const res = await req("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "0.00" }),
  });
  assertEquals(res.status, 400);
});

Deno.test("POST /v1/orders with valid usd_amount sets usdc_amount equal to input without toFixed coercion", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const m = await createMerchant();
  const res = await req("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ usd_amount: "10.50", external_ref: "cart_usd" }),
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.order.usd_amount, "10.50");
  assertEquals(body.order.usdc_amount, "10.50");
});

Deno.test("POST /v1/orders rejects over-precise or non-positive usd_amount with 400", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const m = await createMerchant();
  // Over-precise (> 7 decimals)
  const resOver = await req("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ usd_amount: "10.12345678" }),
  });
  assertEquals(resOver.status, 400);

  // Non-positive (0.00)
  const resZero = await req("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ usd_amount: "0.00" }),
  });
  assertEquals(resZero.status, 400);

  // Non-positive (-1.00)
  const resNeg = await req("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ usd_amount: "-1.00" }),
  });
  assertEquals(resNeg.status, 400);
});

Deno.test("GET /v1/orders lists own orders only", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const a = await createMerchant();
  const b = await createMerchant();
  await req("/v1/orders", { method: "POST",
    headers: { authorization: `Bearer ${a.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "10.00" }) });
  await req("/v1/orders", { method: "POST",
    headers: { authorization: `Bearer ${b.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "20.00" }) });
  const res = await req("/v1/orders", { headers: { authorization: `Bearer ${a.api_key}` } });
  const body = await res.json();
  assertEquals(body.orders.length, 1);
  assertEquals(body.orders[0].brl_amount, "10.00");
});

Deno.test("GET /v1/orders rejects invalid limit with 400 validation error", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const m = await createMerchant();
  for (const invalid of ["abc", "-1", "0"]) {
    const res = await req(`/v1/orders?limit=${invalid}`, {
      headers: { authorization: `Bearer ${m.api_key}` },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "validation_error");
  }
});

Deno.test("GET /v1/orders accepts limit=250 and caps at 200", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const m = await createMerchant();
  const res = await req("/v1/orders?limit=250", {
    headers: { authorization: `Bearer ${m.api_key}` },
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(Array.isArray(body.orders));
  assert(body.orders.length <= 200);
});

Deno.test("GET /v1/orders/:id requires signed token (audit-004 C2)", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const m = await createMerchant();
  const c = await req("/v1/orders", { method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "50.00" }) });
  const cbody = await c.json();
  const { order } = cbody;

  // Without token → 401
  const unauth = await req(`/v1/orders/${order.id}`);
  assertEquals(unauth.status, 401);

  // With invalid token → 401
  const bad = await req(`/v1/orders/${order.id}?t=deadbeef`);
  assertEquals(bad.status, 401);

  // checkout_url carries the valid token; using it returns 200 with PII stripped
  const url = new URL(cbody.checkout_url);
  const token = url.searchParams.get("t");
  assert(token && token.length > 16);
  const ok = await req(`/v1/orders/${order.id}?t=${token}`);
  assertEquals(ok.status, 200);
  const body = await ok.json();
  assertEquals(body.order.id, order.id);
  // PII strip: these fields must NOT appear in the public response
  assertEquals("merchant_id" in body.order, false);
  assertEquals("external_ref" in body.order, false);
  assertEquals("tx_hash" in body.order, false);
  assertEquals("api_key_hash" in body.order, false);
  assert(typeof body.order.merchant_stellar_address === "string" || body.order.merchant_stellar_address === null);
});

Deno.test("POST /v1/orders/:id/cancel marks status cancelled", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const m = await createMerchant();
  const c = await req("/v1/orders", { method: "POST",
    headers: { authorization: `Bearer ${m.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: "5.00" }) });
  const { order } = await c.json();
  const res = await req(`/v1/orders/${order.id}/cancel`, { method: "POST",
    headers: { authorization: `Bearer ${m.api_key}` } });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.order.status, "cancelled");
});

Deno.test("orders.fee_usdc constraint rejects negative values and enforces NOT NULL", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const sb = serviceClient();
  const m = await createMerchant();

  // 1. Rejects negative fee_usdc
  const { error: negErr } = await sb.from("orders").insert({
    merchant_id: m.merchant.id,
    brl_amount: "10.00",
    usdc_amount: "1.7241379",
    rate_brl_usdc: "5.80",
    memo: "m_neg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 50),
    fee_usdc: -1,
  });
  assert(negErr !== null, "insert with negative fee_usdc must be rejected");

  // 2. Rejects NULL fee_usdc
  const { error: nullErr } = await sb.from("orders").insert({
    merchant_id: m.merchant.id,
    brl_amount: "10.00",
    usdc_amount: "1.7241379",
    rate_brl_usdc: "5.80",
    memo: "m_null_" + crypto.randomUUID().replace(/-/g, "").slice(0, 50),
    fee_usdc: null as any,
  });
  assert(nullErr !== null, "insert with null fee_usdc must be rejected");

  // 3. Valid insert succeeds
  const { data: okData, error: okErr } = await sb.from("orders").insert({
    merchant_id: m.merchant.id,
    brl_amount: "10.00",
    usdc_amount: "1.7241379",
    rate_brl_usdc: "5.80",
    memo: "m_ok_" + crypto.randomUUID().replace(/-/g, "").slice(0, 50),
    fee_usdc: "0.0168965",
  }).select("*").single();
  assert(okErr === null, "valid insert must succeed");
  assertEquals(parseFloat(okData.fee_usdc), 0.0168965);
});

Deno.test("orders.platform_fee_bp constraint rejects out-of-bounds values, enforces NOT NULL, and defaults to 297", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const sb = serviceClient();
  const m = await createMerchant();

  // 1. Rejects negative platform_fee_bp (< 0)
  const { error: negErr } = await sb.from("orders").insert({
    merchant_id: m.merchant.id,
    brl_amount: "10.00",
    usdc_amount: "1.7241379",
    rate_brl_usdc: "5.80",
    memo: "m_fee_neg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 40),
    fee_usdc: "0.0168965",
    platform_fee_bp: -1,
  });
  assert(negErr !== null, "insert with negative platform_fee_bp must be rejected");

  // 2. Rejects platform_fee_bp > 1000 (> 10%)
  const { error: highErr } = await sb.from("orders").insert({
    merchant_id: m.merchant.id,
    brl_amount: "10.00",
    usdc_amount: "1.7241379",
    rate_brl_usdc: "5.80",
    memo: "m_fee_high_" + crypto.randomUUID().replace(/-/g, "").slice(0, 40),
    fee_usdc: "0.0168965",
    platform_fee_bp: 1001,
  });
  assert(highErr !== null, "insert with platform_fee_bp > 1000 must be rejected");

  // 3. Rejects NULL platform_fee_bp
  const { error: nullErr } = await sb.from("orders").insert({
    merchant_id: m.merchant.id,
    brl_amount: "10.00",
    usdc_amount: "1.7241379",
    rate_brl_usdc: "5.80",
    memo: "m_fee_null_" + crypto.randomUUID().replace(/-/g, "").slice(0, 40),
    fee_usdc: "0.0168965",
    platform_fee_bp: null as any,
  });
  assert(nullErr !== null, "insert with null platform_fee_bp must be rejected");

  // 4. Default 297 applies when omitted
  const { data: defData, error: defErr } = await sb.from("orders").insert({
    merchant_id: m.merchant.id,
    brl_amount: "10.00",
    usdc_amount: "1.7241379",
    rate_brl_usdc: "5.80",
    memo: "m_fee_def_" + crypto.randomUUID().replace(/-/g, "").slice(0, 40),
    fee_usdc: "0.0168965",
  }).select("*").single();
  assert(defErr === null, "insert without explicit platform_fee_bp must succeed");
  assertEquals(defData.platform_fee_bp, 297);
});

Deno.test("GET /v1/x402/:slug sets platform_fee_bp and fee_usdc on order insert", { sanitizeOps: false, sanitizeResources: false }, async () => {
  const sb = serviceClient();
  const m = await createMerchant();
  const slug = "test-fee-" + crypto.randomUUID().slice(0, 8);
  const { data: resData, error: resErr } = await sb.from("x402_resources").insert({
    merchant_id: m.merchant.id,
    slug,
    usd_amount: "5.0000000",
    inline_content: "hello protected content",
    inline_mime: "text/plain",
  }).select("*").single();
  assert(resErr === null);

  const res = await req(`/v1/x402/${slug}`, { method: "GET" });
  assertEquals(res.status, 402);

  const { data: orderData, error: ordErr } = await sb.from("orders")
    .select("platform_fee_bp, fee_usdc, usdc_amount")
    .eq("x402_resource_id", resData.id)
    .single();
  assert(ordErr === null);
  assertEquals(orderData.platform_fee_bp, 297);
  assertEquals(orderData.fee_usdc, "0.1485000"); // 5.0 * 297 / 10000
});