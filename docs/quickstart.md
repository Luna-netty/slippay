# Quickstart

Get from "no account" to a paid **testnet** order in five minutes. Mainnet has
extra prerequisites; see [Going to mainnet](#going-to-mainnet).

## 1. Create a merchant

Sign up, then create the merchant — from the dashboard or directly through the
API with your Supabase JWT:

```sh
curl -X POST https://api.slippay.cc/api/v1/merchants \
  -H "Authorization: Bearer <supabase-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Vortex Athletic",
    "stellar_address": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "webhook_url": "https://your-store.com/webhooks/slippay"
  }'
```

The response returns the merchant plus an `api_key`, shown **once** — store it
immediately. If you lose it, `POST /api/v1/merchants/me/rotate-key` issues a new
one. The merchant's `webhook_secret` is separate and **write-only**: it is
generated at creation and never returned by any endpoint (see
[merchants](./api-reference/merchants.md#webhook-secret)).

API keys look like:

```
sk_live_<64 hex characters>
```

## 2. Create your first order

```sh
curl -X POST https://api.slippay.cc/api/v1/orders \
  -H "Authorization: Bearer sk_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "brl_amount": "99.90",
    "external_ref": "test_order_001"
  }'
```

Response (`201 Created`, abridged):

```json
{
  "order": {
    "id": "0b49ffe0-2ab2-4cbe-972c-feba218ea338",
    "memo": "ce230c1913a3668164c8544ac49fd244fba452b19ddee02425386945a5e85cd2",
    "brl_amount": "99.90",
    "usd_amount": null,
    "usdc_amount": "18.1636364",
    "rate_brl_usdc": "5.5000000",
    "brl_amount": 99.9,
    "usdc_amount": 18.1636364,
    "rate_brl_usdc": 5.5,
    "expires_at": "2026-05-10T14:30:00Z",
    "status": "pending",
    "platform_fee_bp": 297,
    "fee_usdc": "0.5394600"
  },
  "checkout_url": "https://api.slippay.cc/checkout/ord_3f1a8c4d-...?t=<checkout-token>",
  "fee": {
    "platform_fee_bp": 297,
    "gross_usdc": "18.1636364",
    "fee_usdc": "0.5394600",
    "net_usdc": "17.6241764"
  }
  "checkout_url": "https://api.slippay.cc/checkout/0b49ffe0-2ab2-4cbe-972c-feba218ea338?t=<signed token>"
}
```

Three fields you'll use later:

- `order.id` — pass this to the SDK or store it on your side.
- `order.memo` — 32-byte hash that Stellar uses to route the payment to this order.
- `checkout_url` — open in a buyer browser to complete payment. The `?t=`
  token is signed by the API; pass the URL through unchanged. Its host comes
  from `CHECKOUT_BASE_URL`.

## 3. Have the buyer pay

Open `checkout_url` in a browser. The hosted page handles wallet selection
(Freighter, Lobstr, xBull, Albedo, Hana), shows the BRL/USDC amount, and
asks for one signature.

For embedded checkout in your own site, see the [drop-in SDK guide](./guides/drop-in-sdk.md).

## 4. Receive the webhook

Set a webhook URL in your merchant Settings. SlipPay posts to it once the
listener sees the confirmed payment. Expect roughly 5 to 10 seconds after the
buyer signs: one Stellar ledger close plus one listener polling interval
(`LISTENER_POLL_MS`, 4 seconds by default).

```http
POST https://your-store.com/webhooks/slippay
Content-Type: application/json
X-Slippay-Signature: <hex hmac sha256>

{
  "type": "order.paid",
  "data": {
    "id": "0b49ffe0-2ab2-4cbe-972c-feba218ea338",
    "external_ref": "test_order_001",
    "brl_amount": "99.90",
    "usdc_amount": "18.16",
    "tx_hash": "20655a78f270de139fed0cbc70b37e663253ca2723f957edc27966b56c21ba5c",
    "memo": "ce230c1913a3668164c8544ac49fd244fba452b19ddee02425386945a5e85cd2",
    "paid_at": "2026-05-10T14:00:06Z"
  }
}
```

Verify HMAC, mark the order paid in your system, return `2xx`. Detailed
guide: [handle webhooks](./guides/webhooks-handler.md).

## 5. (Optional) Set up recurring billing

```sh
curl -X POST https://api.slippay.cc/api/v1/subscriptions \
  -H "Authorization: Bearer sk_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "brl_amount": "29.90",
    "period_seconds": 2592000,
    "asset_code": "USDC",
    "max_periods": 12,
    "external_ref": "customer_42_pro_plan"
  }'
```

Then trigger each cycle from your billing scheduler:

```sh
curl -X POST https://api.slippay.cc/api/v1/subscriptions/<sub_id>/charge \
  -H "Authorization: Bearer sk_live_your_key"
```

Idempotent on time: calling charge twice within the same period returns the
same pending order, never double-bills. Full guide:
[recurring billing](./guides/recurring-billing.md).

## What just happened

The order you created went through this pipeline:

```
your POST -> SlipPay api -> postgres (orders row, status=pending)
                                |
                          merchant opens checkout_url
                                |
                          buyer signs Stellar tx with order.memo
                                |
                          payment lands on Stellar (Horizon)
                                |
                          SlipPay listener polls Horizon /payments
                          (paging token, MERCHANT_POLL_MS lease per account)
                          SlipPay listener polls Horizon and sees it
                                |
                          matcher validates: asset, issuer, dest, memo, amount
                                |
                          reconciler updates orders.status=paid
                                |
                          webhook delivery -> your endpoint (HMAC signed)
```

The listener polls Horizon on a timer: every
`LISTENER_POLL_MS` (default 4 seconds) it fetches new payments for each watched
merchant account from the last saved cursor. Every `MERCHANT_POLL_MS` it
re-reads the merchants table to pick up new or changed receive addresses.

Three runtime processes, all live at the same domain. Architecture deep dive:
[concepts/architecture](./concepts/architecture.md).

## Run it locally

To run the whole stack from the repo instead of the hosted API (requires Node
22+, pnpm 9, Deno 2.x, and the Supabase CLI):

```sh
git clone git@github.com:Galmanus/slippay.git
cd slippay && pnpm install
pnpm supabase:start && pnpm supabase:reset    # local Postgres + auth + schema

# in separate terminals:
cd supabase/functions/api && deno run --allow-all --watch index.ts  # API :8000
cd apps/listener && pnpm dev                                        # listener
cd apps/web && pnpm dev                                             # web :5173
```

Copy `.env.example` to `.env` and set at minimum `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. `CHECKOUT_BASE_URL` is the base used to build the
`checkout_url` the orders route returns, and `MERCHANT_POLL_MS` is how often the
listener re-reads the active-merchant set; all four variables are defined in
[`.env.example`](../.env.example).

## Going to mainnet

Testnet uses fake USDC issued by Circle's test issuer. To accept real USDC:

1. Set `network: "mainnet"` on your merchant via dashboard or `PATCH /v1/merchants/me`.
2. Verify your `stellar_address` has a USDC trustline on Stellar mainnet
   (issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`).
3. See [docs/mainnet-readiness.md](./mainnet-readiness.md) for the full checklist.

> **Note**: mainnet launch is gated on a BR anchor partnership for the Pix-in
> leg. Without it, buyers must already hold USDC and a Stellar wallet, which
> caps your TAM at <1% of Brazilian e-commerce buyers. See
> [regulatory framing](./concepts/regulatory.md).
