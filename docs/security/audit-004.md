# audit-004 · Supabase edge API + DB

- **status:** opened · **NO-GO** as-is
- **date:** 2026-05-16
- **scope:** `supabase/functions/api/` (~1230 LOC: index, 4 routes, 3 middleware, 6 libs) + `supabase/migrations/` (6 files, 228 LOC) + `packages/shared/src/schemas/*`
- **target deploy:** Stellar mainnet

## findings

| # | sev | category | location | title |
|---|---|---|---|---|
| C1 | **critical** | RLS bypass total | `auth_apikey.ts:12,23` · `lib/supabase.ts:18` | all routes use `serviceClient()`; RLS off; defense-in-depth = code review forever |
| C2 | **critical** | PII leak no-auth | `routes/orders.ts:82-98` | `GET /v1/orders/:id` unauthenticated; returns merchant_id, amounts, memo, stellar_address, tx_hash |
| C3 | high | error leak | `routes/{merchants,orders,subscriptions}.ts` | Postgres `error.message` echoed in 400s, leaks schema/constraint names |
| C4 | high | apikey hash | `lib/apikey.ts:10-14` | single SHA-256, no pepper; DB leak = brute-able |
| C5 | medium | apikey lookup | `auth_apikey.ts:13-21` | `verifyApiKey` (constant-time) never called; exact-string DB lookup OK for SHA-256 but limits dual-key rotation |
| C6 | **critical** | no rate limit anywhere | `lib/rate.ts` is FX, not RL | flood `/v1/ask`, `/v1/orders/:id`, `/v1/subscriptions/:id/onchain-charge` |
| C7 | **critical** | /v1/ask unauth+subprocess | `routes/ask.ts:18` · `lib/ask.ts:58-65` | spawns Claude CLI per request, no auth; OOM container, burn OAuth quota |
| H1 | high | webhook SSRF write-time | `merchants.ts:30` · `subscriptions.ts:45,92` · `shared/schemas/{merchant,subscription}.ts` | subscription `webhook_url` allows `http://`, no CIDR blocklist at write |
| H2 | low | `parseInt` no radix | `orders.ts:67` · `subscriptions.ts:58` | cosmetic; capped via Math.min |
| H3 | medium | parseFloat bound | `orders.ts:34` · `subscriptions.ts:142` | DB col `numeric(12,7)` → silent ~$100k cap; throws Postgres error → C3 leak chain |
| M1 | low | Zod issues leaked | `middleware/error.ts:9` | reveals field names/regex; OK for dev API, flag for prod |
| M2 | low | CORS wildcard | `index.ts:11` | safe (header auth) but enables unauth endpoint abuse from any origin |
| M3 | — | dup of C2 | — | — |
| M4 | info | RLS policy correct | `rls_policies.sql:15-18` | with-check OK; bypass via service_role (C1) |
| M5 | info | `network=testnet` default | `initial_schema.sql:10` | no API path to promote; manual SQL — keep, but doc |
| M6 | info | memo collision | `lib/memo.ts` | 256-bit random sha256, unique constraint — solid |
| M7 | medium | Soroban RPC unpinned | `lib/soroban.ts:25-27` | hardcoded SDF public RPC; no env override; SPOF |
| M8 | info | `/onchain-charge` returns rpc_url+passphrase | `subscriptions.ts:241-250` | not secret, unusual; couples buyer to RPC |
| I1 | info | FX cache | `lib/rate.ts:13-25` | single CoinGecko endpoint, in-process, 60s TTL, no retry — availability risk |
| I2 | info | api_key plaintext once | `merchants.ts:38` | standard Stripe-style; UI must not persist |

## RLS map (effective state)

| table | anon SELECT | auth SELECT | INSERT | UPDATE | DELETE | reality |
|---|---|---|---|---|---|---|
| merchants | deny | own row via `auth.uid()` | own | own | deny | API runs as service_role → RLS bypassed |
| orders | deny | own merchant | own | own | deny | service_role; **`/v1/orders/:id` public — C2** |
| subscriptions | deny | own merchant | own | own | deny | service_role |
| webhook_deliveries | deny | own merchant | — | — | — | listener writes as service_role |
| listener_state | RLS off | — | — | — | — | service_role convention |

net: RLS protects only future direct-from-SPA queries; never exercised by current API or tests. before mainnet, either narrow service_role usage OR test invariants prove every authed query is merchant-scoped.

## mainnet conditions

**hard blockers (NO-GO without):**

1. **C2** — auth-gate or signed-token-gate `GET /v1/orders/:id`. minimum: strip `merchant_id`, `external_ref`, `tx_hash` from public response
2. **C6/C7** — token-bucket RL middleware (per IP + per merchant.id); auth or aggressive RL on `/v1/ask`; concurrent subprocess semaphore (≤4)
3. **H1** — subscription `webhook_url` schema unify with merchant (`https://` required) + CIDR blocklist write-time
4. **C3** — map Postgres errors to opaque enum at error middleware; never echo `error.message`
5. **C4** — HMAC-SHA256 with server-side pepper env, OR Argon2id; shorten `api_key_prefix` to 4 chars
6. **C1** — narrow service_role usage OR add unit-test invariant: every query under apikey-auth includes `.eq("merchant_id", merchant.id)`

**strongly recommended:**
7. **H3** — zod refine to fit `numeric(12,7)` cap OR widen column to `numeric(18,7)`
8. **M2** — replace `cors:"*"` with explicit allowlist (app.slippay.cc, slippay.cc, per-merchant checkout domains)
9. **M7** — env-configurable Soroban RPC URL with fallback (Validation Cloud / Blockdaemon)
10. **I1** — fallback FX source + last-good cache

## confidence caveats

- `API_KEY_BYTES` / `API_KEY_PREFIX` in `@slippay/shared` not verified (assumed 32 bytes + `sk_live_`)
- whether Supabase Edge deployment exposes `auth.users` for `auth.uid()` in RLS predicates — assumed yes (standard Supabase Postgres)
- listener-side webhook URL handling (H1 needs both ends fixed) — covered in audit-003
- `pg_cron` job at `20260507120000_pg_cron_expire.sql` role assumed has UPDATE on orders
