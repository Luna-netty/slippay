#!/usr/bin/env bash
# END-TO-END: the integrity ORACLE issues the attestation, the Stellar contract
# SETTLES with it. Proves the cross-chain product loop on testnet:
#   register surface -> /attest (oracle signs ONLY if in-surface) -> autocharge_attested settles.
# Plus the negative: oracle REFUSES an out-of-surface action -> no signature -> no charge.
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true
REPO="${SLIPPAY_REPO:-/home/galmanus/projects/slippay}"
ATT="$REPO/packages/slippay-attester"
WASM="$REPO/contracts/subscription/target/wasm32v1-none/release/slippay_subscription.wasm"
NET=testnet; TS=$(date +%s)
B=orc-buyer-$TS; M=orc-merch-$TS; R=orc-relayer-$TS; D=orc-dep-$TS

# oracle attestation helper: prints "PUBKEY NOT_AFTER SIGNATURE" for a clean action,
# or "REFUSED <reason>" when the oracle gates it. Uses the oracle's own code + key.
oracle() { # $1 subnonce  $2 recipient  $3 amount  $4 allowed_recipient
  ( cd "$ATT" && node --input-type=module -e "
import {sha256} from '@noble/hashes/sha256';
import {commitSurface, attest, publicKeyHex} from './src/oracle.mjs';
const priv = sha256(new TextEncoder().encode('slippay-attester-dev-seed'));
commitSurface({agent_id:'a7', allowed_recipients:['$4'], allowed_tools:['charge'], max_amount:'2000000'});
const pk = await publicKeyHex(priv);
const r = await attest({agent_id:'a7', subscription_id:'$1', charges_done:0, recipient:'$2', amount:'$3', tools_used:['charge']}, priv, {ttlSeconds:600});
if (r.ok) console.log(pk, r.not_after, r.signature);
else console.log('REFUSED', r.reason);
" )
}

echo "=== setup (testnet) ==="
for k in $D $B $M $R; do stellar keys generate "$k" --network $NET --fund >/dev/null 2>&1; done
BUYER=$(stellar keys address $B); MERCH=$(stellar keys address $M)
NATIVE=$(stellar contract id asset --asset native --network $NET)
CONTRACT=$(stellar contract deploy --wasm "$WASM" --source $D --network $NET 2>/dev/null | tail -1)
echo "  contract: $CONTRACT · merchant: $MERCH"
NONCE=$(printf 'd4%.0s' {1..32})
stellar contract invoke --id "$CONTRACT" --source $B --network $NET -- create \
  --buyer "$BUYER" --merchant "$MERCH" --token "$NATIVE" --amount 1000000 --period_seconds 86400 --max_periods 0 --expires_at 0 --nonce "$NONCE" >/dev/null
SEQ=$(curl -s "https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['_embedded']['records'][0]['sequence'])")
stellar contract invoke --id "$NATIVE" --source $B --network $NET -- approve \
  --from "$BUYER" --spender "$CONTRACT" --amount 5000000 --expiration_ledger $((SEQ+500000)) >/dev/null
echo "  sub created + allowance approved"

echo "=== NEGATIVE: ask oracle to attest a charge to a NON-committed recipient ==="
NEG=$(oracle "$NONCE" "GAFKDEADBEEFNOTTHEMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" 1000000 "$MERCH")
echo "  oracle says: $NEG"
[ "${NEG%% *}" = "REFUSED" ] && echo "  ✓ oracle refused out-of-surface action (no signature issued)" || { echo "  ✗ oracle should have refused"; exit 1; }

echo "=== POSITIVE: oracle attests the in-surface charge, then Stellar settles ==="
read OPUB ONA OSIG <<<"$(oracle "$NONCE" "$MERCH" 1000000 "$MERCH")"
echo "  oracle pubkey: $OPUB"
echo "  attestation:   not_after=$ONA sig=${OSIG:0:16}…"
# bind the ORACLE's key as the subscription's attester
stellar contract invoke --id "$CONTRACT" --source $M --network $NET -- set_attester --id "$NONCE" --attester "$OPUB" >/dev/null
echo "  oracle bound as on-chain attester"

bal() { curl -s "https://horizon-testnet.stellar.org/accounts/$1" | python3 -c "import sys,json;print([b['balance'] for b in json.load(sys.stdin)['balances'] if b['asset_type']=='native'][0])"; }
MB=$(bal "$MERCH")
# relayer submits; the ORACLE's attestation is what unlocks settlement
stellar contract invoke --id "$CONTRACT" --source $R --network $NET -- autocharge_attested \
  --id "$NONCE" --not_after "$ONA" --signature "$OSIG"
MA=$(bal "$MERCH")

echo "=== RESULT ==="
python3 -c "print('  merchant', '$MB', '->', '$MA', '| delta', round(float('$MA')-float('$MB'),7), 'XLM', '— ORACLE→STELLAR SETTLED' if abs(float('$MA')-float('$MB')-0.1)<1e-4 else '— UNEXPECTED')"
echo "  contract: https://stellar.expert/explorer/testnet/contract/$CONTRACT"
