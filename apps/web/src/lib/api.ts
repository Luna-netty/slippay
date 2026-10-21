const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:54321/functions/v1/api";

// Audit-004 · C2: PublicOrder no longer carries merchant_id / external_ref /
// tx_hash. The checkout page does not need them, and exposing them on an
// endpoint reachable by the customer's browser leaks merchant-side info.
export interface PublicOrder {
  id: string;
  brl_amount: string | number | null;
  usd_amount: string | null;
  usdc_amount: string;
  memo: string;
  status: string;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
  merchant_stellar_address: string | null;
}

// DEMO ONLY. The storefront creates a real order by calling the merchant
// API with a demo merchant key. A production storefront would NEVER ship a
// secret key in the browser bundle — order creation belongs on the
// merchant's server. This key is a local-testnet demo merchant, scoped to
// the local stack, and is acceptable only for the screen-share demo.
export async function createDemoOrder(brlAmount: string): Promise<{ checkout_url: string; order: { id: string; usdc_amount: string; memo: string } }> {
  const key = import.meta.env.VITE_DEMO_MERCHANT_KEY as string | undefined;
  if (!key) throw new Error("VITE_DEMO_MERCHANT_KEY not set");
  const r = await fetch(`${API_BASE}/v1/orders`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ brl_amount: brlAmount }),
  });
  if (!r.ok) throw new Error(`create_order_${r.status}`);
  return r.json();
}

export async function fetchOrder(id: string, token?: string): Promise<PublicOrder> {
  // Resolve the checkout token from caller, then URL search params (for the
  // typical case where the customer landed via `/checkout/:id?t=...`).
  let t = token;
  if (!t && typeof window !== "undefined") {
    t = new URLSearchParams(window.location.search).get("t") ?? undefined;
  }
  const qs = t ? `?t=${encodeURIComponent(t)}` : "";
  const r = await fetch(`${API_BASE}/v1/orders/${id}${qs}`);
  if (!r.ok) throw new Error(`fetch_order_${r.status}`);
  const j = await r.json() as { order: PublicOrder };
  return j.order;
}
