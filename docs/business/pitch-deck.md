# Slippay · pitch deck (7 slides · v0.2 · 2026-05-16)

For Stellar Build Award Sprint 2 Hackathon + SCF #42+ submission.
Each section is one slide. Mario formats into Keynote/Figma.

---

## slide 1 · the problem

**Brazilian SaaS, agencies and digital exporters lose 7-8% on every
international invoice. 1 in 5 transactions silently fails.**

- Stripe BR: 0.7% + 3.99% + R$0.50 per transaction
  · [stripe.com/billing/pricing](https://stripe.com/billing/pricing)
- IOF cross-border FX raised from 0.38% → **3.5%** in May 2025
  · [antom.com](https://knowledge.antom.com/brazils-iof-tax-rollercoaster-how-should-cross-border-sellers-respond)
- LATAM card decline rate: **15-25%** on cross-border (Rapyd, 2025)
  · [rapyd.net](https://www.rapyd.net/blog/payment-processing-decline-rates-in-latam/)
- Brazil cross-border fail rate specific: **11% outright failures**
  · [coinlaw.io](https://coinlaw.io/card-decline-statistics/)
- LATAM has **no Account Updater** — expired cards = involuntary churn
  · [bluesnap support](https://support.bluesnap.com/docs/latam-local-processing)

A R$50k/month SaaS exporting to the US **loses ~R$25k/year** to fees +
~R$120k/year in failed-payment churn the dashboard never shows.

---

## slide 2 · the solution

**Slippay routes the same invoice via Stellar in 6 seconds. No IOF.
No card decline. No chargeback.**

- Buyer pays in USDC (or PYUSD) via Stellar wallet · or in BRL via Pix
  through a licensed BR VASP anchor — anchor handles FX, Slippay handles
  the merchant API + matching + webhook delivery
- Settlement is atomic on-chain · finality in ~6s
- Merchant funds remain non-custodial in their own Stellar wallet from
  the moment of payment forward
- USDC stays USDC — merchant converts when and where they want, not
  every transaction

---

## slide 3 · how it works

```
  customer pays                  Slippay listener                 merchant
  ─────────────                  ────────────────                ────────
                                                                    │
  USDC tx → memo  ────────►   Horizon stream                          │
                              matcher: memo + asset + addr            │
                              reconciler: order.status = paid         │
                              webhook signed (HMAC) ─────────────►    │
                                                                       │
                                                                  fulfillment
```

**Four moving parts. One atomic transaction.**

1. `POST /v1/orders` (merchant API) → USD or BRL denominated · returns
   a hosted `checkout_url` with signed HMAC token (audit-004 C2 closed)
2. Customer signs USDC payment to merchant Stellar address with the
   issued MEMO_HASH
3. Slippay listener watches the merchant account on Horizon · matches
   memo + asset + amount (BigInt stroop arithmetic, audit-003 L4)
4. Webhook fires to merchant endpoint with HMAC `t=,v1=` signature
   + replay-protected delivery uuid (audit-001 closed CVSS 9.1)

Verifiable on-chain · audit-002 F5 closed with real-wallet signature
(testnet tx [`eee0d71f...`](https://stellar.expert/explorer/testnet/tx/eee0d71f2f2100da1b97c971cec98fe367e89758c0b8b91c29ef6d5e84a602ff)).

---

## slide 4 · market

- LATAM cross-border B2C payments: **$170B+/yr** (Mastercard / WorldPay
  2024 · figure for context; not Slippay's TAM in isolation)
- Brazil SaaS exports billed in USD: **$2.3B+/yr** (Abes 2025 estimate)
- Subscription billing infra category on Stellar: **empty**. Closest
  peer on any chain is Loop Crypto, which is sunsetting Feb 2026
  · [docs.loopcrypto.xyz](https://docs.loopcrypto.xyz)

Wedge: BR-export SaaS + agencies + digital infoproducers billing
USD-priced subscriptions to international customers. Total addressable
sub-segment ≈ **40k-60k merchants** (Abes + Conta Azul + Nuvemshop seller
overlap, rough estimate · not measured).

**Why now:**

- BCB Resoluções 519/520/521 (Feb 2026) reclassified BRL ↔ stablecoin
  flow as `operações de câmbio` — licensed VASP path opened
- IOF on cross-border FX 3.5% (May 2025) widened the pain Slippay fixes
- Stellar has BRL anchors operational (Wirex+Ultra Stellar partnership
  April 2026 · [prnewswire.com](https://www.prnewswire.com/news-releases/wirex-and-ultra-stellar-launch-native-stellar-payment-infrastructure-to-power-millions-of-users-and-ai-agents-302732712.html))

---

## slide 5 · business model

| Comp | Take rate | Source |
|---|---|---|
| Stripe Billing | 0.5%-0.8% recurring **+ 2.9% + $0.30 card** (BR: 0.7%+3.99%+R$0.50) | [stripe.com/billing/pricing](https://stripe.com/billing/pricing) |
| Paddle | 5% + $0.50 (MoR) | [paddle.com](https://www.paddle.com/compare/chargebee) |
| Lemon Squeezy | 5% + $0.50, +1.5% international | [docs.lemonsqueezy.com](https://docs.lemonsqueezy.com/help/getting-started/fees) |
| Chargebee | 0.75%-1.4% TCO | [chargebee.com/pricing](https://www.chargebee.com/pricing/) |
| Superfluid | 0% (user pays gas) | [superfluid.finance/subscriptions](https://www.superfluid.finance/subscriptions) |
| Loop Crypto | undisclosed · sunsetting 2026-02 | [loopcrypto.xyz](https://www.loopcrypto.xyz/) |
| **Slippay v0.2 target** | **1.0% take rate, no card cost** | locked in `docs/business/revenue-model.md` |

Path to 1.0%: merchant pays Slippay 1% via the contract's atomic split
(buyer → merchant_share + platform_fee in same tx, no off-chain
reconciliation). Stellar network fee 0.00001 XLM (~$0.000001) is the
floor.

Stretch revenue lanes (post v0.2):
- x402 per-call resource gating (shipped today as PoC · separate doc)
- Anchor partnership rev-share (BRL custody anchor takes their cut · Slippay
  bundles)
- White-label SDK for marketplaces

---

## slide 6 · traction & proof

**On-chain (verifiable now):**

- Contract v0.2 deployed Stellar testnet
  · [`CBN3M7IA...VBTFQ`](https://stellar.expert/explorer/testnet/contract/CBN3M7IAKNSCSDQIUUGDBHSFUQDOFAQQQK6UXJZYGGIWERQGT24VBTFQ)
- Real-wallet e2e charge (F5 gate) PASSED today
  · [tx `eee0d71f...`](https://stellar.expert/explorer/testnet/tx/eee0d71f2f2100da1b97c971cec98fe367e89758c0b8b91c29ef6d5e84a602ff)
  · buyer 1000→990 USDC · merchant 0→10 USDC
- WC plugin v0.2 published with signed release
  · [github.com/Galmanus/slippay/releases/tag/v0.2.0-wc-plugin](https://github.com/Galmanus/slippay/releases/tag/v0.2.0-wc-plugin)
- x402 protocol integration shipped (`POST /v1/x402-resources` + public
  `GET /v1/x402/:slug` flow) — Slippay backbone runs both push and pull
  payment patterns on the same primitive

**Code-quality (verifiable now):**

- 6 audit reports published in `docs/security/audit-001..006.md`
- 8 critical + 14 high findings closed in code · documented with CVSS,
  exploit path, fix sketch, falsifiable predictions
- production CI workflow (`.github/workflows/deploy-production.yml`) with
  signed tags + WASM hash assertion gate

**Pipeline:**

- CompreCripto onboarded (BR crypto exporter, first paying customer
  pipeline)
- 0/5 mainnet wallets active as of submission — mainnet deploy is
  Sprint 4 (deadline 2026-05-30)

---

## slide 7 · team & ask

**Manuel Galmanus** · founder · AI/ML eng, cybersecurity (web2 + web3),
prior shipped Bluewave AI cognitive infra. Solo on backbone + contract.

**Mario F. Neto** · co-founder · ops, design, customer dev.

**What we're asking from Stellar:**

- Selection for the SCF cohort and (if eligible) the Rio in-person
  event so we can pitch the BR-export subscription billing thesis to
  partners and anchors in one room
- SCF Build Award support to extend v0.2 → v0.3: pre-auth (audit-002 F4
  follow-up), multi-asset routing, BRL anchor production integration,
  v0.3 contract redeploy with migration path

**Falsifiable 90 days post-funding:**

- 50 paying merchants live on mainnet
- ≥$50K GMV processed end-to-end on-chain via Slippay
- ≥1 published x402 integration case study with a real agent client

Below this threshold → Slippay's thesis is wrong and we open-source the
backbone as Stellar ecosystem infrastructure rather than continuing the
company.

---

## footer · links + provenance

- repo: [github.com/Galmanus/slippay](https://github.com/Galmanus/slippay)
- live demo (testnet x402 vault): [app.slippay.cc/x402-demo](https://app.slippay.cc/x402-demo)
- audit reports: [docs/security/](https://github.com/Galmanus/slippay/tree/main/docs/security)
- mainnet runbook: [docs/ops/mainnet-runbook.md](https://github.com/Galmanus/slippay/blob/main/docs/ops/mainnet-runbook.md)
- x402 architecture: [docs/integrations/x402.md](https://github.com/Galmanus/slippay/blob/main/docs/integrations/x402.md)
- contact: manuel@bluewaveai.online · +55 47 9745-5602
