#!/usr/bin/env bash
# Canonical SlipPay web deploy: build locally → rsync to prod → verify live bundle.
# Usage: bash scripts/deploy-web.sh
set -euo pipefail

PROD="manuel@165.22.10.194:/opt/slippay-backend/apps/web/dist/"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/web"

echo "▸ typecheck"
npx tsc --noEmit

echo "▸ build"
pnpm build

B=$(grep -oE '/assets/index-[A-Za-z0-9._-]+\.js' dist/index.html | head -1)
echo "▸ local bundle: $B"

echo "▸ rsync → prod ($PROD)"
rsync -az --checksum --delete dist/ "$PROD"

LIVE=$(curl -s --max-time 25 https://app.slippay.cc/ | grep -oE '/assets/index-[A-Za-z0-9._-]+\.js' | head -1 || true)
if [ "$(basename "${LIVE:-}")" = "$(basename "$B")" ]; then
  echo "✓ live matches: $LIVE"
else
  echo "✗ live=$LIVE expected=$B (CDN/propagation lag — re-check in ~30s)"
fi

echo "▸ route smoke test"
for p in "" account buy pay cobrar gate security manifesto investors cockpit dashboard; do
  printf "  /%s -> %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "https://app.slippay.cc/$p")"
done
