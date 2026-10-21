# Agent Integrity Attestation

Autonomous agent payments raise two distinct questions. SlipPay separates them on
purpose, because they have different answers, different enforcement points, and
different failure modes.

## Two questions

### 1. Is the payment authorized?

This is the question every payment rail already answers. On Stellar it is answered
on-chain: the subscription contract holds the recipient, the amount, the period, and
the expiry; settlement pulls funds only within the buyer's standing SEP-41 allowance,
which is a hard ceiling that expires. The buyer authorized a specific debit envelope,
and the contract (via `require_auth` on setup and the allowance on every pull) refuses
anything outside it.

Authorization is necessary. It is not sufficient. A correctly authorized debit is
still a problem if the agent requesting it has been compromised, jailbroken, or
manipulated into spending inside its envelope toward the wrong end.

### 2. Is the agent compromised?

This is the question authorization does not cover, and it is what Agent Integrity
Attestation (AIA) adds. An agent commits a *surface* up front: the recipients it may
pay, the tools it may use, the cap it may spend, the rate at which it may charge. An
attester (an oracle, separate from the agent) holds that commitment, checks each
requested action against it, and signs a verdict only when the action stays inside the
surface. If the agent drifts (a new recipient, an over-cap amount, an off-surface
tool, an abnormal rate), the attester refuses and signs nothing. This is fail-closed:
no signature, no settlement.

The agent cannot forge its own clean bill of health. Even fully jailbroken, its only
path to settlement is an attestation it cannot produce itself, because the signing key
belongs to the attester, not the agent.

## How the answer is enforced

The two questions converge at the same on-chain enforcement point on Stellar. The
attester's verdict is an ed25519 signature over a fixed 44-byte message:

```
subscription_id (32) || charges_done (u32 BE, 4) || not_after (u64 BE, 8)
```

The on-chain gate `autocharge_attested` reconstructs that exact message and runs
`env.crypto().ed25519_verify`. The verify call traps and reverts if the signature is
missing, expired, forged, or replayed. So:

- *Is the payment authorized?* is enforced by the allowance and the contract's own
  amount/recipient/period checks.
- *Is the agent compromised?* is enforced by the **same** contract, in the same
  transaction, via the `ed25519_verify` gate over the attester's verdict.

The three message bindings (Stellar 44-byte, generic 48-byte, x402 over
`PaymentRequirements`) let the same verdict travel to other rails, but on Stellar the
integrity check lives in the contract, not in a trusted off-chain service. The rail
verifies math, not the attester's word.

## How the layers compose

```
agent commits a surface
  -> attester signs an ed25519 verdict off-chain, fail-closed
    -> the on-chain gate verifies the same 44-byte message with ed25519_verify, fail-closed
      -> settlement pulls funds via the buyer's one standing SEP-41 allowance
        -> a relayer (fee-payer only) submits the charge
```

The membrane in `@slippay/mcp` is a fourth, orthogonal restriction: it limits which
verbs the agent process can even call. It reduces the attack surface but is not the
hard guarantee. The hard guarantee is the on-chain `ed25519_verify`.

## Status: testnet-only today

This is the seam that matters and it must be stated plainly. The on-chain integrity
gate (`autocharge_attested` with `ed25519_verify`) is implemented and proven on
**Stellar testnet only**, via end-to-end scripts and contract tests. Stellar mainnet
currently runs the subscription contract version **without** the gate: mainnet charges
are authorized by the allowance, but there is no on-chain integrity verdict enforced
yet.

So today, on mainnet, only question 1 (authorization) is enforced on-chain. Question 2
(integrity) is enforced on-chain only on testnet. The attester library and its HTTP
service run identically regardless of network; what is testnet-only is the on-chain
half of the loop on Stellar.

## Further reading

- `docs/packages/slippay-attester.md` — the oracle, the three bindings, the HTTP flow.
- `docs/packages/slippay-mcp.md` — the agent-facing tools, including
  `slippay_charge_attested` and `slippay_arm_gate`.
