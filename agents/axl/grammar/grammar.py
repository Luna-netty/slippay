"""
Semantic decode-grammar compiler for money policies.

MECHANISM 2 - generation-time impossibility.

Compile a money-policy (allowlist of recipient addresses + an integer amount
range [0, max_amount]) into a GRAMMAR whose LANGUAGE is EXACTLY the set of
valid (recipient, amount) decisions.

This is stronger than JSON-schema structured output. A JSON schema constrains
SHAPE (the field is a string, the field is an integer). This constrains VALUES:
the recipient must be one of a finite literal set, and the amount must be a
decimal numeral denoting an integer <= max_amount. The bounded-integer part is
the load-bearing piece - it is NOT a post-hoc numeric comparison, it is a
digit-by-digit regular grammar that cannot DERIVE a numeral > max_amount.

Representation
--------------
We use a small internal grammar IR (a set of named rules, each rule an
alternation of sequences of symbols, where a symbol is either a nonterminal
reference, a string literal, or a character class [a-b]). The IR is:

  - exact:        accepts(grammar, candidate) decides membership EXACTLY by a
                  deterministic recursive-descent / Earley-style matcher.
  - serializable: to_gbnf(grammar) emits GBNF text (llama.cpp / vLLM / Outlines).

The top-level decision string format is a compact, deterministic JSON-like
envelope so that membership in the language == validity of the decision:

  {"recipient":"<addr>","amount":<numeral>}

with no optional whitespace, no alternate orderings - the grammar pins one
canonical serialization so language membership is unambiguous.

Honesty: see README.md. The matcher proves the grammar's LANGUAGE is the allowed
set. Running this AS constrained decoding requires a self-hosted engine that
exposes grammar-constrained sampling. That wiring is infra-gated here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Union


# --------------------------------------------------------------------------- #
# Grammar IR
# --------------------------------------------------------------------------- #
#
# A Symbol is one of:
#   Ref(name)          - reference to a nonterminal rule
#   Lit(text)          - an exact terminal string
#   CharClass(lo, hi)  - a single character in the inclusive range [lo, hi]
#
# A Sequence is a list[Symbol] (concatenation).
# A Rule is a list[Sequence] (alternation).
# A Grammar is an ordered dict {name -> Rule} plus a designated start symbol.


@dataclass(frozen=True)
class Ref:
    name: str


@dataclass(frozen=True)
class Lit:
    text: str


@dataclass(frozen=True)
class CharClass:
    lo: str
    hi: str

    def __post_init__(self) -> None:
        assert len(self.lo) == 1 and len(self.hi) == 1
        assert self.lo <= self.hi


Symbol = Union[Ref, Lit, CharClass]
Sequence = List[Symbol]


@dataclass
class Grammar:
    start: str
    rules: Dict[str, List[Sequence]] = field(default_factory=dict)

    def add(self, name: str, alternatives: List[Sequence]) -> None:
        self.rules[name] = alternatives


# --------------------------------------------------------------------------- #
# Bounded-integer grammar
# --------------------------------------------------------------------------- #
#
# Goal: a set of alternatives whose language is EXACTLY the decimal numerals
# (no leading zeros, except "0" itself) denoting integers n with 0 <= n <= max.
#
# Algorithm (digit decomposition of the upper bound):
#
# Let D = decimal digits of `max` (most significant first), k = len(D).
#
# Any in-range numeral m (as a string, no leading zeros) is in [0, max] iff:
#   (1) len(m) < k                       -> any numeral with fewer digits and no
#                                           leading zero is automatically < max,
#                                           OR
#   (2) len(m) == k and m <= D           -> compared lexicographically as fixed
#                                           width (same length => numeric order
#                                           == lexicographic order).
#
# We build:
#   - "0"  for the value zero (special-cased: the only numeral that may start
#     with '0').
#   - For each length L in [1, k-1]: a leading nonzero digit [1-9] followed by
#     (L-1) free digits [0-9].  This enumerates every nonzero integer with < k
#     digits, i.e. every n in [1, 10^(k-1) - 1], all of which are < max because
#     max has k digits (max >= 10^(k-1)).
#   - For length == k: the "prefix-bounded" enumeration of all k-digit numerals
#     <= D.  This is the classic positional construction:
#       For position i (0-based, i in [0, k-1]):
#         emit D[0..i-1] literally, then a digit strictly less than D[i] at
#         position i (respecting the no-leading-zero rule at position 0), then
#         free digits [0-9] for the remaining (k-1-i) positions.
#       Finally, emit D itself (the equality case, m == max).
#     Each branch is disjoint (they differ at the first position where the
#     chosen digit is < D[i]); their union is exactly { k-digit m : m <= D }.
#
# Disjointness + completeness => the language is EXACTLY [0, max]. Proven by
# tests including the boundary numerals max and max+1.


def _digit_class_lt(d: str, allow_zero: bool) -> List[CharClass]:
    """Char-class symbols matching a single digit strictly less than `d`.

    If allow_zero is False, the lowest allowed digit is '1' (no leading zero).
    Returns [] if the resulting range is empty.
    """
    lo = "0" if allow_zero else "1"
    hi_exclusive = d  # we want digits < d
    if hi_exclusive <= lo:
        return []
    # digits in [lo, d-1]
    hi = chr(ord(d) - 1)
    if hi < lo:
        return []
    return [CharClass(lo, hi)]


def _free_digit() -> CharClass:
    return CharClass("0", "9")


def bounded_int_alternatives(max_amount: int) -> List[Sequence]:
    """Return alternatives whose language is exactly the decimal numerals for
    integers in [0, max_amount] (no leading zeros except '0')."""
    if max_amount < 0:
        raise ValueError("max_amount must be >= 0")

    D = str(max_amount)
    k = len(D)
    alts: List[Sequence] = []

    # value 0 (only numeral allowed to start with '0')
    alts.append([Lit("0")])

    # all nonzero numerals with fewer than k digits: length L in [1, k-1]
    for L in range(1, k):
        seq: Sequence = [CharClass("1", "9")]
        seq += [_free_digit() for _ in range(L - 1)]
        alts.append(seq)

    # k-digit numerals <= D, positional construction
    for i in range(k):
        allow_zero = i != 0  # position 0 cannot be a leading zero
        lt_syms = _digit_class_lt(D[i], allow_zero)
        if not lt_syms:
            continue
        seq = []
        if i > 0:
            seq.append(Lit(D[:i]))  # fixed prefix
        seq += lt_syms  # a digit strictly less than D[i]
        seq += [_free_digit() for _ in range(k - 1 - i)]  # free tail
        alts.append(seq)

    # the equality case: m == max, but only if max itself has no leading zero,
    # which is always true for a canonical decimal of a nonneg int. If max == 0
    # this duplicates the "0" branch, so skip to keep alternatives disjoint.
    if max_amount != 0:
        alts.append([Lit(D)])

    return alts


# --------------------------------------------------------------------------- #
# Recipient grammar
# --------------------------------------------------------------------------- #


def recipient_alternatives(allowlist: List[str]) -> List[Sequence]:
    """Alternation over the exact allowlist literals.

    The language is exactly { addr : addr in allowlist }. Order is normalized
    (sorted) so the emitted grammar is deterministic for a given allowlist set.
    Duplicates are collapsed.
    """
    uniq = sorted(set(allowlist))
    if not uniq:
        # empty allowlist => empty language for the recipient field. This makes
        # the whole decision language empty: nothing is authorizable. That is
        # the correct, safe behavior for "no approved recipients".
        return []
    return [[Lit(a)] for a in uniq]


# --------------------------------------------------------------------------- #
# Policy compiler
# --------------------------------------------------------------------------- #


def compile_policy_to_grammar(allowlist: List[str], max_amount: int) -> Grammar:
    """Compile a money policy into a Grammar whose language is EXACTLY the set
    of valid (recipient, amount) decisions, serialized as the canonical
    envelope:

        {"recipient":"<addr>","amount":<numeral>}

    addr ranges over `allowlist` (exact literals); numeral ranges over decimal
    integers in [0, max_amount].
    """
    g = Grammar(start="decision")

    g.add("recipient", recipient_alternatives(allowlist))
    g.add("amount", bounded_int_alternatives(max_amount))

    # canonical envelope: fixed structure, no optional whitespace, fixed order.
    g.add(
        "decision",
        [[
            Lit('{"recipient":"'),
            Ref("recipient"),
            Lit('","amount":'),
            Ref("amount"),
            Lit("}"),
        ]],
    )
    return g


# --------------------------------------------------------------------------- #
# Exact membership matcher
# --------------------------------------------------------------------------- #
#
# Deterministic recursive matcher. Returns the SET of end-positions reachable
# from `pos` after matching `symbol` against `text` (a nondeterministic-but-
# bounded match represented by a set of cursors). The grammar is non-recursive
# and finite per the compiler above, so this terminates; we also guard against
# left recursion with a visited-set to keep accepts() total for any IR.


def _match_symbol(
    grammar: Grammar,
    sym: Symbol,
    text: str,
    pos: int,
    stack: Tuple[Tuple[str, int], ...],
) -> List[int]:
    if isinstance(sym, Lit):
        end = pos + len(sym.text)
        if text[pos:end] == sym.text:
            return [end]
        return []
    if isinstance(sym, CharClass):
        if pos < len(text) and sym.lo <= text[pos] <= sym.hi:
            return [pos + 1]
        return []
    if isinstance(sym, Ref):
        return _match_rule(grammar, sym.name, text, pos, stack)
    raise TypeError(f"unknown symbol {sym!r}")


def _match_sequence(
    grammar: Grammar,
    seq: Sequence,
    text: str,
    pos: int,
    stack: Tuple[Tuple[str, int], ...],
) -> List[int]:
    frontier = {pos}
    for sym in seq:
        nxt: set = set()
        for p in frontier:
            for e in _match_symbol(grammar, sym, text, p, stack):
                nxt.add(e)
        if not nxt:
            return []
        frontier = nxt
    return sorted(frontier)


def _match_rule(
    grammar: Grammar,
    name: str,
    text: str,
    pos: int,
    stack: Tuple[Tuple[str, int], ...],
) -> List[int]:
    # left-recursion / loop guard: refuse to re-enter same (rule, pos)
    key = (name, pos)
    if key in stack:
        return []
    stack = stack + (key,)
    if name not in grammar.rules:
        raise KeyError(f"no rule named {name!r}")
    ends: set = set()
    for alt in grammar.rules[name]:
        for e in _match_sequence(grammar, alt, text, pos, stack):
            ends.add(e)
    return sorted(ends)


def accepts(grammar: Grammar, candidate: str) -> bool:
    """Decide EXACT membership: is `candidate` in the language of `grammar`?

    True iff some derivation from the start symbol consumes the ENTIRE string.
    """
    ends = _match_rule(grammar, grammar.start, candidate, 0, ())
    return len(candidate) in ends


# --------------------------------------------------------------------------- #
# Convenience: build the canonical decision string
# --------------------------------------------------------------------------- #


def make_decision(recipient: str, amount: int) -> str:
    """Serialize a (recipient, amount) decision in the canonical envelope the
    grammar pins. Use this to construct test candidates and real decisions."""
    return '{"recipient":"' + recipient + '","amount":' + str(amount) + "}"


# --------------------------------------------------------------------------- #
# GBNF emitter (llama.cpp / vLLM / Outlines wire format)
# --------------------------------------------------------------------------- #


def _gbnf_escape_lit(text: str) -> str:
    """Escape a literal for a GBNF double-quoted string."""
    out = []
    for ch in text:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        else:
            out.append(ch)
    return '"' + "".join(out) + '"'


def _gbnf_charclass(cc: CharClass) -> str:
    def esc(c: str) -> str:
        if c in ("\\", "]", "-", "^"):
            return "\\" + c
        return c

    if cc.lo == cc.hi:
        return "[" + esc(cc.lo) + "]"
    return "[" + esc(cc.lo) + "-" + esc(cc.hi) + "]"


def _gbnf_symbol(sym: Symbol) -> str:
    if isinstance(sym, Lit):
        return _gbnf_escape_lit(sym.text)
    if isinstance(sym, CharClass):
        return _gbnf_charclass(sym)
    if isinstance(sym, Ref):
        return _gbnf_rulename(sym.name)
    raise TypeError(f"unknown symbol {sym!r}")


def _gbnf_rulename(name: str) -> str:
    # GBNF rule names: letters, digits, dashes. Map underscores to dashes.
    return name.replace("_", "-")


def to_gbnf(grammar: Grammar) -> str:
    """Emit the grammar in GBNF text form.

    GBNF (GGML BNF) is the grammar format consumed by llama.cpp, and supported
    by vLLM and Outlines for grammar-constrained sampling. The `root` rule is
    the entry point in GBNF, so we alias the start symbol to `root`.
    """
    lines: List[str] = []

    # root alias
    lines.append(f"root ::= {_gbnf_rulename(grammar.start)}")

    # emit rules in insertion order (start first if present)
    names = list(grammar.rules.keys())
    # keep start near the top for readability
    if grammar.start in names:
        names.remove(grammar.start)
        names.insert(0, grammar.start)

    for name in names:
        alts = grammar.rules[name]
        if not alts:
            # empty language: a rule that can never match. GBNF has no direct
            # "empty set" literal; we encode it as a rule referencing itself,
            # which never terminates a match. Comment it for the human reader.
            lines.append(
                f"{_gbnf_rulename(name)} ::= {_gbnf_rulename(name)}  "
                f"# empty language: nothing derivable (no allowed values)"
            )
            continue
        rendered_alts = []
        for alt in alts:
            if not alt:
                rendered_alts.append('""')  # epsilon
            else:
                rendered_alts.append(" ".join(_gbnf_symbol(s) for s in alt))
        lines.append(f"{_gbnf_rulename(name)} ::= " + " | ".join(rendered_alts))

    return "\n".join(lines) + "\n"
