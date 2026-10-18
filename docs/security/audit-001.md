# audit-001 · WooCommerce gateway webhook authentication bypass

- **status:** found · fixed · pending end-to-end verification on staging
- **date opened:** 2026-05-16
- **date fixed (code):** 2026-05-16
- **severity:** critical · CVSS estimate 9.1 (AV:N / AC:L / PR:N / UI:N / S:C / C:N / I:H / A:N)
- **scope:** `plugins/woocommerce-slippay/` (versions ≤ v0.1)
- **reporter:** internal sprint-3 audit
- **applies to:** any merchant running woocommerce-slippay v0.1 with the default "webhook secret optional" install path

## scope of audit

| component | files | LOC | depth |
|---|---|---|---|
| Soroban subscription contract | `contracts/subscription/src/lib.rs` | 272 | full |
| Stellar tx listener (Node) | `apps/listener/src/{webhook,crypto,matcher,reconciler,horizon,ssrf,db,manager,config,main}.ts` | ~465 | full on webhook+crypto, scanned rest |
| WooCommerce gateway (PHP) | `plugins/woocommerce-slippay/{woocommerce-slippay.php, includes/class-wc-slippay-gateway.php, includes/class-wc-slippay-webhook.php}` | 388 | full |
| Supabase edge API | `supabase/functions/api/{index,routes/{orders,subscriptions,merchants,ask},middleware/{auth_apikey,auth_jwt,error},lib/*}.ts` | ~830 | full on entrypoint, routes, middleware |

total in scope: ~2,000 LOC.

## finding

`plugins/woocommerce-slippay/includes/class-wc-slippay-webhook.php:35-48` (pre-fix) ran the entire HMAC verification block inside `if ( ! empty( $secret ) ) { ... }`. when the merchant's `webhook_secret` setting was empty — which was the default in `class-wc-slippay-gateway.php:89-93` (the field was labelled "Optional but strongly recommended") — the block was skipped and any unauthenticated POST to `/?wc-api=wc_slippay` flowed directly to `payment_complete($tx_hash)` at line 74.

a second defect compounded the bypass: the listener's signature header is `t=<unix>,v1=<hex>` over `HMAC-SHA256(secret, "<t>.<body>")` (see `apps/listener/src/crypto.ts:3-13` and `apps/listener/src/webhook.ts:34`). the PHP receiver compared `hash_hmac('sha256', $raw, $secret)` (bare hex, no timestamp prefix) against the full header string. legitimate, correctly-signed deliveries from the listener always failed with 401, so any merchant who tried to configure a secret saw broken webhooks and reverted to the empty-secret path — the vulnerable path.

a third defect (replay): the listener emits `x-slippay-delivery-id` (`webhook.ts:35`) but the PHP receiver never read it, so even a captured, correctly-signed delivery could be replayed indefinitely.

a fourth defect, present in `find_order_by_slippay_id()` at lines 126-131, was an `^wc_(\d+)$` regex fallback that converted a metadata-bound lookup into a guessable integer probe — an attacker did not need to know SlipPay-side order ids; sequential WC order ids worked.

## severity rationale

- **confidentiality:** none direct.
- **integrity:** high. attacker marks any WC order paid without paying. merchant ships goods or unlocks digital delivery. loss per merchant is bounded by GMV during the exposure window.
- **availability:** none.
- **likelihood:** high. the endpoint `/?wc-api=wc_slippay` is internet-exposed by WooCommerce's API dispatcher and unauthenticated by default. exploit is one `curl`. plugin presence is discoverable from shop fingerprints. the format mismatch ensured the secure path was unusable, funneling every merchant into the vulnerable configuration.
- **CVSS v3.1 estimate:** 9.1 (network · low complexity · no privileges · no UI · scope changed (funds move off-platform) · integrity-high).

## exploit path (reproduction)

1. discover a shop running woocommerce-slippay v0.1 (plugin scanners or footer markers; the gateway also exposes `/checkout` redirects).
2. read or guess a WC order id (sequential by default).
3. send:

```
curl -X POST 'https://victim.example/?wc-api=wc_slippay' \
  -H 'Content-Type: application/json' \
  -d '{"type":"order.paid","data":{"id":"wc_1042","tx_hash":"0000000000000000000000000000000000000000000000000000000000000000"}}'
```

4. receiver returns `{"ok":true}`; order transitions to `processing`/`completed`; fulfillment fires.
5. repeat for any guessable order id. same vector works for `subscription.charged`.

## fix applied

four changes, all in `plugins/woocommerce-slippay/`:

1. **secret is now mandatory.** `class-wc-slippay-gateway.php:89-94` declares `required` + `minlength=32` on the admin field, copy rewritten to make the requirement unambiguous.
2. **empty secret returns 503, not bypass.** `class-wc-slippay-webhook.php:30-36` checks `strlen($secret) < 32` and aborts with `webhook_not_configured` before any payload parsing.
3. **signature format aligned with listener.** parses `t=<unix>,v1=<hex>` strictly, enforces ±300s freshness window, verifies `HMAC-SHA256(secret, "<t>.<body>")` with `hash_equals()`. matches `apps/listener/src/crypto.ts:3-13` exactly.
4. **replay protection.** reads `x-slippay-delivery-id`, stores `slippay_seen_<md5(id)>` as a WordPress transient with `DAY_IN_SECONDS` TTL, returns 409 on duplicate.
5. **fallback resolver dropped.** the `^wc_(\d+)$` regex path in `find_order_by_slippay_id()` was removed. order lookup now strictly requires the gateway-set `_slippay_order_id` meta to match.

diff scope: 2 files, +50 / -15 lines approx.

## verification

unit (PHP, to be added in `plugins/woocommerce-slippay/tests/test-webhook-verify.php`):

- empty secret → response 503 `webhook_not_configured`
- missing `x-slippay-signature` → 401 `missing signature header`
- malformed signature (not `t=...,v1=...` shape) → 401 `malformed signature`
- valid shape, stale `t` (`abs(now-t) > 300`) → 401 `stale signature`
- valid shape, fresh `t`, wrong v1 → 401 `invalid signature`
- valid signature, no `_slippay_order_id` meta on any WC order → 404 `wc order not found` (no integer guessing path)
- valid signature, matching `_slippay_order_id` meta, first delivery → 200 `{"ok":true}`
- same delivery id replayed within 24h → 409 `duplicate delivery`

cross-stack integration (to extend `apps/listener/test/webhook.test.ts`):

- spin a local PHP receiver via `php -S 127.0.0.1:<port> -t plugins/woocommerce-slippay/`, post a fixture from `deliverOnce()`, assert 200 on first call and 409 on replay.

manual smoke (staging merchant only):

```
# empty config now blocks
curl -i -X POST 'https://staging.shop/?wc-api=wc_slippay' \
  -H 'Content-Type: application/json' \
  -d '{"type":"order.paid","data":{"id":"wc_1"}}'
# expect: HTTP/1.1 503

# legitimate listener delivery
# (run apps/listener with WEBHOOK_URL pointing at staging, observe 200 once,
#  then trigger the same delivery twice and observe 409 the second time)
```

## other findings noted (not fixed in this commit)

- `apps/listener/src/crypto.ts:20` — `verifyWebhook` short-circuits on `expected.length !== header.length` before the constant-time loop. permits a structural length-timing oracle. low impact; fix is one line.
- `supabase/functions/api/routes/orders.ts:82-98` — `GET /orders/:id` is unauthenticated and uses `serviceClient()` bypassing RLS. probably intentional for hosted checkout (the page needs the order to render) but warrants per-IP rate limiting and a doc comment to mark intent.
- `contracts/subscription/src/lib.rs:130-185` — `charge()` requires buyer to re-sign each charge. docs imply pre-authorized scheduling. v0.2 must replace this with a pre-auth/allowance pattern or the "off-chain scheduler can call" claim is false.
- `apps/listener/src/webhook.ts:64-72` — `webhook_url` comes from DB; `isSafeWebhookUrl(network)` exists but `ssrf.ts` is worth a separate dedicated pass.
- `plugins/woocommerce-slippay/includes/class-wc-slippay-gateway.php:122-129` — `wp_remote_post` to merchant-configurable `api_base`. abuse requires admin access already, so out of scope here; should be allowlisted to `*.slippay.cc` in a follow-up.

## why this is the chosen sprint-3 critical

the WC webhook bypass is the only finding that meets all four bars: (a) network-reachable, (b) no privileges, (c) integrity-high impact (real funds move), (d) contained fix verifiable end-to-end without contract redeploy. fixing it is a strict precondition for the sprint-4 mainnet milestone — running this code on mainnet without the fix would expose real merchants to direct loss.
