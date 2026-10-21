# BR-export merchants: stop the 6% leak

This guide is for Brazilian SaaS, agencies, freelancers, and digital exporters
who bill international customers in USD. The math below shows what you're
losing today and what SlipPay does about it.

## The problem, with numbers

You invoice a US customer $1,000 USD. Today, the typical flow is:

```
US customer → Stripe / PayPal → BR account
$1000  →  $958 (after Stripe 4.4%)  →  R$5,000 (after FX spread)  →  R$4,981 (after IOF)
```

Per-invoice leakage:

| layer | rate | $1,000 invoice |
|---|---|---|
| Stripe international card | 4.4% + $0.30 | $44.30 |
| FX spread (bank) | 1.5% | ~$15 (taken on R$ side) |
| IOF on incoming FX | 0.38% | ~$3.80 (current rate; was 1.1% pre-2025) |
| **total leakage** | **~6.3%** | **~$63** |

Sources:
- Stripe Brazil pricing: [stripe.com/br/pricing](https://stripe.com/br/pricing) (international cards 4.4% + R$0,40)
- IOF câmbio: [BCB Circular 3.691](https://www.bcb.gov.br/) (current 0.38% for FX inflow up to 360 days)
- Bank FX spread: typical 1-2% for SMB accounts; varies by bank

Multiply by your annual ARR. A $50k/yr export business loses ~$3,150 to friction.
A $500k/yr business loses ~$31,500.

## What SlipPay does instead

```
US customer → SlipPay USDC checkout → your Stellar wallet
$1000  →  USDC 970.30 (after SlipPay 2.97%)  →  stays USDC until YOU choose to convert
```

Per-invoice leakage:

| layer | rate | $1,000 invoice |
|---|---|---|
| SlipPay platform fee | 2.97% (297 bp default) | $29.70 |
| Stellar tx fee | $0.0001 | <$0.01 |
| FX spread | 0% (USDC stays USDC) | $0 |
| IOF | 0% (no FX yet) | $0 |
| **total leakage** | **~2.97%** | **~$29.70** |

You decide WHEN to convert USDC → BRL. If the dollar climbs vs real, you wait.
If you need cash now, convert via your preferred on-ramp. SlipPay doesn't
force a conversion at settlement.

## Who this is for

- **BR SaaS** charging $50–$5,000/mo to international (mostly US) customers.
  Notion, Linear, Vercel-style tools that have global GTM but BR engineering.
- **BR digital agencies** invoicing US clients $5k–$50k per project.
- **BR freelancers / contractors** on Upwork, Toptal, direct retainers.
- **BR creators / educators** selling courses, templates, digital products.
- **BR open-source maintainers** receiving donations / sponsorships.

If your buyer is in Brazil and pays in BRL, see the
[recurring billing guide](./recurring-billing.md) for the BRL-domestic flow.
This guide is specifically for the USD-incoming-from-abroad case.

## Quickstart for BR-export

### 1. Sign up and configure

[api.slippay.cc/signup](https://api.slippay.cc/signup). Drop a Stellar
receive address. Copy your API key.

> **Receive address tip**: use a wallet you control (Freighter, Lobstr, or
> a multi-sig setup via stellar.org/multi-sig). NOT an exchange address —
> exchanges may freeze deposits without notice.

### 2. Invoice in USD (not BRL)

```sh
curl -X POST https://api.slippay.cc/api/v1/orders \
  -H "Authorization: Bearer sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "usd_amount": "1000.00",
    "external_ref": "invoice_2026_005"
  }'
```

USDC amount = `1000.00` (1:1 against USD, USDC is a USD-pegged stablecoin).
No BRL conversion happens at order creation.

Response:

```json
{
  "order": {
    "id": "ord_...",
    "usd_amount": "1000.00",
    "brl_amount": null,
    "usdc_amount": "1000.00",
    "memo": "ce230c...",
    "status": "pending"
  },
  "checkout_url": "https://api.slippay.cc/checkout/ord_..."
}
```

### 3. Email the customer the checkout URL

For most BR-export flows, the buyer is non-Brazilian and pays from a USDC
wallet (Freighter, Lobstr) or via a US-side on-ramp (Coinbase, Kraken with
USDC withdrawal).

Boilerplate email:

```
Subject: Invoice $1,000 - Acme Corp (Apr 2026)

Hi [name],

Your invoice for [scope] is ready. Pay in USDC on Stellar:

  https://api.slippay.cc/checkout/ord_...

Settlement is instant; no chargebacks. If you don't have a Stellar
wallet, the checkout page walks you through it (~2 minutes).

Want to pay via card / ACH / bank wire instead? Reply to this email
and I'll send a Stripe link as a fallback (4.4% fee applies on that
route).

Thanks,
[you]
```

### 4. Get the webhook on payment

When the buyer signs and the listener confirms (~6 seconds):

```json
{
  "type": "order.paid",
  "data": {
    "id": "ord_...",
    "external_ref": "invoice_2026_005",
    "usd_amount": "1000.00",
    "usdc_amount": "1000.00",
    "tx_hash": "20655a78...",
    "paid_at": "2026-05-10T14:00:06Z"
  }
}
```

Mark the invoice paid in your accounting system. USDC sits in your wallet.

### 5. Convert USDC → BRL when YOU decide

Common paths:

- **Hold in USDC** (dollar-hedge against BRL volatility)
- **Convert via Mercado Bitcoin / Foxbit / Bitso** when you need BRL
  (typical fee: 0.5-1.5%, vs ~6% per-Stripe-invoice)
- **Off-ramp via MoneyGram cash** in 180+ countries (only Stellar has this rail)
- **Spend directly in USDC** via crypto-cards (e.g., Crypto.com Visa) for
  international purchases

## Comparison to Stripe Atlas

Many BR-exporters use Stripe Atlas to incorporate a US LLC and accept Stripe
USD payments. Here's the realistic compare-and-contrast:

| | Stripe Atlas + Stripe | SlipPay |
|---|---|---|
| Setup cost | $500 + ~$300/yr Delaware franchise tax + ~$200/mo bookkeeping | $0 |
| Setup time | 2–4 weeks | 5 minutes |
| Bank account | Mercury (US) | none needed (Stellar wallet) |
| Per-invoice fee | 2.9% + $0.30 (US cards) or 4.4% (international) | 2.97% (297 bp default) |
| FX to BRL when you withdraw | bank wire fee ($25-50) + spread (1-2%) | your choice; can stay USDC |
| Tax overhead | annual US LLC filing + IRS 5472 + Brazilian PJ tax | Brazilian PJ tax only |
| Incident scope | Stripe can freeze account | merchant holds keys |
| Non-custodial | no | yes |
| Refunds | full Stripe refund flow | manual USDC return (v0.4 plugin coming) |

**SlipPay does not replace Stripe Atlas across the board.** Stripe Atlas is
better when:

- You need US bank account for vendor relationships
- Your customers won't pay USDC (most enterprise B2B)
- You need PCI-compliant card processing with PCI scope outsourced
- You have US-based co-founders / investors

**SlipPay is better when:**

- Your customers are crypto-comfortable (often the case for SaaS to other
  startups, AI companies, infra tools)
- You want the ~3.3% margin back per invoice (saving ~$33 on a $1,000 invoice vs ~6.3% Stripe/bank friction)
- You want to hold USDC as a dollar hedge
- You want zero recurring infrastructure cost (no LLC, no monthly bookkeeping
  for a US entity)

A common pattern is to **run both**: Stripe Atlas for enterprise B2B that
demands ACH or bank wire, SlipPay for crypto-comfortable customers and
recurring SaaS subscriptions. Each invoice lets you choose.

## Setting expectations with customers

Some customers will hesitate at "pay in USDC". Here's what helps:

1. **Frame it as a discount**: "Pay via SlipPay and we'll take 2% off the
   invoice." You're sharing the savings; everyone wins.
2. **Show them the wallet flow**: 90 seconds to install Freighter +
   90 seconds to fund it from Coinbase. Shorter than ACH setup.
3. **Offer a card fallback**: don't lose the customer over payment method.
4. **Document for their AP team**: USDC is treated as cash equivalent for
   most accounting standards; their accountant can match the on-chain tx
   hash 1:1 to the invoice.

## Tax notes (BR side)

Receita Federal expects you to declare crypto holdings monthly above
R$30k cumulative across all wallets. USDC counts. Maintain a record:

- Date received
- Source (which client / invoice)
- USD value at receipt
- Tx hash for verification
- Date converted to BRL (if applicable) + BRL received

Most BR accountants understand crypto income as service revenue (not
crypto trading), which is the lowest tax bracket. Confirm with your CPA.

> **Disclaimer**: this is operational summary, not tax advice. Consult a
> Brazilian CPA familiar with crypto taxation (CRC + crypto specialty).

## Falsifiable expectations

- Per-invoice savings vs Stripe: should be **~3.3%** (3–3.5%) consistently across
  invoices in the $100–$10,000 range (saving ~$33 per $1,000 invoice compared to
  Stripe's 6.3% combined card + FX + IOF friction).
- Below 2.5% savings: something is wrong with the comparison (you're not
  charging international card rate, or you're double-counting some fee).
- Above 4.5% savings: you're including FX volatility that may swing back;
  realistic claim is ~3.3%.

## Next steps

- [Sign up](https://api.slippay.cc/signup) and run a test invoice for $1
  to a wallet you control
- [Drop-in SDK](./drop-in-sdk.md) — embed checkout on your billing page
- [Webhook handler](./webhooks-handler.md) — auto-mark invoices paid in
  your billing system
- [Recurring billing](./recurring-billing.md) — for SaaS subscriptions
