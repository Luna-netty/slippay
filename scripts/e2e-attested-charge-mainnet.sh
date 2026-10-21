#!/usr/bin/env bash
# MAINNET proof of the INTEGRITY GATE (autocharge_attested) on the live v0.4
# contract, in real USDC. The rail refuses to settle without a fresh, valid,
# sub-bound ed25519 attestation verified ON-CHAIN (44-byte message:
# id || charges_done(u32 BE) || not_after(u64 BE)). Reuses existing accounts to
# avoid funding new ones: buyer = deployer, merchant/submitter = relayer.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

RPC="https://mainnet.sorobanrpc.com"
PASS="Public Global Stellar Network ; September 2015"
SDK="apps/web/node_modules/@stellar/stellar-sdk"
CONTRACT="CCT3KJXRUO3HJJ2GLTW2MISSQVUEKOPUG3B4YQH75TCGKAOC4P6FIKUF"  # v0.5 gate+domain-sep
ISSUER="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
B=slippay-mainnet-deployer        # buyer (has USDC + trustline)
M=slippay-mainnet-relayer         # merchant + submitter (has USDC trustline + XLM gas)
BUYER=$(stellar keys address $B); MERCH=$(stellar keys address $M)
AMOUNT=500000                      # 0.05 USDC (7 decimals)
inv() { stellar contract invoke --id "$1" --source "$2" --rpc-url "$RPC" --network-passphrase "$PASS" -- "${@:3}"; }
USDC=$(stellar contract id asset --asset "USDC:$ISSUER" --rpc-url "$RPC" --network-passphrase "$PASS")
# domain commitment must match the deploy (slippay-domain-<SALT_TAG>|<passphrase>)
DOMAIN=$(node -e "const {hash}=require('./$SDK');console.log(hash(Buffer.from('slippay-domain-v5-gate|$PASS')).toString('hex'))")
echo "buyer=$BUYER merch=$MERCH  domain=${DOMAIN:0:16}…"
echo "USDC SAC=$USDC  contract=$CONTRACT"

NONCE=$(printf 'b5%.0s' {1..32})   # 64 hex = 32 bytes
echo "=== create() — buyer authorizes the subscription ==="
inv "$CONTRACT" "$B" create --buyer "$BUYER" --merchant "$MERCH" --token "$USDC" \
  --amount $AMOUNT --period_seconds 86400 --max_periods 0 --expires_at 0 --nonce "$NONCE" >/dev/null
echo "  created (nonce $NONCE)"

echo "=== approve() — buyer grants a standing USDC allowance (the ONE signature) ==="
SEQ=$(curl -s "https://horizon.stellar.org/ledgers?order=desc&limit=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['_embedded']['records'][0]['sequence'])")
inv "$USDC" "$B" approve --from "$BUYER" --spender "$CONTRACT" --amount 5000000 --expiration_ledger $((SEQ+500000)) >/dev/null
echo "  allowance set"

echo "=== generate attester (ed25519) + bind via set_attester (merchant auth) ==="
read ATT_PUB ATT_SECRET < <(node -e "const {Keypair}=require('./$SDK');const k=Keypair.random();console.log(k.rawPublicKey().toString('hex')+' '+k.secret());")
echo "  attester: $ATT_PUB"
inv "$CONTRACT" "$M" set_attester --id "$NONCE" --attester "$ATT_PUB" >/dev/null
echo "  attester bound"

# 76-byte message: domain(32) || id(32) || charges_done(u32 BE) || not_after(u64 BE)
sign() { node -e "const {Keypair}=require('./$SDK');const k=Keypair.fromSecret(process.argv[1]);const d=Buffer.from('$DOMAIN','hex');const n=Buffer.from(process.argv[2],'hex');const cd=Buffer.alloc(4);cd.writeUInt32BE(Number(process.argv[4]));const na=Buffer.alloc(8);na.writeBigUInt64BE(BigInt(process.argv[3]));console.log(k.sign(Buffer.concat([d,n,cd,na])).toString('hex'));" "$ATT_SECRET" "$2" "$3" "$4"; }
NOT_AFTER=$(( $(date +%s) + 3600 ))

ubal() { curl -s "https://horizon.stellar.org/accounts/$1" | python3 -c "import sys,json;b=json.load(sys.stdin)['balances'];print(next((x['balance'] for x in b if x.get('asset_code')=='USDC'),'0'))"; }

echo "=== BACK DOOR: plain autocharge after attester set → must REJECT ==="
if inv "$CONTRACT" "$M" autocharge --id "$NONCE" >/dev/null 2>&1; then
  echo "  ✗ UNEXPECTED: ungated autocharge accepted on a gated sub"; exit 1
else echo "  ✓ ungated autocharge REJECTED (gate is inescapable)"; fi

echo "=== NEGATIVE: tampered attestation (signed over wrong not_after) → must REJECT ==="
BAD=$(sign x "$NONCE" $((NOT_AFTER-1)) 0)
if inv "$CONTRACT" "$M" autocharge_attested --id "$NONCE" --not_after "$NOT_AFTER" --signature "$BAD" >/dev/null 2>&1; then
  echo "  ✗ UNEXPECTED: tampered attestation accepted"; exit 1
else echo "  ✓ tampered attestation REJECTED on-chain (fail-closed)"; fi

echo "=== POSITIVE: valid attestation (charges_done=0), submitted by relayer → must SETTLE ==="
MB=$(ubal "$MERCH")
GOOD=$(sign x "$NONCE" "$NOT_AFTER" 0)
inv "$CONTRACT" "$M" autocharge_attested --id "$NONCE" --not_after "$NOT_AFTER" --signature "$GOOD"
MA=$(ubal "$MERCH")

echo "=== RESULT ==="
echo "  merchant USDC: $MB -> $MA"
python3 -c "d=round(float('$MA')-float('$MB'),7);print('  delta:',d,'USDC','— ATTESTED CHARGE + FEE ON MAINNET CONFIRMED' if abs(d-0.04703)<1e-4 else '— check (expected merchant +0.04703 net of 2.97% fee)')"
echo "  contract: https://stellar.expert/explorer/public/contract/$CONTRACT"
