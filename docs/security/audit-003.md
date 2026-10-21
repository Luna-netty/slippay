# audit-003 · listener (Stellar→webhook)

- **status:** opened · **NO-GO** as-is
- **date:** 2026-05-16
- **scope:** `apps/listener/src/{config,crypto,db,horizon,log,main,manager,matcher,reconciler,ssrf,webhook}.ts` (464 LOC) + listener tests + `supabase/migrations/20260507100000_initial_schema.sql` + `packages/shared/src/constants.ts`
- **confidence:** 80% findings complete on supplied source; Horizon SDK reorg/replay semantics under node failover unverified without runtime test

## findings

| # | sev | category | location | title |
|---|---|---|---|---|
| L1 | **critical** | SSRF | ssrf.ts:1-20 | allowlist incomplete (no `169.254/16`, `fc00::/7`, `fe80::/10`, `::ffff:0:0/96`, `100.64/10`); no DNS resolution; redirect not pinned |
| L2 | **critical** | race | manager.ts + main.ts | no single-instance guard; two pods deliver duplicates on overlap |
| L3 | high | idempotency | reconciler.ts:66-70 | no unique constraint on `webhook_deliveries(order_id,type)`; `underpaid→paid` transition dropped silently |
| L4 | high | money math | matcher.ts:45-47 | `Number(usdc_amount)` FP compare at stroop boundary; under/overpay misclassification |
| L5 | high | horizon trust | horizon.ts:32-46 | no `transaction_successful` check before DB lookup; no shape validation on `raw.*` fields; `account_merge` to merchant address not handled |
| L6 | high | cursor/reorg | horizon.ts:49,72 | cursor advances on dropped events; no reorg detection; relies on `status=pending` to dedupe |
| L7 | medium | timing | crypto.ts:20 | length-precheck before constant-time loop; not exploitable on emit path but smells |
| L8 | medium | retry schedule | webhook.ts:6 | comment labels misleading (last gap 12h not 24h) — semantics correct |
| L9 | medium | secret in row | webhook.ts:51-79 | `webhook_secret` in JS var, no structural redaction; any future `log(..., row)` leaks |
| L10 | medium | RLS bypass scope | db.ts:14-22 | service role on every query; RCE = full tenant DB write |
| L11 | medium | subs counter race | reconciler.ts:30-46 | `charges_done = (sub.charges_done ?? 0) + 1` not atomic |
| L12 | medium | overpay alarm | matcher.ts:47 | `>=` silently accepts overpayments, no event for merchant refund |
| L13 | medium | fetch hardening | webhook.ts:30-43 | no timeout, no manual redirect, no body cap; slow-loris stalls 50-row tick |
| L14 | low | issuer override env | matcher.ts:36-38 | `STELLAR_USDC_ISSUER_OVERRIDE` should be refused when `network==="PUBLIC"` |
| L15 | low | memo binding | horizon.ts:52-56 | partial index; cross-tenant collision protected only by merchant address re-check |
| L16 | low | log format | log.ts:2-4 | `String(e)` can stringify SDK errors with secrets |
| L17 | info | shutdown | main.ts:11 | only SIGTERM handled, not SIGINT |

## load-bearing detail

### L1 · SSRF (CVSS ~9.1)

```ts
const RFC1918 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./];
const LOCAL_HOSTS = new Set(["localhost","127.0.0.1","[::1]","::1","0.0.0.0"]);
```

missing ranges: `169.254/16` (AWS/GCP/Azure IMDS), `100.64/10` CGNAT, `127.0.0.0/8` other than `.0.1`, IPv6 `fc00::/7`, `fe80::/10`, multicast `224/4` / `ff00::/8`, `0.0.0.0/8`, `198.18/15`, `::ffff:0:0/96` IPv4-mapped bypass. octal/hex/dword encodings pass (`http://0177.0.0.1`, `http://2130706433`). no DNS resolution → hostname string check only; TOCTOU on DNS rebinding unmitigated.

exploit: merchant sets `webhook_url=http://rebind.attacker.com/`. first DNS → public IP (passes), second DNS at fetch → `169.254.169.254`. signed payload + listener context POSTed to cloud metadata. combined with L13 (redirect follow), `Location: http://169.254.169.254/...` from public host bypasses too.

fix:
1. resolve hostname (`dns.lookup({all:true})`), reject if any A/AAAA private/reserved (use `ipaddr.js .range()`)
2. pin resolved IP into fetch via undici `Agent` + `connect({hostname:ip})`
3. `redirect:"manual"`; reject non-2xx with Location
4. `AbortSignal.timeout(10_000)`
5. extend blocklist (ranges above)

verification: unit test mock DNS → 169.254... → expect reject. E2E with `nock` returning 302 to internal IP.

### L2 · single-instance guard (CVSS ~7.5)

`manager.ts` + `main.ts`: no lock prevents two pods running `watchAccount` for same merchant. partial idempotency via `.eq("status","pending")` on UPDATE — but `webhook_deliveries.insert` has no unique key. real risk: deploy overlap (two pods up simultaneously during rolling restart) doubles deliveries; merchant gets duplicate `payment_complete()` calls. fix: postgres advisory lock per `account_id` (`select pg_try_advisory_lock(hashtext($1))`) OR k8s `replicas:1` with `maxSurge:0`.

verification: spawn two procs against same DB on testnet, send one payment, assert exactly one `webhook_deliveries`.

### L3 · idempotency on `underpaid→paid` (CVSS ~6.5)

`.eq("status","pending")` filter blocks the second `paid` event from updating an order that's already `underpaid` from a partial payment. legitimate top-up payment is dropped silently. fix: `.in("status",["pending","underpaid"])` + unique partial index `unique(order_id,type) where type in ('order.paid','order.underpaid','subscription.charged')`.

### L4 · BigInt money math

Stellar = 7-dp decimal strings ("stroops"). `Number(s)` round-trip non-deterministic at boundary. `1.0000001 * 0.9975 → 0.99750009975 → .toFixed(7) = "0.9975001"`. fix: BigInt stroops, e.g. `BigInt(s.replace('.','').padEnd(s.indexOf('.')+8,'0'))`; expected = `totalStroops * (10000n - feeBp) / 10000n`.

## mainnet conditions

**hard blockers (NO-GO without):**
1. L1 SSRF: DNS resolve + IP pin + extended blocklist + manual redirect + timeout
2. L2 single-instance: advisory lock OR deploy-time `replicas:1` check
3. L3 idempotency: allow `underpaid→paid` + unique partial index
4. L4 BigInt money math
5. L13 fetch hardening (timeout + manual redirect + body cap)

**conditional GO after blockers fixed AND testnet load test covering:**
- dual-pod overlap (sends 1 payment, asserts 1 delivery)
- merchant URL DNS-rebind to 169.254.x.x (asserts rejected)
- partial-payment-then-topup (asserts terminal `paid`)
- restart mid-reconcile (asserts no double insert)

## falsifiable

if shipped to mainnet without L1 fix, within 90 days a merchant (malicious or compromised) registers webhook URL whose DNS resolves to `169.254.169.254` or equivalent and listener POSTs to it. threshold: any `webhook_deliveries.response_code` row where upstream IP is internal. below this rate → finding overstated.
