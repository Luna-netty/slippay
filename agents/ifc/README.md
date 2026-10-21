# Mechanism 4 — Information-flow control (non-interference) for inter-agent composition

A static checker that **proves a declared inter-agent flow graph satisfies
non-interference**: no high-confidentiality / high-integrity datum reaches a
lower-cleared sink across an agent-to-agent channel without passing an explicit,
author-written **declassification** point.

Target attack class: covert collusion / steganographic escalation between
composed agents — the **Colosseum / Whispers** family — where agent A holds a
secret (a key, a PII record, a privileged instruction) and smuggles it to a
lower-trust agent C inside a message that is *labelled* low. There is no honest
label under which secret HIGH data may ride a LOW-cleared channel; the only
sanctioned way down the lattice is through a `declassify` node the graph author
wrote on purpose and an auditor can read.

## What's here

- `ifc.py` — the module:
  - **(a) lattice** — powerset-of-tags lattice. `label("key","pii")` is a
    `frozenset`. `join` = set union (least upper bound, the merge op).
    `leq(x, clearance)` = subset (`x` may flow to a sink cleared `clearance` iff
    every tag of `x` is in `clearance`). `PUBLIC` (empty set) is bottom.
    Genuine bounded lattice; chosen over a linear LOW<HIGH chain so that
    incomparable secrets (`{key}` vs `{pii}`) stay incomparable.
  - **(b) flow graph** — `Node` (kinds: `agent`, `source`, `sink`,
    `declassify`) + `Edge` (directed channel, optional `declared_label`).
    Agents carry `input_clearance` (what they may receive) and `output_label`
    (what they intrinsically originate). `declassify` carries `removes` (the
    tags it is permitted to strip).
  - **(c) `check_noninterference(graph) -> CheckResult{ ok, violations }`** —
    propagates labels along edges to a least fixpoint (join on merge), then flags
    every edge whose propagated source label is NOT `<=` the destination's
    clearance and that no declassify on the path covers. Pure, total, no panics:
    malformed graphs (dangling edges) are reported as violations, never raised.
- `test_ifc.py` — adversarial TDD. **16/16 passing** (pytest 8.3.4, Python
  3.10.12). Also runs without pytest via a fallback runner: `python3 test_ifc.py`.

Run:
```
python3 -m pytest agents/ifc/test_ifc.py -v      # 16 passed
python3 agents/ifc/test_ifc.py                   # fallback: 16 passed, 0 failed
```

## The four required guarantees, as tests

| Requirement | Test | Result |
|---|---|---|
| direct HIGH->LOW leak is flagged | `test_direct_high_to_low_leak_is_flagged` | flagged, reason `leak` |
| stego channel (HIGH on a LOW-labelled message) is flagged | `test_stego_channel_high_data_on_low_labelled_message_is_flagged` | flagged, reason `stego_mislabel` (the lie about the channel label is the smuggling signature) |
| legitimate flow through explicit declassify is allowed | `test_flow_through_explicit_declassify_is_allowed` | allowed |
| transitivity A->B->C enforced | `test_transitivity_high_origin_survives_a_relay` | B cannot launder A's `{key}` down to its own PUBLIC label; B->C flagged |

Plus: merge-join of two inputs, declassify strips only its declared tags (not a
blanket launder), cycles terminate (monotone fixpoint), dangling edges reported
not raised, empty graph OK, good-path pins (so a vacuously-reject or
vacuously-accept checker is caught).

## HONESTY — what this proves and what it does NOT

This is **static label propagation over a DECLARED flow graph**. Read these
limits before trusting it for anything real.

1. **It proves the DECLARED graph is safe — nothing more.** The guarantee is
   relative to the completeness of the declared model. For every channel you
   put in the graph, it shows the propagated (join-on-merge) source label is
   within the sink's clearance or is downgraded at an explicit declassify.

2. **It does NOT discover undeclared side channels.** If two agents share a
   covert timing / cache / message-length / token-count channel that nobody
   declared as an edge, this checker is blind to it — the same way a type system
   is blind to a Spectre gadget, or a build-time linter is blind to a runtime
   data race. *Disanalogy with a dynamic taint tracker:* a runtime IFC monitor
   observes the bytes that actually move and can catch an implicit flow as it
   happens; this is static and only sees what the author wrote down. **If your
   threat model includes channels the graph author did not enumerate, this
   mechanism does not cover them.** It raises the cost of *declared-channel*
   collusion to "you must write a visible declassify an auditor can see"; it
   does nothing about a channel that was never modelled.

3. **IFC over-rejects (false positives) — "label creep" is real.** Once a value
   joins with HIGH, the propagated label stays HIGH and poisons everything
   downstream, including flows that are semantically fine. The only cure is
   **designed declassification points**, and those are the trusted core:
   - A `declassify` node is *not* checked on its in-edges (it is, by
     construction, cleared to receive what it will downgrade — otherwise
     declassification is unreachable). This was an actual bug the TDD caught: the
     first implementation flagged `secrets -> redactor` as a leak before the
     redactor could strip anything. The fix makes declassify a trusted boundary.
   - Consequence: **a too-broad `removes` is a hole the checker waves through.**
     We prove a declassify *exists* and that its scope is bounded to declared
     tags; we **cannot** prove a declassify is *semantically justified*. Whether
     stripping `{pii}` at that point is actually safe is a human design call,
     not a theorem this module proves.

4. **Integrity is the dual, modelled but not separately exercised.** Tag an
   untrusted input and require high-integrity sinks to carry no untrusted tag;
   the same subset rule applies. The tests exercise the confidentiality reading.

5. **No cryptography, no runtime enforcement.** This is an analysis you run over
   a graph you build. It does not intercept real agent messages, does not sign
   anything, and does not stop a running agent. Wiring it as a gate
   (build-time check on a composition spec, or a pre-dispatch guard that refuses
   to compose agents whose declared graph fails) is out of scope here.

### Bottom line

`check_noninterference` is sound **with respect to the declared graph**: if it
returns `ok=True`, every declared channel respects the lattice or passes a
declared declassify. It is **not** a discovery tool for hidden channels, and its
declassification points are trusted inputs whose justification it cannot verify.
Use it to make inter-agent flows *auditable and non-interfering by construction*
on the channels you model — not as proof that no covert channel exists.
