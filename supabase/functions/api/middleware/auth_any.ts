import type { Context, Next } from "hono";
import { serviceClient, userClient } from "../lib/supabase.ts";
import { requireApiKey } from "./auth_apikey.ts";

// Dual auth for read endpoints consumed by BOTH the public API (merchant
// integrations, e.g. the WooCommerce plugin, with `Bearer sk_live_...`) AND
// the merchant dashboard (logged-in session, `Bearer <supabase_jwt>`).
//
// Bug it fixes: the dashboard `/v1/orders` list authenticated with the user's
// Supabase JWT but the route only accepted API keys (`requireApiKey`), so the
// request was rejected and the dashboard rendered "0 orders" for every
// merchant regardless of real data.
//
// Both branches set `c.get("merchant")` and a service-role `supabase` client so
// downstream handlers (which filter by `merchant_id`) are identical. Ownership
// is verified before the service client is exposed: the JWT branch only resolves
// the merchant row whose `auth_user_id` matches the authenticated user.
export async function requireApiKeyOrJwt(c: Context, next: Next) {
  const auth = c.req.header("authorization");

  // API-key path (sk_live_...) — delegate to the canonical middleware.
  if (auth?.startsWith("Bearer sk_live_")) {
    return requireApiKey(c, next);
  }

  // Session path — verify the JWT, then resolve the merchant owned by the user.
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  const userSb = userClient(c.req.raw);
  const { data: u, error: ue } = await userSb.auth.getUser();
  if (ue || !u.user) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  const svc = serviceClient();
  const { data: merchant, error: me } = await svc
    .from("merchants")
    .select("*")
    .eq("auth_user_id", u.user.id)
    .eq("active", true)
    .maybeSingle();
  if (me || !merchant) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("user", u.user);
  c.set("merchant", merchant);
  c.set("supabase", svc);
  await next();
}
