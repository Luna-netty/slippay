#!/usr/bin/env bash
# On-chain proof of the INTEGRITY GATE (autocharge_attested) on Stellar TESTNET.
# The rail refuses to settle without a fresh, valid, sub-bound ed25519 attestation
# verified ON-CHAIN. Attester = a Stellar Keypair (which IS ed25519). The relayer
# (not the buyer, not the attester) submits the charge.
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true

NET=testnet
SDK=apps/web/node_modules/@stellar/stellar-sdk
WASM=contracts/subscription/target/wasm32v1-none/release/slippay_subscription.wasm
TS=$(date +%s)
B=att-buyer-$TS; M=att-merch-$TS; R=att-relayer-$TS; D=att-deployer-$TS

echo "=== fund ephemeral testnet accounts ==="
for k in $D $B $M $R; do stellar keys generate "$k" --network $NET --fund >/dev/null 2>&1; done
BUYER=$(stellar keys address $B); MERCH=$(stellar keys address $M)
echo "  buyer=$BUYER merch=$MERCH relayer=$(stellar keys address $R)"

NATIVE=$(stellar contract id asset --asset native --network $NET)
echo "=== deploy v0.3 contract ==="
CONTRACT=$(stellar contract deploy --wasm "$WASM" --source $D --network $NET 2>/dev/null | tail -1)
echo "  contract: $CONTRACT"

NONCE=$(printf 'b2%.0s' {1..32})  # 64 hex
stellar contract invoke --id "$CONTRACT" --source $B --network $NET -- create \
  --buyer "$BUYER" --merchant "$MERCH" --token "$NATIVE" \
  --amount 1000000 --period_seconds 86400 --max_periods 0 --expires_at 0 --nonce "$NONCE" >/dev/null
SEQ=$(curl -s "https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['_embedded']['records'][0]['sequence'])")
stellar contract invoke --id "$NATIVE" --source $B --network $NET -- approve \
  --from "$BUYER" --spender "$CONTRACT" --amount 5000000 --expiration_ledger $((SEQ+500000)) >/dev/null
echo "  sub created + allowance approved"

echo "=== generate attester (ed25519) + bind via set_attester ==="
read ATT_PUB ATT_SECRET < <(node -e "const {Keypair}=require('./$SDK');const k=Keypair.random();console.log(k.rawPublicKey().toString('hex')+' '+k.secret());")
echo "  attester pubkey: $ATT_PUB"
stellar contract invoke --id "$CONTRACT" --source $M --network $NET -- set_attester \
  --id "$NONCE" --attester "$ATT_PUB" >/dev/null
echo "  attester bound to sub"

NOT_AFTER=$(( $(date +%s) + 3600 ))   # fresh: 1h ahead of ledger unix time
sign() { node -e "const {Keypair}=require('./$SDK');const k=Keypair.fromSecret(process.argv[1]);const n=Buffer.from(process.argv[2],'hex');const a=Buffer.alloc(8);a.writeBigUInt64BE(BigInt(process.argv[3]));console.log(k.sign(Buffer.concat([n,a])).toString('hex'));" "$ATT_SECRET" "$2" "$3"; }

bal() { curl -s "https://horizon-testnet.stellar.org/accounts/$1" | python3 -c "import sys,json;print([b['balance'] for b in json.load(sys.stdin)['balances'] if b['asset_type']=='native'][0])"; }

echo "=== NEGATIVE: tampered attestation (sig over wrong not_after) → must REJECT ==="
BAD_SIG=$(sign x "$NONCE" $((NOT_AFTER-1)))
if stellar contract invoke --id "$CONTRACT" --source $R --network $NET -- autocharge_attested \
     --id "$NONCE" --not_after "$NOT_AFTER" --signature "$BAD_SIG" >/dev/null 2>&1; then
  echo "  ✗ UNEXPECTED: tampered attestation was accepted"; exit 1
else
  echo "  ✓ tampered attestation REJECTED on-chain (fail-closed)"
fi

echo "=== POSITIVE: valid attestation, submitted by RELAYER → must SETTLE ==="
MB=$(bal "$MERCH")
GOOD_SIG=$(sign x "$NONCE" "$NOT_AFTER")
stellar contract invoke --id "$CONTRACT" --source $R --network $NET -- autocharge_attested \
  --id "$NONCE" --not_after "$NOT_AFTER" --signature "$GOOD_SIG"
MA=$(bal "$MERCH")

echo "=== RESULT ==="
echo "  merchant: $MB -> $MA"
python3 -c "print('  delta:', round(float('$MA')-float('$MB'),7),'XLM','— ATTESTED AUTONOMOUS DEBIT CONFIRMED' if abs(float('$MA')-float('$MB')-0.1)<1e-4 else '— UNEXPECTED')"
echo "  contract: https://stellar.expert/explorer/testnet/contract/$CONTRACT"
