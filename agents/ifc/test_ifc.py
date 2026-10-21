"""Adversarial TDD for the inter-agent information-flow / non-interference
checker.

Each test is one threat or one algebra law:

  - a direct HIGH->LOW leak is FLAGGED;
  - a stego channel (HIGH data smuggled on a message *labelled* LOW) is FLAGGED,
    and with the more specific ``stego_mislabel`` reason;
  - a legitimate flow through an explicit declassify point is ALLOWED;
  - transitivity (A->B->C) is enforced (label creep survives a relay);
  - the good paths are pinned so a checker that vacuously rejects everything (or
    vacuously accepts everything) is caught.

Run: ``python3 -m pytest agents/ifc/test_ifc.py -v``
  or ``python3 agents/ifc/test_ifc.py``  (tiny fallback runner)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ifc import (  # noqa: E402
    Edge,
    FlowGraph,
    PUBLIC,
    agent,
    check_noninterference,
    declassify,
    join,
    join_all,
    label,
    leq,
    sink,
    source,
)

# Category tags used across the suite.
KEY = label("key")
PII = label("pii")
AUDIT = label("audit")
KEY_PII = label("key", "pii")


# ---------------------------------------------------------------------------
# (a) lattice algebra — the rules the whole checker rests on
# ---------------------------------------------------------------------------
def test_join_is_union_and_public_is_bottom():
    assert join(KEY, PII) == label("key", "pii")
    assert join(KEY, PUBLIC) == KEY
    assert join_all([]) == PUBLIC
    assert join_all([KEY, PII, AUDIT]) == label("key", "pii", "audit")


def test_join_is_idempotent_commutative_associative():
    assert join(KEY, KEY) == KEY
    assert join(KEY, PII) == join(PII, KEY)
    assert join(join(KEY, PII), AUDIT) == join(KEY, join(PII, AUDIT))


def test_leq_is_subset_partial_order():
    assert leq(PUBLIC, KEY)  # bottom flows anywhere
    assert leq(KEY, KEY_PII)  # {key} may reach a sink cleared {key,pii}
    assert not leq(KEY_PII, KEY)  # {key,pii} may NOT reach a {key}-only sink
    # incomparable secrets: neither may substitute for the other
    assert not leq(KEY, PII)
    assert not leq(PII, KEY)


# ---------------------------------------------------------------------------
# (b) direct HIGH -> LOW leak is FLAGGED
# ---------------------------------------------------------------------------
def test_direct_high_to_low_leak_is_flagged():
    g = FlowGraph(
        nodes=(
            source("secrets", originates=KEY),
            sink("public_log", clearance=PUBLIC),
        ),
        edges=(Edge("secrets", "public_log"),),
    )
    res = check_noninterference(g)
    assert res.ok is False
    assert len(res.violations) == 1
    v = res.violations[0]
    assert v.edge == ("secrets", "public_log")
    assert v.reason == "leak"
    assert v.source_label == KEY
    assert v.sink_clearance == PUBLIC


def test_flow_within_clearance_is_allowed():
    # {key} -> a sink cleared for {key,pii}: legitimate, must NOT be flagged.
    g = FlowGraph(
        nodes=(
            source("secrets", originates=KEY),
            sink("vault", clearance=KEY_PII),
        ),
        edges=(Edge("secrets", "vault"),),
    )
    res = check_noninterference(g)
    assert res.ok is True
    assert res.violations == ()


# ---------------------------------------------------------------------------
# (c) stego channel: HIGH data smuggled on a message LABELLED low -> FLAGGED
# ---------------------------------------------------------------------------
def test_stego_channel_high_data_on_low_labelled_message_is_flagged():
    # Agent A holds a key. It emits a message it CLAIMS is PUBLIC (declared_label
    # = PUBLIC) to a low-trust agent C cleared only for PUBLIC. The bytes carry
    # the key. This is the Whispers/Colosseum covert-escalation move.
    g = FlowGraph(
        nodes=(
            agent("A", clearance=KEY, originates=KEY),
            agent("C", clearance=PUBLIC),
        ),
        edges=(Edge("A", "C", declared_label=PUBLIC),),
    )
    res = check_noninterference(g)
    assert res.ok is False
    assert len(res.violations) == 1
    v = res.violations[0]
    # distinguished from an honest over-clearance bug: this is a LIE about the
    # channel label, which is the smuggling signature.
    assert v.reason == "stego_mislabel"
    assert v.source_label == KEY
    assert v.declared_label == PUBLIC


def test_honest_low_label_on_low_data_is_allowed():
    # Same shape, but A genuinely originates PUBLIC and declares PUBLIC. No lie,
    # no leak. Guards against the checker flagging every declared edge.
    g = FlowGraph(
        nodes=(
            agent("A", clearance=PUBLIC, originates=PUBLIC),
            agent("C", clearance=PUBLIC),
        ),
        edges=(Edge("A", "C", declared_label=PUBLIC),),
    )
    res = check_noninterference(g)
    assert res.ok is True


# ---------------------------------------------------------------------------
# (d) legitimate flow through an explicit declassify point is ALLOWED
# ---------------------------------------------------------------------------
def test_flow_through_explicit_declassify_is_allowed():
    # secrets({pii,audit}) -> declassify removes {pii} -> sink cleared {audit}.
    # Sanctioned downgrade: the pii tag is stripped at a node the author wrote.
    g = FlowGraph(
        nodes=(
            source("secrets", originates=label("pii", "audit")),
            declassify("redactor", removes=PII),
            sink("auditor", clearance=AUDIT),
        ),
        edges=(
            Edge("secrets", "redactor"),
            Edge("redactor", "auditor"),
        ),
    )
    res = check_noninterference(g)
    assert res.ok is True, res.violations


def test_declassify_only_strips_its_declared_tags():
    # Same path, but the data ALSO carries {key}, which the redactor is NOT
    # permitted to strip (it only removes {pii}). The key tag survives and the
    # flow to a {audit}-only sink must still be FLAGGED. A declassify is not a
    # blanket launder.
    g = FlowGraph(
        nodes=(
            source("secrets", originates=label("pii", "audit", "key")),
            declassify("redactor", removes=PII),
            sink("auditor", clearance=AUDIT),
        ),
        edges=(
            Edge("secrets", "redactor"),
            Edge("redactor", "auditor"),
        ),
    )
    res = check_noninterference(g)
    assert res.ok is False
    # the surviving leak is on the redactor->auditor edge, carrying {audit,key}
    v = next(x for x in res.violations if x.edge == ("redactor", "auditor"))
    assert "key" in v.source_label
    assert v.sink_clearance == AUDIT


# ---------------------------------------------------------------------------
# transitivity A -> B -> C is enforced (label creep survives a relay)
# ---------------------------------------------------------------------------
def test_transitivity_high_origin_survives_a_relay():
    # A originates {key}. B is a relay that originates nothing (PUBLIC) and is
    # cleared to receive {key}. C is cleared only PUBLIC. B must NOT launder the
    # key down to its own PUBLIC intrinsic label; the B->C edge must be FLAGGED.
    g = FlowGraph(
        nodes=(
            source("A", originates=KEY),
            agent("B", clearance=KEY, originates=PUBLIC),
            sink("C", clearance=PUBLIC),
        ),
        edges=(
            Edge("A", "B"),
            Edge("B", "C"),
        ),
    )
    res = check_noninterference(g)
    assert res.ok is False
    bc = [v for v in res.violations if v.edge == ("B", "C")]
    assert len(bc) == 1
    assert bc[0].source_label == KEY  # the key tag propagated through B
    # the A->B edge itself is legitimate (B is cleared for {key})
    assert all(v.edge != ("A", "B") for v in res.violations)


def test_transitivity_clean_chain_is_allowed():
    # A{key} -> B cleared {key} -> C cleared {key}. No downgrade anywhere.
    g = FlowGraph(
        nodes=(
            source("A", originates=KEY),
            agent("B", clearance=KEY, originates=PUBLIC),
            sink("C", clearance=KEY),
        ),
        edges=(Edge("A", "B"), Edge("B", "C")),
    )
    res = check_noninterference(g)
    assert res.ok is True, res.violations


def test_join_on_merge_two_inputs_combine():
    # Two sources {key} and {pii} both feed B, which forwards to C cleared {key}
    # only. The merge joins to {key,pii}; {key,pii} is NOT <= {key}; flag B->C.
    g = FlowGraph(
        nodes=(
            source("Akey", originates=KEY),
            source("Apii", originates=PII),
            agent("B", clearance=KEY_PII, originates=PUBLIC),
            sink("C", clearance=KEY),
        ),
        edges=(
            Edge("Akey", "B"),
            Edge("Apii", "B"),
            Edge("B", "C"),
        ),
    )
    res = check_noninterference(g)
    assert res.ok is False
    v = next(x for x in res.violations if x.edge == ("B", "C"))
    assert v.source_label == KEY_PII


# ---------------------------------------------------------------------------
# robustness: no panics on malformed graphs; cycles terminate
# ---------------------------------------------------------------------------
def test_dangling_edge_is_reported_not_raised():
    g = FlowGraph(
        nodes=(source("A", originates=PUBLIC),),
        edges=(Edge("A", "ghost"),),
    )
    res = check_noninterference(g)
    assert res.ok is False
    assert res.violations[0].reason == "dangling_edge"
    assert res.violations[0].edge == ("A", "ghost")


def test_cycle_terminates_and_propagates():
    # A{key} -> B -> A cycle, plus B -> C(PUBLIC). Fixpoint must terminate and
    # still flag the leak to C. Tests the monotone-fixpoint termination guard.
    g = FlowGraph(
        nodes=(
            agent("A", clearance=KEY, originates=KEY),
            agent("B", clearance=KEY, originates=PUBLIC),
            sink("C", clearance=PUBLIC),
        ),
        edges=(
            Edge("A", "B"),
            Edge("B", "A"),
            Edge("B", "C"),
        ),
    )
    res = check_noninterference(g)
    assert res.ok is False
    assert any(v.edge == ("B", "C") and v.source_label == KEY for v in res.violations)


def test_empty_graph_is_ok():
    res = check_noninterference(FlowGraph(nodes=(), edges=()))
    assert res.ok is True
    assert res.violations == ()


def test_checkresult_is_truthy_on_ok():
    g = FlowGraph(nodes=(source("A", originates=PUBLIC),), edges=())
    assert bool(check_noninterference(g)) is True


# ---------------------------------------------------------------------------
# tiny fallback runner so the file works without pytest installed
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    failed = 0
    for fn in fns:
        try:
            fn()
            passed += 1
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{passed} passed, {failed} failed, {len(fns)} total")
    sys.exit(1 if failed else 0)
