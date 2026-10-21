import { Hono } from "hono";
import type { SupabaseClient } from "supabase";
import { requireApiKeyOrJwt } from "../middleware/auth_any.ts";
import { mapDbError } from "../lib/db-error.ts";

type Vars = { merchant: { id: string; platform_fee_bp?: number; [k: string]: unknown }; supabase: SupabaseClient };
const r = new Hono<{ Variables: Vars }>();

// Capture model A (off-chain invoice). Aggregates the per-order platform fee
// (persisted on each order as `fee_usdc`) into a billable total for a period —
// the data SlipPay invoices the merchant from. Read endpoint: dashboard (JWT)
// or API key. Default window = current calendar month.
//
// GET /v1/billing/fees?from=ISO&to=ISO
r.get("/fees", requireApiKeyOrJwt, async (c) => {
  const merchant = c.get("merchant");
  const sb = c.get("supabase");

  const now = new Date();
  const defFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const from = c.req.query("from") ?? defFrom;
  const to = c.req.query("to") ?? now.toISOString();

  // Only paid orders are billable.
  const { data, error } = await sb
    .from("orders")
    .select("usdc_amount, fee_usdc, platform_fee_bp")
    .eq("merchant_id", merchant.id)
    .eq("status", "paid")
    .gte("paid_at", from)
    .lte("paid_at", to);
  if (error) { const m = mapDbError(error); return c.json({ error: m.code }, m.status as 400 | 409); }

  const rows = data ?? [];
  const sum = (k: string) => rows.reduce((a, o) => a + parseFloat((o as Record<string, string>)[k] ?? "0"), 0);
  const feeTotal = sum("fee_usdc");
  const grossTotal = sum("usdc_amount");

  return c.json({
    merchant_id: merchant.id,
    period: { from, to },
    orders_count: rows.length,
    gross_usdc: grossTotal.toFixed(7),
    fee_usdc_total: feeTotal.toFixed(7),     // what SlipPay invoices for the period
    net_usdc_total: (grossTotal - feeTotal).toFixed(7),
    platform_fee_bp: Number(merchant.platform_fee_bp ?? 98),
  });
});

export default r;
