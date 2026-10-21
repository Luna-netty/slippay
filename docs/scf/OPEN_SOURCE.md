# Open-Source Declaration — SlipPay (SCF Open Track requirement)

The Open Track requires an explicit open-source plan for any smart contract.
This is that declaration.

## Smart contract

- **What:** SlipPay subscription contract (Soroban), `slippay-subscription`.
- **Source:** `contracts/subscription/src/lib.rs` in the public repo
  `github.com/Galmanus/slippay`.
- **License:** **Apache-2.0** — declared in `contracts/subscription/Cargo.toml`
  and in the repository-root `LICENSE` file. The contract source is public and
  Apache-2.0 from inception (not a future relicensing promise).
- **Deployed (mainnet):** `CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN`
  · Wasm hash `1dbda19a2c9962cf798b62557f7c6388a3ea3c7c506ddb7aafbd549843510c6b`.
- **Deployed (testnet):** `CBN3M7IAKNSCSDQIUUGDBHSFUQDOFAQQQK6UXJZYGGIWERQGT24VBTFQ`
  (same Wasm hash — identical bytecode promoted after the F5 real-wallet
  end-to-end charge gate closed).
- **Reproducible build:** Soroban SDK 26 · Stellar protocol 26 ·
  `cargo test --release` (5/5 passing). The mainnet Wasm hash matches the
  source in-repo, so any third party can rebuild and verify byte-for-byte.

## Open-source roadmap for future deployments

- All future contract versions (v0.3+, e.g. the pre-auth allowance primitive
  noted in `DEPLOYED.md` F4) ship Apache-2.0 in the same public repo before
  mainnet deploy.
- Each deploy records upload tx, deploy tx, deployer, and Wasm hash in
  `contracts/subscription/DEPLOYED.md` so the on-chain bytecode is always
  traceable to a public, licensed source commit.

## What is NOT open-source (and why)

- The off-chain API (`supabase/functions/api`), web app, and platform-fee
  billing logic are proprietary — they are the commercial layer, not the
  on-chain primitive. The grant-relevant artifact (the contract) is fully open.
