# Outreach · Bitso Business (BR licensed VASP + Pix+stablecoin API)

**Status:** DRAFT — review before sending
**Channel:** Bitso Business sales form OR direct LinkedIn (head of Brazil ops, partnerships lead)
**Subject:** Stellar checkout layer on top of Bitso Business — Pix in, USDC out
**Send only after operator approval.** Per memory `feedback_destructive_ops_per_item_consent` —
sending an external partnership pitch is irreversible reputational action.

---

Hi [name],

Quick context: I'm building slippay — a Stellar-native checkout SDK for Brazilian
merchants billing globally (export SaaS, marketplaces, BR sellers with overseas
counterparties). Live on testnet, mainnet planned within 60 days.

Why Bitso: your Bitso Business unified API for Pix + stablecoin (BRL → USDC at
sub-10 bps spread, 7–10 minute settlement loop) is exactly the regulated leg
slippay needs. BCB Res 519/520/521 make BRL ↔ USDC FX-classified; running that
flow without a licensed counterparty isn't viable.

Concrete proposal:

- slippay = checkout layer: merchant onboarding, hosted Pix+wallet checkout,
  memo-matched Stellar settlement, webhook delivery, merchant dashboard
- Bitso = regulated leg: BRL Pix-in, KYC, FX, USDC delivery
- integration via Bitso Business API (whichever endpoint set covers BRL Pix-in
  → USDC payout to a Stellar address). No need for SEP-31 if your existing API
  fits — slippay translates internally
- where Bitso's stablecoin settlement is currently EVM-first (Polygon, etc.),
  this brings you Stellar coverage with sub-cent fees and 6-second finality —
  and a merchant tier (small/mid e-commerce, indie SaaS) that doesn't route
  through your enterprise sales channel
- revenue: split 1% platform fee 50/50, or take rate per Bitso fee schedule +
  slippay markup, whichever models cleaner

What I want to validate in 30 minutes:

1. is the Bitso Business API exposed for the "BRL Pix-in → USDC payout to
   externally-controlled Stellar address" flow today?
2. partnership / white-label terms — yes/no in principle before I dig deeper
3. KYC obligations slippay would inherit on the merchant side
4. minimum volume thresholds for partnership eligibility

Slippay architecture deck + live testnet checkout available on request.

Best,
Manuel Galmanus
Founder, slippay (Bluewave AI · CNPJ 66.381.800/0001-08)
+55 47 9745-5602
manuel@bluewaveai.online
