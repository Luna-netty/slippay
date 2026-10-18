# Verify a certificate (`/verify` and offline `slippay_verify`)

A SlipPay agent spending bound is not a number someone typed. It is a theorem,
recorded in a proof-carrying certificate. `/verify` lets a third party re-check
that certificate in their own browser, with nothing sent to a server. The same
check runs offline through the `slippay_verify` tool in `@slippay/mcp`.

Source: `apps/web/src/pages/Verify.tsx`, `apps/web/src/lib/axlVerify.ts`. The
certificate format is produced by `axl-compiler` (`certify.rs`). See also
[../axl.md](../axl.md).

## What a certificate contains

A certificate is deterministic JSON. The fields that matter for verification:

- `kind` — `"axl-proof-certificate"`.
- `spec_sha256` — SHA-256 of the agent spec the certificate covers.
- `agent` and `invariant` — `{ family, ceiling, bound }`. Today the only
  supported family is `sliding_window`.
- `verdict` — `"ISSUED"` when the proof discharged.
- `tight` — whether the proved bound is attainable (minimal).
- `onchain` — `{ ssl_hash, window_cap_multiplier, ... }`, binding the proof to
  the enforced bound.

## What `/verify` does (and does not) do

Paste a certificate and the agent spec it claims to cover. Everything runs in the
browser. `reverifyCert()` performs three groups of checks.

### (a) Spec to certificate binding (SHA-256)

The page re-hashes the pasted spec with the browser's WebCrypto SHA-256 and
compares it to the certificate's `spec_sha256`. If they match, the certificate
covers exactly this spec. Change one byte of either and this goes red. This check
is zero-trust: it runs in the reader's browser and produces the reader's own
result.

### (b) Structural coherence

- `kind` is the expected certificate kind.
- `verdict` is `ISSUED`.
- `onchain.ssl_hash` equals `spec_sha256` (the on-chain binding points at the
  same spec).
- `onchain.window_cap_multiplier` equals the proved `bound` (the enforced
  multiplier matches the proved theorem).

### (c) Regenerate the exact proof obligations

From the certificate's `(family, ceiling, bound)`, the page regenerates the exact
SMT-LIB obligations the compiler discharged. `axlVerify.ts` is a faithful TS port
of `axl-compiler/src/smt.rs`, so the emitted text is byte-for-byte what
`axlc prove --emit-smt` produces:

- **base case** — `invariant_K(0,0)` holds (expect `unsat` on its negation).
- **inductive step** — the bound is sound for every reachable state (expect
  `unsat`).
- **attainability** — the bound is tight / attainable (expect `sat`).
- when `bound > 1`, **predecessor not sound** — `K-1` is not inductive, proving
  the bound is minimal (expect `sat`).

Each obligation is shown in full and is copy-runnable in any z3 (`z3 -in`).

## What green and red mean

- **Green** — the spec-to-certificate binding holds and the structural coherence
  checks pass. The certificate matches the spec, and the obligations shown are the
  exact theorems the proof claims.
- **Red** — one of the binding or coherence checks failed. The page shows which
  one. A hash mismatch means the spec and certificate do not correspond.

## The honest limit: no in-browser solver yet

`/verify` does **not** run a solver. It proves two things:

1. the certificate is well-formed and matches the spec (binding + coherence), and
2. the obligations are well-formed and are the exact theorems the compiler said
   it discharged.

It does **not**, in the browser, re-run z3 to confirm those obligations are
actually `unsat`/`sat`. To get a live solver discharge today, paste the shown
obligations into a real z3, or run the compiler's `axlc verify-cert`, which
re-hashes and re-discharges via a z3 subprocess. In-browser z3 (wasm) is a
planned next layer; until it ships, the green badge means "binding and coherence
hold and the theorems are well-formed", not "a solver just re-proved them here".

## Offline path: `slippay_verify` in `@slippay/mcp`

`slippay_verify` is the agent-facing tool that performs the same offline
re-verification of a certificate. It is exposed to agents (it is a read-only
check, not a setup verb), so an agent or its auditor can re-check a bound without
trusting SlipPay. See [../../packages/slippay-mcp/README.md](../../packages/slippay-mcp/README.md)
and [agent-surface](../product/agent-surface.md).

## Status and honest limitations

- No solver runs in the browser yet. `/verify` checks binding, coherence, and
  obligation well-formedness only.
- `axl-compiler` is build/test-only. There is no on-chain artifact of the
  compiler, the certificate is not enforced as a required CI gate, and there is no
  downstream adoption today. The proof is re-checkable, but it is not yet a
  required-to-participate standard.
