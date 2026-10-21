# Outreach · Transfero (BRZ issuer + BR VASP)

**Status:** DRAFT — review before sending
**Channel:** email (find decision-maker via LinkedIn first; CEO Thiago Cesar or BD lead)
**Subject:** Stellar checkout layer on top of your BRZ rail — 50/50 take rate
**Send only after operator approval.** Per memory `feedback_destructive_ops_per_item_consent` —
sending an external partnership pitch is irreversible reputational action.

---

Hi [name],

Quick context: I'm building slippay — a Stellar-native checkout SDK for Brazilian
merchants billing globally. Live on testnet, mainnet planned within 60 days.

Why I'm reaching out: I want to ship a Pix-in / USDC-out checkout on Stellar
mainnet, and BCB Resoluções 519/520/521 (effective Feb 2026) make it clear that
the BRL ↔ stablecoin leg is FX. I'm not building licensed VASP infrastructure
from scratch when Transfero already has BRZ + the regulatory perimeter.

Concrete proposal:

- slippay sits on top: merchant API, hosted checkout, memo-matched Stellar
  settlement, webhook delivery, dashboards
- Transfero handles the regulated leg: BRL Pix in, KYC, FX, mint USDC (or BRZ
  bridged to USDC via path-payment) on Stellar against the merchant's address
- SEP-31 between us would be the cleanest integration surface
- platform fee: 1% on transaction volume, split 50/50
- both parties named in merchant onboarding; merchants see "powered by Transfero"

What this gets you: distribution into a merchant tier (BR SaaS, exporters,
crypto-native indie commerce) that doesn't currently route through your direct
sales flow. Non-overlapping with your B2B treasury / on-ramp business.

What this gets us: the regulated counterparty without slippay running its own
SPSAV (R$2M minimum capital, 6-12 month timeline). Credibility for merchants
asking "where does the BRL go before it becomes USDC."

What I'd need to validate the integration:

1. SEP-31 sandbox access (or current state of your SEP-31 deployment)
2. fee structure on the BRL → USDC leg you'd quote
3. KYC flow you'd impose on merchants accepting via this rail
4. monthly volume cap on the partnership tier in early days

I can share the slippay architecture deck and a live testnet checkout if useful.
30-min call this week or next?

Best,
Manuel Galmanus
Founder, slippay (Bluewave AI · CNPJ 66.381.800/0001-08)
+55 47 9745-5602
manuel@bluewaveai.online
