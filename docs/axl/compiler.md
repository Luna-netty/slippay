# axlc — the AXL compiler CLI

`axlc` is a thin wrapper over the `axl-compiler` library. The library never panics
on malformed input: every fallible step returns a `Result`, and the JSON parser
bounds nesting depth so adversarially deep input returns an error rather than
overflowing the stack.

```
axlc parse       <spec.axl>
axlc compile     <spec.axl> --tools <tools.json> --schemas <schemas.json>
axlc request     <spec.axl> --tools <tools.json> --schemas <schemas.json>
axlc enforce     <spec.axl> --tools <tools.json> --schemas <schemas.json> --ctx <ctx.json>
axlc prove       <spec.axl> [--emit-smt]
axlc certify     <spec.axl>
axlc verify-cert <spec.axl> --cert <cert.json>
```

Use `-` as `<spec.axl>` to read the spec from stdin.

## Exit codes

| code | meaning |
|---|---|
| 0 | ok (`prove` ISSUED, `certify` ISSUED, `verify-cert` VALID) |
| 1 | usage error or `CompileError` (parse/compile failure, bad flags, IO/JSON) |
| 2 | `enforce` found violations, `prove`/`certify` REFUSED, or `verify-cert` INVALID (drift) |

The split matters for CI: exit 2 is a fail-closed conformance verdict, not a crash.

## compile / request / enforce

- `compile` parses the spec, resolves `bind` against `tools.json` and `constrain`
  against `schemas.json`, and prints both the inference contract and the Anthropic
  request config (from `to_request_config`).
- `request` prints only the request config fragment.
- `enforce` additionally runs the `prove` predicates against `ctx.json` and prints
  `{ ok, violations }`. A violation yields exit 2.

These three do not touch SMT. Only `prove`, `certify`, and `verify-cert` involve
the solver.

## prove

`prove` requires the spec to declare an `invariant` directive (otherwise it is a
usage error — there is nothing to prove). It fails closed on an unsupported family
*before* announcing discharge, then detects a solver backend and discharges.

```
axlc prove axl-compiler/examples/agent_wallet_m2.axl
```

`--emit-smt` dumps the SMT-LIB obligations to stdout without invoking any solver
(offline inspection or golden capture).

### Solver detection (two backends, no crate dependency)

`detect_backend()` probes, in order:

1. the `z3` binary on `PATH` (`z3 -in`, SMT-LIB fed on stdin); else
2. `python3 -c` driving the installed `z3-solver` package
   (`z3.parse_smt2_string` + `Solver`, printing `sat`/`unsat`).

If neither is available, discharge returns `ProveError::NoSolver` and the caller
REFUSES. Absence of a checker is never a pass. Verdict parsing takes the last
`sat`/`unsat`/`unknown` token from solver stdout, so solver warnings or echoes do
not corrupt the result.

## SMT-LIB lowering (`smt.rs`)

`smt.rs` lowers a parsed `InvariantDecl` to SMT-LIB text. It only handles the
`sliding_window` family; anything else returns `CompileError::UnsupportedPolicy`
(fail-closed). `ceiling = 0` is also rejected, since a `0 * cap` aggregate ceiling
admits no positive charge.

The model is one charge under the sliding window. State is `(prev, cur)` = outflow
in the previous / current epoch. A charge of amount `a` (`0 < a <= per_tx`) after
`elapsed` seconds:

```
rolled        = elapsed >= W
p1            = rolled ? (elapsed < 2W ? cur : 0) : prev    # carry / drop / keep
c1            = rolled ? 0 : cur
eie           = rolled ? 0 : elapsed                        # elapsed-in-epoch
weighted_prev = floor(p1 * (W - eie) / W)                   # throughput shaping
accept        = (weighted_prev + c1 + a <= window_cap)      # weighted check
              AND (p1 + c1 + a <= M * window_cap)           # aggregate ceiling
c2            = c1 + a
```

The invariant being checked is:

```
invariant_K(p, c) = 0 <= p <= cap AND 0 <= c <= cap AND p + c <= K * cap
```

Install-time invariants asserted in the preamble mirror the deployed contract:
`window_cap > 0`, `per_tx > 0`, `per_tx <= window_cap`, `window_cap <= 100 * per_tx`,
`W >= 60`.

The emitter produces these obligations:

- **base** — `invariant_K(0, 0)` must hold; emitted as `assert (not base)`, expect
  `unsat`.
- **inductive** — assume `invariant_K(p, c)` and `accept`, prove
  `invariant_K(p1, c2)`; emitted as the assumptions plus the negated
  post-invariant, expect `unsat` (UNSAT-to-break means the bound is sound over all
  action sequences). This is the load-bearing obligation.
- **attainable** — pin `p1 + c2 == K * cap` under `accept`, expect `sat` (the
  bound is tight, not loose).
- **unbounded** — only for `ceiling = none`: `n` charges of `per_tx` exceed
  `K * cap` for arbitrary `K`, expect `sat`, which forces a refusal.

A helper, `emit_inductive_with_predecessor`, also emits the `K-1` inductive
obligation so the prover can decide minimality without re-walking the AST.

## Decision procedure (`prove.rs`)

`discharge(backend, inv)` reproduces the canonical decision procedure:

- **ceiling = none**: discharge the unbounded witness. `sat` (a witness exists)
  means outflow is unbounded, so REFUSE. `unsat`/`unknown` also REFUSE — a per-tx-only
  policy is never ISSUED.
- **ceiling = M**:
  1. The claimed bound `K` must be inductive (`unsat`). If not, REFUSE with the
     observed verdict in the reason.
  2. Tightness = attainable (`sat`) AND `K-1` not inductive. For `K <= 1` the
     predecessor is trivially unsound, matching the canonical model.
  3. If `M > K`, attach a diagnostic noting the nominal ceiling is looser than the
     proved bound (the weighted check binds tighter than the ceiling).

The result is `Certificate::Issued { ceiling, bound, tight, diagnostic }` or
`Certificate::Refused { reason }`.

## certify

`certify` runs the same discharge and emits a deterministic proof-carrying
certificate (JSON) to stdout. Exit 0 = ISSUED, 2 = REFUSED. The certificate is
emitted in both cases; the exit code lets CI gate on it.

```
axlc certify axl-compiler/examples/agent_wallet_m2.axl
```

### Certificate shape

The certificate binds the proof to the exact spec bytes. `kind` is
`"axl-proof-certificate"`. `spec_sha256` is a real, std-only SHA-256 of the spec
text (verified against NIST vectors). Field order is fixed for byte-level
determinism. An ISSUED certificate (for `agent_wallet_m2.axl`):

```json
{
  "kind": "axl-proof-certificate",
  "axl_version": "0.1.0",
  "spec_sha256": "<sha256 of the spec bytes>",
  "agent": "AgentWallet",
  "invariant": { "family": "sliding_window", "ceiling": 2, "bound": 2 },
  "verdict": "ISSUED",
  "tight": true,
  "diagnostic": null,
  "onchain": {
    "ssl_hash": "<same sha256 as spec_sha256>",
    "window_cap_multiplier": 2,
    "claim": "real-time window outflow <= 2 * window_cap",
    "matches_deployed_enforcement": true
  },
  "backend": "z3 binary (PATH) — `z3 -in` on stdin"
}
```

A REFUSED certificate omits `tight`, carries `refused_reason`, and sets
`onchain` to `null`.

The `onchain.window_cap_multiplier` carries the proved bound `K`.
`matches_deployed_enforcement` compares `K` against `ONCHAIN_ENFORCED_MULTIPLIER`
(a constant `= 2` in `certify.rs`). The `backend` field is recorded for
auditability but is metadata, not load-bearing: the verdict must reproduce, the
solver that produced it does not have to match.

## verify-cert

`verify-cert` re-hashes the spec, re-discharges the invariant, rebuilds the
certificate, and asserts that the provided certificate reproduces the recomputed
one on its load-bearing projection. Exit 0 = VALID, 2 = INVALID.

```
axlc verify-cert axl-compiler/examples/agent_wallet_m2.axl --cert cert.json
```

The load-bearing projection compared is: `kind`, `axl_version`, `spec_sha256`,
`agent`, `family`, `ceiling`, `bound`, `verdict`, `tight`, `onchain.ssl_hash`,
`onchain.window_cap_multiplier`. The `backend` and free-text `claim` are excluded,
so two certificates that differ only in solver still verify against each other.

A non-object certificate, or one missing required fields, projects to nothing and
verification fails (never a silent pass). Tampering with `bound` or supplying a
certificate minted for a different spec produces a named mismatch and exit 2. This
is the intended drift-catch: a CI merge-gate or a counterparty can reject any spec
whose proof no longer matches its certificate. Whether such a gate exists is a
separate question — see [proofs-and-limits.md](proofs-and-limits.md#honest-limitations).
