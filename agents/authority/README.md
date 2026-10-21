# AuthorityAgent — the authorization gate

The gate for every Slippay charge: *did the merchant ask what they asked, and
did the buyer consent to what they consented?* It is a **pure decision function
with no money capability** — its worst-case blast radius is denial-of-service,
never loss.

## Architecture — teeth in code, policy in spec

This agent is delivered as a **pair**, deliberately:

| file | role |
|---|---|
| `authorize.mjs` | **the teeth.** The security boundary. Holds even if the calling agent is fully compromised. |
| `authority.ssl` | **the readable policy.** What an auditor reads. Each assertion names the code that enforces it. |
| `authorize.test.mjs` | 5 adversarial tests. `node --test agents/authority/authorize.test.mjs` → 5/5. |

Why this split: for a money system, an SSL `@assertion` is **not** a security
boundary — a compromised agent cannot be trusted to honor its own assertions.
The boundary is the function it cannot control: a signature check it cannot
forge and a consent digest it cannot match. The `.ssl` makes the policy
auditable; the `.mjs` makes it true. If they disagree, the code wins.

## Threat model — COVERED (by construction, not patch)

- **IPI via merchant metadata** (Whispers of Wealth, arXiv:2601.22569; Greshake
  et al. IPI) → the signed payload is fixed-order typed scalars; free-text
  merchant fields are never authenticated and never branch the decision.
  Defeated structurally, not by a token blocklist. Test: `free-text … is inert`.
- **Slow-drift** (subscription terms mutate silently across renewal cycles) →
  every intent is bound to the buyer's *original* consent digest, recomputed
  per charge. A raised amount or redirected recipient fails even when validly
  signed by the merchant. Test: `amount drifted above consent is rejected`.
- **Forged origin** (string "from: merchant" spoof) → ed25519 signature against
  the merchant's registered key. Test: `intent signed by a non-merchant key`.
- **Replay** (re-submit a captured intent) → nonce authorizes at most once.
  Test: `replayed nonce is rejected`.
- **MINJA / memory hijack** of the consent anchor → the comparison target is the
  immutable digest captured at mandate open, never the current in-memory amount;
  `consent_digests` is read-only after open.

## Threat model — EXPLICITLY NOT covered here (honesty > performative completeness)

- **Multi-agent collusion** at the decision layer — out of scope for this agent.
  Bounded elsewhere: the on-chain wallet cap+allowlist limits the blast radius of
  any collusion regardless of messaging; routing/observation is AntiAbuseAgent.
- **Counterparty / KYT risk scoring** — not here. That is a separate policy
  (`@counterparty`) and lives in the drift detector (`eval/`), pending the
  ROC-gated decision on whether it earns parser primitives.
- **Egress / covert channel** caps — not here; output-side concern.
- **On-ramp / KYC / câmbio licensing** — not a code problem. Partner + legal.
- **The `.ssl` runtime** — Slippay has no SSL interpreter today. `authority.ssl`
  is the auditable spec; the executing enforcement is `authorize.mjs`. Wiring the
  `.ssl` to a runtime (Wave prod, or a slippay-side interpreter) is a separate,
  coupling-bearing decision and is **not** done.

## Status

`authorize.mjs` is tested (5/5) but **not yet wired into the live charge path**
(`supabase/functions/api` billing/subscription routes). Wiring = the next step:
call `authorizeIntent` before any settlement, persist `seen_nonces`, capture
`consentDigest` at mandate creation.
