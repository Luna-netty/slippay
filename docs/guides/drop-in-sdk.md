# Drop-in checkout SDK

Two lines of JavaScript on your page. Backend creates the order, frontend
opens the modal, callbacks tell you what happened.

## Concept

```
your backend          your frontend         SlipPay-hosted modal
     |                       |                       |
     | POST /v1/orders       |                       |
     |---------------------->|                       |
     | <- order.id           |                       |
     |                       |                       |
     |                       | Slippay.open({id})    |
     |                       |---------------------->|
     |                       |                       | (wallet flow,
     |                       |                       |  buyer signs)
     |                       |                       |
     |                       | onPaid({txHash})      |
     |                       |<----------------------|
```

## 1. Server: create the order

```ts
const r = await fetch("https://api.slippay.cc/api/v1/orders", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.SLIPPAY_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    brl_amount: "99.90",
    external_ref: "cart_42",
  }),
});
const { order } = await r.json();
// pass order.id to the browser
```

> **Never** put the API key in client-side code. Always proxy through your
> backend. Compromise = full merchant API access.

## 2. Browser: open the modal

```html
<script src="https://api.slippay.cc/sdk.js"></script>
<script>
  // somewhere after the user clicks "Pay with SlipPay" on your page:
  Slippay.open({
    orderId: "<order.id from step 1>",
    onPaid:      ({ txHash }) => { window.location.href = "/thanks?tx=" + txHash; },
    onCancelled: () => { /* user closed modal without paying */ },
    onExpired:   () => { /* 30 minutes passed, order expired */ },
    onError:     ({ message }) => { alert("Payment error: " + message); },
  });
</script>
```

That's the whole integration.

## What the modal does

1. Loads the order from `GET /v1/orders/:id` (public endpoint).
2. Renders the BRL/USDC amounts, the merchant's Stellar address, and the
   memo (truncated for display).
3. Lets the buyer pick a wallet (Freighter, Lobstr, xBull, Albedo, Hana).
4. Asks the wallet to sign one Stellar transaction:
   - operation: payment
   - destination: merchant address
   - asset: USDC (or PYUSD, depending on order)
   - amount: net amount after platform fee
   - memo: hash type, the order's `memo`
5. Submits the signed tx to Horizon.
6. Polls for confirmation (typically lands in 6 seconds).
7. Posts back via `window.postMessage` to your page; the SDK calls your
   callback.

## Callback reference

```ts
type SlippayOpenOpts = {
  orderId: string;
  env?: string;                                   // origin override; defaults to api.slippay.cc
  onPaid?: (e: { txHash?: string; orderId?: string }) => void;
  onCancelled?: () => void;
  onExpired?: () => void;
  onError?: (e: { message?: string }) => void;
};

Slippay.open(opts: SlippayOpenOpts): { close: () => void };
```

| callback | when | payload |
|---|---|---|
| `onPaid` | listener confirmed payment | `{ txHash, orderId }` |
| `onCancelled` | user closed modal manually | - |
| `onExpired` | 30 min lapsed without payment | - |
| `onError` | wallet refused, network failed, etc. | `{ message }` |

The returned `{ close }` lets you programmatically close the modal:

```ts
const handle = Slippay.open({ orderId, onPaid });
setTimeout(() => handle.close(), 5 * 60 * 1000); // close after 5 min
```

## Don't trust the callback alone

`onPaid` firing in the browser is **necessary but not sufficient** for
fulfillment. Always verify on the server via the `order.paid` webhook
before unlocking the user's purchase. The browser callback can be
spoofed (it's just a `window.postMessage` from your domain). The
HMAC-signed webhook is the source of truth.

```ts
// good
onPaid: ({ orderId }) => {
  // optimistic UI, but don't fulfill yet
  showSpinner("Confirming on-chain...");
  // server-side: webhook will arrive within seconds, fulfill there
};

// bad
onPaid: ({ orderId }) => {
  unlockProduct(orderId); // server can be tricked
};
```

## Versioning

```js
window.Slippay.version
// e.g., "0.1.0"
```

The SDK is loaded from the SlipPay-hosted CDN at `https://api.slippay.cc/sdk.js`.
We aim for forwards-compatibility: existing integrations don't break with
new SDK versions. Breaking changes (if any) ship as new top-level methods,
not modifications to existing ones.

If you need to pin to a specific version, host a copy of `sdk.js` yourself;
contact us if this matters.

## Live demo

Open [api.slippay.cc/demo](https://api.slippay.cc/demo) — this page lets
you paste an order id and watch the SDK events fire in a console. Useful
for seeing the integration end-to-end without writing code.

## Common issues

| symptom | likely cause | fix |
|---|---|---|
| Modal doesn't open, console "Slippay is not defined" | script tag failed to load | check `https://api.slippay.cc/sdk.js` returns 200 |
| `onError: { message: "order not found" }` | wrong orderId or expired | re-create the order on the server |
| `onError: { message: "wallet refused" }` | buyer rejected wallet popup | retry; nothing on your side broken |
| `onPaid` never fires after wallet sign | listener didn't see the tx within 60s | check stellar.expert for the tx hash; webhook will still arrive even if browser callback didn't |
