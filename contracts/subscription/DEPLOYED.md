# Slippay Subscription Contract — deployed

## v0.2 · MAINNET (PRODUCTION · 2026-05-16)

**Contract address**: `CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN`
**Stellar.expert**: https://stellar.expert/explorer/public/contract/CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN
**Wasm hash**: `1dbda19a2c9962cf798b62557f7c6388a3ea3c7c506ddb7aafbd549843510c6b`
**Upload tx**: [`b031a631...`](https://stellar.expert/explorer/public/tx/b031a6315595d45bb655d9a05680df475547d5c02b3e5435563d032bc77a65a3)
**Deploy tx**: [`cb90fccd...`](https://stellar.expert/explorer/public/tx/cb90fccdc7b6c4d7cea33d5bc22ecc9083d4ac1c4e22c9e3cfd4f7d57f170d81)
**Deployer**: `GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P`
**Funding tx (Mario → deployer, 64.35 XLM)**: [`ac2e5647...`](https://stellar.expert/explorer/public/tx/ac2e564714e017b8a951244e23aebbb851fb3ea238c136aca8d3b9efc28af2a9)

Same wasm hash as testnet v0.2 — identical bytecode promoted from
testnet after F5 (audit-002) closed with real-wallet end-to-end charge.
No code differences between testnet v0.2 and mainnet.

## v0.2 · TESTNET (for development/demo)

**Deployed**: 2026-05-16
**Contract address**: `CBN3M7IAKNSCSDQIUUGDBHSFUQDOFAQQQK6UXJZYGGIWERQGT24VBTFQ`
**Stellar.expert**: https://stellar.expert/explorer/testnet/contract/CBN3M7IAKNSCSDQIUUGDBHSFUQDOFAQQQK6UXJZYGGIWERQGT24VBTFQ
**Wasm hash**: `1dbda19a2c9962cf798b62557f7c6388a3ea3c7c506ddb7aafbd549843510c6b`
**Upload tx**: [`1db49c19...`](https://stellar.expert/explorer/testnet/tx/1db49c196cf95d48282292523586a118f7dcfae14cc7abc65a407bbc7a13b168)
**Deploy tx**: [`8bbc3807...`](https://stellar.expert/explorer/testnet/tx/8bbc380771e8435e43155bb515f51611200a5325e88af06906dc13467fd5eb42)
**Soroban SDK**: 26 · **Stellar protocol**: 26
**Source**: `contracts/subscription/src/lib.rs`
**Unit tests**: 5/5 passing (`cargo test --release`)

### F5 · real-wallet e2e charge · PASSED 2026-05-16

Audit-002 F5 mandatory gate before mainnet: at least one charge() with a
real wallet signature (not `mock_all_auths_*`). Run via patched
`_f5-demo.mjs` from `apps/listener/` with fresh keypairs funded by
friendbot, test USDC issuer, SAC wrapped inline, full submit through
soroban RPC + Horizon. Buyer signs `create` AND `charge` invocations
with their real secret key. Nested `SAC.transfer(buyer→merchant, 10)`
auth chain confirmed end-to-end.

| operation | tx hash | stellar.expert |
|---|---|---|
| SAC deploy (test USDC) | `38181c76...6ee217` | [tx](https://stellar.expert/explorer/testnet/tx/38181c76345038102081ebde7c0f90c27960a6a582566cbad44b8473b16ee217) |
| `create()` | `43a56dc8...eacab6` | [tx](https://stellar.expert/explorer/testnet/tx/43a56dc83aa943d8ad70c776e057923c7072c4bbc8bd6deeb69ec10fffeacab6) |
| `charge()` | `eee0d71f...a602ff` | [tx](https://stellar.expert/explorer/testnet/tx/eee0d71f2f2100da1b97c971cec98fe367e89758c0b8b91c29ef6d5e84a602ff) |

**balance proof:** buyer 1000 → 990 USDC (-10), merchant 0 → 10 USDC (+10).
Real value moved on chain, not mocked. v0.2 contract mainnet-ready
from the auth-chain perspective.

### v0.2 changes vs v0.1 (audit-002 fixes)

- **F1** · `extend_ttl` on every persistent `set` (create + charge + cancel + pause + resume + mark_expired) — long-period subs survive idle gaps that would otherwise archive the storage entry
- **F3** · `charges_done.checked_add(1)` instead of `+= 1` — overflow defense even if release profile flags get flipped
- **F4** · module doc rewritten: "v0.1 buyer signs every charge"; v0.2 will add pre-auth (next contract version)
- **F6** · `cancel` only transitions from Active or Paused; refuses Cancelled / Expired (no duplicate event emission)
- **F8** · `subscription_created` event now carries `merchant`, `token`, `max_periods`, `expires_at` so indexers don't need a follow-up `get(id)` round-trip

## v0.1 (deprecated)

**Contract address**: `CBWJ3LQGO7HBZBQK2MGS75EK266HNW4RJS77BVZIGZGDUUENXQMSHRHA`
**Wasm hash**: `dbf7633d724ca1ed23d9ee1452fe182bd5da627ff6db73fe296ea0c55b09e465`
**Deployed**: 2026-05-10. Superseded by v0.2 on 2026-05-16. Kept on testnet for reference but the listener + API point at v0.2.

## Live demo proof

Verified end-to-end on Stellar testnet:

| operation | tx hash | events emitted |
|---|---|---|
| deploy | [`fbfdbb66...`](https://stellar.expert/explorer/testnet/tx/fbfdbb66b8894539f8db2a928f8925f3bb47903ede65d4541b939d6568b545df) | contract instantiated |
| `create()` | [`8ed4fa21...`](https://stellar.expert/explorer/testnet/tx/8ed4fa21923d5433c31663a5e6b43cea8490844682682ba91e228683beedea4a) | `subscription_created(buyer, [nonce, amount, period])` |
| `charge()` | [`688c985a...`](https://stellar.expert/explorer/testnet/tx/688c985a4508ce9599a6430b1a004e265e7d60ca20eb28f4b605700b0dd5980b) | `transfer(buyer, merchant, 10000000, native)` from SAC<br>`subscription_charged(buyer, merchant, [nonce, amount, charges_done=1, next_due])` from contract |

### Demo parameters

```
buyer:       GC6HUYDR3N5PGR2ONPYA5G54HHTGT3PN4X4Q2YZELA4F7QSPHMOUQWXP
merchant:    GAE5HOWKZVVL5AOZQVJOZFY2ZB7Z2YK6PV4UKWOWB3KQWQCHY2PBVJMM
token:       CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC  (native XLM SAC)
amount:      10_000_000  (1.0 XLM with 7 decimals)
period:      86400 seconds (1 day)
max_periods: 12
```

### Balance proof

```
                  before charge        after charge       delta
buyer:    9999.9871928 XLM   →   9998.9852335 XLM   -1.0019593 (1.0 payment + 0.0019593 fee)
merchant: 10000.0000000 XLM  →   10001.0000000 XLM  +1.0000000 (received exactly)
```

The contract atomically debits buyer and credits merchant in a single
transaction. No off-chain reconciliation needed.

## Reproduce

```sh
# 1. Install stellar-cli 26+
# (precompiled binary from github.com/stellar/stellar-cli/releases/v26.0.0)
curl -fsSL -o /tmp/stellar-cli.tar.gz \
  https://github.com/stellar/stellar-cli/releases/download/v26.0.0/stellar-cli-26.0.0-x86_64-unknown-linux-gnu.tar.gz
tar xzf /tmp/stellar-cli.tar.gz -C ~/.local/bin/

# 2. Add wasm target
rustup target add wasm32v1-none

# 3. Build + deploy
cd contracts/subscription
cargo build --target wasm32v1-none --release
WASM=$(pwd)/target/wasm32v1-none/release/slippay_subscription.wasm
stellar keys generate slippay-deployer --network testnet --fund
CONTRACT=$(stellar contract deploy --network testnet --source slippay-deployer --wasm "$WASM" 2>&1 | tail -1)
echo $CONTRACT

# 4. Demo: buyer + merchant + native XLM SAC
stellar keys generate buyer --network testnet --fund
stellar keys generate merchant --network testnet --fund
BUYER=$(stellar keys address buyer)
MERCHANT=$(stellar keys address merchant)
NATIVE_SAC=$(stellar contract id asset --asset native --network testnet)
NONCE=$(openssl rand -hex 32)

# create()
stellar contract invoke --network testnet --source buyer --id $CONTRACT \
  -- create --buyer $BUYER --merchant $MERCHANT --token $NATIVE_SAC \
  --amount 10000000 --period_seconds 86400 --max_periods 12 \
  --expires_at 0 --nonce $NONCE

# charge()
stellar contract invoke --network testnet --source buyer --id $CONTRACT \
  -- charge --id $NONCE
```

## Contract surface

| function | auth | effect |
|---|---|---|
| `create(buyer, merchant, token, amount, period_seconds, max_periods, expires_at, nonce)` | buyer | persists subscription, emits `subscription_created` |
| `charge(id)` | buyer | calls `token.transfer(buyer, merchant, amount)`, bumps `charges_done`, emits `subscription_charged` |
| `cancel(id)` | buyer | sets status=Cancelled, emits `subscription_cancelled` |
| `pause(id)` / `resume(id)` | merchant | flips status Active ↔ Paused |
| `mark_expired(id)` | anyone (idempotent) | sets status=Expired if expires_at passed or max_periods reached |
| `get(id)` | none (read) | returns Subscription struct |

### Idempotency contract

- `charge()` panics with `PeriodNotElapsed` if called before `last_charge_at + period_seconds`. Re-running the scheduler within the same period is safe — no double charge.
- `cancel()` returns silently if already cancelled.
- `mark_expired()` returns `false` if no terminal condition holds (status preserved).

## Security notes

- v0.1: buyer signs each charge (top-level `require_auth` on charge).
  Buyer UX requires wallet interaction per cycle.
- v0.2 plan: replace top-level buyer auth with pre-authorization signature
  attached to the contract invocation, allowing the off-chain scheduler
  (slippay backend) to call charge without buyer wallet interaction.
- Contract has NOT been audited. Do not use with mainnet funds until
  audit is complete (see SCF M4 deliverable in `docs/scf/`).
- All state mutations follow Soroban panic-reverts-state semantics:
  status changes that need to persist when conditions are bad (expiry,
  max_periods reached) are exposed via separate `mark_expired` rather
  than baked into `charge`.

## Status this is enabling

This deploy is the M1 deliverable (contract + tests + on-chain proof) of
the Soroban subscription roadmap documented in
`docs/scf/soroban-subscription-proposal.md`. M2 (TypeScript SDK +
wallet matrix), M3 (mainnet + 5 demo merchants), M4 (audit + open-source)
remain.
