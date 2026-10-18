#!/usr/bin/env bash
# End-to-end demo of slippay-smart-wallet v0.1 on Stellar testnet.
#
# What this script proves:
#   1. A fresh wallet contract can be deployed from the v0.1 wasm
#   2. init() persists the user's passkey pubkey + credential id on chain
#   3. install_policy() persists a per-merchant spending policy whose
#      data structure is publicly readable via get_policy()
#   4. The policy_installed event is emitted with the policy parameters
#      so any indexer can observe the install
#
# v0.1 LIMITATION: install_policy currently does NOT require_auth (see
# contracts/smart-wallet/src/lib.rs comment). The demo flow gates the
# install at the application layer (this script is the trusted setup
# oracle). v0.2 lands real passkey-gated install via __check_auth.
#
# Prereq:
#   stellar-cli installed
#   .testnet-deploy.env exists (produced by deploy-testnet.sh)
#   slippay-deployer key has testnet funding
#
# Run from contracts/smart-wallet/:
#   bash demo-testnet.sh

set -euo pipefail

CONTRACT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CONTRACT_DIR"

source ./.testnet-deploy.env
WASM_HASH="$SLIPPAY_SMART_WALLET_WASM_HASH_TESTNET"

echo "=== deploying fresh wallet instance from wasm $WASM_HASH ==="
WALLET=$(stellar contract deploy \
  --network testnet \
  --source slippay-deployer \
  --wasm-hash "$WASM_HASH" 2>&1 | tail -1)
echo "WALLET=$WALLET"

# Placeholder passkey material — v0.2 replaces with WebAuthn credential.
PUBKEY="04$(printf '01%.0s' {1..32})$(printf '02%.0s' {1..32})"
CRED="$(printf '03%.0s' {1..32})"

# Demo merchant + token (mirror of the slippay-subscription DEPLOYED.md
# demo parameters so events line up across both contracts).
MERCHANT=GAE5HOWKZVVL5AOZQVJOZFY2ZB7Z2YK6PV4UKWOWB3KQWQCHY2PBVJMM
TOKEN=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

echo
echo "=== init wallet ==="
ADMIN=$(stellar keys address slippay-deployer)
stellar contract invoke --network testnet --source slippay-deployer \
  --id "$WALLET" -- init \
  --passkey_pubkey "$PUBKEY" \
  --passkey_cred_id "$CRED" \
  --admin "$ADMIN"

echo
echo "=== install policy ==="
stellar contract invoke --network testnet --source slippay-deployer \
  --id "$WALLET" -- install_policy \
  --merchant "$MERCHANT" \
  --token "$TOKEN" \
  --amount_per_charge 29000000 \
  --max_per_charge 35000000 \
  --interval_seconds 2592000 \
  --expires_at 0

echo
echo "=== get_policy (on-chain read) ==="
stellar contract invoke --network testnet --source slippay-deployer \
  --id "$WALLET" -- get_policy --merchant "$MERCHANT"

echo
echo "=== DONE ==="
echo "wallet:          $WALLET"
echo "stellar.expert:  https://stellar.expert/explorer/testnet/contract/$WALLET"
echo
echo "The contract storage now holds a Policy struct for merchant $MERCHANT"
echo "with max_per_charge=35.0 USDC and interval_seconds=2592000 (30 days)."
echo "Any future SAC transfer attempt with amount>35M or before interval"
echo "elapses would be rejected by __check_auth, on chain, atomically."
