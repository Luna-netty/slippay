# Proof-bounded settlement

This is the product thesis stated in engineering terms. It is architectural, not
a business or pricing argument. The thesis: an agent's settlement should be
bounded by three independent layers, each of which fails closed, and at least one
of which is checkable offline after the fact.

The three layers are:

1. an on-chain allowance and policy ceiling,
2. a fail-closed integrity attestation,
3. an offline-checkable proof of the spending bound.

Each layer is independent: it holds even if the layers above it are absent or
compromised. The layers are not equally mature. Some are live on mainnet, some
are testnet only, and one is build-only. That seam is stated per layer below and
is load-bearing; do not read the thesis as if all three were live.

## Layer 1 — on-chain allowance and policy ceiling

The first bound is the one with the strongest guarantee, because it lives on
Stellar and does not depend on any SlipPay process.

For the v0.2 autocharge model, the buyer grants a standing SEP-41 allowance once
(`token.approve(buyer, contract, cap, expiry)`). Every recurring debit then runs
`transfer_from(spender=contract, buyer -> merchant)`. Two ceilings constrain it:

- contract side: `status`, `period`, `max_periods`, `expires_at`.
- SAC side: the allowance cap and the allowance expiry ledger. When the allowance
  is exhausted or expired, `transfer_from` fails on-chain and the buyer must
  re-approve.

The allowance is a hard on-chain ceiling, not a backend policy. No SlipPay
process can raise it, and a compromised relayer cannot exceed it.

For the smart-wallet agent session model, the bound is an `AgentSession` with
`per_tx_cap`, a sliding-window aggregate `window_cap`, a non-empty recipient
allowlist, expiry, and revoke. The proven worst-case real-time-window bound is
`2x window_cap`, which is the exact property AXL proves (layer 3).

Status: the v0.2 allowance ceiling is live on mainnet. The smart-wallet agent
session model is testnet only.

## Layer 2 — fail-closed integrity attestation

The allowance bounds how much can move. It does not answer whether the agent is
behaving as committed. The second layer adds that check, and it fails closed:
no attestation, no settlement.

`@slippay/attester` is an integrity oracle. It answers "is the agent
compromised?", not "is the payment authorized?". An agent first commits its
surface (allowed recipients, caps, tool set). On each action the attester signs
an ed25519 verdict only if the action stays inside that surface; detection is
surface deviation (recipient not in the committed set, amount over cap,
off-surface tool) plus velocity. If the action is off-surface, `/attest` returns
HTTP 403 and no signature is produced.

The on-chain gate then re-checks the same fact. The v0.3
`autocharge_attested(id, not_after, signature)` entrypoint verifies a 44-byte
message, `id(32) || charges_done(u32 BE) || not_after(u64 BE)`, with
`env.crypto().ed25519_verify`. The bindings are deliberate: `id` blocks
cross-subscription replay, `charges_done` makes each attestation single-use, and
`not_after` enforces freshness. The off-chain attester and the on-chain gate sign
and verify byte-for-byte the same message, so the off-chain refusal and the
on-chain check cannot drift apart. `ed25519_verify` traps and reverts on a bad
signature, so the gate is fail-closed.

Status: the attester package exists and is fail-closed. The on-chain v0.3 gate is
implemented with contract tests and proven on testnet only. Mainnet runs v0.2,
which has layer 1 but not this gate. This is the most important seam on the page:
on mainnet today, settlement is bounded by the allowance ceiling but not by an
on-chain attestation check.

## Layer 3 — offline-checkable proof of the spending bound

Layers 1 and 2 are enforcement at runtime. The third layer is verification of the
bound itself, after the fact, by anyone, without running the agent.

`axl-compiler` compiles an `agent { }` block to one inference contract. The
spending policy is written as `invariant -> sliding_window(ceiling = M) bound K`.
That invariant is lowered to SMT-LIB and discharged by a solver (a `z3` binary,
or the `z3-solver` Python package, refusing if neither exists, because the
absence of a checker is not a pass). A sound discharge means the base case holds
and the inductive step is unsatisfiable; the result is a proof-carrying
certificate that binds the spec hash, the family, the ceiling, the proved bound
`K`, and the verdict.

`axlc verify-cert` re-hashes the spec, re-discharges the obligations, and asserts
byte-equality with the certificate (exit 0 valid, 2 mismatch). The web
`/verify` surface re-hashes the spec and regenerates the SMT-LIB obligations
client-side, though no solver runs in-browser yet.

Status: build/test-only. There is no on-chain artifact, the certificate is not a
required CI gate, and there is zero downstream adoption today. The smart-wallet
does not depend on the compiler and never interprets the certificate; the
`ssl_hash` pin is provenance only. The conformance multiplier (`2x window_cap`)
is currently a hard-coded literal in a test rather than read from a certificate.
So layer 3 is a real, runnable proof of the spending bound, but it is not yet
wired into either enforcement or CI.

## How the layers compose

```
  agent commits surface
        |
        v
  @slippay/attester signs ed25519 verdict (off-chain, fail-closed)   [L2]
        |
        v
  autocharge_attested verifies the same 44-byte message on-chain     [L2]
  with ed25519_verify (fail-closed)                                  (testnet)
        |
        v
  transfer_from settles, bounded by the buyer's SEP-41 allowance     [L1]
  and the contract policy ceilings                                   (mainnet)
        |
        v
  a relayer (fee-payer only) submits; cannot exceed any ceiling

  orthogonal:
  axl-compiler proves the spending bound is a theorem and emits a    [L3]
  proof-carrying cert; axlc verify-cert re-checks it offline         (build-only)
```

## What this thesis does and does not claim

It claims: on-chain ceilings bound the amount (live, mainnet), a fail-closed
attestation can bound the behavior (testnet), and the bound itself can be proven
and re-checked offline (build-only). Stated honestly, only the first layer is
live on mainnet end to end today.

It does not claim: that the proof is a moat, that any of these layers is audited
by a third party (the newer contracts are not), or that there is adoption or
usage. None of those are architectural facts and none are asserted here.
