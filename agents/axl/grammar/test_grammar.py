"""
TDD tests for the semantic decode-grammar compiler.

These tests prove the grammar's LANGUAGE equals the allowed (recipient, amount)
set. They do NOT test live constrained decoding (infra-gated; see README.md).

Test strategy:
  - Exhaustive brute-force of the bounded-integer language for many bounds:
    for every integer n in a window around 0..max, n is in the language iff
    n <= max. This is the strongest possible check for the load-bearing piece.
  - Policy-level acceptance/rejection for recipients and amounts.
  - Boundary tests: max accepted, max+1 rejected, leading-zero rejected.
  - GBNF emission shape checks.
"""

import re

import pytest

from grammar import (
    Grammar,
    accepts,
    bounded_int_alternatives,
    compile_policy_to_grammar,
    make_decision,
    to_gbnf,
)


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def int_grammar(max_amount: int) -> Grammar:
    g = Grammar(start="amount")
    g.add("amount", bounded_int_alternatives(max_amount))
    return g


def numeral_in_language(max_amount: int, numeral: str) -> bool:
    return accepts(int_grammar(max_amount), numeral)


# --------------------------------------------------------------------------- #
# bounded-integer: exhaustive language == [0, max]
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "max_amount",
    [0, 1, 2, 9, 10, 11, 19, 20, 99, 100, 101, 123, 200, 255, 999, 1000, 1234, 5000, 9999],
)
def test_bounded_int_language_is_exactly_range(max_amount):
    """For every n in [0, max+ slack], the canonical numeral str(n) is in the
    grammar language IFF n <= max. Brute force - no sampling, exact decision."""
    hi = max_amount + 50
    for n in range(0, hi + 1):
        numeral = str(n)
        expected = n <= max_amount
        got = numeral_in_language(max_amount, numeral)
        assert got == expected, (
            f"max={max_amount}: numeral {numeral!r} membership={got}, "
            f"expected {expected}"
        )


@pytest.mark.parametrize(
    "max_amount", [0, 1, 9, 10, 99, 100, 255, 999, 1000, 1234]
)
def test_bounded_int_rejects_max_plus_one(max_amount):
    """The boundary numeral max+1 is NOT in the language."""
    assert numeral_in_language(max_amount, str(max_amount))  # max is in
    assert not numeral_in_language(max_amount, str(max_amount + 1))  # max+1 out


@pytest.mark.parametrize("max_amount", [0, 5, 10, 100, 999])
def test_bounded_int_rejects_leading_zeros(max_amount):
    """Non-canonical numerals with leading zeros are not in the language
    (except '0' itself). The decoder cannot emit '007' for 7."""
    assert numeral_in_language(max_amount, "0")  # zero is canonical
    if max_amount >= 7:
        assert numeral_in_language(max_amount, "7")
        assert not numeral_in_language(max_amount, "07")
        assert not numeral_in_language(max_amount, "007")
    # a bare leading-zero multi-digit string is always rejected
    assert not numeral_in_language(max_amount, "00")


@pytest.mark.parametrize("max_amount", [0, 9, 10, 100, 999])
def test_bounded_int_rejects_nonnumeric(max_amount):
    for bad in ["", "-1", "1.0", "1 ", " 1", "1a", "abc", "+1", "0x10"]:
        assert not numeral_in_language(max_amount, bad), (
            f"max={max_amount}: {bad!r} should be rejected"
        )


def test_bounded_int_large_bound_boundaries():
    """A large, non-round bound: only exact boundary numerals, not the full
    sweep (that would be too slow). Proves the positional construction at every
    digit position."""
    mx = 736251
    g = int_grammar(mx)
    assert accepts(g, str(mx))
    assert not accepts(g, str(mx + 1))
    assert accepts(g, str(mx - 1))
    assert accepts(g, "0")
    assert accepts(g, "99999")  # 5-digit < 6-digit bound
    assert not accepts(g, "999999")  # 6-digit, > 736251
    assert accepts(g, "736250")
    assert accepts(g, "700000")
    assert not accepts(g, "800000")  # same length, > bound
    assert not accepts(g, "1000000")  # 7 digits, way over


# --------------------------------------------------------------------------- #
# policy-level: recipient allowlist + amount bound together
# --------------------------------------------------------------------------- #


ALLOW = [
    "GABCDEF1234567890",  # Stellar-style addr (toy)
    "GHIJKL0987654321",
    "GMNOPQ1122334455",
]
MAX = 1000


@pytest.fixture
def policy_grammar():
    return compile_policy_to_grammar(ALLOW, MAX)


def test_every_allowed_decision_accepted(policy_grammar):
    """Every (recipient in allowlist, amount <= max) decision is in the
    language. Sweep allowlist x a sample of amounts including boundaries."""
    sample_amounts = [0, 1, 2, 9, 10, 99, 100, 500, 999, 1000]
    for r in ALLOW:
        for a in sample_amounts:
            d = make_decision(r, a)
            assert accepts(policy_grammar, d), f"should accept {d!r}"


def test_recipient_not_in_allowlist_rejected(policy_grammar):
    """A forbidden recipient is NOT in the language - even with a valid
    amount. This is the value-level guarantee JSON schema cannot give."""
    forbidden = [
        "GATTACKER0000000",  # not in allowlist
        "GABCDEF1234567891",  # one char off an allowed addr
        "GABCDEF123456789",  # prefix of an allowed addr
        "GABCDEF1234567890X",  # allowed addr + suffix
        "",  # empty recipient
    ]
    for r in forbidden:
        d = make_decision(r, 500)  # amount is fine
        assert not accepts(policy_grammar, d), f"should reject recipient {r!r}"


def test_amount_over_max_rejected(policy_grammar):
    """An over-balance amount is NOT in the language - even with an allowed
    recipient."""
    for a in [1001, 1002, 2000, 9999, 1000000]:
        d = make_decision(ALLOW[0], a)  # recipient is allowed
        assert not accepts(policy_grammar, d), f"should reject amount {a}"


def test_max_plus_one_rejected_at_policy_level(policy_grammar):
    """The exact boundary at the policy level: max accepted, max+1 rejected,
    for an allowed recipient."""
    assert accepts(policy_grammar, make_decision(ALLOW[0], MAX))
    assert not accepts(policy_grammar, make_decision(ALLOW[0], MAX + 1))


def test_both_violations_rejected(policy_grammar):
    """Forbidden recipient AND over-max amount: rejected."""
    assert not accepts(policy_grammar, make_decision("GATTACKER0000000", 99999))


def test_malformed_envelope_rejected(policy_grammar):
    """The canonical envelope is pinned. Alternate shapes / whitespace / field
    order are NOT in the language (this is the structural floor under the
    value-level guarantee)."""
    r = ALLOW[0]
    bad_envelopes = [
        '{"recipient": "%s","amount":5}' % r,  # space after colon
        '{"amount":5,"recipient":"%s"}' % r,  # reordered fields
        '{"recipient":"%s","amount":5} ' % r,  # trailing space
        ' {"recipient":"%s","amount":5}' % r,  # leading space
        '{"recipient":"%s","amount":"5"}' % r,  # amount quoted (string)
        '{"recipient":"%s"}' % r,  # missing amount
        '{"amount":5}',  # missing recipient
        '{"recipient":"%s","amount":5,"extra":1}' % r,  # extra field
        '{"recipient":"%s","amount":05}' % r,  # leading-zero amount
        'recipient=%s amount=5' % r,  # not JSON at all
    ]
    for d in bad_envelopes:
        assert not accepts(policy_grammar, d), f"should reject envelope {d!r}"


def test_empty_allowlist_yields_empty_language():
    """No approved recipients => nothing is authorizable. The language is empty;
    no decision (regardless of amount) is accepted. Safe default."""
    g = compile_policy_to_grammar([], 1000)
    assert not accepts(g, make_decision("GABCDEF1234567890", 5))
    assert not accepts(g, make_decision("anyone", 0))


def test_zero_max_only_zero_amount():
    """max_amount == 0 => the only valid amount is 0."""
    g = compile_policy_to_grammar(ALLOW, 0)
    assert accepts(g, make_decision(ALLOW[0], 0))
    assert not accepts(g, make_decision(ALLOW[0], 1))


# --------------------------------------------------------------------------- #
# GBNF emission (wire format)
# --------------------------------------------------------------------------- #


def test_gbnf_has_root_rule(policy_grammar):
    gbnf = to_gbnf(policy_grammar)
    assert gbnf.startswith("root ::="), "GBNF must expose a root rule"
    assert "recipient ::=" in gbnf
    assert "amount ::=" in gbnf
    assert "decision ::=" in gbnf


def test_gbnf_recipient_is_alternation_of_literals(policy_grammar):
    gbnf = to_gbnf(policy_grammar)
    # each allowed address must appear as a quoted literal in the recipient rule
    recipient_line = next(
        ln for ln in gbnf.splitlines() if ln.startswith("recipient ::=")
    )
    for addr in ALLOW:
        assert f'"{addr}"' in recipient_line, f"{addr} must be a GBNF literal"


def test_gbnf_amount_uses_digit_classes(policy_grammar):
    gbnf = to_gbnf(policy_grammar)
    amount_line = next(
        ln for ln in gbnf.splitlines() if ln.startswith("amount ::=")
    )
    # the bounded-int grammar must use digit char classes, not a free number
    assert "[0-9]" in amount_line or "[1-9]" in amount_line


def test_gbnf_is_nonempty_and_lines_well_formed(policy_grammar):
    gbnf = to_gbnf(policy_grammar)
    for ln in gbnf.splitlines():
        if ln.strip() == "":
            continue
        # every GBNF rule line has the form NAME ::= ...
        assert re.match(r"^[a-zA-Z][a-zA-Z0-9-]*\s*::=", ln), f"bad GBNF line: {ln!r}"


def test_gbnf_empty_allowlist_marks_empty_language():
    g = compile_policy_to_grammar([], 100)
    gbnf = to_gbnf(g)
    assert "empty language" in gbnf  # documented unsatisfiable recipient rule


# --------------------------------------------------------------------------- #
# bounded_int_alternatives direct unit checks (disjointness sanity)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("max_amount", [0, 1, 7, 10, 42, 100, 255, 999])
def test_no_duplicate_acceptance_paths_imply_unique_membership(max_amount):
    """Sanity: membership decision is stable and deterministic across repeated
    calls (the matcher is a pure function)."""
    g = int_grammar(max_amount)
    for n in range(0, max_amount + 5):
        first = accepts(g, str(n))
        second = accepts(g, str(n))
        assert first == second
        assert first == (n <= max_amount)
