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

export const DB_SCHEMA = SCHEMA;

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

/**
 * Startup assertion: verify that the configured schema exists and is exposed by PostgREST.
 * Queries the core 'merchants' table. If the schema is missing or not exposed in config.toml,
 * logs a clear, actionable error and throws.
 */
export async function assertSchemaExposed(client?: SupabaseClient): Promise<void> {
  const sc = client ?? serviceClient();
  const { error } = await sc.from("merchants").select("id").limit(1);
  if (error) {
    const msg =
      `[DATABASE SCHEMA MISMATCH] Configured schema "${SCHEMA}" failed verification: ${error.message}. ` +
      `Ensure SLIPPAY_DB_SCHEMA matches your database migrations and is included in supabase/config.toml (schemas = ["..."]).`;
    console.error(msg);
    throw new Error(msg);
  }
}

