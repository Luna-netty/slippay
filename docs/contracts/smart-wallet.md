# smart-wallet contract

Source: `contracts/smart-wallet/src/lib.rs`.

## Purpose

A Soroban custom account (CAP-46-11 `__check_auth`) that lets a user authorize
payments with a WebAuthn/passkey credential instead of a raw Stellar secret key,
and lets the user delegate bounded spend to a merchant (pull) or an autonomous
agent (push) without re-signing each transaction. Non-custodial: the contract is
the user's own account; SlipPay never holds the keys and never has signing
authority over the funds.

## Network, address, deploy date

- **Testnet only, v0.1. Not on mainnet.**
- Template: `CAQZWVRPWW7UBCKPFECNGAZW7YDRVSRWP6FVA4V32Q74ZCNVIPOVK4OM`
  (wasm `01b35f…`, deployed 2026-05-31).
- One per-user instance is deployed from this template per wallet.

## Authorization models

`__check_auth` dispatches on the credential variant (`WalletAuth`):

### Passkey path (`WalletAuth::Passkey`)

Real on-chain WebAuthn over the P-256 curve:

- Binds to the transaction by requiring the base64url-nopad of the Soroban auth
  payload to appear inside `client_data_json` (replay defense).
- Reconstructs `SHA256(authenticator_data || SHA256(client_data_json))`.
- Runs `env.crypto().secp256r1_verify` (Protocol 21, the WebAuthn P-256 curve).

There is also a **pull-policy** sub-path: a per-merchant `Policy` authorizes a
matching transfer WITHOUT consuming a fresh passkey signature, as long as the
transfer stays inside the policy's caps.

### Agent path (`WalletAuth::Agent`)

An ed25519 session key for autonomous agent push payments:

- The user authorizes the session once (via passkey). The agent then signs
  transfer payloads with the session key, no fresh human signature per tx.
- An `AgentSession` carries: `per_tx_cap`, a sliding-window aggregate
  `window_cap`, a non-empty recipient allowlist, an `ssl_hash` provenance pin, a
  revoke flag, and an expiry.

## The 2x window_cap bound

The aggregate budget is enforced with an O(1) sliding-window counter (no per-tx
history): the spend of the current epoch (`cur_spent`) and the immediately
preceding epoch (`prev_spent`). A time-weighted estimate shapes throughput, but
the worst-case guarantee is NOT `<= window_cap`.

A "delayed straddle" (spend late in one epoch, roll, spend early in the next) can
place more than `window_cap` inside a single real `window_seconds`-length
interval, because such an interval overlaps at most two adjacent epochs. The
contract therefore enforces a hard un-weighted ceiling layered over the weighted
estimate:

```
prev_spent + cur_spent + amount <= 2 * window_cap
```

So the proven worst-case spend over ANY `window_seconds`-length real-time
interval is bounded by **2 × window_cap**. Size `window_cap` to half of the
maximum exposure you are willing to accept per window. This `2 * window_cap`
bound is the property AXL proves out-of-band; the contract itself enforces it
regardless.

## Entrypoints

| Entrypoint | Auth | Effect |
|---|---|---|
| `__constructor(passkey_pubkey, passkey_cred_id, admin, max_absolute_per_charge)` | deploy-time | Sets the passkey credential, admin, and the immutable `max_absolute_per_charge` ceiling. Rejects a non-positive ceiling. There is no setter for the ceiling anywhere. |
| `init(_passkey_pubkey, _passkey_cred_id, _admin)` | — | Guarded no-op. Always errors `AlreadyInitialized`; exists only to reject front-running of the old init path. |
| `install_policy(merchant, token, amount_per_charge, max_per_charge, interval_seconds, expires_at)` | wallet auth (passkey via `__check_auth`) | The only path to grant a merchant the right to pull funds. |
| `revoke_policy(merchant)` | wallet auth | Kill switch for a merchant policy. |
| `get_policy(merchant) -> Policy` | none (read) | Returns the policy. |
| `install_agent_session(...)` | wallet auth | Installs an `AgentSession` (session pubkey, caps, window, recipient allowlist, ssl_hash, expiry). |
| `get_agent_session(session_pubkey) -> AgentSession` | none (read) | Returns the session. |
| `revoke_agent_session(session_pubkey)` | wallet auth | Kill switch for an agent session. |
| `__check_auth(...)` | host-invoked | Validates passkey or agent credential and enforces the caps above. |

## Storage model

Instance storage holds the passkey pubkey (`BytesN<65>`), passkey credential id,
admin address, and the immutable `MaxAbsolutePerCharge`. Per-merchant `Policy`
and per-session `AgentSession` records are keyed by merchant address and session
pubkey respectively (`DataKey`). Policy fields include `max_per_charge`,
`interval_seconds`, `expires_at`, `last_charge_at`, and a `revoked` kill switch.

## Caps / invariants

- `max_absolute_per_charge` is immutable, set once at construction, positive, and
  has no setter. It is the absolute ceiling above all policies and sessions.
- Hardened bounds at install time: per-charge cap ratio `<= 10x`, window ratio
  `<= 100x`, no self / wallet-as-merchant, single-use session pubkey.
- Passkey path is bound to the tx (auth payload inside `client_data_json`) and
  verified with `secp256r1_verify`; replay-defended.
- Agent path: every transfer must satisfy `per_tx_cap`, the recipient allowlist
  (non-empty), and the `2 * window_cap` worst-case ceiling.
- Both Policy and AgentSession have user-set `revoked` kill switches and expiry.

## Status & honest limitations

- Testnet only. Not deployed on mainnet. The mainnet path does not exist yet.
- The agent-session guarantee is `2 * window_cap` over any real-time window, not
  `window_cap`. Misreading it as `window_cap` understates worst-case exposure by
  2x. Size accordingly.
- `ssl_hash` is a provenance pin recorded on the session; the contract does not
  interpret it or depend on any external cert.
- No third-party audit of this contract. A self-run adversarial audit harness
  exists on testnet (`CCPIR4DN…`, 2026-06-03).
