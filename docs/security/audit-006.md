# audit-006 · WC plugin re-audit (post audit-001 fix + non-webhook surfaces)

- **status:** opened · GO-WITH-CONDITIONS
- **date:** 2026-05-16
- **scope:** `plugins/woocommerce-slippay/` post-audit-001 + non-webhook surfaces
- **audit-001 fix verification:** **PASS-WITH-CAVEATS**

## audit-001 fix · inspection result

| check | status | location |
|---|---|---|
| empty/short secret → 503 `webhook_not_configured` | OK | `webhook.php:35-39` |
| signature parser strict `^t=(\d+),v1=([a-f0-9]{64})$` | OK | `webhook.php:50` |
| timestamp window ±300s | OK | `webhook.php:58` (matches `crypto.ts:1 TOLERANCE_S`) |
| HMAC over `${t}.${body}` raw concat | OK | `webhook.php:64` (matches `crypto.ts:9`) |
| `hash_equals` constant-time | OK | `webhook.php:65` |
| replay via WP transient 24h | OK | `webhook.php:76-84` |
| resolver no numeric fallback | OK | `webhook.php:156-166` |

### caveats

1. **empty `delivery_id` header bypasses replay block** (`webhook.php:73-84`). listener always sends a uuid (`webhook.ts:35`), so practical exposure requires secret compromise + replaying within 300s. fix: treat missing/empty `x-slippay-delivery-id` as 400 `missing_delivery_id`. severity low (gated by freshness + secret).
2. transient store under persistent object cache: per-region on multi-region WC stores with non-replicated cache. acceptable for v0.2; document.
3. listener `crypto.ts:20` length-precheck pre-constant-time loop (cross-stack asymmetry vs PHP's `hash_equals`). low impact, but smell. (also flagged in audit-003 L7.)

## findings outside webhook

| # | sev | location | title |
|---|---|---|---|
| W1 | high | `class-wc-slippay-gateway.php:33,102-160` | `environment` setting (testnet/mainnet) not validated against `api_key` prefix or `api_base` host |
| W2 | medium | `gateway.php:158` | `$data['checkout_url']` returned verbatim as redirect; open-redirect-to-phishing if `api_base` compromised |
| W3 | medium | `gateway.php:143` · `webhook.php:111-114, 119-123` | order-note interpolation without `esc_html`; XSS via compromised `api_base` rendered in admin |
| W4 | medium | `gateway.php` settings | `webhook_secret` is `type=password` but stored plaintext in `wp_options`; any plugin/admin with `manage_options` reads it |
| W5 | low | endpoint | no rate limit on `/?wc-api=wc_slippay`; amplification target |
| W6 | low | `gateway.php` | `process_refund` not implemented; WC shows "Refund" button that silently fails |
| W7 | low | `gateway.php:149-151` | `_slippay_usdc_amount` stored as string; downstream locale parse risk |
| W8 | low | `gateway.php:115` · `is_available()` | no `BRL` currency check; non-BRL store sends USD value labelled as BRL |
| W9 | info | `woocommerce-slippay.php:72-78` | `flush_rewrite_rules` cargo-cult (plugin registers no rewrite rules) |
| W10 | info | repo | no `readme.txt` (WP.org format) if submitting to wp.org |

## v0.1 → v0.2 upgrade story

**CHANGELOG (v0.2):**
- security: critical webhook authentication bypass fixed (audit-001). v0.1 vulnerable; all installs must upgrade.
- security: signature now `t=<unix>,v1=<hex>` HMAC-SHA256 matching listener.
- security: replay protection via per-delivery uuid, 24h window.
- security: order resolver no longer falls back to numeric WC id guessing.
- breaking: `webhook_secret` is now required (min 32 chars). v0.1 installs without secret return 503 until configured.
- compat: HPOS declaration unchanged.

**merchant communication (mandatory, security-list email):**
1. subject: "Security update required — SlipPay WooCommerce plugin v0.2"
2. body: state bypass in v0.1, CVSS 9.1, instruct: (a) install v0.2, (b) set webhook secret ≥32 chars in WC → Settings → Payments → SlipPay, (c) rotate secret on SlipPay merchant dashboard to match, (d) verify by listener logs returning 200 on next event. provide curl one-liner to confirm 503 on empty secret.
3. unreachable merchants: SlipPay-side mitigation — refuse to send `order.paid` to webhook endpoints that haven't acknowledged v0.2 upgrade (flag on merchant row).
4. key-rotation guide: dashboard → settings → rotate webhook secret → copy new → paste into WC admin → save. old secret valid for grace window (10min) — listener-side dual-secret support is v0.2 backend change, separate scope.

## mainnet conditions

before flipping mainnet for any merchant:

1. **W1** — environment/api_key prefix coherence check (gateway enforces `sk_test_` vs `sk_live_`; allowlist `api_base` to `*.slippay.cc` unless explicit constant)
2. **W2** — `checkout_url` host validated (https + allowlist or matches configured `api_base`)
3. **W3** — `esc_html` around interpolated values before `add_order_note`
4. **W8** — `is_available()` checks `get_woocommerce_currency() === 'BRL'`
5. plugin tests authored per audit-001:verification (`plugins/woocommerce-slippay/tests/test-webhook-verify.php` does not exist; verified by directory listing)
6. merchant comms drafted and v0.2 tag published
7. listener-side `crypto.ts:20` length short-circuit fixed
8. **W6** — `process_refund` returns clear `WP_Error` message instead of silent fail

without these: GO acceptable only for testnet pilot (CompreCripto) where loss is bounded. real mainnet rollout requires W1-W3 + W8 minimum.

## falsifiable

if v0.2 ships with conditions 1-4 done AND listener integration tests in `apps/listener/test/webhook.test.ts` extended per audit-001:verification, next 90 days of mainnet operation across ≤10 merchants should produce **zero** webhook-auth incidents. >0 incidents falsifies the spec — re-open audit at sprint-5.
