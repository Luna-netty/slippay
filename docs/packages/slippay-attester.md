# @slippay/attester

`@slippay/attester@0.1.0` (npm, MIT). A rail-agnostic Agent Integrity Attestation
(AIA) oracle. It answers one question and signs the verdict so a settlement venue can
enforce it.

## What it attests

Payment rails (x402, card rails, the Stellar gate) settle on *is this payment
authorized?* The attester answers a different question: *is the agent requesting it
compromised?* It signs an ed25519 attestation only when the agent's requested action
stays inside a surface the agent committed up front.

The signature is the easy half. The value is the verdict behind it: the oracle signs
only after detection passes.

## v0 detection

Detection is composable and fail-closed. The current detectors:

1. **Surface deviation** — the agent commits an allowed surface (recipients, optional
   tool set, amount cap). A charge is refused if the recipient is not in the
   committed set, the amount exceeds the committed cap, or a tool outside the
   committed set was used.
2. **Velocity** — charges per window above the committed rate are refused. A runaway
   or compromised agent tends to betray itself by rate. Velocity is off when
   `max_per_window` is 0.

Deeper detectors (prompt-injection markers, tool-output-poisoning signals,
behavioral drift, counterparty reputation) are roadmap. Each plugs in as another
detector; the signing gate stays the same.

## Fail-closed

`attest` runs the integrity check first. If any detector fires, it returns
`{ ok: false, reason }` and signs nothing. A signature is produced only when the
action is inside the committed surface. Over HTTP, a refusal returns status `403`.

## The three bindings

All three use the same key, curve, and trust model. They differ only in the message
that gets signed.

### Stellar binding (44 bytes)

The Soroban subscription contract already enforces recipient and amount, so the
signed message collapses to identity plus the single-use counter:

```
message = subscription_id (32) || charges_done (u32 BE, 4) || not_after (u64 BE, 8)   # 44 bytes
```

The on-chain gate `autocharge_attested` reconstructs this message and calls
`ed25519_verify` natively. Settlement reverts if the attestation is absent, expired,
or forged.

### Generic binding (48 bytes)

For any other rail. The rail builds a canonical action descriptor, hashes it, and the
oracle signs:

```
action_hash = sha256(canonical_json(descriptor))                 # keys sorted
message     = action_hash (32) || not_after (u64 BE, 8) || nonce (u64 BE, 8)   # 48 bytes
```

The rail recomputes `action_hash` from its own payment intent and verifies the
signature. The `nonce` makes the attestation single-use.

### x402 binding

x402 settles authorization; AIA adds integrity over the same payment intent, as a
plain instance of the generic binding. The descriptor is the economically-binding
subset of an x402 v2 `PaymentRequirements`:

```
descriptor = { asset, maxAmountRequired, network, payTo, resource, scheme }   # keys sorted
action_hash = sha256(canonical_json(descriptor))
message     = action_hash (32) || not_after (8) || nonce (8)                   # 48 bytes
```

A facilitator already holds the `PaymentRequirements`. Before honoring the 402 it
recomputes `action_hash` and calls `verifyX402(...)`. Tamper `payTo` or
`maxAmountRequired` and the recomputed hash no longer matches: the verdict is bound
to that exact payment. The reference implementation is exported at
`@slippay/attester/x402` (`x402Descriptor`, `x402ActionHash`, `attestX402`,
`verifyX402`).

## Attestation properties

- **Single-use.** Binding to the monotonic `charges_done` counter (Stellar) or a
  per-action `nonce` (generic) consumes the attestation.
- **Fresh.** `not_after` bounds validity in real time (default `now + 300s`). Stale is
  rejected.
- **Bound.** The signed message ties the verdict to this action; no cross-action or
  cross-subscription replay.
- **Portable.** The same ed25519 verdict verifies on-chain (Stellar) and off-chain
  (any rail).

## HTTP flow

The reference attester is a zero-dependency Node `http` server. Run it with
`npm start` (default port `8790`). The signing key is `SLIPPAY_ATTESTER_SECRET`
(64-hex / 32 bytes); if unset, a demo key is derived from a fixed seed (development
only, never in production).

```
GET  /pubkey                                  -> { pubkey }   (register on any rail)
POST /register {agent_id, allowed_recipients, allowed_tools?, max_amount, max_per_window?}
                                              -> { commitment }   (SHA-256 of the committed surface)
POST /attest   {agent_id, subscription_id, charges_done, recipient, amount, tools_used?}
                                              -> { ok, not_after, signature }   (Stellar binding)
POST /verify   {subscription_id, charges_done, not_after, signature, pubkey}
                                              -> { valid }
```

`POST /attest` returns `200` with the signature when the action is in-surface, and
`403` with a reason when the agent is refused (fail-closed). The library functions
behind these endpoints are `commitSurface`, `attest` / `attestAction` / `attestX402`,
and `verifyAttestation` / `verifyAction` / `verifyX402`.

The committed surfaces are file-backed (`SLIPPAY_ATTESTER_DATA`, default
`~/.slippay/surfaces.json`) so they survive a restart.

## Byte-parity with the on-chain gate

The `attestationMessage` builder in `oracle.mjs` produces the 44-byte Stellar message
byte-for-byte identical to what the on-chain `autocharge_attested` gate reconstructs
and verifies. This is what lets one attestation be valid both on-chain (Stellar
`ed25519_verify`) and off-chain (`verifyAttestation`). The parity is verified against
the contract's reconstruction.

## Adopting AIA on a new rail

1. Pick the action descriptor your rail signs over; compute `action_hash`.
2. Have the agent register its surface with an attester; get the attester pubkey.
3. Before settlement, require a fresh AIA signature and verify it (embed the verifier
   or call `/verify`). No signature, no settlement.

## Status and limitations

- v0 detection is surface deviation plus velocity only. The deeper detectors are not
  implemented yet.
- The Stellar on-chain enforcement path (`autocharge_attested`) is proven on testnet
  only; mainnet runs the subscription contract without the gate. The attester itself
  is rail-agnostic and runs the same regardless, but on Stellar the on-chain half of
  the loop is testnet-only today.
- The demo signing key is for development. Set a real `SLIPPAY_ATTESTER_SECRET` in any
  non-test deployment.
