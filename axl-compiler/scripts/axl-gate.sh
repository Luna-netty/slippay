#!/usr/bin/env bash
#
# axl-gate — the forcing function that makes the AXL proof load-bearing.
#
# It fails the build (non-zero exit) unless ALL of the following hold:
#   1. the deployed agent policy still PROVES its bound (z3 re-discharge), and
#   2. the checked-in certificate reproduces from that policy (no proof/spec
#      drift), and
#   3. the constant the on-chain contract actually enforces equals the
#      certified `window_cap_multiplier` (no contract/proof drift).
#
# Without this gate the proof and the deployed enforcement are two independent
# numbers that can silently diverge. With it, changing one without the other
# turns CI red. This is what turns AXL from "an offline verifier" into a
# control that is checked on every change.
#
# Usage: axl-compiler/scripts/axl-gate.sh
# Exit:  0 = conformant; 1 = tooling/usage error; 2 = drift detected.

set -euo pipefail

# --- resolve paths relative to this script, so it runs from anywhere ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$CRATE_DIR/.." && pwd)"

POLICY="$CRATE_DIR/examples/agent_wallet_m2.axl"
CERT="$CRATE_DIR/certified/agent_wallet.cert.json"
CONTRACT="$REPO_DIR/contracts/smart-wallet/src/lib.rs"
AXLC="$CRATE_DIR/target/release/axlc"

fail()  { echo "axl-gate: FAIL — $*" >&2; exit 2; }
err()   { echo "axl-gate: ERROR — $*" >&2; exit 1; }
ok()    { echo "axl-gate: ok — $*"; }

# --- 0. preconditions ---------------------------------------------------------
[ -f "$POLICY" ]   || err "policy not found: $POLICY"
[ -f "$CERT" ]     || err "certificate not found: $CERT"
[ -f "$CONTRACT" ] || err "contract not found: $CONTRACT"

if ! command -v z3 >/dev/null 2>&1 && \
   ! python3 -c 'import z3' >/dev/null 2>&1; then
  err "no SMT solver (z3 binary or python3 z3-solver) — cannot discharge the proof; fail-closed"
fi

# --- 1. build axlc if needed --------------------------------------------------
if [ ! -x "$AXLC" ]; then
  echo "axl-gate: building axlc (release)..."
  ( cd "$CRATE_DIR" && cargo build --release --quiet )
fi
[ -x "$AXLC" ] || err "axlc binary missing after build: $AXLC"

# --- 2. re-discharge + verify the checked-in certificate ----------------------
# verify-cert re-emits the obligations, re-runs z3, and asserts the certificate
# reproduces (kind/sha256/family/ceiling/bound/verdict/tight/onchain match).
# exit 2 = drift; exit 0 = VALID.
if ! "$AXLC" verify-cert "$POLICY" --cert "$CERT"; then
  fail "checked-in certificate does not reproduce from $(basename "$POLICY") (proof/spec drift) — regenerate with: axlc certify $(basename "$POLICY") > $(basename "$CERT")"
fi
ok "certificate reproduces from policy (z3 re-discharged)"

# --- 3. contract bound == certified multiplier --------------------------------
# The contract pins the hard-ceiling multiplier into every session from the
# named constant `PROVED_WINDOW_MULTIPLIER` and reads it back in the hot path
# (window_cap.saturating_mul(session.window_cap_multiplier)). Extract the
# constant and compare it to the certified window_cap_multiplier.
CONTRACT_MULT="$(grep -oE 'PROVED_WINDOW_MULTIPLIER:[[:space:]]*u32[[:space:]]*=[[:space:]]*[0-9]+' "$CONTRACT" \
  | sed -E 's/.*=[[:space:]]*([0-9]+).*/\1/' | head -1 || true)"
[ -n "$CONTRACT_MULT" ] || fail "could not find 'const PROVED_WINDOW_MULTIPLIER: u32 = N' in $(basename "$CONTRACT") — the proved bound constant moved or was renamed; update this gate to match"

# Defense-in-depth: the hot path must read the session field, not a bare literal.
if ! grep -qE 'window_cap\.saturating_mul\(\s*s\.window_cap_multiplier' "$CONTRACT" \
   && ! grep -qE 'saturating_mul\(s\.window_cap_multiplier as i128\)' "$CONTRACT"; then
  fail "the hot path no longer reads s.window_cap_multiplier for the hard ceiling in $(basename "$CONTRACT") — a bare literal would decouple enforcement from the certified, per-session bound"
fi

CERT_MULT="$(grep -oE '"window_cap_multiplier"[[:space:]]*:[[:space:]]*[0-9]+' "$CERT" \
  | grep -oE '[0-9]+' | head -1 || true)"
[ -n "$CERT_MULT" ] || fail "certificate has no window_cap_multiplier — is it a REFUSED cert?"

if [ "$CONTRACT_MULT" != "$CERT_MULT" ]; then
  fail "DRIFT: contract enforces ${CONTRACT_MULT}x window_cap but the proof certifies ${CERT_MULT}x. The deployed bound and its proof disagree. Re-prove the policy or fix the contract so they are one number."
fi
ok "contract enforces ${CONTRACT_MULT}x window_cap == certified ${CERT_MULT}x bound"

echo "axl-gate: PASS — proof, policy, certificate, and on-chain bound are conformant."
