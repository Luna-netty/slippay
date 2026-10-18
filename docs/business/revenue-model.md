# Slippay · revenue model (v0.2 → v0.4)

- **status:** recomputed for v0.4 mainnet · 2026-06-26
- **author:** Manuel Galmanus
- **audience:** SCF reviewers · prospective merchants · internal scope-discipline

> **Fee provenance.** The shipped platform fee is **297 basis points (2.97%)**,
> `DEFAULT_PLATFORM_FEE_BP` in
> [`packages/shared/src/constants.ts`](../../packages/shared/src/constants.ts).
> This model was first drafted for the v0.2 launch and has been recomputed end to
> end at 297 bp; where a number below and that constant disagree, the constant —
> and the on-chain v0.4 contract that charges it — is the source of truth.

## TL;DR

**Slippay takes 2.97% (297 basis points) of the gross USDC settlement amount,
charged atomically inside the on-chain transfer.** No card processing fee
stacked on top, no FX spread, no IOF, no chargeback risk. The fee is paid
in USDC at settlement time, deducted from the buyer's payment before the
merchant receives the rest, in a single Stellar transaction.

A merchant invoicing USD $1,000 receives USD $970.30 in USDC; Slippay's
platform receives USD $29.70. Network fee on Stellar to execute the split:
≈ 0.00001 XLM (≈ USD $0.000001).

## How it compares · benchmark table

All rates as of 2026-05-16. Every cell links to a source; the column "all-in
for a BR→US $1,000 invoice" rolls the line into a single number.

| Provider | Headline rate | Card fee | IOF cross-border | All-in (BR→US, $1k) | Source |
|---|---|---|---|---|---|
| **Stripe Billing (BR)** | 0.7% recurring | + 3.99% + R$0.50 ≈ $0.10 | + 3.5% on FX leg | **~8.3%** | [stripe.com/billing/pricing](https://stripe.com/billing/pricing) |
| **Paddle (MoR)** | 5% + $0.50 | bundled | bundled | **~5.55%** | [paddle.com](https://www.paddle.com/compare/chargebee) |
| **Lemon Squeezy (MoR)** | 5% + $0.50 + 1.5% intl surcharge | bundled | bundled | **~7.05%** | [docs.lemonsqueezy.com](https://docs.lemonsqueezy.com/help/getting-started/fees) |
| **Chargebee** | 0% sub fee under $250k LTB, 0.75% overage | + Stripe ~3.6% | + 3.5% | **~4.35%** under cap, **~5.10%** over | [chargebee.com/pricing](https://www.chargebee.com/pricing/) |
| **Superfluid** | 0% protocol | n/a (user pays gas) | n/a | **0%** + buyer gas on Ethereum L2 | [superfluid.finance](https://www.superfluid.finance/subscriptions) |
| **Loop Crypto** | undisclosed | n/a | n/a | sunset 2026-02-13 | [loopcrypto.xyz](https://www.loopcrypto.xyz/) |
| **Slippay v0.4** | **2.97%** | none | none | **2.97%** + ≈ $0.000001 network | this doc |

Sources for the BR-side stack-ups:
- Stripe BR rate: [stripe.com/br/pricing](https://stripe.com/br/pricing)
- IOF cross-border raise (0.38% → 3.5% in May 2025):
  [knowledge.antom.com](https://knowledge.antom.com/brazils-iof-tax-rollercoaster-how-should-cross-border-sellers-respond)
- LATAM card decline 15-25%: [rapyd.net](https://www.rapyd.net/blog/payment-processing-decline-rates-in-latam/)
- BR cross-border specific 11% outright failure rate:
  [coinlaw.io](https://coinlaw.io/card-decline-statistics/)
- BR cross-border chargeback 2× domestic + avg $94 + 36.9% win rate:
  [chargeback.io](https://www.chargeback.io/blog/chargeback-statistics)

## Why 2.97%

We stress-tested the shipped 297 bp rate against four constraints. Listed in
priority order, with the math.

### 1 · headroom vs. fiat competitors (the hard floor)

A merchant comparing Slippay to Stripe Billing needs to see daylight. Stripe
on a $1,000 BR→US invoice nets us ~$83 of total leakage (4.7% Stripe stack +
3.5% IOF + the implied 15-25% silent decline cost amortized across attempts).
Slippay at 2.97% nets $29.70. **Headroom is ~53 percentage points** before our
fee even matters relative to their pain.

297 bp is not a round number chosen for narrative — it is the rate the v0.4
subscription contract splits on-chain. The wedge survives even so: at 2.97%
Slippay still costs roughly a third of the fiat stack all-in, and the "one
clean, auditable on-chain fee" position is what does the selling. Undercutting
to something rounder would leave money on the table without changing the
merchant's comparison.

### 2 · break-even on infrastructure (the soft floor)

Operating cost per processed payment is dominated by:

- Listener Horizon polling uptime (DigitalOcean droplet · $6/mo flat,
  amortized across all merchants)
- Supabase queries per order (~12 row reads/writes; well under free tier
  for first 50 merchants)
- Soroban network fee per `charge()` (~0.00001 XLM ≈ $0.000001)
- Webhook delivery (HTTPS POST · ~1KB · effectively free at scale)

At 100 merchants doing $10k/mo each (total GMV $1M/mo), Slippay gross is
$29.7k/mo at a 2.97% take. Infra cost stays under $200/mo. **Gross margin
> 99% before any non-engineering opex.** That margin gives room to absorb
support costs, fund the Sprint 4 mainnet ops, and reach v0.3 without
external funding.

### 3 · stretch lanes that should NOT subsidize the headline (the disanalogy)

Slippay v0.4 has three other revenue lanes available, none of which should
be baked into the headline 2.97%:

- **x402 per-call billing** — different shape (pay-per-resource, not
  recurring) · separate take of 2% on x402 transactions, justified by the
  smaller per-tx GMV and the agent-economy framing
- **Anchor partnership rev-share** — when the licensed BR VASP is wired
  in for Pix-on-ramp, the anchor takes their cut (typically 1.5-3% per
  fiat conversion) and Slippay either passes that through or splits with
  the anchor. **This is outside the 2.97% headline** — buyers using
  Pix-on-ramp see a separate FX/anchor line, not bundled into Slippay's
  take.
- **White-label SDK for marketplaces** — flat enterprise fee, not a
  percentage. Negotiated per-deal, post-Sprint 5.

Stripe bundles. Paddle/Lemon Squeezy bundle. Slippay deliberately does
not. **Disanalogy: in fiat, bundling reduces friction because the
infrastructure stack is hidden anyway. On Stellar, every fee is on-chain
and auditable; bundling them obscures the value pass-through and
breaks the audit narrative.**

### 4 · merchant-side anchoring (the perception math)

A BR-export SaaS founder reads "2.97% take" and immediately maps it to
"a fraction of what I'm paying now." That is the right mental model to fit
Slippay into. The number is legible next to Stripe's ~8.3% all-in, and it is
the number the contract actually charges — so the doc and the chain agree. The
lever for larger merchants is the v0.3 volume tier (below), not a lower
headline.

**2.97% is the shipped price-point for the BR-export wedge.** It sits inside
the band occupied by infrastructure-tier SaaS take rates — well under Stripe's
all-in stack, and above the low-single-digit API pricing of Plaid and Twilio.

## What 2.97% actually buys the merchant

Per $1,000 USD invoice:

- buyer pays exactly $1,000 in USDC (1:1 USD peg, no FX surprise)
- merchant receives $970.30 USDC in their own Stellar wallet, atomic with
  the buyer payment
- Slippay platform receives $29.70 USDC at the platform fee receiver
  address (separate Stellar account, multisig recommended for v0.2+)
- Stellar network fee: ≈ 0.00001 XLM ≈ $0.000001 paid by the buyer
- finality: ~6 seconds
- no chargeback (Stellar is final)
- no IOF (USDC is not a fiat FX leg)
- no card-decline-and-retry loop (no card present)
- no Account Updater problem (no expiring card to renew)
- no Pix decline (when the merchant's customer pays directly in USDC)

## Hidden costs the merchant must own (honesty)

- **Customer needs USDC on Stellar.** If the customer pays direct in
  USDC, they need a Stellar wallet + USDC trustline + USDC. For US
  customers this is friction. For LATAM crypto-native customers
  (CompreCripto-style ICP), this is normal.
- **Pix-on-ramp path** — when the BR VASP anchor partnership lands,
  buyers pay Pix BRL and the anchor mints USDC against the merchant's
  Stellar address. The anchor takes 1.5-3% on the fiat leg; that's a
  separate line, not Slippay's 2.97%.
- **Withdrawal to fiat** — when the merchant wants to pull USDC back to
  USD or BRL bank, they hit a separate off-ramp fee at MoneyGram,
  Wirex, or a BR VASP. Slippay does not charge for this; the off-ramp
  provider does.

## How it ships (technical)

The atomic split is implemented in the
[`subscription` contract](../../contracts/subscription/src/lib.rs) and
mirrored in the
[`buildAtomicTx`](../../apps/web/src/lib/stellar.ts) helper for one-shot
orders. Per call to `charge()`:

```rust
// merchant_share = amount * (1 - platform_fee_bp / 10_000)
// fee_share      = amount - merchant_share
client.transfer(&buyer, &merchant, &sub.amount);  // SAC handles the split
```

`platform_fee_bp` defaults to **297 (2.97%)** — `DEFAULT_PLATFORM_FEE_BP` in
[`packages/shared/src/constants.ts`](../../packages/shared/src/constants.ts) —
on `merchants.platform_fee_bp`, with per-merchant overrides allowed (0–1000 bp).
The matcher in `apps/listener/src/matcher.ts` uses BigInt stroop arithmetic to
verify the merchant share matches expected (audit-003 L4 closed).

## Pricing tiers (v0.4 ship · v0.3 expansion)

| Tier | When | Take rate | Other notes |
|---|---|---|---|
| **v0.4 mainnet (now)** | first 50 merchants | **2.97% flat** | no tier complexity, no minimums, no committed-volume discounts |
| **v0.3 Q3 2026** | merchants > $50K GMV/mo | 2.23% on volume above $50K/mo (a 25% discount to the headline) | rewards growth, doesn't lower the floor |
| **v0.3 enterprise** | white-label / per-deal | negotiated | flat fee or custom %, separate contract |
| **x402 per-call** | separate product | 2.0% | smaller per-tx amounts justify the higher % |

We commit to **no headline price changes for 12 months** from mainnet launch
(2026-05-16 → 2027-05-15). Any merchant onboarded in this window keeps
2.97% even after v0.3 tier complexity arrives.

## Falsifiable 12-month commitments

Publishing these as binding so the operator (Manuel) is held accountable:

1. **50 paying mainnet merchants by 2026-11-16** (6 months post-launch).
   Below this → product-market fit isn't there at 2.97%, revisit pricing
   or wedge.
2. **≥$1M USD cumulative GMV processed on mainnet by 2026-11-16.**
   Below this → take rate of 2.97% yields <$29.7k revenue · not viable as a
   company · backbone gets open-sourced as ecosystem infrastructure.
3. **Zero unannounced price changes in the first 12 months.** If we
   raise the rate, every existing merchant grandfathers at 2.97% for the
   remainder of their first 24-month contract.
4. **≤3% of merchants churn citing price as the reason in the first
   90 days.** Above this → the headline is more important than we think
   and the launch rate needs to be reassessed, not deferred to v0.3.

## What this doc is NOT

- **Not legal/tax advice.** BR-side IOF, ICMS-ST, and US-side
  withholding implications belong with the merchant's accountant. We
  state our take-rate; we don't classify the buyer's tax situation.
- **Not a quote for enterprise/white-label.** Anything above
  $500k/mo GMV or any embedded-SDK deal gets priced separately.
- **Not the only revenue line.** x402 has its own take (2%), the
  anchor partnership is a separate rev-share, and white-label is
  flat-fee. This doc covers the **subscription billing** lane only.

## See also

- [Positioning](./positioning.md) — where Slippay fits in the market
- [Architecture](../concepts/architecture.md) — how the split is enforced
  on-chain
- [Contract source](../../contracts/subscription/src/lib.rs) — the
  primitive that executes the split
- [Audit 002](../security/audit-002.md) — independent review of the
  contract pre-mainnet
