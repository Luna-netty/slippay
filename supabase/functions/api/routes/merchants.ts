import { Hono } from "hono";
import type { SupabaseClient } from "supabase";
import { CreateMerchantInputSchema, PatchMerchantInputSchema, type Merchant } from "@slippay/shared";
import { requireJwt } from "../middleware/auth_jwt.ts";
import { generateApiKey, hashApiKey, prefixOf } from "../lib/apikey.ts";
import { mapDbError } from "../lib/db-error.ts";
import { StrKey } from "npm:@stellar/stellar-sdk";

// Hono v4 requires Variables typed on the instance for c.get/c.set.
// Using a typed Hono instance avoids `c.get("key")` returning `never`.
type AppUser = { id: string; email: string; [k: string]: unknown };
type Vars = { user: AppUser; supabase: SupabaseClient };

// The M4 lockdown migration (20260601230000_security_rls_lockdown.sql) revokes
// table-level SELECT on merchants from `authenticated` and grants only the
// non-secret columns. These routes run as the user (userClient), so select("*")
// expands to api_key_hash and webhook_secret, which the role may not read:
// Postgres answers 42501 insufficient_privilege and mapDbError turns that into
// a 403, breaking merchant creation and profile reads. Name the safe columns
// instead — they are exactly the ones the API returns anyway.
const MERCHANT_SAFE_COLUMNS =
  "id, auth_user_id, display_name, email, stellar_address, network, " +
  "api_key_prefix, webhook_url, platform_fee_bp, active, created_at";

const r = new Hono<{ Variables: Vars }>();

r.post("/", requireJwt, async (c) => {
  const user = c.get("user");
  const sb = c.get("supabase");
  const input = CreateMerchantInputSchema.parse(await c.req.json());
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey.plain);
  const prefix = prefixOf(apiKey.plain);
  const webhookSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  if (input.stellar_address != null && !StrKey.isValidEd25519PublicKey(input.stellar_address)) {
    return c.json({ error: "invalid_stellar_address" }, 400);
  }
  const { data, error } = await sb
    .from("merchants")
    .insert({
      auth_user_id: user.id,
      display_name: input.display_name,
      email: user.email,
      stellar_address: input.stellar_address ?? null,
      webhook_url: input.webhook_url ?? null,
      api_key_hash: hash,
      api_key_prefix: prefix,
      webhook_secret: webhookSecret,
    })
    .select(MERCHANT_SAFE_COLUMNS)
    .single();
  if (error) {
    const m = mapDbError(error);
    return c.json({ error: m.code }, m.status as 400 | 409);
  }
  const safe = data;
  return c.json({ merchant: safe as Merchant, api_key: apiKey.plain }, 201);
});

r.get("/me", requireJwt, async (c) => {
  const sb = c.get("supabase");
  const { data, error } = await sb.from("merchants").select(MERCHANT_SAFE_COLUMNS).maybeSingle();
  if (error || !data) return c.json({ error: "not_found" }, 404);
  const safe = data;
  return c.json({ merchant: safe as Merchant });
});

r.patch("/me", requireJwt, async (c) => {
  const user = c.get("user");
  const sb = c.get("supabase");
  const input = PatchMerchantInputSchema.parse(await c.req.json());
  if ((input as { stellar_address?: string }).stellar_address != null &&
      !StrKey.isValidEd25519PublicKey((input as { stellar_address?: string }).stellar_address!)) {
    return c.json({ error: "invalid_stellar_address" }, 400);
  }
  const { data, error } = await sb
    .from("merchants")
    .update(input)
    .eq("auth_user_id", user.id)
    .select(MERCHANT_SAFE_COLUMNS)
    .single();
  if (error) {
    const m = mapDbError(error);
    return c.json({ error: m.code }, m.status as 400 | 409);
  }
  const safe = data;
  return c.json({ merchant: safe });
});

r.post("/me/rotate-key", requireJwt, async (c) => {
  const user = c.get("user");
  const sb = c.get("supabase");
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey.plain);
  const prefix = prefixOf(apiKey.plain);
  const { error } = await sb
    .from("merchants")
    .update({ api_key_hash: hash, api_key_prefix: prefix })
    .eq("auth_user_id", user.id)
    .select("id")
    .single();
  if (error) {
    const m = mapDbError(error);
    return c.json({ error: m.code }, m.status as 400 | 409);
  }
  return c.json({ api_key: apiKey.plain });
});

export default r;
