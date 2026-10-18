// Ramp provider webhooks (CriptoPix today).
//
// CriptoPix POSTs transaction status here with an `Authorization: Bearer <JWT>`
// signed HS256 with our partner `clientSecret` (payload: { businessId }). We
// verify the signature, then upsert the status into `ramp_transactions` so the
// Anchor read methods can resolve it (the provider has no GET-by-id endpoint).
//
// Mount: api.route("/v1/ramp", ramp)  → POST /api/v1/ramp/criptopix/webhook
//
// The endpoint is public (no API key) but authenticated by the JWT HMAC — only
// a caller holding the clientSecret can forge a valid token. Returns 200 only
// after a successful upsert so CriptoPix retries on transient failure.

import { Hono, type Context } from "hono";
import { b64url, b64urlDecode } from "@slippay/shared";
import { upsertRampTxFromWebhook, type CnopWebhookBody } from "../lib/ramp/store.ts";

const r = new Hono();
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Verify an HS256 JWT against `secret`. Returns the decoded payload or null. */
async function verifyHs256(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = await crypto.subtle.sign("HMAC", key, enc.encode(`${h}.${p}`));
  if (b64url(new Uint8Array(expected)) !== sig) return null;
  try {
    return JSON.parse(dec.decode(b64urlDecode(p))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function bearer(c: Context): string | null {
  const h = c.req.header("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Health/registration probe: lets the provider (or a browser) confirm the URL
// is alive before the integration is enabled. Always 200.
r.get("/criptopix/webhook", (c) =>
  c.json({ ok: true, endpoint: "criptopix-webhook", method: "POST" }));

r.post("/criptopix/webhook", async (c) => {
  const secret = Deno.env.get("CRIPTOPIX_CLIENT_SECRET")?.trim();
  // Gated (no secret yet): ack so the provider can register/validate the URL.
  // Real notifications are JWT-verified once CRIPTOPIX_CLIENT_SECRET is set.
  if (!secret) return c.json({ ok: true, gated: true });

  const token = bearer(c);
  if (!token) return c.json({ error: "missing_token" }, 401);

  const payload = await verifyHs256(token, secret);
  if (!payload) return c.json({ error: "invalid_token" }, 401);

  // Optional: pin to a known business id when configured.
  const expectBiz = Deno.env.get("CRIPTOPIX_BUSINESS_ID")?.trim();
  if (expectBiz && payload.businessId !== expectBiz) {
    return c.json({ error: "business_mismatch" }, 401);
  }

  let body: CnopWebhookBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }

  try {
    const key = await upsertRampTxFromWebhook(body);
    if (!key) return c.json({ error: "no_transaction_id" }, 422);
    return c.json({ ok: true, id: key });
  } catch (e) {
    // 5xx so CriptoPix retries.
    return c.json({ error: "store_failed", message: String((e as Error).message) }, 502);
  }
});

export default r;
