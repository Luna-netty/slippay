#!/usr/bin/env bash
# On-chain proof of autonomous debit (autocharge) on Stellar TESTNET.
# Uses native XLM SAC (no trustline dance). The killer step: autocharge is
# submitted by a RELAYER account (not the buyer) and still settles — proving
# no buyer signature is needed at charge time, only the standing allowance.
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true

NET=testnet
WASM=contracts/subscription/target/wasm32v1-none/release/slippay_subscription.wasm
TS=$(date +%s)
B=auto-buyer-$TS; M=auto-merch-$TS; R=auto-relayer-$TS; D=auto-deployer-$TS

echo "=== fund ephemeral testnet accounts (friendbot) ==="
for k in $D $B $M $R; do stellar keys generate "$k" --network $NET --fund >/dev/null 2>&1; echo "  $k -> $(stellar keys address $k)"; done
BUYER=$(stellar keys address $B); MERCH=$(stellar keys address $M)

echo "=== native SAC id (testnet) ==="
NATIVE=$(stellar contract id asset --asset native --network $NET)
echo "  $NATIVE"

echo "=== deploy updated subscription contract ==="
CONTRACT=$(stellar contract deploy --wasm "$WASM" --source $D --network $NET 2>/dev/null | tail -1)
echo "  contract: $CONTRACT"

NONCE=$(printf 'a1%.0s' {1..32})  # 64 hex chars = 32 bytes
echo "=== create() — buyer signs once ==="
stellar contract invoke --id "$CONTRACT" --source $B --network $NET -- create \
  --buyer "$BUYER" --merchant "$MERCH" --token "$NATIVE" \
  --amount 1000000 --period_seconds 86400 --max_periods 0 --expires_at 0 --nonce "$NONCE" >/dev/null
echo "  sub created (nonce $NONCE)"

echo "=== approve() — buyer grants standing allowance to the contract (the ONE signature) ==="
SEQ=$(curl -s "https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['_embedded']['records'][0]['sequence'])")
EXP=$((SEQ + 500000))
stellar contract invoke --id "$NATIVE" --source $B --network $NET -- approve \
  --from "$BUYER" --spender "$CONTRACT" --amount 5000000 --expiration_ledger "$EXP" >/dev/null
echo "  allowance 0.5 XLM set, expires ledger $EXP"

bal() { curl -s "https://horizon-testnet.stellar.org/accounts/$1" | python3 -c "import sys,json;print([b['balance'] for b in json.load(sys.stdin)['balances'] if b['asset_type']=='native'][0])"; }
MB=$(bal "$MERCH")
echo "merchant XLM before: $MB"

echo "=== autocharge() — submitted by RELAYER (NOT buyer). Autonomy proof. ==="
stellar contract invoke --id "$CONTRACT" --source $R --network $NET -- autocharge --id "$NONCE"
MA=$(bal "$MERCH")
echo "merchant XLM after:  $MA"

echo "=== RESULT ==="
echo "  buyer:    $BUYER"
echo "  merchant: $MERCH (Δ should be +0.1 XLM)"
echo "  relayer (autocharge source, NOT buyer): $(stellar keys address $R)"
python3 -c "print('  delta:', round(float('$MA')-float('$MB'),7), 'XLM', '— AUTONOMOUS DEBIT CONFIRMED' if abs(float('$MA')-float('$MB')-0.1)<0.0001 else '— UNEXPECTED')"
echo "  contract: https://stellar.expert/explorer/testnet/contract/$CONTRACT"
