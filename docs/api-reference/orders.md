# Orders

A one-shot payment. Buyer pays the `usdc_amount` (or `pyusd_amount`) to your
merchant address, with the order's `memo` as the Stellar transaction memo.
The listener confirms the payment and fires `order.paid` to your webhook.

> **Auth**: API key (`Bearer sk_live_...`) on all routes except `GET /:id`
> which is public to support hosted checkout.

## The Order object

```json
{
  "id": "ord_3f1a8c4d-9b8e-4f5a-a3c2-1d2e3f4a5b6c",
  "merchant_id": "mer_a1b2c3...",
  "subscription_id": null,
  "external_ref": "cart_42",
  "brl_amount": "99.90",
  "usdc_amount": "18.16",
  "rate_brl_usdc": "5.50",
  "memo": "ce230c1913a3668164c8544ac49fd244fba452b19ddee02425386945a5e85cd2",
  "status": "pending",
  "tx_hash": null,
  "expires_at": "2026-05-10T14:30:00Z",
  "paid_at": null,
  "created_at": "2026-05-10T14:00:00Z"
}
```

| field | type | notes |
|---|---|---|
| `id` | uuid | order identifier |
| `merchant_id` | uuid | who owns this order |
| `subscription_id` | uuid \| null | set if the order originated from a subscription charge |
| `external_ref` | string \| null | your reference; opaque to SlipPay; max 120 chars |
| `brl_amount` | string | BRL with 2 decimals |
| `usdc_amount` | string | USDC with up to 7 decimals (Stellar precision) |
| `rate_brl_usdc` | string | conversion rate locked at order creation |
| `memo` | string | 64-hex-char SHA-256 = 32 bytes for `Memo.hash` |
| `status` | enum | `pending`, `paid`, `underpaid`, `expired`, `cancelled`, `dead` |
| `tx_hash` | string \| null | Stellar transaction hash, set when paid |
| `expires_at` | iso8601 | order expires if not paid by this time (default 30 min) |
| `paid_at` | iso8601 \| null | when the listener marked it paid |
| `created_at` | iso8601 | order creation time |

### Status lifecycle

```
            pg_cron expire (every 5 min)
       +-----------+
       |           v
pending +--> expired
   |
   |  on-chain payment matched
   v
  paid
   |
   |  amount < expected
   v
underpaid

pending -[merchant calls cancel]-> cancelled
underpaid -[after 5 retries]-> dead
```

## Create order

`POST /api/v1/orders`

### Request

```json
{
  "brl_amount": "99.90",
  "external_ref": "cart_42",
  "expires_in_minutes": 30
}
```

| field | type | required | notes |
|---|---|---|---|
| `brl_amount` | string | yes | BRL with 2 decimals, > 0 |
| `external_ref` | string | no | max 120 chars |
| `expires_in_minutes` | int | no | 5–1440, default 30 |

### Response

`201 Created`

```json
{
  "order": { ... full Order object ... },
  "checkout_url": "https://api.slippay.cc/checkout/<id>"
}
```

### Errors

| status | code | when |
|---|---|---|
| 400 | `validation_error` | bad input shape; `issues` array per zod |
| 400 | `create_failed` | DB insert failed; `detail` has the message |
| 401 | `invalid_api_key` | bad `Authorization` header |

## List orders

`GET /api/v1/orders[?status=paid&limit=50]`

### Query params

| param | type | default | notes |
|---|---|---|---|
| `status` | enum | (any) | filter by `pending`, `paid`, `underpaid`, etc. |
| `limit` | int | 50 | max 200 |

### Response

```json
{ "orders": [ { ... }, { ... } ] }
```

Sorted by `created_at` desc.

## Get one order (public)

`GET /api/v1/orders/:id`

No auth required — used by the hosted checkout to render the page. Returns
a slimmed-down view including `merchant_stellar_address` so the wallet flow
can construct the payment.

### Response

```json
{
  "order": {
    "id": "...",
    "merchant_id": "...",
    "brl_amount": "99.90",
    "usdc_amount": "18.16",
    "memo": "ce230c...",
    "status": "pending",
    "expires_at": "...",
    "merchant_stellar_address": "GA5ZSE..."
  }
}
```

## Cancel order

`POST /api/v1/orders/:id/cancel`

Only works when status is `pending`. Returns `400 cannot_cancel` otherwise.

### Response

```json
{ "order": { ... status: "cancelled" ... } }
```

## Webhooks fired for orders

- `order.paid` — the listener confirmed an on-chain payment matching the order.
- `order.underpaid` — payment landed but amount was below the expected merchant share.

See [webhooks reference](./webhooks.md) for payload shape.

## Notes on settlement math

SlipPay charges a platform fee (default 2.97% / 297 bp, configurable per merchant via
`platform_fee_bp`). For the exact integer formulas, rounding direction (dust accrues
to the merchant), conservation identity (`net + fee = gross`), and overpayment policy,
see the [Fee Arithmetic and Rounding Specification](../fees.md).

The buyer pays `usdc_amount`; the merchant receives `usdc_amount - fee_usdc`.
The matcher accepts the payment as `paid` only if the on-chain amount is
**>= the expected merchant share**. This way the buyer can pay the gross or
the net depending on the wallet flow; either is accepted. Future versions may
split the payment into two operations atomically.
