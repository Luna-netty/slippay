# AXL

AXL is a small declarative DSL for agent policy. One `agent { ... }` block compiles
into one inference contract whose load-bearing checks are code and proof, not the
model's own promise. It does not invent inference primitives. It unifies four
existing mechanisms (capability scoping, structured output, deterministic checks,
SMT verification) behind one syntax and adds the discipline that the safety-relevant
parts run outside the model's reach.

The reference implementation is `axl-compiler/`, a standalone Rust crate (edition
2021, std-only, zero external dependencies — hand-rolled lexer/parser, JSON
parser+serializer, predicate engine, SHA-256). The CLI binary is `axlc`. See
[compiler.md](compiler.md) for the commands and [proofs-and-limits.md](proofs-and-limits.md)
for exactly what is and is not proved.

## Status (read this first)

This is a research and proof tool, not a deployed system.

- Build/test-only. There is no on-chain artifact. The smart-wallet contract has
  no dependency on `axl-compiler` and never reads an AXL certificate.
- The SMT-discharged property is the sliding-window epoch-state invariant. The
  family lowered to SMT is `sliding_window` and nothing else; every other policy
  is fail-closed rejected.
- The proof requires an external z3 solver at run time. The crate compiles with
  zero dependencies; the solver is a runtime dependency.
- Zero downstream adoption today. The certificate is not a required CI gate
  anywhere. See [proofs-and-limits.md](proofs-and-limits.md#honest-limitations).

## The agent block

```
agent Settlement {
  bind      -> [read_balance, propose_settlement]    # capability scope
  constrain -> SettlementDecision                    # output schema
  prove     -> decision.amount <= account.balance    # decidable predicate
  prove     -> decision.recipient in account.allowlist
  invariant -> sliding_window(ceiling = 2) bound 2   # policy bound, SMT-discharged
}
```

`axlc` lowers this block to: a filtered `tools` array, an `output_config.format`
JSON schema, a set of deterministic predicate checkers, and (for `invariant`) an
SMT-LIB proof obligation discharged by z3.

## The four directives

Each directive's guarantee is meant to hold even if the agent's model is fully
compromised (prompt injection, jailbreak), because none of them depends on the
model behaving. They are enforced by the request builder and by code/solvers
outside the model.

### `bind` -> [tools]

Compiles a capability list against a tool registry into the exact `tools=[...]`
array passed to the model. A capability that is not bound has no schema in the
action space, so the model cannot emit a valid tool call for it. Default-deny,
fail-closed: an unknown capability is a `CompileError::UnknownCapability`, never
a silent drop.

### `constrain` -> Schema

Compiles a named schema into `output_config.format = {type: "json_schema",
schema}` (engine-enforced constrained decoding) plus strict tool definitions.
Fail-closed: a strict schema must declare `additionalProperties: false`, or the
compiler refuses with `StrictSchemaNeedsAdditionalPropertiesFalse`. Honest
boundary: this enforces output *shape*, not output *values*. Constraining values
(only allowlisted recipients are emittable) is a stronger, separate mechanism and
needs an engine you control.

### `prove` -> <predicate>

Compiles a predicate (`lhs op rhs`, with `op` in `<= < >= > == != in`, operands
are dotted paths / numbers / strings) into a deterministic checker. At run time,
`enforce(contract, ctx)` runs every predicate and rejects an output that violates
one. The discipline: decidable money logic (`amount <= balance`,
`recipient in allowlist`) compiles to code, never to an LLM judge. AXL applies
only to decidable predicates; irreducibly fuzzy judgment ("is this suspicious?")
is out of scope.

### `invariant` -> sliding_window(ceiling = M) bound K

The only directive sent to SMT, and the only policy family supported. Declares a
sliding-window spending policy with aggregate ceiling `M * window_cap` and a
claimed real-time-window bound `K * window_cap`. The compiler lowers it to SMT-LIB
and discharges it with z3, reporting `ISSUED K` or `REFUSED`. Any other family
(for example `token_bucket`) is rejected with `CompileError::UnsupportedPolicy`
before any solver runs. See [proofs-and-limits.md](proofs-and-limits.md) for the
decision procedure and what the bound means.

## Worked example

From `axl-compiler/examples/agent_wallet_m2.axl`:

```
agent AgentWallet {
  bind      -> [read_balance, propose_payment]
  invariant -> sliding_window(ceiling = 2) bound 2
}
```

Discharge it:

```
axlc prove axl-compiler/examples/agent_wallet_m2.axl
```

This claims that under an aggregate ceiling of `2 * window_cap`, total outflow in
any real-time window of length `W` is bounded by `2 * window_cap`. z3 confirms the
inductive step is `unsat` (sound over all action sequences), the bound is attained
(tight), and `K = 1` is not inductive (minimal), so the verdict is `ISSUED K = 2`.

Three contrasting examples ship alongside it:

- `agent_wallet_m1.axl` — `ceiling = 1`, `bound 1`. A stricter policy.
- `agent_wallet_m3.axl` — `ceiling = 3`, `bound 2`. The nominal ceiling is looser
  than the proved bound; the certificate carries a diagnostic.
- `agent_wallet_none.axl` — `ceiling = none`. No aggregate cap, so outflow is
  unbounded; the verdict is `REFUSED` (fail-closed).
- `agent_wallet_unsupported.axl` — `token_bucket(...)`. Rejected before the solver
  runs (`UnsupportedPolicy`).

## Relation to the smart-wallet's sliding-window bound

The smart-wallet contract (`contracts/smart-wallet`, Soroban, testnet only) uses
an O(1) sliding-window counter for an agent session's spending. It keeps the
current epoch spend (`cur_spent`) and the previous epoch spend (`prev_spent`),
and estimates the rolling spend as a time-weighted sum. A delayed straddle across
an epoch boundary can place up to roughly `2 * window_cap` of spend into a single
real `W`-length interval, so the contract enforces a hard un-weighted ceiling
`prev_spent + cur_spent + amount <= 2 * window_cap`
(see `contracts/smart-wallet/src/lib.rs`, audit note A3).

The `K = 2` that AXL proves for `sliding_window(ceiling = 2)` is the same `2x`
real-time-window constant the contract enforces. The relationship is intentional
but informational only: the contract does not import `axl-compiler` and does not
read any certificate. AXL re-derives and machine-checks the bound the contract
already hard-codes; it does not feed it. The honest gap is in
[proofs-and-limits.md](proofs-and-limits.md#honest-limitations).
