// Audit-004 · C2 — public `GET /v1/orders/:id` is hit by an unauthenticated
// browser at checkout time, so we can't use API key auth. Instead, every
// `checkout_url` carries a signed HMAC token derived from the order id. The
// token is generated at order creation and verified on every public read.
// An attacker who guesses an order uuid cannot read it without the secret.
//
// Token is `?t=<base64url(hmac_sha256(secret, order_id))>`. Constant-time
// compare on verify.

import { b64url, b64urlDecode } from "@slippay/shared";

const ENC = new TextEncoder();
const CACHE: Record<string, CryptoKey> = {};

function getSecret(): string {
  const s = Deno.env.get("CHECKOUT_TOKEN_SECRET");
  if (!s || s.length < 32) {
    throw new Error("CHECKOUT_TOKEN_SECRET not set or < 32 chars");
  }
  return s;
}

async function getKey(): Promise<CryptoKey> {
  const secret = getSecret();
  if (CACHE[secret]) return CACHE[secret]!;
  const key = await crypto.subtle.importKey(
    "raw", ENC.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
  CACHE[secret] = key;
  return key;
}

export async function signCheckoutToken(orderId: string): Promise<string> {
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, ENC.encode(orderId));
  return b64url(sig);
}

export async function verifyCheckoutToken(orderId: string, token: string): Promise<boolean> {
  if (!token || token.length < 16) return false;
  const key = await getKey();
  let provided: Uint8Array;
  try { provided = b64urlDecode(token); } catch { return false; }
  try {
    return await crypto.subtle.verify("HMAC", key, provided, ENC.encode(orderId));
  } catch { return false; }
}
