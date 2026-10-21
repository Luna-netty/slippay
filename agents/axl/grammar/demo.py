"""
Demo: compile a money policy, emit GBNF, decide membership.

Run: python3 demo.py
"""

from grammar import accepts, compile_policy_to_grammar, make_decision, to_gbnf


def main() -> None:
    allowlist = [
        "GABCDEF1234567890",  # toy Stellar-style addresses
        "GHIJKL0987654321",
        "GMNOPQ1122334455",
    ]
    max_amount = 1000

    g = compile_policy_to_grammar(allowlist, max_amount)

    print("=== GBNF (wire-ready: llama.cpp / vLLM / Outlines) ===")
    print(to_gbnf(g))

    print("=== membership decisions (the proof of value-level constraint) ===")
    cases = [
        (allowlist[0], 0, "min amount, allowed recipient"),
        (allowlist[1], 999, "in-range, allowed recipient"),
        (allowlist[2], 1000, "exactly max, allowed recipient"),
        (allowlist[0], 1001, "OVER max -> not in language"),
        ("GATTACKER000000", 5, "forbidden recipient -> not in language"),
        ("GATTACKER000000", 99999, "forbidden recipient AND over max"),
    ]
    for recipient, amount, note in cases:
        decision = make_decision(recipient, amount)
        verdict = "ACCEPT" if accepts(g, decision) else "REJECT"
        print(f"  [{verdict}] {decision}   # {note}")


if __name__ == "__main__":
    main()
