import { Hono } from "hono";
import type { SupabaseClient } from "supabase";
import {
  CreateSubscriptionInputSchema,
  UpdateSubscriptionInputSchema,
  LimitQuerySchema,
  ORDER_DEFAULT_EXPIRY_MINUTES,
  DEFAULT_PLATFORM_FEE_BP,
} from "@slippay/shared";
import { requireApiKey } from "../middleware/auth_apikey.ts";
import { requireApiKeyOrJwt } from "../middleware/auth_any.ts";
import { generateMemo } from "../lib/memo.ts";
import { getBrlPerUsdc } from "../lib/rate.ts";
import { buildChargeTransaction } from "../lib/soroban.ts";
import { signCheckoutToken } from "../lib/checkout-token.ts";
import { mapDbError } from "../lib/db-error.ts";

type Vars = { merchant: { id: string; [k: string]: unknown }; supabase: SupabaseClient };
const r = new Hono<{ Variables: Vars }>();

const CHECKOUT_BASE = Deno.env.get("CHECKOUT_BASE_URL") ?? "http://localhost:5173";

const SOROBAN_NETWORK = (Deno.env.get("STELLAR_NETWORK")?.toLowerCase() ?? "testnet") as
  "testnet" | "mainnet";
// Network-CORRECT contract selection. The previous code preferred the testnet
// contract regardless of SOROBAN_NETWORK — on a PUBLIC/mainnet config that would
// silently bind subscriptions to the testnet contract id. Pick by network.
const SOROBAN_CONTRACT_DEFAULT =
  SOROBAN_NETWORK === "mainnet"
    ? (Deno.env.get("SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET") ?? null)
    : (Deno.env.get("SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET") ?? null);

// POST /v1/subscriptions — create a subscription
r.post("/", requireApiKey, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  let input: ReturnType<typeof CreateSubscriptionInputSchema.parse>;
  try {
    input = CreateSubscriptionInputSchema.parse(await c.req.json());
  } catch (e: unknown) {
    const issues = (e as { issues?: unknown }).issues ?? (e as { errors?: unknown }).errors ?? [];
    return c.json({ error: "validation_error", issues }, 400);
  }
  const { data, error } = await sb.from("subscriptions").insert({
    merchant_id: merchant.id,
    external_ref: input.external_ref ?? null,
    buyer_stellar_address: input.buyer_stellar_address ?? null,
    buyer_email: input.buyer_email ?? null,
    asset_code: input.asset_code,
    brl_amount: input.brl_amount,
    period_seconds: input.period_seconds,
    max_periods: input.max_periods ?? null,
    expires_at: input.expires_at ?? null,
    webhook_url: input.webhook_url ?? null,
    metadata: input.metadata ?? {},
    next_charge_at: new Date().toISOString(),
  }).select("*").single();
  if (error) { const m = mapDbError(error); return c.json({ error: m.code }, m.status as 400 | 409); }
  return c.json({ subscription: data }, 201);
});

// GET /v1/subscriptions — list merchant's subscriptions
r.get("/", requireApiKeyOrJwt, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const status = c.req.query("status");
  const limit = LimitQuerySchema.parse(c.req.query("limit"));
  let q = sb.from("subscriptions").select("*").eq("merchant_id", merchant.id)
    .order("created_at", { ascending: false }).limit(limit);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) { const m = mapDbError(error); return c.json({ error: m.code }, m.status as 400 | 409); }
  return c.json({ subscriptions: data ?? [] });
});

// GET /v1/subscriptions/:id — single subscription
r.get("/:id", requireApiKeyOrJwt, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const id = c.req.param("id");
  const { data, error } = await sb.from("subscriptions")
    .select("*").eq("id", id).eq("merchant_id", merchant.id).maybeSingle();
  if (error || !data) return c.json({ error: "not_found" }, 404);
  return c.json({ subscription: data });
});

// PATCH /v1/subscriptions/:id — update status/webhook/metadata
r.patch("/:id", requireApiKey, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const id = c.req.param("id");
  let input: ReturnType<typeof UpdateSubscriptionInputSchema.parse>;
  try {
    input = UpdateSubscriptionInputSchema.parse(await c.req.json());
  } catch (e: unknown) {
    const issues = (e as { issues?: unknown }).issues ?? (e as { errors?: unknown }).errors ?? [];
    return c.json({ error: "validation_error", issues }, 400);
  }
  const patch: Record<string, unknown> = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.webhook_url !== undefined) patch.webhook_url = input.webhook_url;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  if (input.soroban_contract_id !== undefined) patch.soroban_contract_id = input.soroban_contract_id;
  if (input.soroban_subscription_id !== undefined) patch.soroban_subscription_id = input.soroban_subscription_id;
  if (Object.keys(patch).length === 0) {
    return c.json({ error: "empty_update" }, 400);
  }
  const { data, error } = await sb.from("subscriptions")
    .update(patch).eq("id", id).eq("merchant_id", merchant.id)
    .select("*").maybeSingle();
  if (error || !data) {
    if (error) { const m = mapDbError(error); return c.json({ error: m.code }, m.status as 400 | 409); }
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ subscription: data });
});

// POST /v1/subscriptions/:id/charge — materialize the next billing cycle as an order
r.post("/:id/charge", requireApiKey, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const id = c.req.param("id");

  const { data: sub, error: fetchErr } = await sb.from("subscriptions")
    .select("*").eq("id", id).eq("merchant_id", merchant.id).maybeSingle();
  if (fetchErr || !sub) return c.json({ error: "not_found" }, 404);
  if (sub.status !== "active") {
    return c.json({ error: "not_active", status: sub.status }, 409);
  }
  if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
    await sb.from("subscriptions").update({ status: "expired" }).eq("id", id);
    return c.json({ error: "expired" }, 409);
  }
  if (sub.max_periods && sub.charges_done >= sub.max_periods) {
    await sb.from("subscriptions").update({ status: "expired" }).eq("id", id);
    return c.json({ error: "max_periods_reached" }, 409);
  }

  // Idempotency on time: don't create a new order if the previous one is still
  // pending and within the same period window.
  const { data: openOrder } = await sb.from("orders")
    .select("*").eq("subscription_id", id).eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (openOrder) {
    const openToken = await signCheckoutToken(openOrder.id as string);
    return c.json({
      order: openOrder,
      checkout_url: `${CHECKOUT_BASE}/checkout/${openOrder.id}?t=${openToken}`,
      idempotent: true,
    }, 200);
  }

  const rate = await getBrlPerUsdc();
  const usdc = (parseFloat(sub.brl_amount) / rate).toFixed(7);
  const memo = await generateMemo();
  const expiresAt = new Date(Date.now() + ORDER_DEFAULT_EXPIRY_MINUTES * 60_000).toISOString();
  const nextChargeAt = new Date(Date.now() + sub.period_seconds * 1000).toISOString();

  const feeBp = Number((merchant as { platform_fee_bp?: number }).platform_fee_bp ?? DEFAULT_PLATFORM_FEE_BP);
  const grossUsdc = parseFloat(usdc);
  const feeUsdc = (grossUsdc * feeBp / 10_000).toFixed(7);

  const { data: order, error: orderErr } = await sb.from("orders").insert({
    merchant_id: merchant.id,
    // Pin the consented payout address at charge time (recipient-drift defense).
    merchant_stellar_address: merchant.stellar_address ?? null,
    subscription_id: id,
    external_ref: sub.external_ref,
    brl_amount: sub.brl_amount,
    usdc_amount: usdc,
    rate_brl_usdc: rate.toFixed(7),
    memo,
    expires_at: expiresAt,
    platform_fee_bp: feeBp,
    fee_usdc: feeUsdc,
  }).select("*").single();
  if (orderErr) { const m = mapDbError(orderErr); return c.json({ error: m.code }, m.status as 400 | 409); }

  // Bump subscription bookkeeping; charges_done is incremented on payment in
  // the listener (see matcher.ts), not here, since this is just an invoice.
  await sb.from("subscriptions").update({
    last_charge_at: new Date().toISOString(),
    next_charge_at: nextChargeAt,
  }).eq("id", id);

  const orderToken = await signCheckoutToken(order.id as string);
  return c.json({
    order,
    checkout_url: `${CHECKOUT_BASE}/checkout/${order.id}?t=${orderToken}`,
    idempotent: false,
  }, 201);
});

// POST /v1/subscriptions/:id/cancel — convenience over PATCH
r.post("/:id/cancel", requireApiKey, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const id = c.req.param("id");
  const { data, error } = await sb.from("subscriptions")
    .update({ status: "cancelled" })
    .eq("id", id).eq("merchant_id", merchant.id).neq("status", "cancelled")
    .select("*").maybeSingle();
  if (error || !data) return c.json({ error: "cannot_cancel" }, 400);
  return c.json({ subscription: data });
});

// POST /v1/subscriptions/:id/onchain-charge — build an unsigned Soroban
// charge transaction. The api never holds the buyer's secret; it returns
// the unsigned XDR for the buyer to sign externally (Freighter, Lab) and
// submit. After submission, the contract emits subscription_charged event
// and the buyer's balance is debited atomically by the SAC.
//
// Requires:
//   - subscription.soroban_contract_id set (or env-default contract)
//   - subscription.soroban_subscription_id set (32-byte hex nonce)
//   - request body: { buyer_address: "G..." }
r.post("/:id/onchain-charge", requireApiKey, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");
  const id = c.req.param("id");

  let body: { buyer_address?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body OK */ }
  const buyer = body.buyer_address ?? null;
  if (!buyer || buyer.length !== 56 || !buyer.startsWith("G")) {
    return c.json({ error: "invalid_buyer_address", detail: "expected 56-char Stellar pubkey" }, 400);
  }

  const { data: sub, error: fetchErr } = await sb.from("subscriptions")
    .select("*").eq("id", id).eq("merchant_id", merchant.id).maybeSingle();
  if (fetchErr || !sub) return c.json({ error: "not_found" }, 404);
  if (sub.status !== "active") {
    return c.json({ error: "not_active", status: sub.status }, 409);
  }

  const contractId = sub.soroban_contract_id ?? SOROBAN_CONTRACT_DEFAULT;
  if (!contractId) {
    return c.json({
      error: "no_onchain_contract",
      detail: `subscription has no soroban_contract_id and SLIPPAY_SUBSCRIPTION_CONTRACT_${SOROBAN_NETWORK.toUpperCase()} env not set`,
    }, 409);
  }
  if (!sub.soroban_subscription_id) {
    return c.json({
      error: "no_onchain_id",
      detail: "subscription.soroban_subscription_id (32-byte hex nonce) not set; PATCH it first",
    }, 409);
  }

  let result;
  try {
    result = await buildChargeTransaction({
      contractId,
      subscriptionNonce: sub.soroban_subscription_id,
      buyerAddress: buyer,
      network: SOROBAN_NETWORK,
    });
  } catch (e: unknown) {
    return c.json({ error: "build_failed", detail: String((e as Error).message ?? e) }, 400);
  }

  return c.json({
    onchain_charge: result,
    instructions: [
      "1. Buyer signs the unsigned_xdr with their Stellar wallet (Freighter, Lab, or stellar-sdk).",
      "2. Submit the signed XDR via SorobanRpc sendTransaction at rpc_url.",
      "3. The contract emits subscription_charged on success; SAC debits buyer + credits merchant atomically.",
      "4. Optionally call this api with the resulting tx_hash to update slippay's charges_done counter (TBD endpoint).",
    ],
    contract_explorer: `https://stellar.expert/explorer/${SOROBAN_NETWORK === "mainnet" ? "public" : "testnet"}/contract/${contractId}`,
  }, 200);
});

export default r;
