# Slippay · market positioning

- **status:** v0.2 launch positioning · 2026-05-16
- **author:** Manuel Galmanus
- **revisit cadence:** every 30 days while pre-PMF · quarterly after PMF

## One-line claim

**Slippay is the subscription billing primitive for Brazilian SaaS,
agencies, and digital exporters who bill global customers in USD.**

USDC settles in 6 seconds on Stellar. No IOF on the FX leg. No card
decline. No chargeback. The merchant holds USD-denominated USDC in their
own wallet from the moment of payment forward.

## The audience · who Slippay is for

Three concentric circles, in order of fit:

### Circle 1 · BR-export SaaS billing USD (highest fit)

The crisp-clean ICP. Companies that:

- Are CNPJ-registered in Brazil
- Sell SaaS / digital products / agency services to non-Brazilian
  customers (US, EU, LATAM-ex-BR)
- Invoice in USD (or want to)
- Process recurring subscriptions, not one-off transactions
- Today's leakage:
  - Stripe Billing BR cards: **7-8% all-in** (0.7% + 3.99% + R$0.50 +
    3.5% IOF). [stripe.com/br/pricing](https://stripe.com/br/pricing) +
    [antom.com IOF](https://knowledge.antom.com/brazils-iof-tax-rollercoaster-how-should-cross-border-sellers-respond)
  - LATAM cross-border card decline rate: **15-25%**, with BR
    specifically at **11% outright failure on cross-border**.
    [rapyd.net](https://www.rapyd.net/blog/payment-processing-decline-rates-in-latam/),
    [coinlaw.io](https://coinlaw.io/card-decline-statistics/)
  - Chargebacks: BR 2× domestic rate, average $94 per dispute, 36.9%
    merchant win rate. [chargeback.io](https://www.chargeback.io/blog/chargeback-statistics)

A $50K/mo MRR BR-export SaaS today loses **~$36k/year in fees** and
~$120k/year in failed-payment churn that never shows on their dashboard.
At Slippay's 1.0% take, the fee line collapses to ~$6k/year. The
failed-payment-churn line goes to **zero** because the card rail is
removed entirely.

**Size of this circle (rough estimate, not measured):** 40-60k merchants
across Abes membership + Conta Azul / Nuvemshop seller overlap with
international invoicing tags. Subset that actively bills USD subscriptions:
maybe 10-15k. Slippay's 12-month falsifiable target is 50 merchants
(0.3% of the inner pool) → plenty of room.

### Circle 2 · LATAM-wide digital exporters

Same shape, different geography. Mexico, Colombia, Argentina, Chile
exporters with similar IOF-equivalent FX tax + card-decline overhead.
Slippay v0.2 supports them technically (USDC is geography-agnostic) but
positioning, anchor partnerships, and merchant comms stay BR-focused
until 12-month milestones hit. Circle 2 is reserved for v0.4+ expansion.

### Circle 3 · Crypto-native subscription merchants globally

Web3 SaaS, DAO tooling, on-chain analytics services, NFT memberships.
Smaller TAM, but high fit because the customer already has a Stellar
wallet. Slippay v0.2 serves them as a side-effect; we don't actively
market here. The first paying merchant (CompreCripto, BR crypto-exporter)
sits in the overlap of Circle 1 and Circle 3.

## What Slippay is NOT

This list exists because misclassification by a prospect is more painful
than non-fit.

- **Not a wallet.** We don't custody anything. Buyer wallet → merchant
  wallet, direct, atomic, on-chain. Slippay's process never holds
  customer funds.
- **Not a fiat on-ramp.** Buyers who want to pay BRL via Pix do so
  through a licensed BR VASP anchor partnership (pending). Slippay
  orchestrates the order + memo + matching; the anchor handles the
  BRL→USDC custody and FX.
- **Not a Stripe replacement for domestic BRL cards.** If your customer
  is in São Paulo paying in BRL with a Brazilian credit card to a
  Brazilian merchant, Stripe domestic / Pagar.me / Asaas are still the
  right tools. Slippay's wedge is the **cross-border** leg specifically.
- **Not a remittance service.** Money lands in the merchant's Stellar
  wallet, not their BR bank. Off-ramp to BRL is a separate step the
  merchant handles via MoneyGram, Wirex, or a BR VASP. Slippay does not
  charge for off-ramp.
- **Not a tax/accounting tool.** Slippay reports the on-chain settlement;
  the merchant's accountant classifies it per BCB Res 519/520/521 and
  Receita Federal guidance.
- **Not an exchange / DEX.** No order book, no market-making, no swap.
  Direct stablecoin transfer with merchant-side payment matching.

## Competitive landscape

We mapped every project that could be confused with Slippay. Categories
by overlap:

### High overlap (direct competitors, all sunsetting or non-Stellar)

| | What they do | Status | Slippay differentiation |
|---|---|---|---|
| **Loop Crypto** | Crypto subscription / recurring billing on Ethereum L2s, Stripe-style autopay | **Sunsetting 2026-02-13** ([docs.loopcrypto.xyz](https://docs.loopcrypto.xyz)) | Not on Stellar · folding into Lead · the closest peer on any chain is gone in 60 days |
| **Superfluid** | Continuous payment streams on Ethereum / Optimism / Polygon | Active, $0 protocol fee but user pays gas | Different shape (per-second streams vs. discrete subscriptions). Slippay's discrete model fits invoicing/tax reporting. Stellar fees ≈ free vs L2 gas variable |
| **Sablier v2** | Token streams, vesting-focused | Active, fees not verified | Vesting/grant focus, not merchant billing. Different ICP |

### Adjacent (overlap with our anchor-partnership leg, NOT direct)

- **Wirex + Ultra Stellar** (April 2026) — wallet + card issuance on
  Stellar, not subscription billing. [prnewswire.com release](https://www.prnewswire.com/news-releases/wirex-and-ultra-stellar-launch-native-stellar-payment-infrastructure-to-power-millions-of-users-and-ai-agents-302732712.html)
- **Mykobo** (SCF #14 winner) — EURC issuance / fiat ramp, not billing
- **MoneyGram-Stellar rail** — fiat payout, useful as merchant off-ramp,
  not a competitor
- **Beans App / Lobstr Pay / Bitfinex Pay** — wallet UX / P2P / merchant
  acceptance, none recurring
- **Stellar Disbursement Platform (SDF)** — enterprise bulk push payouts,
  opposite direction

### Stellar-native subscription billing: empty category

We checked SCF #40 + #41 + #42 portfolios + the broader Stellar
ecosystem. **No other project on Stellar ships a subscription-billing
SDK with merchant API + listener + WooCommerce plugin.** Closest peers
are anchors (BR/EUR/USD on/off-ramp) and adjacent infra (Aquarius DEX,
SDF Disbursement Platform). Subscription primitive on Soroban is a
white-space category as of 2026-05-16.

Confidence in this claim: 80%. Could have missed an early-stage SCF
submission that hasn't surfaced publicly yet. The white-space status
will be re-checked at each SCF round publication.

## The "why now" argument

Three time-sensitive forces converge in 2026 that didn't exist before:

### 1 · BCB Resoluções 519/520/521 (effective February 2026)

The Banco Central do Brasil reclassified BRL ↔ stablecoin flow as
**operações de câmbio** (FX operations) under VASP supervision. This
opens the legal path for a licensed BR VASP anchor to mint USDC from
Pix BRL on behalf of merchants without the previous regulatory ambiguity.
Slippay's anchor-partnership architecture is built specifically for this
post-Feb-2026 reality.

[BCB resolution publication index](https://www.bcb.gov.br/estabilidadefinanceira/criptoativos)

### 2 · IOF cross-border raised 0.38% → 3.5% in May 2025

A near 10× tax increase on cross-border FX in 12 months. Every BR-export
SaaS that bills in USD suddenly carries 3.5% more cost per invoice.
USDC settlement on Stellar **does not pass through this leg** because no
fiat FX is happening at the moment of payment — the buyer is paying USDC
directly, and the merchant chooses when/if/where to convert later. The
arbitrage window is open.

[antom.com analysis of the IOF rollercoaster](https://knowledge.antom.com/brazils-iof-tax-rollercoaster-how-should-cross-border-sellers-respond)

### 3 · LATAM Pix overtaking cards · BR online card share 49% → 41% in 2 years

[norbr.com payment methods report](https://norbr.com/library/payworldtour/payment-methods-in-blilrazil/)

The card rail is shrinking in BR. The replacement, Pix, is BRL-only and
doesn't help cross-border. USDC is the natural cross-border replacement
for BR-export use cases. Slippay sits at exactly this hinge.

## Falsifiable wedge claims · 12 months

Publishing as binding:

1. **Wedge is real, not invented.** In the next 12 months, at least 1
   non-Slippay-affiliated source (Stellar blog / SCF case study /
   investor analysis / Brazilian fintech press) will publish independent
   coverage characterizing BR-export USD subscription billing on
   Stellar as a category. **Below this** → either we're inventing
   demand or the narrative isn't crisp enough.
2. **No direct Stellar competitor by 2026-11-16.** If another team
   ships a Stellar-native subscription primitive + merchant API +
   plugin distribution by that date and we are not the obvious leader,
   our category-creation timing was 6+ months too slow.
3. **CompreCripto-like wedge generalizes.** Of the first 10 paying
   merchants, ≥7 are BR-CNPJ exporters billing non-BR customers (not
   crypto-native side-projects). Below this → the wedge is actually
   different from what we said, recalibrate.
4. **IOF arbitrage is the dominant motivator.** Of the first 10 paying
   merchants, ≥6 cite "IOF + Stripe fees" as the primary reason for
   choosing Slippay in their onboarding survey. Below this → we are
   over-indexed on the macro pitch, the real driver is something else
   (settlement speed, non-custodial, dev-experience, brand).

## The product vs the company

Important separation:

- **Slippay (the product)** is a billing primitive. It does one thing
  well: subscription + per-call settlement on Stellar with merchant API
  + listener + plugin. Slippay should never become a wallet, an
  exchange, or a tax tool.
- **Bluewave AI (the company)** is the operator behind Slippay and
  potentially future products. The Concierge agent on Slippay's landing
  runs on Bluewave's open SSL v7 specification
  ([galmanus.github.io/ssl-spec](https://galmanus.github.io/ssl-spec/)).
  Future Bluewave products may share the SSL agent framework but will
  be separately branded.

Stakeholders should evaluate Slippay on Slippay's wedge, not on
Bluewave's broader thesis.

## See also

- [Revenue model](./revenue-model.md) — how the 1.0% take rate ladders
  to a sustainable company at the falsifiable 12-month thresholds
- [Pitch deck](./pitch-deck.md) — the 7-slide version for investors / SCF
  reviewers / cohort applications
- [Audit reports](../security/) — 6 closed audits backing the
  technical-credibility claims in this positioning
- [Mainnet runbook](../ops/mainnet-runbook.md) — operational discipline
  backing the "live on mainnet" claim
