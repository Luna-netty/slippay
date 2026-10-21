# Authentication

SlipPay uses three distinct authentication models depending on which surface
you are calling:

| surface | mechanism | header |
|---|---|---|
| Merchant API (server-side) | API key | `Authorization: Bearer sk_live_...` |
| Dashboard UI / merchant-self routes | Supabase JWT | `Authorization: Bearer eyJ...` |
| Webhook receiver (your side) | HMAC-SHA256 of body | `X-Slippay-Signature: <hex>` |

## API keys

API keys are used for all server-to-server calls (creating orders, managing
subscriptions, listing your orders). They look like:

```
sk_live_e6f4a1c8b3d2...   (sk_live_ + 64 hex chars = 256 bits of entropy)
```

### Where API keys come from

- **Created automatically** when you call `POST /v1/merchants` (returned once).
- **Rotated** by calling `POST /v1/merchants/me/rotate-key` (JWT auth required).
- **Stored hashed**: only SHA-256 of the plain key is kept in the database.
  The plain key is shown to you once at creation/rotation time.

### Using an API key

```sh
curl https://api.slippay.cc/api/v1/orders \
  -H "Authorization: Bearer sk_live_..."
```

Routes that require an API key:

| route | method |
|---|---|
| `/api/v1/orders` | POST, GET |
| `/api/v1/orders/:id/cancel` | POST |
| `/api/v1/subscriptions` | POST, GET |
| `/api/v1/subscriptions/:id` | GET, PATCH |
| `/api/v1/subscriptions/:id/charge` | POST |
| `/api/v1/subscriptions/:id/cancel` | POST |

> **Security**: never expose the API key in client-side JavaScript. Treat it
> like a password. If leaked, rotate immediately from the dashboard.

## JWT (Supabase) sessions

Used by the merchant dashboard and a few self-management routes. JWTs are
issued by Supabase Auth when a user signs up or logs in, and they identify
*the human user*, not the merchant they own.

### Login

```sh
curl -X POST 'https://nhddnulzsaubewvzspkh.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: <SUPABASE_PUBLISHABLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "email": "you@example.com", "password": "..." }'
```

Response includes `access_token` (the JWT to send) and `refresh_token`.

### Routes that require JWT

| route | method | purpose |
|---|---|---|
| `/api/v1/merchants` | POST | create the merchant tied to your auth user |
| `/api/v1/merchants/me` | GET | fetch your merchant |
| `/api/v1/merchants/me` | PATCH | update display_name, webhook_url, etc. |
| `/api/v1/merchants/me/rotate-key` | POST | invalidate current API key, get a new one |

## Webhook HMAC

When SlipPay delivers a webhook to your URL, it signs the body so you can
verify it came from us.

```http
POST /your/webhook HTTP/1.1
Content-Type: application/json
X-Slippay-Signature: 6fda9c0f8e7b2a1c3d4e5f6789a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8

{ "type": "order.paid", "data": { ... } }
```

### Verification (Node.js example)

```ts
import crypto from "node:crypto";

function verifySlippayWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  // timing-safe compare
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### Verification (PHP / WooCommerce)

The bundled `WC_Slippay_Webhook` class handles this automatically; see
`plugins/woocommerce-slippay/includes/class-wc-slippay-webhook.php`.

> **Important**: always read the *raw* request body before parsing JSON. If
> your framework has already parsed and re-serialized the body, the HMAC
> won't match because key ordering or whitespace will differ.

## Errors related to auth

| status | error code | meaning |
|---|---|---|
| 401 | `missing_authorization` | no `Authorization` header sent |
| 401 | `invalid_api_key` | API key doesn't match any merchant or is revoked |
| 401 | `invalid_jwt` | JWT signature failed or token expired |
| 403 | `forbidden` | you authenticated but don't own the resource |

See [errors](./errors.md) for the full table.
