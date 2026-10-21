# AXL — proofs and limits

This page states exactly what AXL proves, what the proof-carrying certificate
binds, and what is not done today. It is deliberately conservative: AXL is a
research and proof tool, not a deployed system.

## What is proved

The only directive sent to SMT is `invariant -> sliding_window(ceiling = M) bound K`.
For that family, z3 discharges the epoch-state invariant:

```
invariant_K(prev, cur) = 0 <= prev <= cap AND 0 <= cur <= cap AND prev + cur <= K * cap
```

The inductive step shows that under the `accept` predicate (the weighted
throughput check AND the aggregate ceiling `M * window_cap`), every accepted charge
preserves `invariant_K`. UNSAT-to-break means the bound holds over all action
sequences, not just sampled ones. The certified bound for `ceiling = 2` is
`K = 2`: total outflow in any real-time window of length `W` is bounded by
`2 * window_cap`.

The `2x` is not a loose safety margin. It comes from the sliding-window straddle:
spend up to `window_cap` just before an epoch boundary, then up to `window_cap`
just after, and both land inside a single real `W`-length interval. The bound is
proved tight (attainable) and minimal (`K = 1` is not inductive).

The proof is over mathematical integers. The contract's saturating `i128`
arithmetic only rejects more, so the bound is preserved on-chain.

## What is not proved (the modeling seam)

z3 discharges the epoch-state invariant on the `(prev, cur)` model. The step from
that to the real-time sliding-window guarantee relies on an overlap premise: a
window of length `W` touches at most two adjacent epochs, because epoch rolls fire
only at `elapsed >= W`. That premise is a stated geometric lemma, not separately
mechanized in this crate. The model encodes it (the `p1` carry/drop/keep
definition), but the lemma itself is an argument, not a discharged obligation.

AXL applies only to decidable policy (arithmetic, membership, bounded state). For
irreducibly fuzzy judgment it does not apply and an LLM remains necessary; those
judgments are not proofs.

## The proof-carrying certificate

`axlc certify` emits a deterministic JSON certificate; `axlc verify-cert`
re-discharges and asserts byte-equality on the load-bearing projection. Three
bindings matter:

- **spec_sha256** — a real SHA-256 of the exact spec bytes. A certificate minted
  for one spec does not verify against another spec's recomputed certificate; the
  mismatch is named (`spec_sha256`).
- **onchain block** — `onchain.window_cap_multiplier` carries the proved bound
  `K`, and `onchain.ssl_hash` equals `spec_sha256`. The intent is that a
  conformance test could read `K` from the certificate instead of hard-coding a
  literal.
- **ONCHAIN_ENFORCED_MULTIPLIER = 2** — a constant in `certify.rs`. The certificate
  sets `matches_deployed_enforcement = (K == 2)`, comparing the proved bound
  against the multiplier the smart-wallet contract hard-codes
  (`prev_spent + cur_spent + amount <= 2 * window_cap`).

`verify-cert` is the substrate a CI merge-gate or a third-party auditor would run
to catch drift between a deployed bound and its proof.

## Honest limitations

This is the load-bearing section. The certificate machinery is real and the tests
are green, but the moat thesis around it does not hold today. The summary below
follows the `axl-compiler/MOAT_EVOLUTION_2026_06_02.md` synthesis.

**The proof is not the moat.** The z3 model is roughly 40 lines of SMT. A
competent formal-verification engineer ports it in engineer-weeks. There is no
legal or algorithmic barrier (disanalogy with a patent: a patent makes replication
illegal; a ported SMT model makes it merely some weeks of work). The only durable
barrier would be adoption of the certificate as a standard or required-to-participate
forcing function, and that adoption does not exist.

Three concrete gaps, found in the code:

1. **The `axl-gate` CI check is real (closed 2026-06-26).** `.github/workflows/axl-gate.yml`
   runs on every PR/push touching `axl-compiler/**` or `contracts/smart-wallet/src/lib.rs`:
   it builds `axlc`, runs `cargo test`, then runs `axl-compiler/scripts/axl-gate.sh`, which
   (a) re-discharges the proof with z3 and asserts the checked-in certificate
   (`axl-compiler/certified/agent_wallet.cert.json`) reproduces via `verify-cert`, and
   (b) extracts the integer `N` from `window_cap.saturating_mul(N)` in the contract and
   asserts it equals the certified `window_cap_multiplier`. Validated to go red on contract
   drift, on certificate tamper, and to pass clean. The proof can no longer silently drift
   from the deployed bound at build time.

2. **The enforced bound is now on-chain state bound to ssl_hash (closed on testnet
   2026-06-26).** The contract no longer uses a source literal. The hard ceiling
   multiplier is stored per session (`AgentSession.window_cap_multiplier`), pinned at
   install to the named const `PROVED_WINDOW_MULTIPLIER` and bound alongside `ssl_hash`,
   and read back by the hot path (`window_cap.saturating_mul(s.window_cap_multiplier)`).
   `axl-gate.sh` binds the const to the certified `window_cap_multiplier` AND asserts the
   hot path reads the session field. Demonstrated on Stellar testnet: contract
   `CCJXPLDPFMHYJIN6PTYQUNCP2ZTS52JK4WVRBKRHLXF2S6JFFVKYRDHN`, a session installed with
   the certified `ssl_hash 0415df30…e35e3be` reads back `window_cap_multiplier: 2`
   (install tx `6b57021b…007ae8`). Residual: the contract enforces the stored value but
   does not re-verify the SMT proof on-chain (z3 on-chain is infeasible); trust reduces to
   "installed multiplier == certified," made auditable by the on-chain record + the gate.
   The **mainnet** wallet still runs the prior literal-`2` contract pending a deliberate
   redeploy.

3. **`ssl_hash` is provenance-only.** The smart-wallet contract pins `ssl_hash`
   immutably but does not interpret it, and the contract crate has no dependency on
   `axl-compiler`. A spend is not cryptographically tied to the proved policy. The
   certificate provides a real SHA-256 that *could* be threaded as `ssl_hash`, but
   the deployment scripts are not rewired to do so.

Additional caveats:

- **Build-only, no on-chain artifact.** AXL produces certificates on disk. Nothing
  about AXL is deployed on-chain, and the chain enforces nothing about the proof.
- **Zero downstream adoption.** No second prover, no insurer, no on-chain
  certificate registry consumes these certificates. A standard with no adopters is
  not a standard.
- **Solver is a runtime dependency.** `prove` / `certify` / `verify-cert` require
  z3 (binary or the `z3-solver` Python package) at run time. The crate itself
  compiles with zero dependencies.

## Where this leaves AXL

What survives honestly: the certificate is useful audit and CI rigor — a real
provenance hash plus a drift-catching verification command — and a necessary
precondition for any future standard built on top of it. It is not the standard,
and the on-chain enforcement half is not built. Treat AXL as a verifier you can
run offline against a spec, not as a control that is in any production path today.
