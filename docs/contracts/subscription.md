# subscription contract

Source: `contracts/subscription/src/lib.rs`.

## Purpose

On-chain recurring USDC debit on Stellar. Non-custodial: the contract pulls funds
from the buyer to the merchant; SlipPay never holds funds and never has signing
authority over user funds. The source carries three settlement models that have
accreted over versions:

- **v0.1** — buyer signs every period (`charge`).
- **v0.2** — autonomous debit against a standing SEP-41 allowance, no per-period
  buyer signature (`autocharge`).
- **v0.3** — v0.2 settlement gated by a single-use ed25519 integrity attestation
  verified on-chain (`autocharge_attested` + `set_attester`).

## Network, addresses, deploy dates

| Version | Network | Address | wasm hash | Deployed |
|---|---|---|---|---|
| v0.1 (per-period signature) | mainnet (`PUBLIC`) | `CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN` | `1dbda19a…` | 2026-05-16 |
| v0.2 autocharge | mainnet (`PUBLIC`) | `CAQZECYTKQGUJETQRRBONGQA2DJBNQVYCSKBYCKXOVQOEEOMHKBTJZEP` | `f8cfed71…` | 2026-06-03 |
| v0.3 attestation gate | testnet only | (in v0.2 wasm's source; not separately deployed on mainnet) | — | — |

Creator / deployer for both mainnet contracts:
`GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P`.

Proven settlements:

- v0.1 real-keypair mainnet `charge`: tx `5da9741f…` (2026-06-03).
- v0.2 `autocharge` mechanism: testnet tx `40e19a7a…`.

## The testnet/mainnet seam (read this)

Mainnet recurring billing today runs **v0.2** (allowance-gated autocharge).
The **v0.3 attestation gate is NOT deployed on mainnet**. It is implemented in
source with 6 contract tests and proven on testnet via e2e scripts only. Mainnet
runs v0.2 WITHOUT the gate. Do not describe the on-chain attestation gate as a
mainnet capability.

## Entrypoints

### `create(buyer, merchant, token, amount, period_seconds, max_periods, expires_at, nonce) -> id`

- Auth: `buyer` authorizes.
- Effect: creates a `Subscription` record keyed by a derived id. `period_seconds`
  minimum is 86400s in production. A `1s` minimum is allowed only under the
  `demo` cargo feature, which must never be shipped to mainnet.
- `max_periods = 0` means unlimited until expiry; `expires_at = 0` means no
  expiry. `checked_add` guards against overflow.

### `charge(id) -> ledger_time` (v0.1 model)

- Auth: `buyer` signs every period. Uses `require_auth_for_args` binding the
  buyer signature to `(id, token, merchant, amount)`.
- Effect: nested SEP-41 `token.transfer(buyer -> merchant, amount)`. Enforces
  period elapsed, status active, max_periods, expiry. Advances `charges_done`
  and `last_charge_at`.

### `autocharge(id) -> ledger_time` (v0.2 model)

- Auth: no per-period buyer signature. Any relayer can submit (the buyer pre-
  authorized off-band by granting a standing SEP-41 allowance once:
  `token.approve(buyer, contract, cap, expiry)`).
- Effect: pulls via `transfer_from(spender = contract, buyer -> merchant)` each
  period. Two independent ceilings apply:
  - **contract-side**: status / period elapsed / `max_periods` / `expires_at`.
  - **SAC-side**: the SEP-41 allowance cap AND the allowance expiry ledger. When
    the allowance is exhausted or expired, `transfer_from` fails and the buyer
    must re-approve. This is a hard on-chain ceiling the contract cannot bypass.

### `set_attester(id, attester)` (v0.3 setup)

- Auth: merchant (the party allowed to bind an attester to the subscription).
- Effect: stores the ed25519 public key (`BytesN<32>`) of the integrity attester
  under `DataKey::Attester(id)`. `autocharge_attested` will not settle without a
  fresh signature from this key.

### `autocharge_attested(id, not_after, signature) -> ledger_time` (v0.3 model)

- Auth: no per-period buyer signature. Settlement is gated by an on-chain ed25519
  verification of an attestation produced off-chain by the bound attester.
- Effect:
  1. Loads the attester (`AttesterNotSet` if unset) and the subscription
     (`NotFound` if absent).
  2. Freshness check: reverts `AttestationExpired` if `now > not_after`.
  3. Reconstructs the signed message (44 bytes):

     ```
     id (32) || charges_done (u32 BE, 4) || not_after (u64 BE, 8)
     ```

     - `id` binding blocks replay of one subscription's attestation on another
       (cross-sub).
     - `charges_done` binding makes each attestation single-use: an attestation
       signed for charge N is consumed when N executes; the counter advances, so
       the same blob cannot authorize N+1. Single-use is carried by binding to
       the contract's existing monotonic state, with no hand-rolled nonce store.
     - `not_after` is the freshness window.
  4. `env.crypto().ed25519_verify(attester, msg, signature)`. An invalid
     signature traps and reverts, so the path is fail-closed.
  5. On success, runs the same allowance-gated settlement as `autocharge`.

### Lifecycle and read entrypoints

| Entrypoint | Auth | Effect |
|---|---|---|
| `cancel(id)` | buyer | Sets status terminal; no further charges. |
| `pause(id)` | merchant | Suspends charging. |
| `resume(id)` | merchant | Re-activates. |
| `get(id) -> Subscription` | none (read) | Returns the record. |
| `mark_expired(id) -> bool` | anyone (idempotent) | Persists terminal `expired` status. Exists because Soroban panics revert state, so a terminal status reached inside a charge path cannot persist there; this is the explicit path to commit it. |

## Storage model

Persistent keys (`DataKey`):

- `Sub(BytesN<32>)` → `Subscription { buyer, merchant, token, amount,
  period_seconds, max_periods, expires_at, charges_done, last_charge_at, status }`.
- `NextNonce` → id derivation counter.
- `Attester(BytesN<32>)` → ed25519 attester public key (v0.3).
- `PlatformFee` (instance storage) → `{ platform, fee_bps }`, set once at deploy
  via the constructor (v0.4).

`Status` is one of `active`, `paused`, `cancelled`, `expired`. Every persistent
set is followed by `extend_ttl(17280, 535000)`.

## Caps / invariants

- `charge` requires a fresh buyer signature bound to `(id, token, merchant,
  amount)` each period.
- `autocharge` / `autocharge_attested` settle only within both the contract-side
  ceilings and the SEP-41 allowance ceilings (cap and expiry). The allowance is
  the hard non-custodial ceiling: when exhausted or expired, settlement fails.
- v0.3 attestations are single-use (bound to `charges_done`), non-replayable
  across subscriptions (bound to `id`), and freshness-bounded (`not_after`).
- ed25519 verification is fail-closed (trap reverts).
- Production minimum `period_seconds` is 86400s; the `1s` minimum is a `demo`
  cargo-feature artifact that must not reach mainnet.
- `checked_add` overflow defense on arithmetic.

## Platform fee (v0.4)

The contract captures the platform fee on-chain, on the autonomous rail, so
revenue is collected at settlement time with no off-chain invoicing.

- **Set at deploy, immutable.** `__constructor(platform, fee_bps)` binds the fee
  recipient and rate to the contract instance. Setting it atomically at deploy
  removes any front-running window on a public network. `fee_bps` is capped at
  1000 (10%); `fee_bps = 0` disables the fee leg entirely (the rail runs free).
- **Inescapable on the autonomous rail.** `autocharge` and `autocharge_attested`
  take the fee out of `amount`: the merchant receives `amount - fee`, the
  platform receives `fee = amount * fee_bps / 10000`, and the buyer's total debit
  stays `amount`. Both legs are pulled from the buyer's one standing SEP-41
  allowance, so the allowance cap still bounds the total.
- **Why only the autonomous rail.** The fee is on the autonomous, attested path
  (the agent product), not on v0.1 `charge` (which requires a fresh buyer
  signature each period). Routing around the fee would mean giving up the
  autonomous product, so capture is effectively inescapable for the product.
- **Canonical rate is 297 bp (2.97%).** A mainnet deployment should pass
  `fee_bps = 297` to match the API default.

This is the on-chain monetization of the attested charge: a fee on every charge
that, on the v0.3 path, only settles with a fresh valid integrity attestation.

## Status & honest limitations

- v0.1 and v0.2 are live on mainnet. v0.3 (`autocharge_attested` / `set_attester`
  with on-chain `ed25519_verify`) is proven on testnet only and is NOT deployed
  on mainnet. Mainnet runs v0.2 without the gate.
- The v0.4 platform fee leg (constructor + on-chain fee split) is LIVE on mainnet
  as of 2026-06-05: contract `CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U`
  (constructor platform `GCEYFLGN…`, fee_bps 297). The fee split is proven on-chain
  on testnet (`CDO4DEBW…`, merchant +970300 / platform +29700 stroops on a 0.1 XLM
  autocharge). The rail (web, scheduler, API) points at this contract. Note: the
  attestation gate (`autocharge_attested`) ships in this contract but stays inactive
  per subscription until an attester is bound via `set_attester`; the plain
  `autocharge` path (allowance + fee, no gate) is what runs by default. Capture is
  still gated on real volume — no paying subscriptions exist yet, so realized fees
  are zero until merchants onboard.
- No third-party audit of the subscription contract (v0.1/v0.2/v0.3). The
  existing audits 001-006 cover the WooCommerce plugin only. A self-run
  adversarial audit harness exists on testnet (`CCPIR4DN…`, 2026-06-03).
- The `demo` cargo feature relaxes the period minimum to 1s; shipping it to
  mainnet would remove a real safety bound.
