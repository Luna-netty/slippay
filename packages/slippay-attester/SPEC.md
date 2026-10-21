# Agent Integrity Attestation (AIA) — v0 spec

A small, open, **rail-agnostic** standard. Every agent-payment rail today (x402 on
Base, pay.sh on Solana, Orthogonal, the Stellar gate) answers the same question:
*is this payment authorized?* AIA answers the one none of them do: **is the agent
requesting it compromised?** — and encodes the verdict as a portable signature any
rail can enforce. Settle on more than authorization. Settle on integrity.

## Roles

- **Agent** — the autonomous payer. Commits a *surface* up front (what it may do).
- **Attester (oracle)** — holds the commitment, runs detection, and signs an
  attestation iff the requested action stays inside the surface. Fail-closed.
- **Rail** — the settlement venue (an L1/L2 contract, a 402 facilitator, an SDK).
  Enforces the attestation by verifying the signature before letting funds move.

The rail never trusts the attester's word — it verifies math. The attester never
holds funds. The agent cannot exceed what it committed, even fully jailbroken,
because its only path to settlement is an attestation it cannot forge.

## The attestation

ed25519 over a fixed message. Two bindings; same key, same curve, same trust model.

**Generic binding (any rail).** The rail builds a canonical action descriptor,
hashes it, and the attester signs:

```
message = action_hash (32) ‖ not_after (u64 BE, 8) ‖ nonce (u64 BE, 8)        # 48 bytes
action_hash = sha256(canonical_json(descriptor))   # keys sorted; descriptor is rail-defined
```

A Base/x402 or Solana/pay.sh flow computes the same `action_hash` from its own
payment intent, then `verify(action_hash, not_after, nonce, signature, attester_pubkey)`.

**Stellar binding (Soroban gate).** The Soroban contract already enforces the
subscription's recipient + amount, so the descriptor collapses to identity + the
single-use counter:

```
message = subscription_id (32) ‖ charges_done (u32 BE, 4) ‖ not_after (u64 BE, 8)   # 44 bytes
```

The on-chain gate `autocharge_attested` reconstructs this and calls
`ed25519_verify` natively — settlement reverts if absent/expired/forged.

**x402 binding (Stellar's first-party rail).** x402 is now first-party on Stellar:
per-request HTTP payment via a signed Soroban auth-entry, SEP-41/USDC, Coinbase +
OpenZeppelin facilitators on testnet and mainnet. x402 settles *authorization*. AIA
adds *integrity* over the **same** payment intent, as a plain instance of the generic
binding — the `descriptor` is the economically-binding subset of the x402 v2
`PaymentRequirements`:

```
descriptor = { asset, maxAmountRequired, network, payTo, resource, scheme }   # keys sorted
action_hash = sha256(canonical_json(descriptor))
message     = action_hash (32) ‖ not_after (8) ‖ nonce (8)                     # 48 bytes
```

The facilitator already holds the `PaymentRequirements`; before honoring the 402 it
recomputes `action_hash` and calls `verifyX402(...)`. No integrity signature, no
settlement. Tamper `payTo` or `maxAmountRequired` and the recomputed hash no longer
matches — the verdict is bound to *this* payment. Reference impl + tests:
`@slippay/attester/x402` (`attestX402` / `verifyX402`).

## Properties

- **Single-use.** Binding to a monotonic counter (`charges_done`) or a per-action
  `nonce` consumes the attestation; it can't authorize a different action.
- **Fresh.** `not_after` bounds validity in real time. Stale = rejected.
- **Bound.** The signed message ties the verdict to *this* action (recipient,
  amount, index) — no cross-action / cross-sub replay.
- **Portable.** Same ed25519 verdict verifies on-chain (Stellar) and off-chain
  (any rail) — one integrity layer over every chain.

## Detection (what makes the attestation *true*)

The signature is the easy half; the value is the verdict behind it. The attester
signs only after detection passes. v0 detectors, composable, fail-closed:

1. **Surface deviation** — recipient ∉ committed set, amount > committed cap, or a
   tool-call outside the committed surface → refuse.
2. **Velocity** — charges per window above the committed rate → refuse (runaway /
   compromised agents betray themselves by rate).

Roadmap (the moat — security depth a payments incumbent can't cheaply copy):
prompt-injection markers, tool-output-poisoning signals, behavioral drift,
counterparty reputation. Each plugs in as another detector; the gate stays the same.

## Endpoints (reference attester, `@slippay/attester`)

```
GET  /pubkey                                  → attester ed25519 pubkey (register on any rail)
POST /register {agent_id, allowed_recipients, allowed_tools?, max_amount, max_per_window?}
POST /attest   {agent_id, subscription_id, charges_done, recipient, amount, tools_used?}   → Stellar binding
POST /attest   {agent_id, descriptor, recipient, amount, tools_used?}                       → generic binding
POST /verify   {…, signature, pubkey}          → { valid }
```

## Adopting AIA on a new rail

1. Pick the action descriptor your rail signs over; compute `action_hash`.
2. Have the agent register its surface with an attester; get the attester pubkey.
3. Before settlement, require a fresh AIA signature; `verify` it (embed the ~30-line
   verifier, or call `/verify`). No signature, no settlement. That's the whole gate.
