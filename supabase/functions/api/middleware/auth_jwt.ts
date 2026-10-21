import type { Context, Next } from "hono";
import { userClient } from "../lib/supabase.ts";

export async function requireJwt(c: Context, next: Next) {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  const sb = userClient(c.req.raw);
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("user", data.user);
  c.set("supabase", sb);
  await next();
}
