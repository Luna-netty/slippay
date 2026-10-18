> **Historical.** Mainnet is already live: the subscription/transfer contracts
> are deployed on Stellar mainnet (`PUBLIC`). This pre-launch readiness checklist
> is kept for reference only. For deploys, see `docs/ops/deploy.md`. For the
> current network seam (mainnet vs testnet per contract), see the quickstarts.

# SlipPay — Mainnet Readiness Checklist

> Cross-reference: `docs/superpowers/specs/2026-05-07-slippay-design.md` §9 (security checklist)
> and §10 (out-of-scope items). Read the spec before working through this checklist.
>
> **Rule:** If any item below is unchecked, do **not** flip any merchant to mainnet.
> The toggle is `merchants.network = 'mainnet'` and must be executed via direct DB UPDATE by Manuel
> — never through the dashboard — until this checklist is fully closed.

---

## 1. Compliance & Legal

| # | Item | Owner | Verification |
|---|------|-------|--------------|
| 1.1 | VASP partnership for on/off-ramp BRL/PIX (provider: 4P Finance; PagFinance for off-ramp) | Marco | API key active; live transaction verified |
| 1.2 | VASP partnership signed for buyer KYC institucional (AML/KYC delegation to licensed party) | Marco | Contract specifies KYC scope, SLA, data sharing terms |
| 1.3 | Legal opinion in writing from Brazilian fintech law firm classifying SlipPay as **technology provider**, NOT PSAV under BCB Resoluções 519/520/521 | Manuel + legal counsel | Written opinion on firm letterhead; counsel named and OAB registration verified |
| 1.4 | Terms of Service (ToS) published at `/terms` on the web checkout domain and linked in the checkout iframe footer | Manuel | `curl -I https://<prod-domain>/terms` returns 200; link visible in `apps/web` checkout page source |
| 1.5 | Privacy Policy published at `/privacy` with explicit LGPD compliance notes (data controller identity, retention period, DPO contact, data subject rights) | Manuel | `curl -I https://<prod-domain>/privacy` returns 200; LGPD articles cited in the document |
| 1.6 | Brazilian CNPJ active and matching the entity used in all merchant onboarding contracts | Marco | CNPJ status "ATIVA" on receita.fazenda.gov.br; same CNPJ in merchant agreements |

- [ ] 1.1 — VASP off-ramp partnership signed
- [ ] 1.2 — VASP KYC partnership signed
- [ ] 1.3 — Legal opinion (BCB classification) on file
- [ ] 1.4 — Terms of Service published and linked
- [ ] 1.5 — Privacy Policy published (LGPD-compliant)
- [ ] 1.6 — CNPJ active and consistent across onboarding records

---

## 2. Security

### 2.1 External Audit

- [ ] Independent security audit completed on **`apps/api`**: Hono routes, RLS policies, auth flows, API key issuance
  - Pass: written report from named firm; all P0 + P1 findings tracked in issue tracker
- [ ] Independent security audit completed on **`apps/web`**: atomic tx builder, wallet integration, postMessage surfaces, no XSS vectors
  - Pass: written report; CSP tested via `curl -s -I https://<prod-domain> | grep content-security-policy`
- [ ] Independent security audit completed on **`apps/listener`**: matcher logic (`apps/listener/src/matcher.ts`), reconciler idempotency (`apps/listener/src/reconciler.ts`), webhook delivery (`apps/listener/src/webhook.ts`), SSRF guard (`apps/listener/src/ssrf.ts`)
  - Pass: written report; auditor confirmed SSRF allowlist is enforced before any outbound HTTP call
- [ ] All P0 and P1 audit findings resolved or documented as accepted risk with written rationale
  - Pass: issue tracker shows zero open P0/P1; any accepted-risk items have written sign-off from Manuel
- [ ] No HIGH or CRITICAL findings left open at launch date
  - Pass: audit firm's final summary letter states "no unresolved HIGH/CRITICAL"

### 2.2 Key Management

- [ ] Mainnet platform Stellar address generated in cold storage with multi-sig (≥ 2-of-3 signers)
  - Pass: Stellar account on mainnet shows `signers` with `weight` ≥ 2 threshold; verified via Horizon `GET /accounts/<address>`
- [ ] Platform private key never typed into a hot environment (no `.env`, no shell history, no CI secret that contains it)
  - Pass: grep on repo history (`git log -S <key-fragment> --all`) returns zero hits; CI env audit shows no raw secret
- [ ] API key hashing uses `crypto.ts` (`apps/listener/src/crypto.ts`) — confirm same pattern used in API key issuance route in `apps/api`
  - Pass: `grep -r "hashKey\|hash_key\|sha256" apps/api/src` shows consistent usage; no plaintext key stored in `api_keys` table

### 2.3 Web / Network Hardening

- [ ] CSP header active on web prod
  - Pass: `curl -s -I https://<prod-domain> | grep -i content-security-policy` returns non-empty value with `default-src`, `script-src`, `frame-ancestors` directives
- [ ] No secrets in client bundles
  - Pass: CI step `grep -rE "(sk_|secret_|PRIVATE_KEY|SUPABASE_SERVICE)" apps/web/dist/` exits non-zero (no matches)
- [ ] Rate limiting active and tested: 60 req/min per API key, 10 req/min per IP unauthenticated
  - Pass: load test script demonstrates 429 response at threshold; config visible in `apps/api` middleware
- [ ] HMAC webhook signature verification documented for merchant integrators
  - Pass: `docs/webhooks.md` published (see §4); signing algorithm and header name match implementation in `apps/listener/src/webhook.ts`

---

## 3. Operational

### 3.1 Infrastructure

- [ ] Listener deployed on Fly.io GRU region with health check endpoint responding 200
  - Pass: `fly status -a slippay-listener` shows `running`; `curl https://slippay-listener.fly.dev/healthz` returns `{"ok":true}`
- [ ] Edge functions deployed to **staging** Supabase project (`slippay-staging`)
  - Pass: `supabase functions list --project-ref <staging-ref>` shows all functions with status `active`
- [ ] Edge functions deployed to **prod** Supabase project (`slippay-prod`) — separate project, separate service-role key
  - Pass: `supabase functions list --project-ref <prod-ref>` shows all functions with status `active`; prod ref ≠ staging ref
- [ ] Migrations run cleanly on both staging and prod with zero errors
  - Pass: `supabase db remote commit` dry-run shows no pending diffs; migration history table matches repo `supabase/migrations/`
- [ ] `pg_cron` job scheduled and verified firing every 5 min on both projects (expire stale pending orders)
  - Pass: `SELECT jobname, schedule, last_run_status FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;` shows recent successful runs on both projects

### 3.2 Monitoring & Alerting

- [ ] Alert: `listener_state` staleness > 60 s triggers PagerDuty / Slack notification
  - Pass: alert rule configured; tested by pausing listener and confirming notification fires within 90 s
- [ ] Alert: webhook dead rate > 5% over 5-min window triggers notification
  - Pass: alert rule in place; threshold matches definition of `dead` state in `apps/listener/src/webhook.ts`
- [ ] Alert: edge function 5xx error rate > 1% over 5-min window triggers notification
  - Pass: Supabase log-based alert or external monitor configured
- [ ] Logs aggregation: Fly logs + Supabase logs queryable from single dashboard or CLI
  - Pass: runbook describes how on-call engineer retrieves logs for both systems within 5 min

### 3.3 On-Call & Runbooks

- [ ] On-call rotation defined: primary Marco, backup Manuel; contact method documented
  - Pass: rotation document in `docs/runbooks/on-call.md` with phone/Telegram handles
- [ ] Runbook: listener crash recovery at `docs/runbooks/listener.md`
  - Pass: file exists; covers `fly restart`, log retrieval, rollback procedure
- [ ] Runbook: Supabase outage handoff at `docs/runbooks/supabase.md`
  - Pass: file exists; covers read-only fallback, PITR restore steps, edge function disable toggle
- [ ] Runbook: Horizon outage / Stellar testnet unavailable
  - Pass: file exists at `docs/runbooks/horizon.md`; covers fallback Horizon endpoint config in `apps/listener/src/horizon.ts`
- [ ] Database backup strategy: Supabase PITR enabled on prod project, weekly logical export verified restorable
  - Pass: PITR status confirmed in Supabase dashboard; last weekly export restore drill completed and dated

---

## 4. Product & Integrations

- [ ] At least 3 pilot merchants integrated and successfully testing on testnet
  - Pass: 3 merchant records in `merchants` table with `network = 'testnet'`; each has at least one `orders` record with `status = 'paid'`
- [ ] Each pilot merchant's webhook receiver verified: endpoint returns 200 on POST; merchant confirms HMAC signature verification on their side
  - Pass: webhook delivery log shows successful delivery to each merchant's endpoint; written confirmation from merchant contact
- [ ] Public API reference published at `docs/api.md`
  - Pass: file exists; covers authentication, `/v1/orders` POST + GET, error codes, rate limits
- [ ] Public webhook integration guide published at `docs/webhooks.md`
  - Pass: file exists; covers payload schema, HMAC verification example (Node.js + Python), retry behavior, idempotency key
- [ ] Public security guide for merchants published at `docs/security.md`
  - Pass: file exists; covers API key rotation, webhook secret rotation, trustline requirement, mainnet address verification
- [ ] Embeddable SDK or postMessage protocol: **deferred to Plan D**
  - Note: this is a hard gate — do not launch public SDK until Plan D spec is written and reviewed. Merchants must use server-side API integration only at mainnet launch.

---

## 5. Per-Merchant Smoke Gate (testnet → mainnet transition)

Run this gate for **each individual merchant** before flipping their network flag. Do not batch.

- [ ] Merchant has confirmed receipt of mainnet API key and webhook secret (separate from testnet credentials)
  - Pass: confirmation message on record (email or Telegram); credentials delivered via secure channel (not plain email)
- [ ] Merchant's webhook endpoint responded successfully (HTTP 200) to at least 3 test deliveries on testnet in the past 7 days
  - Pass: `webhook_deliveries` table shows 3 successful deliveries to this merchant's endpoint within the window
- [ ] Merchant's mainnet Stellar address verified by manually paying 0.01 USDC (testnet equivalent) and confirming receipt
  - Pass: Horizon transaction record of test payment; merchant acknowledges receipt
- [ ] Merchant has signed off on integration testing in writing
  - Pass: written sign-off on record (email or signed doc)
- [ ] Mainnet trustline added on merchant's Stellar address for Circle USDC issuer
  - Issuer address: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
  - Pass: `GET https://horizon.stellar.org/accounts/<merchant-address>` shows `balances[]` entry with `asset_code: "USDC"` and `asset_issuer: GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
- [ ] `merchants.network` flipped to `'mainnet'` via direct DB UPDATE by Manuel only
  - Command: `UPDATE merchants SET network = 'mainnet' WHERE id = '<merchant-id>';`
  - Pass: executed on prod DB; confirmed by `SELECT network FROM merchants WHERE id = '<merchant-id>';`
  - **Never** expose this transition through the dashboard until the full mainnet readiness checklist is closed.

---

## 6. Final Go / No-Go

All sections above must be fully checked before any merchant goes to mainnet. The following sign-offs are required with date:

- [ ] **Marco (founder)** — confirms partnership readiness, pilot merchant readiness, product completeness
  - Date: ___________
- [ ] **Manuel (architect)** — confirms infrastructure, security posture, operational runbooks
  - Date: ___________
- [ ] **Legal counsel (named firm + OAB)** — confirms regulatory classification and ToS/Privacy Policy adequacy
  - Firm: ___________  Date: ___________
- [ ] **Security auditor (named firm)** — confirms all P0/P1 findings resolved; no open HIGH/CRITICAL
  - Firm: ___________  Date: ___________

---

## 7. Failure Modes if Mainnet Flipped Before Checklist Closed

These are the concrete risks gated by the items above. Each failure mode references the control that prevents it.

| Failure mode | Impact | Gating control |
|---|---|---|
| **Funds loss via on-chain redirect** — attacker replaces merchant Stellar address between order creation and payment matching | Buyer pays attacker; merchant never receives funds; SlipPay liable | Security audit on `apps/api` (§2.1) + matcher logic audit (`apps/listener/src/matcher.ts`) |
| **Regulatory enforcement by Banco Central** — SlipPay classified as PSAV instead of technology provider | Forced shutdown, fines, criminal exposure for founders | Legal opinion (§1.3) — this is a binary gate, not a risk to manage down |
| **Webhook URL pointing to attacker-controlled host (SSRF)** — malicious merchant registers internal URL; listener exfiltrates internal network responses | Internal service compromise; credential leakage | SSRF guard enforced in `apps/listener/src/ssrf.ts` before every outbound webhook call; confirmed by audit (§2.1) |
| **Listener silent failure** — process dies or falls behind Horizon cursor; payments go unmatched indefinitely | Merchants receive no webhook; orders stuck as `pending`; manual reconciliation required | Staleness alert > 60 s (§3.2); listener crash runbook (§3.3) |
| **Stellar SDK upgrade breaks production** — upstream `@stellar/stellar-sdk` change alters transaction parsing or Horizon response schema | Matcher silently drops valid payments; revenue loss | CI smoke tests against testnet on every dependency bump (enabled by Plan C task 7); `apps/listener/src/horizon.ts` is the integration surface to watch |
| **pg_cron job silently stops** — expired orders never cleaned up; `pending` orders accumulate; matcher retries orders past TTL | Merchant double-charges buyer if buyer retries manually | pg_cron monitoring via `cron.job_run_details` alert (§3.1) |

---

*Last updated: 2026-05-07 · Owner: Manuel (architecture) + Marco (product)*
