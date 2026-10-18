import { createClient, SupabaseClient } from "supabase";

const SCHEMA = Deno.env.get("SLIPPAY_DB_SCHEMA") ?? "public";

export function userClient(req: Request): SupabaseClient {
  const auth = req.headers.get("authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
      db: { schema: SCHEMA },
    },
  );
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false },
      db: { schema: SCHEMA },
    },
  );
}
