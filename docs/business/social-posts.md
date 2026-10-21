# Slippay · social posts (3) · Sprint 2 hackathon deliverable

Drafted 2026-05-16. Adjust voice for the channel before publishing.
All tx hashes / links are real and verifiable.

---

## post 1 · Twitter/X · technical drop · 280 chars max

> Brazilian SaaS loses ~7-8% on every international invoice via Stripe + IOF.
> 1 in 5 LATAM card transactions silently fails.
>
> We built Slippay on @StellarOrg + Soroban. Subscription billing, 6s
> finality, 1% take.
>
> Real-wallet charge on testnet today:
> stellar.expert/explorer/testnet/tx/eee0d71f...
>
> Demo: app.slippay.cc/x402-demo

Variant if char count over:

> @StellarOrg Soroban subscription primitive shipping.
> BR SaaS pays 7-8% + IOF to Stripe today.
> Slippay = 1% on-chain, 6s finality, 0 chargeback.
> Real charge proven: stellar.expert/explorer/testnet/tx/eee0d71f...
> Demo: app.slippay.cc/x402-demo

---

## post 2 · LinkedIn · long-form business · ~1500 chars

> **Why we built Slippay on Stellar**
>
> The pain isn't subtle. Brazilian SaaS exporters pay roughly 7-8% on
> every international invoice — Stripe BR (0.7% + 3.99% + R$0.50) plus
> the IOF cross-border FX, which jumped from 0.38% to 3.5% in May 2025.
> On top of that, 15-25% of LATAM cross-border card transactions
> silently fail (Rapyd 2025). A R$50k/month exporter sees R$25k/year
> evaporate in fees and another R$120k/year in failed-payment churn
> that never makes it to their dashboard.
>
> Slippay routes the same invoice through Stellar in 6 seconds. USDC
> settles directly to the merchant's wallet — non-custodial. The
> buyer pays in USDC or PYUSD, or in BRL via Pix through a licensed
> BR VASP anchor. The IOF, the chargeback, the FX spread, the silent
> card decline — none of them exist on this path.
>
> Today we shipped:
>
> · Soroban subscription contract v0.2 on testnet
>   (CBN3M7IA...VBTFQ)
> · F5 audit gate closed: real-wallet end-to-end charge with
>   buyer-signed nested SAC.transfer auth chain
> · x402 protocol integration so the same backbone powers per-call
>   agent payments alongside subscriptions
> · 6 security audits formally documented (8 critical + 14 high
>   findings closed)
> · WooCommerce plugin v0.2 with signed release + SHA256SUMS
>
> Demo live for anyone to use:
> https://app.slippay.cc/x402-demo
>
> Code open: https://github.com/Galmanus/slippay
>
> Stellar Build Award · #stellarcommunityfund #soroban #brazilianfintech

---

## post 3 · Twitter/X thread (5 tweets) · narrative insight from the build

**1/5** · 6 audits closed in one day. 8 critical + 14 high findings. We
documented every one with CVSS, exploit path, fix sketch, and a
falsifiable prediction we now have to honor.
github.com/Galmanus/slippay/tree/main/docs/security

**2/5** · The worst finding: WooCommerce webhook bypass at CVSS 9.1.
v0.1 plugin accepted unauthenticated `order.paid` events from anywhere
on the internet. v0.2 closes it with required HMAC secret + listener-
aligned signature + replay protection. Signed release published.

**3/5** · The next-worst: listener SSRF. Merchant could register a
webhook URL whose DNS resolves to 169.254.169.254 — AWS/GCP cloud
metadata. We added DNS-resolve + IP pinning via undici Agent + extended
blocklist (CGNAT, ULA, link-local, IPv4-mapped IPv6).

**4/5** · The subtle one: BigInt money math. Stellar amounts are 7-dp
decimal strings. `Number()` round-trip is non-deterministic at the
stroop boundary. We rewrote the matcher to operate in BigInt stroops
with floor-truncation to merchant.

**5/5** · Why this matters: Slippay is going to mainnet. Merchants
will route real money through this code. Audit-first isn't ceremony —
it's the only way a 2-person team gets to ship payments infra without
becoming the next headline. @StellarOrg
demo: app.slippay.cc/x402-demo

---

## post 4 (bonus, optional) · Twitter/X · x402 angle · for the Coinbase / x402 community

> Slippay backbone now serves both:
> · push payments (subscriptions, audit-002 contract v0.2)
> · pull payments (x402 per-call, shipped today)
>
> One memo discipline. One listener. One reconciler.
>
> Coinbase x402 + @StellarOrg ecosystem — Brazilian SaaS billing
> infra wired in.
>
> github.com/Galmanus/slippay/blob/main/docs/integrations/x402.md

---

## scheduling note

Suggested order (sat 2026-05-16):
- 19:00 BRT · post 1 (technical drop on X)
- 21:00 BRT · post 2 (LinkedIn long-form)
- 22:00 BRT · post 3 (thread on X)
- sun morning · post 4 (x402 community angle)

Tag list: @StellarOrg @BluewaveAI @coinbase (for x402 thread only).
Hashtags: #stellar #soroban #stellarcommunityfund #brazilianfintech
#paymentinfra #SCF
