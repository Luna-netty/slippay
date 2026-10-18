# Subscriptions

A recurring billing relationship. The merchant (or a scheduler on the merchant's
behalf) calls `POST /:id/charge` each period to materialize an order; the buyer
pays the order; the listener confirms; SlipPay fires `subscription.charged`.

> **v0.1**: off-chain orchestrated. Each period requires an active call to
> `/charge`. The buyer signs each individual order.
>
> **v0.2** (LIVE on mainnet): the Soroban subscription contract
> (`CAQZECYTKQGUJETQRRBONGQA2DJBNQVYCSKBYCKXOVQOEEOMHKBTJZEP`, deployed
> 2026-06-03) debits the buyer wallet against a standing SEP-41 allowance the
> buyer granted once. No buyer signature needed per cycle. The off-chain
> scheduler fires `autocharge(id)` via a relayer (fee-payer only). See
> [contracts/subscription](../contracts/subscription.md) for the on-chain model.
>
> The v0.3 on-chain attestation gate is proven on testnet only and is NOT on
> mainnet; mainnet runs v0.2 without the gate.

## The Subscription object

```json
{
  "id": "sub_2b9ef205-b85f-472d-80b2-303ae588fb85",
  "merchant_id": "mer_a1b2c3...",
  "external_ref": "customer_42_pro_plan",
  "buyer_stellar_address": null,
  "buyer_email": "buyer@example.com",
  "asset_code": "USDC",
  "brl_amount": "29.90",
  "period_seconds": 2592000,
  "max_periods": 12,
  "charges_done": 1,
  "status": "active",
  "expires_at": null,
  "last_charge_at": "2026-05-10T14:00:00Z",
  "next_charge_at": "2026-06-09T14:00:00Z",
  "soroban_contract_id": null,
  "webhook_url": null,
  "metadata": {},
  "created_at": "2026-05-10T13:55:00Z"
}
```

| field | type | notes |
|---|---|---|
| `id` | uuid | subscription identifier |
| `external_ref` | string \| null | your reference; max 120 chars |
| `buyer_stellar_address` | string \| null | optional, 56 chars (G...) |
| `buyer_email` | string \| null | optional, for invoice notifications |
| `asset_code` | enum | `USDC` or `PYUSD` |
| `brl_amount` | string | charged each period |
| `period_seconds` | int | min 86400 (1 day), max 31536000 (1 year) |
| `max_periods` | int \| null | hard cap; null = until expires_at or cancel |
| `charges_done` | int | bumps when listener confirms a charge order paid |
| `status` | enum | `active`, `paused`, `cancelled`, `expired` |
| `expires_at` | iso8601 \| null | absolute end time |
| `last_charge_at` | iso8601 \| null | last successful charge |
| `next_charge_at` | iso8601 | when the next charge is due |
| `soroban_contract_id` | string \| null | populated when v0.2 contract is deployed |
| `webhook_url` | string \| null | overrides merchant-level webhook for this sub |
| `metadata` | object | up to 1KB JSON; opaque to SlipPay |

### Status lifecycle

```
       create -> active
                   |
        +----------+----------+--------------+
        |          |          |              |
        v          v          v              v
       pause    cancel    max_periods    expires_at
        |          |        reached       reached
        v          v          |              |
      paused   cancelled      v              v
        |                  expired         expired
        v
      resume
        |
        v
      active
```

## Create subscription

`POST /api/v1/subscriptions`

### Request

```json
{
  "brl_amount": "29.90",
  "period_seconds": 2592000,
  "asset_code": "USDC",
  "max_periods": 12,
  "buyer_email": "buyer@example.com",
  "external_ref": "customer_42_pro_plan",
  "webhook_url": "https://your-store.com/webhooks/slippay-sub-only",
  "metadata": { "plan": "pro", "seats": 5 }
}
```

| field | required | notes |
|---|---|---|
| `brl_amount` | yes | string, 2 decimals, > 0 |
| `period_seconds` | yes | int, 86400 ≤ p ≤ 31536000 |
| `asset_code` | no | `USDC` (default) or `PYUSD` |
| `max_periods` | no | int, 1–120; null = unlimited |
| `buyer_stellar_address` | no | 56 chars, no validation against on-chain |
| `buyer_email` | no | for billing notifications |
| `expires_at` | no | iso8601 absolute end |
| `webhook_url` | no | per-subscription override |
| `external_ref` | no | max 120 chars |
| `metadata` | no | object, opaque |

### Response

`201 Created` with `{ "subscription": { ... } }`.

`next_charge_at` is initialized to `now()`, so the first charge is immediately
due.

## List

`GET /api/v1/subscriptions[?status=active&limit=50]`

| param | default | notes |
|---|---|---|
| `status` | (any) | `active`, `paused`, `cancelled`, `expired` |
| `limit` | 50 | max 200 |

## Get

`GET /api/v1/subscriptions/:id`

Auth-scoped to the merchant; returns 404 if you don't own it.

## Update

`PATCH /api/v1/subscriptions/:id`

Editable fields:

```json
{
  "status": "paused",
  "webhook_url": "https://...",
  "metadata": { ... }
}
```

Returns `400 empty_update` if no editable field is set.

## Charge

`POST /api/v1/subscriptions/:id/charge`

Materializes the next billing cycle as an order. Idempotent on time:

- If a `pending` order already exists for this subscription within its
  current period, the same order is returned with `idempotent: true` and
  status `200 OK`.
- Otherwise a new order is created and returned with `idempotent: false`
  and status `201 Created`.

### Response (new charge)

```json
{
  "order": { ... full Order object ... },
  "checkout_url": "https://api.slippay.cc/checkout/<order_id>",
  "idempotent": false
}
```

### Failure cases

| status | error | when |
|---|---|---|
| 404 | `not_found` | subscription doesn't exist or doesn't belong to you |
| 409 | `not_active` | status is paused, cancelled, or expired |
| 409 | `expired` | expires_at has passed |
| 409 | `max_periods_reached` | charges_done >= max_periods |

## Cancel

`POST /api/v1/subscriptions/:id/cancel`

Sets status to `cancelled`. No further charges can be created. Returns
`400 cannot_cancel` if already cancelled.

## Webhooks for subscriptions

- `subscription.charged` — buyer paid an order originating from this subscription.
  Payload includes `subscription_id` so you can update your billing state.

The first time a charge succeeds, `subscription.charged` fires *instead* of
`order.paid`, so handlers don't need to dedup. If you only care about orders,
listen to `order.paid`. If you handle subscriptions, listen to both.

## Patterns

### Daily billing scheduler

```ts
// run this every minute via cron
const due = await fetch(API + "/v1/subscriptions?status=active", { headers });
for (const sub of due.subscriptions) {
  if (new Date(sub.next_charge_at) > new Date()) continue;
  await fetch(`${API}/v1/subscriptions/${sub.id}/charge`, { method: "POST", headers });
}
```

The charge endpoint is idempotent, so re-runs are safe.

### Skip a billing cycle

```sh
curl -X PATCH https://api.slippay.cc/api/v1/subscriptions/<id> \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "status": "paused" }'

# later, resume
curl -X PATCH https://api.slippay.cc/api/v1/subscriptions/<id> \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "status": "active" }'
```

### Check current state

```sh
curl https://api.slippay.cc/api/v1/subscriptions/<id> \
  -H "Authorization: Bearer sk_live_..."
```

Look at `charges_done`, `last_charge_at`, `next_charge_at`.
