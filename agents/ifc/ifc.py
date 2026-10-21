"""Information-flow control (non-interference) checker for inter-agent
composition.

This is **Mechanism 4** of Slippay's agent-integrity stack. Where Mechanism 3
(``agents/tee``) attests *which policy+model produced a decision*, this one
attests *that no high-confidentiality / high-integrity datum reaches a lower
sink across an agent-to-agent channel without passing an explicit, declared
declassification point*.

The attack class it targets is covert collusion / steganographic escalation
between composed agents — the Colosseum/Whispers family — where agent A holds a
secret (a key, a PII record, a privileged instruction) and smuggles it to a
lower-trust agent C by hiding it inside a message that is *labelled* low. If the
flow graph declares that A's output is HIGH and the A->C edge feeds a LOW sink,
this checker flags it. There is no honest label under which secret HIGH data may
ride a LOW-cleared channel; the only sanctioned way down the lattice is through
a ``declassify`` node that the graph author had to write on purpose and that an
auditor can read.

WHAT THIS PROVES (and what it does NOT) — see README.md for the long form:

- It proves the **DECLARED** flow graph satisfies non-interference under a
  security-label lattice: for every channel, the (propagated, join-on-merge)
  label of the data at the source is <= the clearance of the sink, OR an
  explicit declassify node on the path downgrades it within its declared,
  bounded allowance.
- It does **NOT** discover undeclared side channels. If two agents share a
  covert timing/cache/length channel that nobody put in the graph as an edge,
  this checker is blind to it — exactly like a type system is blind to a
  Spectre gadget. The guarantee is relative to the completeness of the declared
  model. Disanalogy with a runtime taint tracker: a dynamic IFC monitor sees
  the bytes that actually move and can catch an implicit flow at runtime; this
  is a *static* check over a *declared* graph, so its soundness is bounded by
  whether the graph author declared every real channel as an edge.
- IFC is **known for false positives**: a label-propagation checker over-rejects
  legitimate flows (the classic "label creep" — once a value touches HIGH, its
  join stays HIGH and poisons everything downstream). The cure is *designed*
  declassification points, which themselves are the trusted core: a wrong
  declassify allowance is a hole the checker will happily wave through. We make
  declassification explicit, bounded, and auditable, but we cannot prove a
  declassify node is *semantically* justified — only that it exists and that the
  author scoped it.

The lattice algebra (join/leq), the label propagation with merge-join, the
declassify accounting, and the cycle-safe fixpoint are real and tested. The
*completeness of the declared graph* and the *justification of each declassify*
are the trusted, human-supplied parts. See README.md.

Pure, Result-style, no panics: every public function returns a value (a
``CheckResult`` or a ``(bool, reason)``); malformed graphs are reported as
violations, never raised.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, FrozenSet, Iterable, List, Mapping, Optional, Tuple

# ---------------------------------------------------------------------------
# (a) The security-label lattice.
#
# We use a powerset-of-tags lattice. A label is a frozenset of confidentiality
# *categories* (tags): {"pii"}, {"key", "pii"}, the empty set (== PUBLIC), etc.
#
#   - PARTIAL ORDER (leq): label X "may flow to" sink-clearance Y iff X is a
#     SUBSET of Y. Reading the lattice as confidentiality: a sink cleared for
#     categories Y can receive data whose categories X are all within Y. Data
#     tagged {"key"} flowing to a sink cleared only for {"pii"} is rejected
#     because {"key"} is NOT a subset of {"pii"}.
#   - JOIN (least upper bound): set UNION. When two flows merge at a node, the
#     result carries the union of their tags — the conservative, monotone move
#     that makes label propagation sound (you can only gain tags going forward,
#     never silently lose one). PUBLIC (empty set) is the bottom; the union of
#     all declared tags is the top.
#
# This is a genuine lattice: union is associative/commutative/idempotent with
# identity emptyset; subset is a partial order; (P(T), subset, union) is the
# canonical example of a bounded lattice. Choosing powerset-of-tags over a
# linear LOW<HIGH chain lets us express incomparable secrets (a {"key"} flow and
# a {"pii"} flow are *incomparable* — neither may substitute for the other),
# which a totally-ordered level scheme cannot.
#
# Integrity is the dual: model an integrity requirement as a tag too (e.g.
# "trusted") and read it with the same subset rule by tagging *untrusted* inputs
# and requiring high-integrity sinks to carry no untrusted tag. We expose the
# confidentiality reading by default and document the dual in README.
# ---------------------------------------------------------------------------

Label = FrozenSet[str]

PUBLIC: Label = frozenset()


def label(*tags: str) -> Label:
    """Construct a label from category tags. ``label()`` == PUBLIC (bottom)."""
    return frozenset(tags)


def join(a: Label, b: Label) -> Label:
    """Least upper bound: union of tags. The merge operation for propagation."""
    return frozenset(a) | frozenset(b)


def join_all(labels: Iterable[Label]) -> Label:
    """Fold ``join`` over many labels. Empty -> PUBLIC (the identity)."""
    acc: Label = PUBLIC
    for lb in labels:
        acc = join(acc, lb)
    return acc


def leq(x: Label, clearance: Label) -> bool:
    """Partial order: may data labelled ``x`` flow to a sink cleared ``clearance``?

    True iff every tag of ``x`` is permitted by ``clearance`` (subset). This is
    the single rule the whole checker rests on.
    """
    return frozenset(x) <= frozenset(clearance)


# ---------------------------------------------------------------------------
# (b) The flow-graph model.
#
# Three node kinds, all carried in one ``Node`` for simplicity, distinguished by
# ``kind``:
#
#   - "agent": an agent. Has ``input_clearance`` (the highest label it is
#     cleared to RECEIVE — i.e. the sink-side clearance for edges pointing INTO
#     it) and ``output_label`` (the *intrinsic* label the agent stamps on data
#     it ORIGINATES, e.g. a secrets-holder originates {"key"}). The label that
#     actually leaves an agent is join(intrinsic output, everything that flowed
#     in) — that is the label-creep-honest propagation.
#   - "source": a pure origin of data at a fixed label (no inputs). Sugar for an
#     agent with no in-edges; kept separate so test graphs read clearly.
#   - "sink": a pure consumer with an ``input_clearance`` and no out-edges.
#   - "declassify": the ONLY sanctioned downgrade and the trusted boundary.
#     Carries ``removes`` (the tags it is permitted to strip). Data passing
#     through it has exactly those tags removed from its propagated label, and
#     nothing else changes. A declassify that removes {"pii"} turns
#     {"pii","audit"} into {"audit"} and lets it reach a sink cleared {"audit"}.
#     It is powerless over tags not in ``removes``. An edge INTO a declassify is
#     never itself a leak: the node is, by construction, cleared to receive
#     whatever it is about to downgrade (else declassification would be
#     unreachable). The bounded, auditable part is what it strips — checked on
#     its OUT-edges — NOT what it accepts. This is exactly why a declassify is
#     trusted-core: a too-broad ``removes`` is a hole the checker waves through.
#
# Edges are directed channels carrying labelled data from src to dst.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Node:
    name: str
    kind: str  # "agent" | "source" | "sink" | "declassify"
    # For agents/sinks: the highest label this node may RECEIVE.
    input_clearance: Label = PUBLIC
    # For agents/sources: the intrinsic label this node ORIGINATES.
    output_label: Label = PUBLIC
    # For declassify nodes: the tags it is permitted to strip.
    removes: Label = PUBLIC

    def __post_init__(self) -> None:
        object.__setattr__(self, "input_clearance", frozenset(self.input_clearance))
        object.__setattr__(self, "output_label", frozenset(self.output_label))
        object.__setattr__(self, "removes", frozenset(self.removes))


def agent(name: str, *, clearance: Label = PUBLIC, originates: Label = PUBLIC) -> Node:
    return Node(name, "agent", input_clearance=clearance, output_label=originates)


def source(name: str, *, originates: Label) -> Node:
    return Node(name, "source", output_label=originates)


def sink(name: str, *, clearance: Label = PUBLIC) -> Node:
    return Node(name, "sink", input_clearance=clearance)


def declassify(name: str, *, removes: Label) -> Node:
    return Node(name, "declassify", removes=removes)


@dataclass(frozen=True)
class Edge:
    """A directed channel from ``src`` node-name to ``dst`` node-name.

    ``declared_label`` is OPTIONAL and is the steganography trap: it is the label
    the *channel author claims* the message carries. The checker IGNORES it for
    the safety decision (it propagates the real, computed label instead) but
    records a ``mislabel`` flag when the declared label is lower than the
    computed one — that mismatch is the signature of a stego/covert escalation
    attempt: "I told you this message was LOW, but the data on it is HIGH."
    """

    src: str
    dst: str
    declared_label: Optional[Label] = None

    def __post_init__(self) -> None:
        if self.declared_label is not None:
            object.__setattr__(self, "declared_label", frozenset(self.declared_label))


@dataclass(frozen=True)
class FlowGraph:
    nodes: Tuple[Node, ...]
    edges: Tuple[Edge, ...]

    def node(self, name: str) -> Optional[Node]:
        for n in self.nodes:
            if n.name == name:
                return n
        return None


# ---------------------------------------------------------------------------
# (c) The checker.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Violation:
    edge: Tuple[str, str]
    reason: str
    source_label: Label
    sink_clearance: Label
    # set on stego/mislabel detections: what the channel CLAIMED vs what it CARRIES
    declared_label: Optional[Label] = None


@dataclass(frozen=True)
class CheckResult:
    ok: bool
    violations: Tuple[Violation, ...] = field(default_factory=tuple)

    def __bool__(self) -> bool:  # Result-style truthiness
        return self.ok


def _out_label(node: Node, incoming: Label) -> Label:
    """The label leaving ``node`` given the joined label of everything that
    flowed into it.

    - agent/source: join(intrinsic output_label, incoming). Label creep is
      honest here: an agent cannot launder a HIGH input down to its own lower
      intrinsic label; the join keeps the HIGH tag.
    - declassify: incoming with exactly its permitted ``removes`` tags stripped.
      This is the ONLY place the propagated label can lose a tag.
    - sink: sinks have no out-edges; their out-label is irrelevant but defined as
      the incoming (so a misconfigured sink-with-out-edge still propagates
      conservatively rather than silently dropping tags).
    """
    if node.kind == "declassify":
        return frozenset(incoming) - frozenset(node.removes)
    if node.kind in ("agent", "source"):
        return join(node.output_label, incoming)
    return frozenset(incoming)


def check_noninterference(graph: FlowGraph) -> CheckResult:
    """Propagate labels along edges (join on merge) to a fixpoint, then flag any
    edge whose propagated source label is NOT <= the destination's clearance and
    that no declassify node on the path covers.

    Returns ``CheckResult(ok, violations)``. Pure, total, no exceptions:

      - Unknown node referenced by an edge          -> violation "dangling_edge".
      - Source label exceeds sink clearance         -> violation "leak".
      - Channel declared LOW but carries HIGH data   -> violation "stego_mislabel"
        (a leak that is ALSO a lie about the channel label — the covert-collusion
        signature). It is reported with this more specific reason so audit logs
        distinguish an honest over-clearance bug from a smuggling attempt.

    Transitivity (A->B->C) is enforced for free by the fixpoint: B's out-label is
    join(B intrinsic, A's label), so a HIGH origin at A is still HIGH leaving B
    and is checked again on the B->C edge.

    The fixpoint terminates on any graph, including cycles: labels only grow
    (monotone in the join lattice) and the lattice has finite height (bounded by
    the number of distinct tags), so the iteration reaches a least fixed point in
    at most |tags|*|nodes| rounds; we bound rounds by |nodes|*(|tags|+1)+1 as a
    belt-and-braces guard and treat non-convergence (impossible by monotonicity,
    but defended anyway) as no extra growth.
    """
    by_name: Dict[str, Node] = {n.name: n for n in graph.nodes}

    # ---- 0. structural validation (no panics; report as violations) ----
    dangling: List[Violation] = []
    valid_edges: List[Edge] = []
    for e in graph.edges:
        if e.src not in by_name or e.dst not in by_name:
            dangling.append(
                Violation(
                    edge=(e.src, e.dst),
                    reason="dangling_edge",
                    source_label=PUBLIC,
                    sink_clearance=PUBLIC,
                )
            )
        else:
            valid_edges.append(e)

    in_edges: Dict[str, List[Edge]] = {n.name: [] for n in graph.nodes}
    for e in valid_edges:
        in_edges[e.dst].append(e)

    # all tags that appear anywhere — used to bound the fixpoint height
    all_tags = set()
    for n in graph.nodes:
        all_tags |= set(n.output_label)
    n_tags = len(all_tags)
    max_rounds = len(graph.nodes) * (n_tags + 1) + 1

    # ---- 1. label-propagation fixpoint ----
    # incoming[name] = join of out-labels of all in-edge sources (least fixpoint)
    incoming: Dict[str, Label] = {n.name: PUBLIC for n in graph.nodes}

    def out_of(name: str) -> Label:
        return _out_label(by_name[name], incoming[name])

    for _ in range(max_rounds):
        changed = False
        for n in graph.nodes:
            joined = PUBLIC
            for e in in_edges[n.name]:
                joined = join(joined, out_of(e.src))
            if joined != incoming[n.name]:
                # monotone: incoming only grows; defended against shrink anyway
                grown = join(incoming[n.name], joined)
                if grown != incoming[n.name]:
                    incoming[n.name] = grown
                    changed = True
        if not changed:
            break

    # ---- 2. per-edge non-interference check ----
    leaks: List[Violation] = []
    for e in valid_edges:
        carried = out_of(e.src)  # the REAL, propagated label on this channel
        dst = by_name[e.dst]

        # A declassify node is the trusted downgrade boundary: by definition it
        # is cleared to RECEIVE whatever it is about to downgrade, so an edge
        # INTO a declassify is never itself a leak. The bounded, audited part is
        # what it REMOVES (checked on the declassify's OUT-edges via the stripped
        # propagated label), not what it accepts. Without this, no HIGH datum
        # could ever reach a redactor and declassification would be unreachable.
        if dst.kind == "declassify":
            continue

        clearance = dst.input_clearance

        if leq(carried, clearance):
            continue  # legitimate flow (incl. anything routed via a declassify)

        # It is a leak. Is it ALSO mislabelled (declared lower than carried)?
        if e.declared_label is not None and not leq(carried, e.declared_label):
            leaks.append(
                Violation(
                    edge=(e.src, e.dst),
                    reason="stego_mislabel",
                    source_label=carried,
                    sink_clearance=clearance,
                    declared_label=e.declared_label,
                )
            )
        else:
            leaks.append(
                Violation(
                    edge=(e.src, e.dst),
                    reason="leak",
                    source_label=carried,
                    sink_clearance=clearance,
                    declared_label=e.declared_label,
                )
            )

    violations = tuple(dangling + leaks)
    return CheckResult(ok=(len(violations) == 0), violations=violations)
