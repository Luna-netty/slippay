# @slippay/mcp

`@slippay/mcp@0.2.0` (npm, MIT). A Model Context Protocol server that exposes the
SlipPay payment rail to an AI agent as a small set of tools: pay, set up a recurring
subscription, arm and use the integrity gate, and re-verify a spending-bound
certificate offline.

## Architecture: non-custodial, backend-free

The server runs locally next to the agent. There is no SlipPay backend in the path
for any on-chain operation.

- The agent holds its own wallet secret (`SLIPPAY_SIGNER_SECRET`). The secret never
  leaves the process; it is used only to sign transactions locally.
- Each spending tool builds a Soroban or Stellar transaction, signs it with that
  key, and submits it directly to a Soroban RPC endpoint.
- Settlement state is read directly from Horizon. SlipPay never holds funds and
  never has signing authority over the agent's wallet.

This is the same trust posture as the offline `slippay_verify` tool: nothing is sent
to a SlipPay-operated service.

## Install

The server runs over stdio. Configure it in any MCP client (for example Claude
Desktop) under `mcpServers`:

```jsonc
{
  "mcpServers": {
    "slippay": {
      "command": "npx",
      "args": ["-y", "@slippay/mcp"],
      "env": {
        "SLIPPAY_SIGNER_SECRET": "S...",          // agent wallet secret (required to sign)
        "SLIPPAY_CONTRACT": "C...",               // subscription contract id
        "SLIPPAY_NETWORK": "testnet"              // testnet | public
      }
    }
  }
}
```

`slippay_verify` needs no key and no network. It works the moment the server loads.

## Environment variables

| var | default | used by |
|---|---|---|
| `SLIPPAY_SIGNER_SECRET` | — (required to sign) | every tool that signs a tx |
| `SLIPPAY_CONTRACT` | — | subscribe / approve / autocharge / charge_attested / arm_gate |
| `SLIPPAY_NETWORK` | `testnet` | all chain ops (`testnet` or `public`) |
| `SLIPPAY_ROLE` | `agent` | tool surface selection (`agent` or `principal`) |
| `SLIPPAY_RPC_URL` | network default | Soroban RPC override |
| `SLIPPAY_HORIZON_URL` | network default | Horizon override |
| `SLIPPAY_USDC_ISSUER` | network default | USDC issuer override |

Network defaults: on `public`, RPC `https://mainnet.sorobanrpc.com`, Horizon
`https://horizon.stellar.org`, USDC issuer
`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (Circle). On `testnet`,
RPC `https://soroban-testnet.stellar.org`, Horizon `https://horizon-testnet.stellar.org`,
USDC issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.

## Role membrane

The exposed tool surface depends on `SLIPPAY_ROLE` (default `agent`). The default
agent role gets a deliberately minimal surface; the `principal` role adds the
trust-establishing verbs.

| tool | agent | principal | what it does |
|---|---|---|---|
| `slippay_verify` | yes | yes | Re-verify a proof-carrying spending-bound certificate offline. No key, no network. |
| `slippay_whoami` | yes | yes | Return the wallet address derived from `SLIPPAY_SIGNER_SECRET`, network, and configured contract. No transaction. |
| `slippay_charge_attested` | yes | yes | Autonomous charge that settles only with a fresh, single-use ed25519 integrity attestation, verified on-chain. |
| `slippay_status` | yes | yes | Look up a transaction hash on Horizon and return settlement status and explorer link. |
| `slippay_pay` | no | yes | Raw SEP-41/SAC asset transfer (default USDC) from the wallet to a recipient. Ungated. |
| `slippay_subscribe` | no | yes | Create an on-chain recurring subscription (agent is the payer). Returns the 32-byte hex subscription id. |
| `slippay_approve` | no | yes | Approve the subscription contract as a SEP-41 spender up to a capped, expiring allowance. The one signature that arms autonomous debit. |
| `slippay_autocharge` | no | yes | Trigger an autonomous charge using the standing allowance, with no integrity attestation. Submittable by any relayer. |
| `slippay_arm_gate` | no | yes | Bind an ed25519 attester public key to a subscription (`set_attester`). |

### Membrane rationale

More tools mean more injection paths. The agent role gets only what it needs to
operate inside an already-established trust relationship: prove a bound, read its own
address, check settlement, and spend through the gate. It gets no raw `slippay_pay`
(an ungated escape hatch) and no privileged setup verbs.

The consequence: a compromised agent cannot get a fresh integrity attestation, so
`slippay_charge_attested` will not settle for it. It also has no path to a raw
payment and no way to change the trust setup. The privileged verbs that establish or
widen trust (`slippay_subscribe`, `slippay_approve`, `slippay_arm_gate`, plus raw
`slippay_pay` and the ungated `slippay_autocharge`) are gated behind
`SLIPPAY_ROLE=principal`.

Note that the membrane is a surface restriction enforced by the MCP server process.
The hard, on-chain guarantee is separate: `slippay_charge_attested` settles only if
the contract's `ed25519_verify` check passes (see the integrity-gate seam below).

## Tool reference

### `slippay_verify(certificate, spec)`

Re-verify, locally and offline, that a spending bound is real. Pass the proof
certificate (JSON) and the agent spec it covers. Returns the
spec-to-certificate SHA-256 binding (tamper-evidence: change a byte and it goes red),
structural coherence checks, and the exact SMT-LIB proof obligations the compiler
discharged. Nothing is sent anywhere.

### `slippay_whoami()`

Returns the Stellar public key derived from `SLIPPAY_SIGNER_SECRET`, the active
network, the RPC URL, and the configured contract. No transaction.

### `slippay_charge_attested(subscription_id, not_after, signature)`

Calls `autocharge_attested` on the subscription contract. Settles only when a fresh,
single-use ed25519 attestation is presented (a 64-byte / 128-hex signature from the
attester bound via `slippay_arm_gate`, over `subscription_id || charges_done ||
not_after`), verified on-chain. Missing, expired, forged, or replayed: the contract
reverts (fail-closed). The attestation comes from a separate integrity attester (see
`@slippay/attester`); the agent does not produce it itself.

### `slippay_status(hash)`

Reads a transaction hash from Horizon. Returns whether it settled, the ledger, the
creation time, and the explorer link.

### `slippay_pay(recipient, amount, asset?)` — principal only

Sends a SEP-41/SAC asset transfer (default USDC) from the wallet to a recipient.
Signed locally, submitted to the RPC. Ungated.

### `slippay_subscribe(merchant, amount, period_seconds, max_periods?, expires_at?)` — principal only

Creates a subscription where the agent is the payer. `period_seconds` must be at
least 86400 (the contract minimum in production). Returns the 32-byte hex
`subscription_id` used by `approve`, `autocharge`, and the gate.

### `slippay_approve(amount, expiration_ledger)` — principal only

Approves the subscription contract as a SEP-41 spender up to a capped, expiring
allowance. After this, charges run within the cap without a per-cycle signature. The
allowance is a hard on-chain ceiling: when the cap is exhausted or the
`expiration_ledger` passes, `transfer_from` fails and the payer must re-approve.

### `slippay_autocharge(subscription_id)` — principal only

Executes the next charge using the standing allowance, with no buyer signature and
no integrity attestation. The contract enforces period/max/expiry; the allowance
enforces the cap. Submittable by any relayer.

### `slippay_arm_gate(subscription_id, attester_pubkey)` — principal only

Binds a 32-byte (64-hex) ed25519 attester public key to the subscription
(`set_attester`). Once armed, `slippay_charge_attested` is the path that settles, and
only with that attester's fresh signature.

## Agent quickstart

A minimal agent flow uses two tools. The trust setup (subscribe, approve, arm the
gate) is done once by a principal beforehand.

1. **Verify a counterparty offline.** Before acting on another agent's claimed
   spending bound, call `slippay_verify(certificate, spec)`. Check that `verified`
   is true and that the spec-to-certificate SHA-256 binding matches. This requires no
   key and no network.

2. **Charge through the gate.** Obtain a fresh attestation from the integrity
   attester for the current charge (it returns `not_after` and a `signature`), then
   call `slippay_charge_attested(subscription_id, not_after, signature)`. If the
   attester refused (the agent drifted outside its committed surface), there is no
   signature and the charge cannot settle.

## Status and limitations

- The on-chain integrity gate (`autocharge_attested` / `ed25519_verify`) is proven
  on **testnet only**. Stellar mainnet currently runs the subscription contract
  version **without** the gate (allowance-only `autocharge`). Setting
  `SLIPPAY_NETWORK=public` and calling `slippay_charge_attested` will not find the
  gate on the mainnet contract.
- The role membrane is enforced by this server process. It restricts which tools the
  agent sees; it is not a chain-level guarantee. The chain-level guarantee for
  attested charges is the contract's signature check.
- The new contracts have no third-party audit.
