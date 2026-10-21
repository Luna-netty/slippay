import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { config } from "./config.js";

const SCHEMA = process.env.SLIPPAY_DB_SCHEMA ?? "public";

// Cast to the default-generic SupabaseClient so consumers (watchAccount,
// startWebhookWorker, reconcileMatch, etc.) receive a uniformly-typed
// client regardless of which schema we routed it at runtime.
//
// `transport: ws` is required on Node < 22 (no native WebSocket); supabase-js
// 2.105+ throws at construction otherwise even though the listener never uses
// realtime.
export const db: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { persistSession: false },
    db: { schema: SCHEMA },
    realtime: { transport: WebSocket as unknown as never },
  },
) as unknown as SupabaseClient;
