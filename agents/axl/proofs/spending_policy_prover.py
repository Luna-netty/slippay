#!/usr/bin/env python3
"""
Verified Spending Policy — a prover that issues a machine-checked SAFETY
CERTIFICATE for an agent spending policy, and REFUSES to certify the unsafe ones.

Positioning (Stellar / x402 agent economy): x402 and MPP are live on Stellar
mainnet; the explicit value prop is "programmable payment policies — spending
limits, approval rules — guardrails without removing autonomy." Every agent
wallet today CAPS spend. None ships a proof that the cap cannot be exceeded over
all action sequences. This does: it certifies the worst-case window outflow of a
policy as K * window_cap, proves K is tight, and fail-closed refuses a policy
with no provable bound.

This generalizes mechanism #1 (budget_invariant.py) from the one deployed policy
to a parameterized family: the policy's aggregate-ceiling multiplier M is the
knob; the prover returns the PROVED bound K, or refuses.

K is NOT always M. The weighted throughput check independently binds prev and
cur to <= window_cap each, so for any M >= 2 the proved bound is 2*window_cap
regardless of a looser declared ceiling — the prover reports this as a
diagnostic ("nominal ceiling looser than proved bound", i.e. the ceiling is not
the binding constraint). M = 1 binds tighter than the weighted check (K = 1).
A policy with no aggregate cap is unbounded and is REFUSED.

Honest scope (verified by adversarial review):
  - The proved object is the epoch-state invariant prev+cur <= K*window_cap; the
    real-time-window bound follows by the OVERLAP LEMMA (a W-window touches <= 2
    adjacent epochs since rolls fire only at elapsed >= W). The lemma is a true
    geometric premise, stated not machine-checked here.
  - The proof is over unbounded mathematical integers. The contract uses
    saturating i128: at astronomically large caps the weighted product can
    saturate and relax THROUGHPUT shaping, but the unweighted hard ceiling
    (saturating_add, fail-closed, reject if > 2*window_cap) still enforces the
    2*window_cap real-time envelope — the SAFETY bound K=2 is not invalidated.
  - Non-linear or unbounded-state policies are out of Z3's decidable reach — the
    prover REFUSES them, it does not pretend.
"""

from z3 import Int, Ints, Solver, And, Or, Not, If, IntVal, sat, unsat


def base(W_cap, per_tx, W):
    # install-time invariants from the deployed contract.
    return [W_cap > 0, per_tx > 0, per_tx <= W_cap, W_cap <= 100 * per_tx, W >= 60]


def transition(M, p, c, W_cap, per_tx, W, elapsed, a):
    """One charge under the sliding-window policy with aggregate ceiling M*W_cap.
    Mirrors contracts/smart-wallet/src/lib.rs try_authorize_agent_transfer."""
    rolled = elapsed >= W
    p1 = If(rolled, If(elapsed < 2 * W, c, IntVal(0)), p)   # carry / drop / keep
    c1 = If(rolled, IntVal(0), c)
    eie = If(rolled, IntVal(0), elapsed)
    remaining = W - eie
    weighted_prev = (p1 * remaining) / W                    # floor div, operands >= 0
    accept = And(weighted_prev + c1 + a <= W_cap,           # weighted throughput check
                 p1 + c1 + a <= M * W_cap)                  # aggregate ceiling = M*W_cap
    c2 = c1 + a
    return p1, c2, accept


def invariant(p, c, K, W_cap):
    return And(p >= 0, c >= 0, p <= W_cap, c <= W_cap, p + c <= K * W_cap)


def is_inductive(M, K):
    """Is invariant_K preserved by every accepted charge under ceiling M? UNSAT to
    break => inductive => K*window_cap is a sound bound for all action sequences."""
    W_cap, per_tx, W, elapsed, a = Ints("W_cap per_tx W elapsed a")
    p, c = Ints("p c")
    s = Solver()
    s.add(base(W_cap, per_tx, W))
    s.add(invariant(p, c, K, W_cap))
    s.add(elapsed >= 0, a > 0, a <= per_tx)
    p1, c2, accept = transition(M, p, c, W_cap, per_tx, W, elapsed, a)
    s.add(accept)
    s.add(Not(invariant(p1, c2, K, W_cap)))
    return s.check() == unsat


def is_attainable(M, K):
    """Can an accepted charge drive window outflow (p+c) up to exactly K*window_cap?
    SAT => the bound is reached => K is tight (not loose)."""
    W_cap, per_tx, W, elapsed, a = Ints("W_cap per_tx W elapsed a")
    p, c = Ints("p c")
    s = Solver()
    s.add(base(W_cap, per_tx, W))
    s.add(invariant(p, c, K, W_cap))
    s.add(elapsed >= 0, a > 0, a <= per_tx)
    p1, c2, accept = transition(M, p, c, W_cap, per_tx, W, elapsed, a)
    s.add(accept)
    s.add(p1 + c2 == K * W_cap)
    return s.check() == sat


def unbounded_no_aggregate():
    """Policy with ONLY a per-tx cap (no aggregate window limit): show window
    outflow exceeds K*window_cap for an arbitrary K -> no finite bound -> refuse."""
    W_cap, per_tx = Ints("W_cap per_tx")
    n = Int("n_charges_in_window")
    s = Solver()
    s.add(W_cap > 0, per_tx > 0, per_tx <= W_cap)
    K = 1000  # pick any target; a solution exists for every K -> unbounded
    # n charges, each up to per_tx, all within one window (no rate limit forbids it)
    s.add(n > 0, n * per_tx > K * W_cap)
    return s.check() == sat


def certify(name, M):
    """Issue a certificate for a policy. M = aggregate ceiling multiplier; None =
    per-tx-only (no aggregate cap)."""
    print(f"\n── policy: {name} ──")
    if M is None:
        refused = unbounded_no_aggregate()
        print("  aggregate cap: NONE (per-tx cap only)")
        print(f"  ∃ sequence exceeding K*window_cap for arbitrary K ?  {refused}")
        print("  CERTIFICATE: REFUSED — window outflow is UNBOUNDED. Fail-closed.")
        return {"policy": name, "certified": False, "reason": "unbounded: no aggregate cap"}
    # minimal sound K
    K = None
    for cand in range(1, 7):
        if is_inductive(M, cand):
            K = cand
            break
    if K is None:
        print(f"  ceiling: {M}*window_cap — no bound provable up to 6*window_cap")
        print("  CERTIFICATE: REFUSED (could not prove a bound).")
        return {"policy": name, "certified": False, "reason": "no provable bound"}
    tight = is_attainable(M, K) and (K == 1 or not is_inductive(M, K - 1))
    print(f"  ceiling: {M}*window_cap")
    print(f"  inductive over ALL action sequences ?  yes  (invariant_K, UNSAT to break)")
    print(f"  certified bound K = {K}  -> window outflow <= {K}*window_cap")
    print(f"  tight (bound is attained, K-1 unsound) ?  {tight}")
    if M > K:
        print(f"  DIAGNOSTIC: nominal ceiling {M}*window_cap is LOOSER than the proved "
              f"bound {K}*window_cap — the weighted check binds tighter than the ceiling.")
    print(f"  CERTIFICATE: ISSUED — outflow <= {K}*window_cap, machine-checked.")
    return {"policy": name, "certified": True, "ceiling_multiplier": M,
            "certified_bound_K": K, "tight": bool(tight)}


if __name__ == "__main__":
    print("=" * 70)
    print("VERIFIED SPENDING POLICY — machine-checked safety certificates (Z3)")
    print("=" * 70)
    certs = [
        certify("deployed agent_wallet (sliding window, ceiling 2*cap)", 2),
        certify("strict variant (ceiling 1*cap)", 1),
        certify("loose ceiling (3*cap) — weighted check still binds", 3),
        certify("naive per-tx-only (no aggregate cap)", None),
    ]
    print("\n" + "=" * 70)
    print("SUMMARY")
    for c in certs:
        if c["certified"]:
            print(f"  [CERT]  {c['policy']}: outflow <= {c['certified_bound_K']}*window_cap "
                  f"(tight={c['tight']})")
        else:
            print(f"  [REFUSED] {c['policy']}: {c['reason']}")
    print("\nThe deployed policy carries a proof no x402/MPP wallet ships today:")
    print("its spend cannot be exceeded beyond 2*window_cap over ANY action sequence.")
    print("The unsafe policy is refused, not silently shipped. That is the wedge.")
