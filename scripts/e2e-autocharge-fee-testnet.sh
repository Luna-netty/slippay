#!/usr/bin/env bash
# On-chain proof of the v0.4 PLATFORM FEE on the autonomous rail (Stellar TESTNET).
# Deploys with the constructor (platform, fee_bps=297), runs an autocharge, and
# asserts the split: merchant receives amount-fee, platform receives fee, both
# pulled from the buyer's one standing allowance. Native XLM SAC (no trustline).
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
source "$HOME/.cargo/env" 2>/dev/null || true

NET=testnet
WASM=contracts/subscription/target/wasm32v1-none/release/slippay_subscription.wasm
TS=$(date +%s)
B=fee-buyer-$TS; M=fee-merch-$TS; R=fee-relayer-$TS; D=fee-deployer-$TS; P=fee-platform-$TS
AMOUNT=1000000          # 0.1 XLM (stroops)
FEE_BPS=297             # 2.97%
FEE=$((AMOUNT * FEE_BPS / 10000))   # 29700 stroops = 0.00297 XLM
NET_TO_MERCH=$((AMOUNT - FEE))      # 970300 stroops = 0.09703 XLM

echo "=== fund ephemeral testnet accounts (friendbot) ==="
for k in $D $B $M $R $P; do stellar keys generate "$k" --network $NET --fund >/dev/null 2>&1; echo "  $k -> $(stellar keys address $k)"; done
BUYER=$(stellar keys address $B); MERCH=$(stellar keys address $M); PLAT=$(stellar keys address $P)

NATIVE=$(stellar contract id asset --asset native --network $NET)
echo "=== native SAC: $NATIVE ==="

echo "=== deploy v0.4 WITH constructor (platform=$PLAT, fee_bps=$FEE_BPS) ==="
CONTRACT=$(stellar contract deploy --wasm "$WASM" --source $D --network $NET -- --platform "$PLAT" --fee_bps $FEE_BPS 2>/dev/null | tail -1)
echo "  contract: $CONTRACT"

NONCE=$(printf 'fe%.0s' {1..32})
echo "=== create() ==="
stellar contract invoke --id "$CONTRACT" --source $B --network $NET -- create \
  --buyer "$BUYER" --merchant "$MERCH" --token "$NATIVE" \
  --amount $AMOUNT --period_seconds 86400 --max_periods 0 --expires_at 0 --nonce "$NONCE" >/dev/null
echo "  sub created"

echo "=== approve() — buyer grants standing allowance (the ONE signature) ==="
SEQ=$(curl -s "https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['_embedded']['records'][0]['sequence'])")
EXP=$((SEQ + 500000))
stellar contract invoke --id "$NATIVE" --source $B --network $NET -- approve \
  --from "$BUYER" --spender "$CONTRACT" --amount 5000000 --expiration_ledger "$EXP" >/dev/null
echo "  allowance 0.5 XLM set"

bal() { curl -s "https://horizon-testnet.stellar.org/accounts/$1" | python3 -c "import sys,json;print([b['balance'] for b in json.load(sys.stdin)['balances'] if b['asset_type']=='native'][0])"; }
MB=$(bal "$MERCH"); PB=$(bal "$PLAT")
echo "merchant before: $MB | platform before: $PB"

echo "=== autocharge() — submitted by RELAYER (not buyer) ==="
stellar contract invoke --id "$CONTRACT" --source $R --network $NET -- autocharge --id "$NONCE"
MA=$(bal "$MERCH"); PA=$(bal "$PLAT")
echo "merchant after:  $MA | platform after:  $PA"

echo "=== RESULT (expect merchant +$NET_TO_MERCH stroops, platform +$FEE stroops) ==="
python3 - "$MB" "$MA" "$PB" "$PA" "$NET_TO_MERCH" "$FEE" <<'PY'
import sys
mb,ma,pb,pa,net,fee = sys.argv[1:7]
md = round((float(ma)-float(mb))*1e7)
pd = round((float(pa)-float(pb))*1e7)
print(f"  merchant delta: {md} stroops (expected {net})")
print(f"  platform delta: {pd} stroops (expected {fee})")
ok = abs(md-int(net))<=2 and abs(pd-int(fee))<=2
print("  FEE CAPTURE ON-CHAIN:", "CONFIRMED ✓" if ok else "UNEXPECTED ✗")
PY
echo "  contract: https://stellar.expert/explorer/testnet/contract/$CONTRACT"
