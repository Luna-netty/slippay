# Verified Spending Policy — proof-carrying guardrails for the agent economy

**One line:** every x402 / MPP agent wallet on Stellar today *caps* spend; this is
the first that ships a **machine-checked proof the cap cannot be exceeded over any
action sequence** — and that *refuses* to certify a policy whose spend is unbounded.

## Why this, why Stellar, why now

[x402 went live on Stellar mainnet in March 2026](https://stellar.org/blog/foundation-news/x402-on-stellar);
MPP is live with 100+ integrated services (Stripe, Anthropic, OpenAI, Shopify, Visa).
SDF's own framing of the opportunity:

> "Soroban enables programmable payment policies — spending limits, approval rules,
> compliance controls. For enterprises deploying agents with budgets, this is how you
> set guardrails without removing autonomy."

The guardrail exists everywhere. The **proof that the guardrail holds** exists nowhere.
That gap is the wedge — and it is narrow on purpose: this is **not** a general
formal-verification platform (SDF already funds [Certora](https://stellar.org/press/a-milestone-in-smart-contract-security-certora-teams-up-with-the-stellar-network-s-smart-contract-platform-soroban)
and the [Soroban Audit Bank](https://stellar.org/grants-and-funding/soroban-audit-bank)).
It is one applied primitive: a *verified spending policy* for agent payments.

## What is actually proven

The deployed agent wallet (`contracts/smart-wallet`, Soroban, audited, mainnet) enforces a
sliding-window budget: a per-tx cap, an aggregate `window_cap`, a recipient allowlist.
The prover certifies the **worst-case real-time-window outflow** of that policy.

| policy | certificate |
|---|---|
| deployed (sliding window, ceiling `2·window_cap`) | **`outflow ≤ 2·window_cap`**, tight, inductive over all sequences |
| strict variant (ceiling `1·window_cap`) | `outflow ≤ 1·window_cap`, tight |
| loose ceiling (`3·window_cap`) | `outflow ≤ 2·window_cap` (weighted check binds tighter than the ceiling) |
| naive per-tx-only (no aggregate cap) | **REFUSED — unbounded.** fail-closed |

The bound is not a test or a sample — it is an **inductive invariant** machine-checked by
Z3: assuming the invariant holds before a charge, every accepted charge preserves it
(UNSAT to break); from the install state `(0,0)` it therefore holds for **every** action
sequence. Run it:

```
python3 agents/axl/proofs/budget_invariant.py          # the core 2×cap proof + tightness
python3 agents/axl/proofs/spending_policy_prover.py    # certificates across the policy family
```

Both run in under a second on `z3-solver`.

## Honest scope (verified by independent adversarial review)

A separate reviewer attacked the prover for a false certificate and found none; concrete
simulation puts the real worst case near `1.5·window_cap`, under the certified `2·`. The
limits, stated plainly so SDF reads them from us first:

- **Overlap lemma.** The proved object is the epoch-state invariant `prev+cur ≤ K·window_cap`.
  The real-time-window claim follows because a `W`-length window touches at most two adjacent
  epochs (rolls fire only at `elapsed ≥ W`). This geometric premise is **true but stated, not
  machine-checked here.** Mechanizing it is the next hardening step.
- **Integer model.** The proof is over mathematical integers; the contract uses saturating
  `i128`. At astronomically large caps the weighted product can saturate and relax *throughput
  shaping* — but the unweighted hard ceiling (`saturating_add`, fail-closed, reject if
  `> 2·window_cap`) still enforces the `2·window_cap` real-time envelope. The **safety bound is
  not invalidated**; only the shaping degrades.
- **Decidable subset.** This covers the linear-integer sliding-window budget family. Non-linear
  or unbounded-state policies are outside Z3's decidable reach — the prover **REFUSES** them; it
  does not pretend.

## What this is not

Not a pivot (Slippay already integrates x402). Not "FV better than Certora" — it is a single
proof-carrying payment primitive. Not a language pitch — the Axl compiler that will emit these
proofs as a first-class `invariant` directive is supporting infrastructure, deliberately
under-claimed. The headline is the proof.
