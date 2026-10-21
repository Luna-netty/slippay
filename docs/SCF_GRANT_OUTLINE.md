# SlipPay — SCF Build Award outline

Target: SCF Build Award #44 · $150K XLM · deadline **2026-06-14**.
Positioning: **the integrity layer for agentic payments on Stellar** — agentic
payments with policy enforcement. Not another rail; a policy/verification layer
*above* x402, the rail Stellar already ships.

> Grounding rule for this doc: everything under "Already built" is verifiable today
> (on-ledger tx, published npm, passing tests). Everything under "8-week plan" is a
> commitment, not a claim. The testnet/mainnet seam is stated explicitly — the
> integrity gate is proven on testnet and not yet on a mainnet address, and we say so.

## Problem

Agents are starting to hold payment mandates. Every payment rail — x402 (now
first-party on Stellar: per-request HTTP payment via signed Soroban auth-entry,
SEP-41/USDC, Coinbase + OpenZeppelin facilitators), Stripe, the card networks —
settles a single question: **is this payment authorized?** None ask the second:
**is the agent requesting it compromised?**

A hijacked agent holds a perfectly valid mandate. An autonomous reasoning-model
attacker breaks frontier-model guardrails at a **97.14%** success rate over 25,200
trials (Nature Communications, 2026, s41467-026-69010-1). The mandate stays valid
even when the agent holding it doesn't. That gap — agent integrity at settlement —
is unowned, and it is where fraud/abuse loss in the agent economy will concentrate.

## Solution

A rail-agnostic standard + reference implementation: **Agent Integrity Attestation
(AIA)**. An agent commits a *surface* up front (allowed recipients, tools, amount
cap, velocity). An off-chain oracle runs integrity detection and signs an ed25519
verdict **only** while the agent stays in-surface — fail-closed. The settlement
venue verifies the signature before money moves:

- **On Stellar (Soroban):** the gate `autocharge_attested` verifies natively;
  settlement reverts if the attestation is absent / expired / forged / replayed.
- **On x402:** the facilitator recomputes `action_hash` from the `PaymentRequirements`
  it already holds and verifies the AIA signature before honoring the 402.
- **Any other chain / off-chain:** the same ed25519 verdict verifies via `verifyAction`.

One integrity verdict, every rail. The rail never trusts the oracle's word — it
verifies math; the oracle never holds funds; the agent cannot exceed its committed
surface even fully jailbroken, because its only path to settlement is a verdict it
cannot forge.

## Already built (verifiable today)

- **Recurring billing, live on Stellar mainnet.** Soroban subscription contract
  `CBJMQ6ZY…EVQN`; a real USDC charge settled — tx `5da9741f…`.
- **Autonomous debit (v0.2)** — SEP-41 allowance, no per-period buyer signature.
- **Attestation gate (v0.3)** — `autocharge_attested` + single-use binding; 13/13
  cargo tests; **proven on testnet**, mainnet redeploy pending.
- **Integrity oracle** — `@slippay/attester`: surface + velocity detection,
  fail-closed; Stellar + generic bindings; 15/15 tests. Oracle→Stellar e2e on testnet.
- **AIA-over-x402** — `@slippay/attester/x402`: `attestX402` / `verifyX402` bind the
  verdict to the x402 payment intent; 6/6 tests (binding holds, refuses off-surface
  recipient + over-cap).
- **MCP** — `@slippay/mcp@0.2.0` published; capability-gated agent surface.
- **AIA spec** (`SPEC.md`) — generic + Stellar + x402 bindings.
- **Adversarial audit harness** — 6/6 attacks held on-chain; emits a re-runnable report.

## 8-week plan (the grant deliverables)

| Wk | Milestone | Definition of done |
|----|-----------|--------------------|
| 1–2 | **Mainnet integrity gate** | v0.3 single-use gate redeployed to mainnet; a real attested charge settles + a forged one reverts, both on-ledger. |
| 2–3 | **x402 facilitator integration** | AIA verify wired into an x402 flow end-to-end (in-surface pays, off-surface refused) against a Stellar x402 facilitator. |
| 3–4 | **Public oracle + AIA standard** | `@slippay/attester` + SPEC published; hosted `/attest` `/verify` `/pubkey`; quickstart for adopting AIA on a rail. |
| 4–6 | **Detection depth v1** | beyond surface+velocity: prompt-injection markers + tool-output-poisoning signals as pluggable detectors, each with a reproducible test. (The moat — security depth a payments incumbent can't cheaply copy.) |
| 6–7 | **Merchant console** | charges, refusals, limits, audit trail; sandbox → testnet → mainnet promotion. |
| 7–8 | **Pilot + attestation artifact** | one design-partner agent live on mainnet; a signed integrity-attestation report (the document a compliance officer files). |

**Out of scope (deliberately).** A jurisdiction-by-jurisdiction *compliance engine*
is not an 8-week build and collides with live regulation (BCB 561, LGPD). Compliance
is the **outcome** the attestation serves — the artifact a compliance officer files —
not a module we ship. We sell the proof, not a regulatory engine.

## Metrics

- Mainnet: ≥1 attested charge settled + ≥1 forged charge reverted, on-ledger.
- x402: end-to-end attested payment through a facilitator; off-surface refused.
- Detection: ≥2 detector classes beyond surface/velocity, each with a repro test.
- Adoption: ≥1 external design partner; AIA verifier embedded by ≥1 third party.
- Public: oracle + spec live; MCP install count.

## Why Stellar

x402 first-party + SEP-41/USDC + native `ed25519_verify` in Soroban makes Stellar the
one chain where the integrity verdict is enforced **at settlement, on-chain**, not
just checked off-chain. SlipPay proves the rail works (mainnet, today) and makes it
safe for production agent use — riding the network's own rail rather than competing.

## One-line pitch

"A policy-enforcement layer for agentic payments on Stellar that settles only while
the agent, its mandate, and the context stay in policy — USDC, Soroban, x402, with a
public on-chain audit trail."
