# SlipPay contract suite

Reference for the Soroban contracts under `contracts/`. These are the on-chain
primitives behind SlipPay's non-custodial USDC rails on Stellar. Non-custodial
means the buyer or agent wallet signs funds directly to the merchant; SlipPay
never holds funds and never has signing authority over user funds.

Per-contract reference:

- [subscription.md](./subscription.md) — recurring debit (v0.1 per-period signature, v0.2 allowance autocharge, v0.3 attestation gate)
- [smart-wallet.md](./smart-wallet.md) — WebAuthn/passkey custom account with merchant pull-policy and agent session paths
- [checkout.md](./checkout.md) — atomic fee-split one-time payment
- receipt — tamper-evident receipt hash chain (see source `contracts/receipt/src/lib.rs`; documented at the end of this file)

## The testnet/mainnet seam

State this seam wherever it matters. Not all contracts are on mainnet, and one
contract runs a different version on mainnet than the one its source supports.

| Concern | Mainnet (`PUBLIC`) | Testnet |
|---|---|---|
| subscription v0.1 (per-period signature) | live | n/a |
| subscription v0.2 autocharge (SEP-41 allowance) | live | proven |
| subscription v0.3 attestation gate (`autocharge_attested`) | NOT deployed | proven (e2e scripts only) |
| smart-wallet (passkey + agent session) | NOT deployed | template live, per-user instances |
| checkout (fee-split) | NOT deployed (pending) | live |
| receipt | NOT deployed (verify before claiming) | NOT deployed (verify before claiming) |

The key honest points:

- Mainnet recurring billing today runs subscription v0.2 (allowance-gated
  autocharge). The v0.3 attestation gate exists in source with contract tests
  and is proven on testnet only. Mainnet runs v0.2 WITHOUT the gate.
- smart-wallet and checkout are testnet-only. Their mainnet paths are not
  deployed.

## Deployed addresses

### Mainnet (`PUBLIC`)

| Contract | Address | wasm hash | Deployed |
|---|---|---|---|
| subscription v0.1 | `CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN` | `1dbda19a…` | 2026-05-16 |
| subscription v0.2 autocharge | `CAQZECYTKQGUJETQRRBONGQA2DJBNQVYCSKBYCKXOVQOEEOMHKBTJZEP` | `f8cfed71…` | 2026-06-03 |

Creator / deployer for both: `GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P`.
This account is also the platform fee account that receives the platform fee leg.

### Testnet

| Contract | Address | wasm hash | Deployed |
|---|---|---|---|
| smart-wallet (template) | `CAQZWVRPWW7UBCKPFECNGAZW7YDRVSRWP6FVA4V32Q74ZCNVIPOVK4OM` | `01b35f…` | 2026-05-31 |
| checkout | `CBO2COBZUTHH4II4JCQRZVO4RKDUIUH4MXZTAWOYVUZIVYI47UIDQCWQ` | (see source/deploy) | 2026-06-05 |
| adversarial audit harness | `CCPIR4DN…` | (see harness) | 2026-06-03 |

The smart-wallet template is the wasm from which one instance is deployed per
user wallet.

### Assets / accounts

| Item | Address |
|---|---|
| Mainnet USDC issuer (Circle) | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| Testnet USDC issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Platform fee account (mainnet) | `GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P` |

The Circle USDC issuer account is the asset issuer; it is not a SlipPay account
and carries no traction meaning.

## receipt contract

Source: `contracts/receipt/src/lib.rs`. Purpose: a tamper-evident, gap-free
receipt hash chain for OFF-CHAIN-settled recurring charges (for example a Pix
BRL debit, where the money never touches Stellar). For each billing period the
recorder publishes one opaque 32-byte `commitment`; the contract chains it into a
running `head`:

```
new_head = sha256( commitment(32) || prev_head(32) || period_index_be(4) )   // 68 bytes
```

The contract stores nothing about the amount. The amount and the blinding factor
are computed and held off-chain; a third party later handed `(amount, blinding)`
can recompute the commitment and check it against the public chain. This is
selective disclosure over an immutable ledger, not a confidential-transfer
primitive.

Entrypoints:

| Entrypoint | Auth | Effect |
|---|---|---|
| `open_mandate(mandate_id, recorder)` | `recorder.require_auth()` | Creates a mandate; `head` = 32 zero bytes, `count` = 0. Rejects `AlreadyExists`. |
| `record(mandate_id, period_index, commitment) -> head` | mandate's `recorder` | Requires `period_index == count` (no gaps/replay/reorder, else `BadPeriod`). Advances `head` and `count`, emits a `receipt` event with no amount. |
| `get_head(mandate_id) -> BytesN<32>` | none (read) | Current chain tip. `NotFound` if absent. |
| `get_count(mandate_id) -> u32` | none (read) | Receipts recorded so far. |
| `get_mandate(mandate_id) -> Mandate` | none (read) | Full mandate record. |

Storage model: persistent `DataKey::Mandate(BytesN<32>)` → `Mandate { recorder,
head, count }`. Every persistent set is followed by `extend_ttl(17280, 535000)`.

Caps / invariants: strict monotonic, gap-free `period_index` (must equal
`count`); each `head` depends on the previous, so rewriting any past commitment
changes every subsequent head.

### Status & honest limitations (receipt)

- Source and tests exist; no deployed address is recorded in the canonical facts.
  Verify on-chain before claiming a deployment for this contract.
- Hiding/binding of the amount come from sha256 plus a high-entropy `blinding`
  chosen off-chain. The contract treats `commitment` as opaque and does not
  enforce the off-chain commitment formula or that the blinding is random.
- The amount is hidden end-to-end ONLY when settlement is off-chain. If
  settlement is an on-chain SAC / SEP-41 `transfer`, the amount leaks at the
  transfer event. This contract performs no transfer.
- No third-party audit of this contract.
