# Build a webhook handler

A production-grade SlipPay webhook handler does four things:

1. Captures the raw request body (before any framework parsing).
2. Verifies HMAC-SHA256 against your merchant's webhook secret.
3. Acks fast (within 15 seconds), processes async if needed.
4. Idempotency-keys the event so retries don't double-process.

This guide walks through each in a Node/Express stack. Adapt to your
runtime as needed.

## 1. Capture the raw body

Frameworks parse JSON automatically by default — re-serializing the body
during parsing breaks HMAC because key ordering and whitespace differ.

```ts
import express from "express";

const app = express();

// CRITICAL: this route must use raw body, not parsed JSON.
app.use("/webhooks/slippay", express.raw({ type: "application/json" }));
```

In Fastify:

```ts
fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  done(null, body);
});
```

In Next.js API routes:

```ts
export const config = { api: { bodyParser: false } };

import getRawBody from "raw-body";

export default async function handler(req, res) {
  const raw = await getRawBody(req);
  // ...
}
```

## 2. Verify HMAC

Use your merchant's `webhook_secret` — `X-Slippay-Signature` is HMAC-SHA256 over
the raw request body. The secret is minted at merchant creation and is
**write-only**: the API never returns it (not even in the create response), so
capture it out-of-band, as described in
[merchants](../api-reference/merchants.md#webhook-secret).


```ts
import crypto from "node:crypto";

function verifySignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  if (expected.length !== signatureHeader.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

Use a **constant-time comparison** (`crypto.timingSafeEqual`), not `===`.
A naïve string compare leaks information about the secret via timing
attacks; in practice, this matters less for short-lived HTTPS connections,
but it's free to do right.

## 3. Ack fast, process async

Webhook deliveries time out after 15 seconds. If your handler takes longer
(running an email send, charging a downstream API, etc.), you'll get
unnecessary retries.

The pattern is **enqueue, then 200**:

```ts
app.post("/webhooks/slippay", async (req, res) => {
  const sig = req.header("X-Slippay-Signature") ?? "";
  if (!verifySignature(req.body, sig, process.env.SLIPPAY_WEBHOOK_SECRET!)) {
    return res.status(401).send("invalid signature");
  }

  const event = JSON.parse(req.body.toString("utf8"));

  // enqueue for background processing
  await jobQueue.push({
    name: "process-slippay-event",
    payload: event,
    idempotencyKey: idempotencyKeyFor(event),
  });

  // ack immediately
  res.status(200).send("ok");
});
```

For low-traffic apps, you can process inline if total handler time stays
under ~5 seconds:

```ts
app.post("/webhooks/slippay", async (req, res) => {
  // ... HMAC check ...

  const event = JSON.parse(req.body.toString("utf8"));

  if (await alreadyProcessed(event)) {
    return res.status(200).send("ok"); // ack the duplicate
  }

  await processEvent(event);
  await markProcessed(event);

  res.status(200).send("ok");
});
```

## 4. Idempotency

The webhook delivery is **at-least-once**. SlipPay retries failed
deliveries on the schedule documented in
[webhooks reference](../api-reference/webhooks.md#retry-schedule).
Your handler **will** see duplicates eventually.

The cheapest dedup key for `order.paid` and `subscription.charged` is
`(event.type, event.data.id, event.data.tx_hash)` — the order id and
transaction hash uniquely identify a confirmed payment.

```ts
function idempotencyKeyFor(event: { type: string; data: { id: string; tx_hash?: string } }) {
  return `${event.type}:${event.data.id}:${event.data.tx_hash ?? "none"}`;
}

async function alreadyProcessed(event): Promise<boolean> {
  const key = idempotencyKeyFor(event);
  const exists = await redis.set(key, "1", "EX", 60 * 60 * 24 * 30, "NX");
  return exists === null; // null means key already exists (NX failed)
}
```

For databases with unique constraints, use a `processed_events` table
with `UNIQUE(idempotency_key)`. Insert + catch unique violation = "already
seen".

## Per-event handling

```ts
async function processEvent(event) {
  switch (event.type) {
    case "order.paid":
    case "subscription.charged":
      await markOrderPaid({
        slippayOrderId: event.data.id,
        externalRef: event.data.external_ref,
        txHash: event.data.tx_hash,
        amountUsdc: event.data.usdc_amount,
        paidAt: event.data.paid_at,
        subscriptionId: event.data.subscription_id ?? null,
      });
      break;

    case "order.underpaid":
      await flagForReview({
        slippayOrderId: event.data.id,
        expected: event.data.expected,
        received: event.data.received,
      });
      break;

    case "order.expired":
    case "order.cancelled":
      await cancelOrder(event.data.id);
      break;

    case "subscription.cancelled":
      await deactivateSubscription(event.data.id);
      break;

    case "subscription.expired":
      await endOfBilling(event.data.id);
      break;

    default:
      console.warn("Unhandled SlipPay event:", event.type);
      // still 2xx — unknown event types should not retry forever
  }
}
```

## Failure modes and how SlipPay handles them

| your response | SlipPay does |
|---|---|
| 2xx | mark delivered, no retry |
| 4xx (other than 401/422) | mark dead immediately; manual replay needed |
| 401 (bad signature) | mark dead immediately (security event in our logs) |
| 422 (unprocessable) | mark dead immediately |
| 5xx | retry per schedule |
| network error / timeout | retry per schedule |
| no response within 15s | retry per schedule |

## Testing

### Local with a tunnel

```sh
# install ngrok or cloudflared
ngrok http 3000
# get https://abc-123-456.ngrok-free.app
```

Set this as your merchant's `webhook_url` in the SlipPay dashboard.
Trigger a testnet payment; watch your local server receive the POST.

### Unit-test the HMAC verifier

```ts
import crypto from "node:crypto";

const secret = "test-secret";
const body = Buffer.from(JSON.stringify({ type: "order.paid", data: { id: "test" } }));
const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

assert(verifySignature(body, signature, secret));
assert(!verifySignature(body, signature, "wrong-secret"));
assert(!verifySignature(body, signature.slice(0, -1) + "x", secret)); // tampered
```

### Replay a real payload

The dashboard exposes `webhook_deliveries` with full payload + signature
per delivery. You can copy a previous payload + signature and POST to
your handler manually for debugging.

## Security checklist

- [ ] Raw body captured before any JSON parsing
- [ ] HMAC verified with `timingSafeEqual`
- [ ] Webhook secret stored in env vars, not committed to source
- [ ] Webhook URL is HTTPS (HTTP webhooks don't work; SlipPay refuses them)
- [ ] Webhook URL is not in a private IP range (RFC1918, link-local; SSRF
  protected on SlipPay's side, but check yours)
- [ ] Idempotency key set; duplicate handler invocations are no-ops
- [ ] Handler returns 2xx within 15 seconds
- [ ] Unknown event types still ack 2xx (don't retry forever)
- [ ] Logging captures `event.type` and `event.data.id` (not full payload
  to avoid PII leakage in logs if metadata gets sensitive)

## See also

- [Webhooks API reference](../api-reference/webhooks.md) — full event types
  and payload shapes
- [Authentication](../api-reference/authentication.md) — HMAC details
