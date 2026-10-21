#!/usr/bin/env bash
# Deploy slippay-subscription contract to Stellar MAINNET.
#
# Prereqs (operator-side, MUST be true before running):
#   1. `stellar keys add slippay-mainnet-deployer` already configured
#      (or `stellar keys generate slippay-mainnet-deployer`).
#   2. Deployer account funded with ≥30 XLM mainnet
#      (covers upload ~5 XLM + deploy ~1 XLM + reserves + buffer).
#   3. WASM built (run `cargo build --release --target wasm32v1-none --locked`).
#   4. F5 e2e signed charge gate passed on testnet (audit-002 F5).
#
# Output:
#   .mainnet-deploy.env  (CONTRACT_ID + WASM_HASH for the listener flip)
#
# This script is idempotent on re-run for the same wasm hash — `upload`
# returns the same hash, `deploy` writes a new instance only if the
# source account hasn't deployed this wasm at this nonce yet.

set -euo pipefail

CONTRACT_DIR="$(cd "$(dirname "$0")" && pwd)"
NETWORK="mainnet"
DEPLOYER_NAME="${DEPLOYER_NAME:-slippay-mainnet-deployer}"
WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/slippay_subscription.wasm"

cd "$CONTRACT_DIR"

echo "=== preflight ==="
if [ ! -f "$WASM_PATH" ]; then
  echo "wasm not found at $WASM_PATH"
  echo "build first: cargo build --release --target wasm32v1-none --locked"
  exit 1
fi
DEPLOYER_PUB=$(stellar keys address "$DEPLOYER_NAME" 2>/dev/null || true)
if [ -z "$DEPLOYER_PUB" ]; then
  echo "deployer identity '$DEPLOYER_NAME' not found in stellar keys."
  echo "create it first via: stellar keys generate $DEPLOYER_NAME"
  exit 1
fi
echo "deployer: $DEPLOYER_PUB"
echo "wasm:     $WASM_PATH"
echo "wasm sha: $(sha256sum "$WASM_PATH" | awk '{print $1}')"
echo ""
echo "About to UPLOAD + DEPLOY to Stellar MAINNET. This is irreversible."
echo "Press Ctrl-C now to abort, or Enter to proceed."
read -r _

echo ""
echo "=== upload wasm to mainnet ==="
WASM_HASH=$(stellar contract upload \
  --network "$NETWORK" \
  --source "$DEPLOYER_NAME" \
  --wasm "$WASM_PATH" 2>&1 | tail -1)
echo "WASM_HASH=$WASM_HASH"

echo ""
echo "=== deploy mainnet contract instance ==="
CONTRACT_ID=$(stellar contract deploy \
  --network "$NETWORK" \
  --source "$DEPLOYER_NAME" \
  --wasm "$WASM_PATH" 2>&1 | tail -1)
echo "CONTRACT_ID=$CONTRACT_ID"

echo ""
echo "=== persist for listener integration ==="
cat > "$CONTRACT_DIR/.mainnet-deploy.env" <<EOF
SLIPPAY_SUBSCRIPTION_CONTRACT_MAINNET=$CONTRACT_ID
SLIPPAY_SUBSCRIPTION_WASM_HASH_MAINNET=$WASM_HASH
SLIPPAY_SUBSCRIPTION_DEPLOYER_PUB=$DEPLOYER_PUB
SLIPPAY_SUBSCRIPTION_DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SLIPPAY_SUBSCRIPTION_VERSION=v0.2
EOF
echo "wrote $CONTRACT_DIR/.mainnet-deploy.env"

echo ""
echo "=== DONE ==="
echo "contract:      $CONTRACT_ID"
echo "stellar.expert: https://stellar.expert/explorer/public/contract/$CONTRACT_ID"
echo ""
echo "Next steps (manual):"
echo "  1. Update GitHub Actions var SLIPPAY_SUBSCRIPTION_WASM_HASH_MAINNET=$WASM_HASH"
echo "  2. On VPS, flip listener:"
echo "       sed -i 's/^STELLAR_NETWORK=.*/STELLAR_NETWORK=mainnet/' /opt/slippay-backend/.env"
echo "       pm2 reload slippay-listener --update-env"
echo "  3. Update DEPLOYED.md with the new mainnet block"
