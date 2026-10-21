-- supabase/migrations/20260601230000_security_rls_lockdown.sql
--
-- Security RLS lockdown. Closes four confirmed findings (H4, H5, M5, M4)
-- where tables were either missing RLS entirely or exposed secret columns
-- to PostgREST under the default Supabase client grants.
--
-- Access patterns were verified against the codebase before authoring; the
-- per-table comments below cite the evidence. The Stellar listener
-- (apps/listener/src/db.ts) and the edge API (supabase/functions/api) both
-- build their clients with SUPABASE_SERVICE_ROLE_KEY for these tables, and
-- service_role BYPASSES row level security and is unaffected by these
-- revokes. We do NOT revoke from service_role or postgres.

-- ---------------------------------------------------------------------------
-- H4 · x402_resources — anon could read every merchant's inline_content /
-- redirect_url / usd_amount / slug, and under default grants PATCH
-- redirect_url or zero usd_amount to hijack paid flows. The table never had
-- RLS enabled.
--
-- Access pattern CONFIRMED service-role-only:
--   * merchant register/list:  supabase/functions/api/routes/x402.ts:69,93
--     use c.get("supabase"), which requireApiKey sets to serviceClient()
--     (supabase/functions/api/middleware/auth_apikey.ts:18,35).
--   * payer GET /:slug:        supabase/functions/api/routes/x402.ts:116
--     calls serviceClient() directly.
--   * dashboard (apps/web):    reaches these rows only via authFetch("/v1/...")
--     REST calls to the edge function (apps/web/src/pages/Dashboard*.tsx),
--     never via direct PostgREST .from("x402_resources"). The browser
--     supabase client (apps/web/src/lib/auth.tsx:7) is anon, used only for
--     auth sessions.
-- Because NO client role (anon or authenticated) ever touches this table
-- directly, the correct fix is a BLANKET revoke + RLS enable, NOT a
-- merchant-scoped authenticated policy. A scoped policy would be dead code
-- here and would widen the surface for no functional gain.
alter table x402_resources enable row level security;
revoke all on table x402_resources from anon, authenticated;
comment on table x402_resources is
  'H4 lockdown 2026-06-01: RLS enabled + all client-role grants revoked. Served exclusively by the edge API service-role client (supabase/functions/api/routes/x402.ts). No anon/authenticated PostgREST access by design.';

-- ---------------------------------------------------------------------------
-- H5 · listener_leases — RLS disabled meant anon DELETE/INSERT could strip
-- or forge the per-account exclusivity lease, causing double-charge or a
-- settlement DoS.
--
-- Access pattern CONFIRMED service-role-only: only apps/listener/src/lease.ts
-- (insert/select/update/delete at lines 41-96) touches it, via the
-- service-role client db (apps/listener/src/db.ts:14, built with
-- config.supabaseServiceRoleKey). No edge function or browser path references
-- this table.
alter table listener_leases enable row level security;
revoke all on table listener_leases from anon, authenticated;
comment on table listener_leases is
  'H5 lockdown 2026-06-01: RLS enabled + all client-role grants revoked. Exclusivity lease managed solely by the listener service-role client (apps/listener/src/lease.ts). Forging/stripping the lease was a double-charge / settlement-DoS vector.';

-- ---------------------------------------------------------------------------
-- M5 · listener_state — RLS disabled let anon read watched Stellar
-- account_ids and corrupt Horizon paging cursors ("paid but not credited").
--
-- Access pattern CONFIRMED service-role-only: only apps/listener/src/horizon.ts
-- (select/upsert at lines 23,49,74) touches it, via the same service-role
-- client db (apps/listener/src/db.ts:14). No edge function or browser path
-- references this table.
alter table listener_state enable row level security;
revoke all on table listener_state from anon, authenticated;
comment on table listener_state is
  'M5 lockdown 2026-06-01: RLS enabled + all client-role grants revoked. Horizon paging cursors owned solely by the listener service-role client (apps/listener/src/horizon.ts). Corrupting the cursor caused "paid but not credited".';

-- ---------------------------------------------------------------------------
-- M4 · merchants — row-level RLS already exists (merchants_self_select, etc.
-- in 20260507100100_rls_policies.sql), but it is row-scoped only: a logged-in
-- merchant can SELECT their OWN cleartext webhook_secret and api_key_hash
-- columns directly via PostgREST, bypassing the edge-function column strip.
--
-- Fix: column-level grants. Revoke the blanket SELECT from authenticated,
-- then re-grant SELECT on only the non-secret columns. The existing
-- row-level policy stays intact and still constrains WHICH rows are visible;
-- this adds WHICH columns are visible on top.
--
-- Secret columns EXCLUDED from the grant: api_key_hash, webhook_secret.
-- (Schema verified: 20260507100000_initial_schema.sql lines 4-17; no later
-- migration adds columns to merchants — 20260526114600 only changes a
-- default; there is no pepper column on this table, the HMAC pepper lives in
-- the edge env, not the schema.)
--
-- INSERT/UPDATE grants are intentionally left untouched: the merchants_self_*
-- write policies in 20260507100100 require auth_user_id = auth.uid(), and a
-- merchant legitimately rotates their own webhook_url/stellar_address through
-- the edge API. We only narrow READ exposure of the two secret columns.
revoke select on table merchants from authenticated;
grant select (
  id,
  auth_user_id,
  display_name,
  email,
  stellar_address,
  network,
  api_key_prefix,
  webhook_url,
  platform_fee_bp,
  active,
  created_at
) on table merchants to authenticated;
comment on table merchants is
  'M4 lockdown 2026-06-01: column-level SELECT for authenticated excludes api_key_hash and webhook_secret. Row-level policy merchants_self_select (20260507100100) still applies. Secrets are only ever served stripped via the edge API.';

-- ---------------------------------------------------------------------------
-- APPLY: this changes live data-plane access; apply to the hosted Supabase
-- project as a deploy step (supabase db push / migration), NOT auto-applied
-- here.
-- ---------------------------------------------------------------------------
