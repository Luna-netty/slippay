# Slippay Smart Wallet Contract — deployed

## v0.1 · TESTNET (M6 admin pattern · 2026-05-28)

**Template wasm hash**: `a2328321a8b0811ccee92edf8555849a4310081efaf26ec89140da31d8eb470c`
**Template contract**: `CBG62CSWG6FYX6CTH5246V6DLQTIR3GKJEIZEQN3AH4W46E7ES6UNASO`
**Stellar.expert**: https://stellar.expert/explorer/testnet/contract/CBG62CSWG6FYX6CTH5246V6DLQTIR3GKJEIZEQN3AH4W46E7ES6UNASO
**Deployer / v0.1 admin**: `GDYKSPEDSST4YSSMNW6LMK27XN6YMM4SEN4RAKCCFT3N74GWPGXAJPQT`
**Soroban SDK**: 26 · **Stellar protocol**: 26 · **Build target**: `wasm32v1-none`
**Unit tests**: 13/13 passing (`cargo test --release`)

### Live e2e proof on testnet (M6)

Per-user wallet provisioned via the spike HTTP endpoint
(`scripts/policy-checkout-spike-server.mjs`). One-shot trace:

| step | tx | observable |
|---|---|---|
| deploy fresh instance | (contract address) | `CBFX3HTMYYEHZMTDNXFKDSXKWOUGCAY46A53QDMV3WL5W6C6NKSCFK2S` |
| `init(pubkey, cred_id, admin)` | [`479dec7b...`](https://stellar.expert/explorer/testnet/tx/479dec7b9db2ecf2ceebd12ada96db5bed214eefbdec3e5f00a0145321df12db) | `wallet_initialized(pubkey, cred_id, admin)` |
| `install_policy(merchant, ...)` | [`2fd68a5b...`](https://stellar.expert/explorer/testnet/tx/2fd68a5b78284bdc2ce0b0c9569aee0736f4e42d52324f07a448643a2611c42e) | `policy_installed(merchant, amount=29M, max=35M, interval=2592000, expires=0)` |

Per-user instance deploy → init → policy install round trip clocked at
~20-30s wall time on testnet (deploy ~4-11s, init ~6-9s, install ~7-10s
depending on RPC load). All three calls signed by the admin G-account
held in the spike server.

## v0.1 security state · gap status

### Gap 1 · install/revoke gating — **CLOSED via admin pattern**

`install_policy` and `revoke_policy` now require `admin.require_auth()`.
The admin address is set once at `init` and stored in instance storage.
For the spike, callers (the trusted-setup server) pass the deployer's
classic G-account; the server signs the install/revoke transactions with
that key.

**v0.2 migration:** change the `init` call to set `admin =
env.current_contract_address()`. install/revoke then trigger the wallet's
own `__check_auth` which (per Gap 2 closure below) requires a real
secp256r1 signature from the user's passkey.

### Gap 2 · `__check_auth` signature stub — **still open**

When a transfer authorization is requested whose merchant has no active
policy match, `__check_auth` falls through to a v0.1 stub that accepts
any non-zero signature blob. v0.2 restores
`env.crypto().secp256r1_verify(pubkey, payload, signature)` over the
host-provided digest.

**Why this is not blocking the current demo:** the transfer authorization
path is only invoked when a merchant pulls funds from the wallet
(`slippay-subscription.charge` → nested `token.transfer`). That flow is
not yet wired end-to-end in v0.1 — the demo today exercises wallet
creation + policy install only. The 13 unit tests cover the policy-match
enforcement that would fire when the transfer path lands.

**Why this still matters:** before v0.2, the wallet should not hold any
mainnet funds. The stub means a sufficiently motivated attacker who can
get a token transfer authorization request through the wallet could
satisfy `__check_auth` with garbage. Mainnet deployment remains gated on
closing this gap.

## Contract surface

| function | v0.1 auth | effect |
|---|---|---|
| `init(passkey_pubkey, passkey_cred_id, admin)` | none (one-shot) | persists passkey material + admin address |
| `install_policy(merchant, token, amount, max, interval, expires_at)` | **admin** (Ed25519 G-account in v0.1) | persists policy, emits `policy_installed` |
| `revoke_policy(merchant)` | **admin** (Ed25519 G-account in v0.1) | flips `revoked=true`, emits `policy_revoked` |
| `get_policy(merchant)` | none (read) | returns the Policy struct |
| `__check_auth(payload, sig, contexts)` | (custom account interface) | policy-matched contexts return Ok without sig; everything else falls through to **v0.1 stub** (Gap 2) |

## What v0.1 already proves on-chain

- Per-merchant policy storage with admin-gated mutation
- Per-charge hard cap enforcement (transfer above `max_per_charge` → reject)
- Interval enforcement
- Revoked policies block all subsequent merchant pulls
- Optional expiry auto-revokes
- Wrong-token transfers under same merchant → no policy match (correct fall-through)
- Unknown-merchant transfers → no policy match (correct fall-through)

These properties are enforced by Soroban host execution semantics, not by
Slippay backend code. 13 unit tests cover them deterministically.

## Composition with `slippay-subscription` v0.2

This wallet is intended to be the `buyer` argument in calls to the
production-deployed slippay-subscription mainnet contract
(`CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN`). When the
merchant calls `slippay-subscription.charge(id)`, the nested
`token.transfer(buyer, merchant, amount)` triggers this wallet's
`__check_auth`. If a matching policy exists, the pull is authorized
without consulting the passkey — that is the "no extra tap" property
demanded by the [policy-checkout product spec](../../docs/product/policy-checkout-spec.md).

That wiring is M7 (next milestone), not landed in v0.1.

## Reproduce

```sh
cd contracts/smart-wallet
bash deploy-testnet.sh        # uploads + deploys template, writes .testnet-deploy.env
bash demo-testnet.sh          # deploys a fresh per-user instance, init, install_policy, get_policy

# OR run the HTTP endpoint and hit it from the page:
pnpm policy-checkout:spike    # listens on :8787
# then open the app and visit /s/demo
```

## Status this is enabling

This deploy is M4 + M5 + M6 of the policy-checkout sprint. M7 will wire
the merchant-pull flow against the production slippay-subscription
contract on testnet first, then mainnet rehearsal, ahead of Rio Stellar
37 Graus on 2026-06-08.
