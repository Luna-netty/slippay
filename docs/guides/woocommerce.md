# WooCommerce plugin

Accept SlipPay payments on any WooCommerce store. Buyer hits checkout, picks
SlipPay, pays in BRL via Pix or stablecoin via Stellar wallet, merchant
gets the order marked Completed automatically.

> **Status**: v0.1.0 · open source under Apache-2.0 · in
> [`plugins/woocommerce-slippay/`](https://github.com/Galmanus/slippay/tree/main/plugins/woocommerce-slippay).
> Not yet on the WordPress.org plugin directory; install manually for now.

## Install

### Option A: zip + admin upload

```sh
git clone --depth 1 https://github.com/Galmanus/slippay.git /tmp/slippay
cd /tmp/slippay/plugins
zip -r ~/woocommerce-slippay.zip woocommerce-slippay/
```

Then in your WP admin:
**Plugins → Add New → Upload Plugin → choose `woocommerce-slippay.zip` → Install → Activate**.

### Option B: SSH + symlink

```sh
ssh user@your-store.com
cd /var/www/html/wp-content/plugins
git clone --depth 1 https://github.com/Galmanus/slippay.git /tmp/slippay
mv /tmp/slippay/plugins/woocommerce-slippay ./
rm -rf /tmp/slippay
```

Activate from **Plugins** in WP admin.

### Option C: composer (advanced)

```json
{
  "repositories": [
    {
      "type": "vcs",
      "url": "https://github.com/Galmanus/slippay.git"
    }
  ],
  "require": {
    "galmanus/slippay-wc": "dev-main"
  }
}
```

Note: requires post-install hook to move the plugin from `vendor/` to
`wp-content/plugins/`.

## Configure

### Step 1: get an API key

Sign up at [api.slippay.cc/signup](https://api.slippay.cc/signup),
create a merchant, drop your Stellar receive address, and copy the
`sk_live_…` key from the Settings tab.

### Step 2: configure WooCommerce

**WooCommerce → Settings → Payments → SlipPay**

| field | value |
|---|---|
| Enable | ✓ checked |
| Environment | `testnet` (until you've tested end-to-end) |
| Title at checkout | what buyers see, e.g., "Pay with SlipPay (USDC or PYUSD)" |
| Description | rendered under the title at checkout |
| API base URL | `https://api.slippay.cc` (don't change unless self-hosting) |
| API key | `sk_live_...` from your dashboard |
| Default settlement asset | USDC or PYUSD |
| Webhook secret | a long random string; **must match what's in the SlipPay merchant dashboard** |

### Step 3: configure the webhook on SlipPay

In your SlipPay merchant dashboard (Settings tab), set:

```
webhook_url = https://your-store.com/wc-api/wc_slippay
webhook_secret = <same string as in step 2>
```

Save. The plugin handles the rest.

## What buyers see

At the WC checkout page, SlipPay appears alongside other payment methods:

```
[ Cartão de crédito  ]  Visa, Mastercard
[ Pix                 ]  PagBank
[ SlipPay             ]  Pay with SlipPay (USDC or PYUSD)   <- this is yours
[ Boleto              ]  ...
```

When buyer clicks **Place Order**:

1. Plugin calls `POST /api/v1/orders` on the SlipPay backend with
   `brl_amount = <WC order total>`, `external_ref = wc_<WC order id>`.
2. SlipPay returns `checkout_url`.
3. WC redirects buyer to that URL.
4. Buyer signs in their Stellar wallet.
5. SlipPay listener confirms payment and POSTs `order.paid` to
   `/wc-api/wc_slippay`.
6. Plugin verifies HMAC, calls `WC_Order::payment_complete( $tx_hash )`.
7. Buyer is redirected back to the WC "Thank you" page.

Total time from "Place Order" click to "Order completed": ~10–15
seconds (depends on wallet flow speed; on-chain finality is ~6s).

## What merchants see

In **WooCommerce → Orders**, paid orders show:

- Status: **Completed** (auto-set by `payment_complete()`)
- Order notes:
  - "SlipPay order created. Awaiting on-chain payment." (at checkout)
  - "SlipPay order.paid confirmed. tx: 20655a78..." (after webhook)
- Custom meta visible via Order → Custom Fields:
  - `_slippay_order_id` (UUID matching SlipPay's `orders.id`)
  - `_slippay_memo` (the 64-hex memo for the on-chain payment)
  - `_slippay_usdc_amount`
  - `_slippay_tx_hash` (after payment)

## Webhook events handled

| event | WC behavior |
|---|---|
| `order.paid` | `payment_complete()`, status → Completed |
| `subscription.charged` | same as `order.paid` (recurring) |
| `order.underpaid` | status → On hold, with expected/received note |
| `order.expired` | status → Cancelled |
| `order.cancelled` | status → Cancelled |

## Refunds

v0.1 does **not** support refunds via the SlipPay API. The merchant has
full control of their Stellar address; to refund, send USDC back to the
buyer's address manually using a Stellar wallet. Add an order note in WC
for the refund tx hash.

v0.4 will add an in-plugin refund button that initiates a USDC return
from the merchant's wallet (via wallet-connect signature, not custodied).

## Testing

1. Switch the plugin **Environment** to `testnet`.
2. Create a test product (R$1.00 or similar) on your WC store.
3. Buy it as a logged-out user. Pick SlipPay.
4. Use a Stellar testnet wallet (Freighter on testnet) to pay.
5. Watch WC admin → Orders for the order to flip to Completed.
6. Switch Environment to `mainnet` and repeat with real USDC for a final
   smoke test before going live.

## Common issues

| symptom | cause | fix |
|---|---|---|
| "SlipPay" not showing at checkout | gateway disabled OR API key empty | check Payments settings |
| Order stuck in Pending after buyer pays | webhook URL not reachable | verify `https://your-store.com/wc-api/wc_slippay` returns 4xx not 5xx (404 is fine — POST works) |
| "invalid signature" in plugin logs | webhook secret mismatch | rotate on both sides; secrets must match exactly |
| "wc order not found" in plugin logs | external_ref didn't store | check `_slippay_order_id` meta on the WC order; if missing, the create_order call failed |
| 401 from SlipPay API | wrong API key | rotate the key on dashboard, paste the new one |

## Plugin source

```
plugins/woocommerce-slippay/
├── woocommerce-slippay.php             ← bootstrap + plugin metadata
├── README.md
└── includes/
    ├── class-wc-slippay-gateway.php    ← WC_Payment_Gateway subclass
    └── class-wc-slippay-webhook.php    ← HMAC verifier + order updater
```

PRs welcome at [github.com/Galmanus/slippay](https://github.com/Galmanus/slippay).
