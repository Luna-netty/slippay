import type { Context, Next } from "hono";
import { serviceClient } from "../lib/supabase.ts";
import { hashApiKey } from "../lib/apikey.ts";

// Legacy SHA-256 fallback for keys hashed before audit-004 C4 (peppered HMAC).
// Removed once all merchants rotate via /me/rotate-key.
async function legacyHashApiKey(plain: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function requireApiKey(c: Context, next: Next) {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer sk_live_")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  const plain = auth.slice("Bearer ".length);
  const sb = serviceClient();

  // Look up by peppered hash first (canonical). If miss, try legacy hash for
  // unrotated keys. Both branches still go through `.in()` exact-match on the
  // indexed column, so per-row time is constant.
  const peppered = await hashApiKey(plain);
  const legacy = await legacyHashApiKey(plain);
  const { data, error } = await sb
    .from("merchants")
    .select("*")
    .in("api_key_hash", [peppered, legacy])
    .eq("active", true)
    .maybeSingle();
  if (error || !data) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("merchant", data);
  c.set("supabase", sb);
  await next();
}
