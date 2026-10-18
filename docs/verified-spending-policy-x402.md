# Verified Spending Policy
### The proven budget layer for x402 agents

**One line.** x402 caps what an agent pays *per request*; it does not bound what
an agent spends *in total*. We add the cumulative budget — and a machine-checked
proof it cannot be exceeded over any sequence of an agent's actions.

---

## The gap x402 leaves open

x402 standardizes the per-request payment: a `402 Payment Required` carries
`maxAmountRequired`, `payTo`, `asset`, `network`, `nonce`, `expiresAt`; the agent
returns a signed authorization where the amount is `≤ maxAmountRequired`
(x402 whitepaper, Coinbase, §9). That bound is **per request only**. There is no
field, and no protocol guarantee, for an agent's spend *across* requests.

An autonomous agent making N x402 calls therefore has **no protocol-level bound
on its cumulative spend.** In the language of our prover, x402 out of the box is
the *per-tx-only* policy — which is **unbounded**, and which our prover refuses
to certify. The friction x402 removes (no approvals, no human in the loop) is
exactly what makes the missing budget layer load-bearing.

## What we add — and prove

The agent's spend is governed by a sliding-window budget on Soroban (per-tx cap,
aggregate `window_cap`, recipient allowlist), audited and deployed on **Stellar
mainnet**. On top of enforcement, we ship the artifact no one else does — a
**machine-checked proof** of the worst case:

- `window outflow ≤ 2 · window_cap` over **every** action sequence — an inductive
  invariant verified by Z3, not a test or a sample.
- the bound is **tight** (the constant 2 is the smallest sound one).
- a policy with no aggregate cap (i.e. raw x402) is proven **unbounded** and is
  **refused** — fail-closed. You cannot ship a spend policy without a proof of its
  bound.

`maxAmountRequired` ↔ our per-tx cap (x402 has this). The proven aggregate budget
↔ our `window_cap` (x402 has no equivalent). We are **not** competing with x402;
we are the budget governance layer x402 explicitly leaves to the wallet.

## Why this is a wedge (as of 2026-05-31)

A survey of the agentic-payments field — Coinbase/World AgentKit, Skyfire, Catena
ACK-Lab, MPP, Crossmint, Circle, Payman, Stripe, Google AP2, Visa Intelligent
Commerce, OpenZeppelin's x402 smart accounts — finds **configurable caps, policy
engines, signed mandates, and on-chain-enforced rules everywhere, and a published
machine-checked spend bound nowhere.**

The distinction the field elides: **on-chain enforced ≠ formally verified.** A
contract can deterministically reject an over-limit transfer while its limit
accounting carries an unproven logic bug. The closest anyone comes is
OpenZeppelin + Certora on Stellar — but no published Certora proof of an agentic
spend-limit invariant exists today. Even Chainlink CCIP — the most mature
spend-governance in crypto, with per-lane rate limits and a Risk Management
Network — ships those limits **configurable, not formally verified.**

## What we do NOT claim (the scope, stated first)

- The proved object is the epoch-state invariant; the real-time-window bound
  follows by a stated geometric lemma (a `W`-window touches ≤ 2 adjacent epochs),
  not yet mechanized.
- The proof is over mathematical integers; under `i128` saturation at extreme
  caps the throughput *shaping* can relax, but the hard ceiling still holds the
  `2·window_cap` envelope — the safety bound is intact.
- It covers the **decidable** sliding-window budget family. Non-linear or
  unbounded-state policies are refused, not faked.
- This is **not** a general formal-verification platform (Certora's lane). It is
  one applied primitive: a proof-carrying spending policy for agent payments.
- **Cross-chain is out of scope today:** CCIP does not support Stellar, so a
  cross-chain version of this is premature — Stellar-native is the claim.

## Where it fits

Above x402 / MPP, Stellar-native, on the rail Slippay already runs. The proof is
the headline; the agent wallet and the compiler that emits these proofs are the
supporting infrastructure.

*Artifacts (runnable, < 1s): `agents/axl/proofs/budget_invariant.py`,
`spending_policy_prover.py`. Independently adversarially verified: every issued
certificate sound, refusals correct.*

---
*Draft — for internal review before any external use.*
