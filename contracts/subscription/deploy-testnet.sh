#!/usr/bin/env bash
# Deploy slippay-subscription contract to Stellar testnet.
# Idempotent: re-running with the same source key + same wasm yields the same id
# (deterministic deploy via salt; SAC-style).
#
# Prereq:
#   stellar-cli installed (cargo install --locked stellar-cli)
#   cd contracts/subscription/
#
# Output:
#   .testnet-deploy.env  (CONTRACT_ID + WASM_HASH for slippay backend integration)

set -euo pipefail

CONTRACT_DIR="$(cd "$(dirname "$0")" && pwd)"
NETWORK="${NETWORK:-testnet}"
DEPLOYER_NAME="${DEPLOYER_NAME:-slippay-deployer}"

cd "$CONTRACT_DIR"

echo "=== build (wasm32, release) ==="
cargo build --target wasm32-unknown-unknown --release
WASM_PATH="$CONTRACT_DIR/target/wasm32-unknown-unknown/release/slippay_subscription.wasm"
ls -la "$WASM_PATH"

echo "=== ensure deployer keypair (testnet, friendbot funded) ==="
if ! stellar keys ls 2>/dev/null | grep -q "^${DEPLOYER_NAME}$"; then
  stellar keys generate --global "$DEPLOYER_NAME" --network "$NETWORK" --fund
fi
DEPLOYER_PUB=$(stellar keys address "$DEPLOYER_NAME")
echo "deployer: $DEPLOYER_PUB"

echo "=== upload wasm ==="
WASM_HASH=$(stellar contract upload \
  --network "$NETWORK" \
  --source "$DEPLOYER_NAME" \
  --wasm "$WASM_PATH" 2>&1 | tail -1)
echo "WASM_HASH=$WASM_HASH"

echo "=== deploy ==="
CONTRACT_ID=$(stellar contract deploy \
  --network "$NETWORK" \
  --source "$DEPLOYER_NAME" \
  --wasm "$WASM_PATH" 2>&1 | tail -1)
echo "CONTRACT_ID=$CONTRACT_ID"

echo "=== persist for backend integration ==="
cat > "$CONTRACT_DIR/.testnet-deploy.env" <<EOF
SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET=$CONTRACT_ID
SLIPPAY_SUBSCRIPTION_WASM_HASH_TESTNET=$WASM_HASH
SLIPPAY_SUBSCRIPTION_DEPLOYER_PUB=$DEPLOYER_PUB
SLIPPAY_SUBSCRIPTION_DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
echo "wrote $CONTRACT_DIR/.testnet-deploy.env"

echo
echo "=== DONE ==="
echo "contract: $CONTRACT_ID"
echo "stellar.expert: https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID"
echo
echo "Next: copy SLIPPAY_SUBSCRIPTION_CONTRACT_TESTNET to /opt/slippay-backend/.env on prod."
