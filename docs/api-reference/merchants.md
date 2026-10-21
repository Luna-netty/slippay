# Merchants

A merchant represents your account on SlipPay. One merchant per Supabase auth
user. Stores your Stellar receive address, API key fingerprint, webhook URL,
and platform fee rate.

## The Merchant object

```json
{
  "id": "mer_a1b2c3...",
  "auth_user_id": "uuid-of-supabase-user",
  "display_name": "Vortex Athletic",
  "email": "operations@vortex.example",
  "stellar_address": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "network": "testnet",
  "api_key_prefix": "sk_live_e6f4",
  "webhook_url": "https://vortex.example/webhooks/slippay",
  "platform_fee_bp": 297,
  "active": true,
  "created_at": "2026-05-10T13:00:00Z"
}
```

| field | type | notes |
|---|---|---|
| `id` | uuid | merchant identifier |
| `auth_user_id` | uuid | Supabase auth user that owns this merchant |
| `display_name` | string | shown to buyers at checkout |
| `email` | string | from Supabase user; not editable directly here |
| `stellar_address` | string \| null | 56-char Stellar pubkey where USDC settles |
| `network` | enum | `testnet` or `mainnet` |
| `api_key_prefix` | string | first 12 chars of the key (`sk_live_` + 4 chars), display-only for dashboard identification and never used for authentication |
| `webhook_url` | string \| null | where SlipPay POSTs events |
| `platform_fee_bp` | int | platform fee in basis points (297 = 2.97%, max 1000 = 10%), configured per-merchant on the `merchants` table (default: `DEFAULT_PLATFORM_FEE_BP` = 297). See [Fee Arithmetic and Rounding Specification](../fees.md). |
| `active` | bool | inactive merchants don't receive new orders |

`api_key_hash` and `webhook_secret` are stored but never returned by any
endpoint. The webhook secret is minted server-side at creation and is
**write-only**: see [Webhook secret](#webhook-secret).

## Create merchant

`POST /api/v1/merchants`

> **Auth**: JWT (Supabase). Run after the auth user signs up.

### Request

```json
{
  "display_name": "Vortex Athletic",
  "stellar_address": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "webhook_url": "https://vortex.example/webhooks/slippay"
}
```

| field | required | notes |
|---|---|---|
| `display_name` | yes | 1–120 chars |
| `stellar_address` | no | 56 chars; can be set later via PATCH |
| `webhook_url` | no | https URL; can be set later via PATCH |

### Response

`201 Created`

```json
{
  "merchant": { ... full Merchant object ... },
  "api_key": "sk_live_e6f4a1c8b3d2..."
}
```

> **Important**: `api_key` is shown **once**. Store it now. If lost, use
> [`POST /me/rotate-key`](#rotate-api-key).

The response does **not** include `webhook_secret` — the API strips it from the
create response exactly as it does for every later read. See
[Webhook secret](#webhook-secret).

## Get current merchant

`GET /api/v1/merchants/me`

> **Auth**: JWT.

```json
{ "merchant": { ... } }
```

Returns 404 if the auth user has not yet created a merchant.

## Update merchant

`PATCH /api/v1/merchants/me`

> **Auth**: JWT.

```json
{
  "display_name": "Vortex Athletic Inc.",
  "stellar_address": "GBR...",
  "webhook_url": "https://vortex.example/v2/webhooks/slippay"
}
```

All fields optional. Returns the updated merchant.

## Rotate API key

`POST /api/v1/merchants/me/rotate-key`

> **Auth**: JWT.

Invalidates the current API key immediately and returns a new one.

```json
{ "api_key": "sk_live_<new key>" }
```

Use this after a suspected leak. Existing webhook deliveries are not
affected (they don't use the API key); only future server-to-server calls
must use the new key.

## Webhook secret

Every merchant has an internal `webhook_secret` (256-bit random, hex) used to
HMAC-sign all outgoing webhook payloads (`X-Slippay-Signature`). The API
generates it server-side when the merchant is created and **never returns it**:

- `POST /api/v1/merchants` strips it from the response
  (`const { api_key_hash, webhook_secret, ...safe } = data`), so it is not in
  the create response either.
- `GET /api/v1/merchants/me` and `PATCH /api/v1/merchants/me` strip it too.
- Column-level grants exclude it from authenticated reads, so the dashboard
  cannot display it.

Treat the secret as **one-time, write-only material** minted with the merchant.
Unlike the API key there is no rotation endpoint in this version: there is no
`POST /me/rotate-webhook-secret` and no reveal affordance on `GET /me`. If you
need to read the stored value (for example to re-provision a handler) it is
readable only with service-role database access; if you need a supported
rotate/reveal path, file an issue.

To verify HMAC on your side, use the secret as documented in
[authentication](./authentication.md#webhook-hmac).