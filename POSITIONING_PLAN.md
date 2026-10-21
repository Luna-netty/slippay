# SlipPay — positioning & business model

_2026-06-02. Authored by Claude (laptop/SlipPay session) from the thesis Manuel + Wave converged on, with numbers verified independently and three corrections applied. This is decision material, not a fixed plan — the gates below are falsifiable on purpose._

## The thesis (one line)

**SlipPay is the proof-bounded settlement rail for the agent economy. The money is a take-rate (basis points) on settled volume — not a per-attestation fee. The proof/verify is the toll-gate that makes the take-rate defensible. The free MCP is the distribution Trojan horse.**

You don't sell the proof. You charge to cross the wall the proof builds.

## Why this is the most profitable shape (grounded)

The most profitable payment companies don't charge much — they charge almost nothing over almost everything.

- **Visa, FY2024:** net revenue **$35.9B** on payments volume **$13.2T** → an all-in net take of **~27 bps** (0.27%). The slice it charges merchants directly (the assessment/network fee) is **~13 bps**. The 1.5–2% everyone quotes is *interchange* — that goes to the issuing banks, not Visa. A ~$600B company built on ~0.1–0.3% of everything. [Visa FY2024 8-K](https://www.sec.gov/Archives/edgar/data/0001403161/000140316124000053/q42024earningsrelease.htm)
- Marginal cost per additional transaction ≈ 0. Revenue scales with the size of the agent economy, **not with Manuel's attention.** That is the exact property recurring audit revenue lacks.

**Disanalogy (stated honestly):** Visa took decades and a two-sided card network to reach $13.2T. SlipPay has $0 of agent-to-agent volume today. The bps model is only worth anything *if the volume arrives and SlipPay is the rail it arrives on*. That is the bet, and it's gated below.

## The market is real and arriving (verified)

- Juniper (Apr 2026): agentic spend **$8B in 2026 → $1.5T by 2030**. [Juniper via commercetools](https://commercetools.com/blog/agentic-commerce-stats-enterprise-guide)
- McKinsey (Oct 2025): **$3–5T** agentic commerce by 2030.
- Agentic *payment infrastructure* market: **$7B now → $93B by 2032**.
- Coinbase **x402** processed **~165M agent transactions** in its first months; Coinbase launched **Agent.market** (Apr 2026) where agents pay each other in stablecoins. [Nevermined stats](https://nevermined.ai/blog/agentic-commerce-growth-statistics)

The volume is coming. The question is who's the rail when it lands.

## The five questions, answered

### 1. How do we sell it
Two motions, sequenced — not one:
- **Now (bridge):** sell the *attestation/audit* — the re-verifiable proof that an agent can't overspend. This is service revenue. It is capped by Manuel's attention and it is **the bridge, not the business.** It pays the café while the rail has no volume.
- **Later (rail):** take a fee in basis points on every agent-to-agent payment that clears through the proof-bounded wallet. Infrastructure, not service. This is the fortune.
- **Always (distribution):** the **free, open-source MCP** (`slippay_verify` especially) is the Trojan horse — it puts `/verify` into every agent toolchain *before there's a competitor*. Whoever is the rail when the market is born is not replaced later.

### 2. To whom
- **Bridge buyers (pay now):** teams deploying autonomous agents with real budgets that need *auditable* spend caps — fintech/enterprise agent teams, agent-framework vendors who need a compliance story to sell up-market, security auditors. They pay to **avoid** an agent overspending or being socially-engineered into a bad payment.
- **Rail users (pay on volume):** agent platforms and marketplaces settling agent↔agent payments where **counterparty trust** is the blocker — the Agent.market / x402-adjacent world, but proof-gated.

### 3. For how much
- **Bridge:** per-attestation + annual retainer. Honest ceiling: ~$5–20k/yr per client → ~$10M ARR needs ~500 clients, all pulling Manuel's time. Consultant-rich, not rich-rich. Treat as runway, not destination.
- **Rail:** take-rate on settled volume. **Anchor low (10–30 bps), not Stripe's 2.9%** — on-chain rails (x402/stablecoin) are racing the protocol fee toward zero, so the premium has to come from the proof-gate, not from being a payment processor. 30 bps × $1B settled = $3M; the same 30 bps scales to $130M at $100B of flow with no extra headcount.
- **MCP:** $0. It is customer-acquisition, not a SKU.

### 4. Why someone buys / adopts
- The proof does a job a configured guard (kaimo's "abort if drift > 5%") cannot: it holds for **every reachable state** of the contract, and the counterparty can **re-verify it themselves** (browser `/verify`, offline `slippay_verify`). 
- On the rail: an agent settles only to a counterparty **proved not to be compromised** — the defense against the prompt-injection / impersonation attack class (Branded/Vault Whisper, arXiv:2601.22569). The toll buys *safe clearing*, which raw routing can't offer.

### 5. Why Stellar (SDF/SCF) would sponsor it
Their incentive is ecosystem usage, TVL, and the agentic-commerce narrative. This is fundable through real, named programs:
- **SCF Build Award — up to $150K in XLM**, milestone-based (10/20/30/40% tranches). The proof-bounded rail builds directly on Soroban + passkey-kit. [SCF awards](https://communityfund.stellar.org/awards)
- **SCF Public Goods Award** (launched May 2025) — for key infra/tooling. The **open MCP + `/verify` is a textbook public good.** [SCF handbook](https://stellar.gitbook.io/scf-handbook)
- **SCF Growth Hack** — $20K in XLM to mainnet companies to test acquisition (Q4 2025).
- Warm channel already exists: Rio Stellar Brasil approval **with financial aid**. Realistic combined ask: a Build Award (rail) + Public Goods (MCP/verify), milestone-gated.

## What I corrected from the relayed version (factual + mandate)

1. **Privy comp was overstated.** Not "$200M". Privy raised **~$40M total** (~$15M last round, Ribbit/Sequoia/Coinbase), valued **~$230M** (PitchBook, Mar 2025), and was **acquired by Stripe in June 2025** (undisclosed). [SiliconANGLE](https://siliconangle.com/2025/06/11/stripe-acquires-crypto-wallet-infrastructure-provider-privy/) · [The Block](https://www.theblock.co/post/357803/payment-giant-stripe-to-buy-crypto-wallet-firm-privy-report). The honest number is *smaller* but the comp is *stronger*: a payment giant just paid for exactly this category (passkey/wallet infra). That validates the acquisition logic better than an inflated funding figure.
2. **The gate is SlipPay's own proof, not "Bluewave attestation."** Wave's relay called the toll "a atestação Bluewave." Per the hard Bluewave↔SlipPay separation mandate, the gate is SlipPay-native (axl → proof-carrying cert → `/verify` / `slippay_verify`). Keep it that way or the separation Manuel set is violated.
3. **"Be the rail" is not virgin territory.** Coinbase **x402 already has ~165M agent transactions** and Agent.market, on EVM/Base. SlipPay is not first-to-rail. The wedge is narrower and truer: **the rail that proves its limits, on Stellar** — and likely *interoperating with* x402 (Stellar sits outside canonical EVM x402), not claiming to replace it.

## Named failure modes (the part that makes this not theater)

- **Take-rate × $0 GMV = $0.** Agent↔agent proof-bounded settlement has no volume through SlipPay today. The bridge revenue is mandatory, not optional.
- **Platform/standard risk.** x402, Google AP2, Stripe (which now owns Privy), Visa/Mastercard agentic — any could make "agent pays under a cap" native. The defensible sliver is the *re-verifiable proof*, not the payment. The day a competitor ships a real proof, they've conceded their guard was never enough — but they can ship it.
- **Regulatory (Res BCB 561 / 519 / 520 / 521).** A take-rate on a **cross-border stablecoin** rail *from Brazil* is FX (câmbio) and needs a license. Selling the **verifier / dev tool / SaaS** sidesteps money-transmission classification; **taking bps on value-transfer does not.** This dictates where the settlement entity lives (domestic "dólar dentro do Pix" framing, or a non-BR rail entity). Lawyer is on the critical path before the rail takes a single bp.

## Sequence

1. **Ship distribution (days):** `npm publish @slippay/mcp` + GitHub front. Free. Get `slippay_verify` into toolchains now.
2. **Run the bridge (weeks):** package the attestation/audit SKU. Cash flow, not destination. Honestly capped.
3. **Apply to SCF (weeks):** Public Goods (MCP/verify) + Build (rail), milestone-gated, on the warm Rio channel.
4. **Build the rail (months):** the missing `slippay_pay` agent-settlement endpoint + bps metering on settled volume. Position as "proof-bounded settlement," never "the agent rail."
5. **Lawyer before bp #1:** resolve the Res-561 entity/structure question before charging take-rate on value transfer.

## Falsifiable gate — 2026-12-02 (6 months)

**Threshold:** ≥ some real, third-party agent-to-agent volume settled through the proof-bounded rail (not demo, not self-dealt) — propose **$10k cumulative settled GMV** as the line.

- **Hit it →** the rail option is live; lean in, raise/expand on the bps thesis.
- **Miss it ($0–trivial) →** the rail was an option that expired unexercised; SlipPay is a (good) audit/attestation service business, and the bps deck was a story. Either outcome is fine **if named in advance** — which it now is.

Sell the ceiling as a present and you're lying. Ignore the ceiling and stay in service-only and the option expires unexercised. The bridge funds the wait; the rail is the upside; the gate decides which one it actually was.
