# SlipPay v0 · design spec

**Date:** 2026-05-07
**Author:** Manuel Galmanus + Claude Opus 4.7 (1M ctx)
**Status:** draft, pending operator review
**Register:** engineer mode (CLAUDE.md `@register_engineer`)

---

## 1. Context

SlipPay is a non-custodial USDC payment gateway for Brazilian e-commerce. Original concept and pitch deck owned by Marco Antônio (`mrcoantonioconceicao-ctrl/SlipPay2`). The existing repo at HEAD `416e184` is a ~660 LOC Rust prototype that diverges materially from the pitch deck — single-account XLM payment-link generator, hardcoded HMAC secret exposed in frontend (`src/main.rs:40-41@416e184`, `index.html:23@416e184`), no Solana, no USDC, no multi-merchant, no webhook delivery. Operator decision (2026-05-07): **scrap and rebuild from zero in the stack the pitch describes**, narrowed to single-chain v0.

### Decisions fixed before this spec

| Decision | Choice | Rationale |
|---|---|---|
| Chain v0 | Stellar only | USDC native via trustline; finality ~5s; Circle as anchor; single-dev velocity beats multi-chain parity. Solana deferred to v2 gated on ≥5 paying merchants on mainnet. |
| Build owner | Manuel + Claude end-to-end | Marco receives runnable artifact. |
| Surface scope | MVP multi-tenant | merchant signup + API + checkout + listener + webhook + minimal dashboard. No plugins, no SDK, no KYC in v0. |
| Stack | Path C — Supabase-native | Hono on Supabase Edge Functions (Deno) · Postgres + Auth + RLS · React 18 + Vite + Tailwind · listener as Node container on Fly.io GRU. |

### Falsifiable prediction at spec time (60% conf)

v0 testnet end-to-end (signup → create order → pay via Freighter testnet → webhook fires → dashboard shows paid) ships in **≤6 weeks** of operator + Claude work. Below = stack mismatch or scope creep. Above 6 weeks = recalibrate.

---

## 2. Architecture

```
                    ┌────────────────────────────────────────┐
                    │           Supabase                     │
                    │  ┌──────────┐  ┌───────────┐  ┌──────┐ │
                    │  │ Postgres │  │   Auth    │  │ RLS  │ │
                    │  └──────────┘  └───────────┘  └──────┘ │
                    │  ┌──────────────────────────────┐      │
                    │  │  Edge Functions (Hono/Deno)  │      │
                    │  │   POST /orders               │      │
                    │  │   GET  /orders/:id           │      │
                    │  │   POST /merchants            │      │
                    │  └──────────────────────────────┘      │
                    └──────▲─────────────────────────▲───────┘
                           │ service_role            │ anon+jwt
                           │                         │
                ┌──────────┴────────┐    ┌───────────┴──────────┐
                │ Listener (Fly.io  │    │  Web (Vercel)        │
                │ GRU container)    │    │  React+Vite+Tailwind │
                │ Horizon SSE       │    │  /checkout/:id       │
                │ → match memo      │    │  /dashboard          │
                │ → update orders   │    │  /signup /login      │
                │ → enqueue webhook │    │  stellar-wallets-kit │
                └──────────┬────────┘    └──────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Merchant    │
                    │  Webhook     │
                    │  Endpoint    │
                    └──────────────┘
```

### Boundary contract

| Component | Owns | Trusts | Failure mode if breach |
|---|---|---|---|
| `apps/api` | request/response, validation, order creation | Supabase JWT for merchant auth, hashed API key for machine auth | API key leak → unauthorized order creation. Mitigation: hashed in DB, displayed once at create+rotate. |
| `apps/web` | UI rendering, wallet connect, tx build/sign, submit | nothing user-controlled | XSS in checkout → wallet drain. Mitigation: no `dangerouslySetInnerHTML`, CSP header, escape merchant display_name. |
| `apps/listener` | Horizon SSE consumer, order state transition, webhook enqueue | service_role DB access | Listener crash mid-tx → cursor goes back, idempotent UPDATE WHERE status='pending' covers reprocess. |
| Webhook worker | retry semantics, HMAC signing | merchant-controlled URL | Merchant URL malicious → SSRF. Mitigation: deny RFC1918, deny localhost, deny non-HTTPS in mainnet. |

---

## 3. Components

### 3.1 `apps/api` — Hono on Supabase Edge Functions

Endpoints:

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/v1/merchants` | Supabase JWT (post-magic-link) | `{display_name, stellar_address?, webhook_url?}` | merchant + api_key (one-time reveal) |
| GET | `/v1/merchants/me` | Supabase JWT | — | merchant (no key) |
| PATCH | `/v1/merchants/me` | Supabase JWT | partial fields | merchant |
| POST | `/v1/merchants/me/rotate-key` | Supabase JWT | — | new api_key (one-time reveal) |
| POST | `/v1/orders` | API key (`Authorization: Bearer sk_live_...`) | `{brl_amount, external_ref?, expires_in_minutes?}` | `{id, checkout_url, memo, usdc_amount, expires_at}` |
| GET | `/v1/orders` | API key | query: `status,limit,cursor` | paginated |
| GET | `/v1/orders/:id` | API key OR public (limited fields) | — | order |
| POST | `/v1/orders/:id/cancel` | API key | — | order |
| POST | `/v1/test-webhook` | API key | — | enqueues fake delivery |

Validation: `zod` schemas in `packages/shared`. Rate limiting via Supabase: 60 req/min per API key, 10 req/min per IP unauth.

**Failure modes:**
- API key leak via merchant logs/CI → rotate endpoint exists, audit log on rotation.
- Edge Function cold start latency on first request (~200-400ms typical for Deno on Supabase, **unverified — measure on deploy**) → checkout page polls `/orders/:id`, not blocking on cold path.

### 3.2 `apps/web` — React 18 + Vite + Tailwind

Routes:

- `/` — marketing/landing (minimal v0)
- `/signup`, `/login` — Supabase magic-link
- `/dashboard` — orders list, API key (reveal once + rotate), webhook URL config, Stellar address config, network toggle (testnet/mainnet) gated by feature flag
- `/checkout/:order_id` — public, no auth, wallet connect via `@creit.tech/stellar-wallets-kit`, tx build + sign + submit
- `/docs` — static API reference

Wallet integration: `stellar-wallets-kit` covers Freighter, Lobstr, xBull, Albedo, Hana per pitch deck. Solana wallets out of scope.

Polling: checkout page polls `GET /v1/orders/:id` every 2s up to `expires_at`. **Disanalogy:** this is not WebSocket-grade real-time — Stellar finality is ~5s, polling 2s gives one cache miss worst case. Acceptable for v0; revisit if UX feedback demands.

**Failure modes:**
- Wallet rejection after sign → frontend retry, order remains `pending` until expiry.
- Browser closes mid-flow → user reopens checkout URL, picks up where they left off (order is the source of truth, not browser state).
- Wallet returns success but Horizon submit fails (network) → frontend shows submit retry; tx already signed, can resubmit.

### 3.3 `apps/listener` — Node container, Fly.io GRU

Single long-lived process. Two concurrent tasks:

1. **Stream watcher.** For each `merchants WHERE active=true`, subscribe to Horizon SSE `/accounts/{stellar_address}/transactions`. Match `memo_type=hash` + `memo` against `orders.memo WHERE status='pending'`. Validate amount + asset + destination.
2. **Webhook delivery worker.** Pull `webhook_deliveries WHERE next_attempt_at <= now() AND status IN ('queued','failed')` LIMIT 50 every 5s. Sign with merchant's `webhook_secret`. Schedule next attempt or mark `dead`.

Cursor: `listener_state.paging_token` per Stellar address. **Cursor advance happens BEFORE per-tx processing**, not inside the loop — this is the explicit fix for the bug in `mrcoantonioconceicao-ctrl/SlipPay2/src/main.rs:447-521@416e184` where empty-memo txs blocked cursor advance.

**Failure modes:**
- SSE drop → exponential backoff reconnect 1s→60s, resume from cursor.
- Listener crash → Fly health check restart, cursor in DB persists.
- Underpaid tx → mark `status='underpaid'`, fire webhook with flag — merchant decides accept/reject (out of scope to refund automatically).
- Duplicate confirm (already-paid order) → `UPDATE ... WHERE status='pending'` is a no-op, idempotent.
- Reorg on Stellar → effectively impossible with Stellar Consensus Protocol finality; not handled.

### 3.4 Webhook delivery semantics

- POST `Content-Type: application/json`
- Header `X-SlipPay-Signature: t=<unix>,v1=<hmac_sha256(secret, t + '.' + body)>`
- Header `X-SlipPay-Delivery-Id: <uuid>`
- Idempotency: merchant should treat `delivery_id` as the dedupe key.
- Retries: 1m, 5m, 30m, 2h, 12h, 24h. After 6 → `dead`.
- Mainnet only: deny non-HTTPS URLs and RFC1918/localhost destinations.

Payload:

```json
{
  "id": "wh_...",
  "type": "order.paid" | "order.expired" | "order.underpaid",
  "created_at": "2026-05-07T...",
  "data": {
    "id": "ord_...",
    "external_ref": "...",
    "brl_amount": "100.00",
    "usdc_amount": "20.0000000",
    "tx_hash": "...",
    "memo": "...",
    "paid_at": "2026-05-07T..."
  }
}
```

---

## 4. Data model

```sql
-- merchants
create table merchants (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique not null references auth.users(id) on delete cascade,
  display_name    text not null,
  email           text not null,
  stellar_address text,
  network         text not null default 'testnet' check (network in ('testnet','mainnet')),
  api_key_hash    text not null,
  api_key_prefix  text not null,
  webhook_url     text,
  webhook_secret  text not null,
  platform_fee_bp int  not null default 100,
  active          bool not null default true,
  created_at      timestamptz default now()
);

-- orders
create table orders (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchants(id) on delete restrict,
  external_ref    text,
  brl_amount      numeric(12,2) not null check (brl_amount > 0),
  usdc_amount     numeric(12,7) not null check (usdc_amount > 0),
  rate_brl_usdc   numeric(12,7) not null,
  memo            text not null unique,
  status          text not null default 'pending'
                  check (status in ('pending','paid','underpaid','expired','cancelled','dead')),
  tx_hash         text,
  created_at      timestamptz default now(),
  expires_at      timestamptz not null,
  paid_at         timestamptz
);
create index orders_merchant_status_idx on orders(merchant_id, status);
create index orders_memo_idx on orders(memo) where status = 'pending';

-- webhook_deliveries
create table webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  type            text not null,
  attempt_n       int not null default 0,
  status          text not null default 'queued'
                  check (status in ('queued','sent','failed','dead')),
  response_code   int,
  response_body   text,
  payload         jsonb not null,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now()
);
create index webhook_pending_idx on webhook_deliveries(next_attempt_at)
  where status in ('queued','failed');

-- listener_state
create table listener_state (
  account_id   text primary key,
  paging_token text not null,
  updated_at   timestamptz default now()
);
```

### RLS policies

```sql
alter table merchants enable row level security;
alter table orders enable row level security;
alter table webhook_deliveries enable row level security;

-- merchants: own row only
create policy merchants_self on merchants
  for all to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- orders: through merchant
create policy orders_via_merchant on orders
  for all to authenticated
  using (merchant_id in (select id from merchants where auth_user_id = auth.uid()));

-- webhooks: through merchant via order
create policy webhooks_via_merchant on webhook_deliveries
  for all to authenticated
  using (order_id in (
    select o.id from orders o
    join merchants m on m.id = o.merchant_id
    where m.auth_user_id = auth.uid()
  ));
```

Listener uses **`SUPABASE_SERVICE_ROLE_KEY`** which bypasses RLS — separate Postgres client in the listener container. **Failure mode:** service_role key leak = full DB read/write. Mitigation: only in Fly secrets, never in logs, never in shared frontend bundles. Separate test that grep's `dist/` for the key prefix as part of CI.

---

## 5. Stellar payment flow

1. Merchant: `POST /v1/orders {brl_amount: 100, external_ref: "cart_42"}` with `Authorization: Bearer sk_live_...`.
2. API:
   - Verify API key against `merchants.api_key_hash`.
   - Fetch BRL→USDC rate (provider TBD: Circle API, fallback CoinGecko, ttl 60s in-memory).
   - Compute `usdc_amount = brl_amount / rate`, round to 7 decimals (Stellar precision).
   - Generate `memo = hex(sha256(uuid_v4()))[0:64]` (32 bytes, fits memo_hash exactly).
   - INSERT order with `expires_at = now() + 30min`.
   - Return `{id, checkout_url: 'https://checkout.slippay.app/checkout/<id>', memo, usdc_amount, expires_at}`.
3. Buyer opens `/checkout/:id`. Frontend `GET /v1/orders/:id` (public limited fields).
4. Frontend renders amount, countdown, "connect wallet" button.
5. Buyer connects via `stellar-wallets-kit`. Modal lists: Freighter, Lobstr, xBull, Albedo, Hana.
6. Frontend builds atomic tx:
   ```
   sourceAccount = buyer.publicKey
   memo = MemoHash(order.memo)
   timeBounds = { maxTime: order.expires_at }
   operations:
     - payment(merchant.stellar_address, USDC_asset, usdc_amount * (1 - fee_bp/10000))
     - payment(platform.stellar_address, USDC_asset, usdc_amount * fee_bp/10000)
   ```
7. Wallet signs. Frontend submits via `server.submitTransaction(signed)` directly to Horizon. **SlipPay backend never touches the signed XDR.**
8. Listener detects on `merchant.stellar_address`, validates amount sum + asset = USDC + memo match. UPDATE `orders.status='paid'`, `tx_hash`, `paid_at`. Enqueue webhook.
9. Frontend polls `GET /v1/orders/:id` every 2s, transitions to "paid" view on confirmation.

### Edge cases

| Case | Behavior |
|---|---|
| Tx amount < expected | `status='underpaid'`, webhook with delta. Merchant decides. |
| Tx after expiry | Listener still credits if memo matches; merchant can reject in webhook handler. |
| Duplicate tx (same memo) | Idempotent UPDATE, second tx is just an extra on-chain payment merchant keeps. |
| Wrong asset (XLM not USDC) | Listener ignores. Order stays pending. |
| Buyer wallet has no USDC trustline | Tx fails on submit, frontend shows error, suggests trustline setup. |
| Expired pending order | Cron `update orders set status='expired' where status='pending' and expires_at < now()`. Webhook `order.expired`. |

---

## 6. Auth model

| Actor | Mechanism |
|---|---|
| Merchant (humano) | Supabase Auth magic link → JWT in cookie |
| Merchant (machine) | API key `sk_live_<32 random bytes hex>` in `Authorization: Bearer` header |
| Buyer | none — wallet signature is the auth |
| Listener | `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS |

API key storage: **bcrypt cost 12** of full key, plus first 8 chars in plaintext for prefix display. Reveal only at create/rotate. **Failure mode:** key transmitted in URL query → log leak. Mitigation: API rejects keys in querystring, requires header.

---

## 7. Testing

### Unit (vitest)
- Hono handlers (mocked Supabase client)
- Listener match logic (memo decode, amount validation, idempotent update)
- Rate provider (caching, fallback chain)
- HMAC sign/verify
- Coverage gate: ≥80% on `apps/api/src` and `apps/listener/src`

### Integration
- testcontainers Postgres + Supabase migrations applied
- Mock Horizon SSE feeder
- Full lifecycle: create order → simulate tx → assert listener updates + webhook enqueued

### E2E (Playwright)
- Stub wallet adapter (signs with deterministic test keypair)
- Happy path: signup → create order via API → checkout page → wallet connect → sign → wait for paid status
- CI runs against Stellar testnet on every merge to `main`, must pass before deploy.

### Smoke
- After deploy: smoke script calls live API on testnet, creates order, signs with bot keypair, asserts paid within 60s.

---

## 8. Deploy

| Surface | Target | Trigger |
|---|---|---|
| Frontend (`apps/web`) | Vercel | auto on push to `main` |
| Edge Functions (`apps/api`) | Supabase | `supabase functions deploy` in GH Actions |
| Listener (`apps/listener`) | Fly.io machine `slippay-listener` (region `gru`, 1 instance, always-on) | `flyctl deploy` in GH Actions |
| DB migrations | Supabase | `supabase db push` in GH Actions, gate on test pass |

Env separation: `slippay-staging` (testnet) and `slippay-prod` (mainnet) — separate Supabase projects, separate Fly apps, separate Vercel projects. Mainnet flip is explicit per-merchant DB toggle, gated by VASP partnership confirmation (manual ops gate).

### Cost estimate (v0, no traffic)

- Supabase free tier: $0 (until 500MB DB or 50k MAU)
- Fly.io listener: 1× shared-cpu-1x 256MB ≈ **$1.94/mo**
- Vercel hobby: $0
- Domain (slippay.app or similar): ~$12/yr

Total v0 idle cost: **~$2/mo**. Verified via Fly + Supabase pricing pages, but **revalidate at deploy** — pricing may have shifted since knowledge cutoff (Jan 2026).

---

## 9. Security checklist (v0)

- [ ] No secrets in source. `.env.example` only.
- [ ] CSP header on web: `default-src 'self'`, allow Stellar SDK CDN if used.
- [ ] CORS on API: allow checkout subdomain + dashboard subdomain only.
- [ ] API key in DB as bcrypt; reveal only at create/rotate.
- [ ] Webhook URL validation: HTTPS only on mainnet, deny RFC1918.
- [ ] Rate limit: 60/min per API key, 10/min per IP unauth.
- [ ] HMAC verify on webhook receipt side documented for merchants.
- [ ] CI grep for `SUPABASE_SERVICE_ROLE_KEY` in `dist/`.
- [ ] No `console.log` of API keys, signatures, or memos in prod.
- [ ] Stellar tx built **client-side only** — backend never holds buyer key.

**Failure mode unique to this design:** because the frontend builds the atomic tx (merchant payment + platform fee), a malicious frontend deploy could redirect the platform-fee leg to an attacker. Mitigation: deploy fingerprint pinning + Subresource Integrity on Stellar SDK + audit on `apps/web` deploys before mainnet.

---

## 10. Out of scope (v0)

Explicit non-goals — not "TBD", actively excluded:

- Solana
- VTEX / Nuvemshop / Shopify plugins
- Embeddable JS SDK (define API stability first)
- Off-ramp BRL/PIX (depends on VASP partner contract)
- Buyer KYC (depends on VASP partner)
- Merchant KYC (depends on legal review)
- Mobile native apps
- WebSocket dashboard (polling 2s sufficient)
- Multi-currency display beyond BRL
- Mainnet launch (gate: VASP partnership + audit)
- Multi-region listener HA
- Refund flow

---

## 11. Repo layout

```
slippay/
├── apps/
│   ├── web/              # React + Vite + Tailwind
│   ├── api/              # Hono (Supabase Edge Functions, Deno)
│   └── listener/         # Node container, Horizon SSE + webhook worker
├── packages/
│   └── shared/           # zod schemas, types, constants
├── supabase/
│   ├── migrations/
│   ├── functions/        # symlink or path of apps/api
│   ├── seed.sql
│   └── config.toml
├── docs/superpowers/specs/
├── .github/workflows/
├── pnpm-workspace.yaml
└── README.md
```

Monorepo via pnpm workspaces. Deno for `apps/api`, Node for `apps/listener` and `apps/web` build.

---

## 12. Pinned versions (verify at scaffold)

| Package | Version | Verified | Notes |
|---|---|---|---|
| Deno (Supabase Edge runtime) | 1.46+ | unverified | Supabase pins their runtime; check current at scaffold. |
| Hono | ^4.6 | unverified | latest stable. |
| `@stellar/stellar-sdk` | latest stable, target ≥13 | unverified | PDF cites v14; verify current at scaffold. |
| `@creit.tech/stellar-wallets-kit` | ^1.7 | unverified | latest stable. |
| React | ^18.3 | verified (knowledge cutoff Jan 2026) | |
| Vite | ^5 | verified | |
| Tailwind | ^3.4 | verified | |
| Node container | `node:22-alpine` | verified | |
| pnpm | 9.x | verified | |
| Postgres | Supabase default (15.x) | verified | |

---

## 13. Stellar specifics (verify before mainnet)

| Item | Value | Verification status |
|---|---|---|
| USDC issuer mainnet | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (Circle) | unverified — confirm via Circle docs at scaffold |
| USDC issuer testnet | Circle testnet issuer | unverified — confirm |
| Asset code | `USDC` | verified |
| Memo type used | `MemoHash` (32 bytes) | verified |
| Operation count | 2 ops per tx (merchant payment + fee payment) | verified — well under 100 op limit |
| Network passphrase mainnet | `Public Global Stellar Network ; September 2015` | verified |
| Network passphrase testnet | `Test SDF Network ; September 2015` | verified |
| Horizon endpoint mainnet | `https://horizon.stellar.org` | verified |
| Horizon endpoint testnet | `https://horizon-testnet.stellar.org` | verified |

**Verified vs unverified separation:** verified items above are knowledge cutoff Jan 2026. Anything marked unverified must be re-confirmed against live Stellar docs at implementation time. Source of truth: https://developers.stellar.org.

---

## 14. Failure modes (rolled up)

| # | Mode | Severity | Mitigation |
|---|---|---|---|
| 1 | RLS leak between merchants | high | integration test attempting cross-merchant access via Supabase client |
| 2 | Listener cursor advance bug (regression of Marco's prototype) | high | cursor advance BEFORE per-tx processing; idempotent UPDATE with `WHERE status='pending'` |
| 3 | Frontend deploy redirects platform fee to attacker | high pre-mainnet | deploy fingerprint pinning, SRI on SDK, manual deploy review pre-mainnet |
| 4 | Stellar SDK incompat with Deno on upgrade | medium | pin exact version, CI smoke test on Deno before merge |
| 5 | Service_role key leak via frontend bundle | high | CI grep on `dist/`, separate listener env |
| 6 | Webhook URL malicious (SSRF) | medium | HTTPS-only mainnet, RFC1918 deny |
| 7 | Edge Function cold start ruins checkout UX | low | checkout polls, doesn't block; cold start observable in logs |
| 8 | Wallet rejection mid-flow | low | order remains pending, retry from checkout URL |
| 9 | Underpaid tx | low | `status='underpaid'`, webhook with delta, merchant decides |
| 10 | Rate provider down | medium | fallback chain Circle → CoinGecko → cached last-known with TTL=5min |

---

## 15. Cross-domain isomorphism

Stripe's "Payment Intents" model (server creates intent → client confirms) and SlipPay's order model are structurally identical: server-side idempotency key + state machine + webhook on terminal state. **Disanalogy:** Stripe holds funds at confirmation and clears later; SlipPay never custodies — settlement is the moment the buyer signs and Horizon confirms, no clearing layer. The implication is that SlipPay's "paid" state is closer to a bank wire confirmation than to a card authorization. UX should communicate this — "paid in 5s, irrevocable" not "authorized, settling".

---

## 16. Open questions for operator review

1. **Domain.** `slippay.app`, `slippay.com.br`, `slippay.io` — Marco's preference? checkout subdomain (`checkout.slippay.app`) advisable for CSP separation.
2. **Platform fee default.** 1% (100bp) is placeholder. Stripe charges 3.99%+R$0.39 for BR cards. SlipPay's costless settlement advantage suggests 0.5-1% is defensible; confirm with Marco.
3. **Platform Stellar address.** Need a Bluewave-controlled testnet keypair to start. Mainnet keypair must be cold-storage with multisig before mainnet flip.
4. **Marco's involvement.** Decision says "Manuel + Claude end-to-end" — does Marco get read access to repo? Commit access? PR review gate?
5. **Branding/copy.** Use existing `slippay` mark from Marco's logo asset, or rebrand? Out of scope to design but blocks landing copy.

---

## Appendix A · audit pass against engineer-mode criteria

| Criterion | Met? | Where |
|---|---|---|
| ≥1 concrete number | yes | timeline (6 weeks), fee (100bp), polling (2s), retry schedule, finality (5s), bcrypt cost (12), cost estimate ($2/mo), op count (2), memo size (32 bytes) |
| Failure mode named per recommendation | yes | section 14 + scattered per-component |
| Falsifiable prediction | yes | section 1 (6 week threshold, 60% conf) |
| Disanalogy when analogy used | yes | section 15 (Stripe Payment Intents) |
| File:line@sha citation | yes | section 1 (Marco prototype refs), section 3.3 (cursor bug ref) |
| No marketing words | confirmed | scan for "revolutionary"/"exciting"/"amazing" — none |
| Verified vs unverified separation | yes | section 12, 13 |

Audit verdict at draft time: **5/5 criteria met.** Operator audit on review will determine if substance matches form.
