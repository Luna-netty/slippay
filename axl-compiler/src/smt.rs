//! SMT-LIB emitter for the sliding-window spending-policy safety bound.
//!
//! This module LOWERS a parsed [`InvariantDecl`] to SMT-LIB text that reproduces
//! the canonical Python model
//! (`agents/axl/proofs/spending_policy_prover.py`) EXACTLY, so z3 returns the
//! identical sat/unsat verdicts. The crate stays zero-dependency: we emit TEXT,
//! never link a solver. Discharge happens in [`crate::prove`] via `z3` on a
//! subprocess.
//!
//! ## The model (one charge under the sliding window)
//!
//! State is `(prev, cur)` = outflow in the previous / current epoch. A charge of
//! amount `a` (`0 < a <= per_tx`) after `elapsed` seconds:
//!
//! ```text
//! rolled        = elapsed >= W
//! p1            = rolled ? (elapsed < 2W ? cur : 0) : prev   ; carry / drop / keep
//! c1            = rolled ? 0 : cur
//! eie           = rolled ? 0 : elapsed                       ; elapsed-in-epoch
//! weighted_prev = floor(p1 * (W - eie) / W)                  ; throughput shaping
//! accept        = (weighted_prev + c1 + a <= window_cap)     ; weighted check
//!               AND (p1 + c1 + a <= M * window_cap)          ; aggregate ceiling
//! c2            = c1 + a
//! ```
//!
//! `invariant_K(p,c) = 0<=p<=cap AND 0<=c<=cap AND p+c <= K*cap`.
//!
//! ## The three obligations
//!
//! - **base case**: `invariant_K(0, 0)` holds. Emitted as `assert (not base)`,
//!   expect `unsat`.
//! - **inductive step**: assume `invariant_K(p,c)` AND `accept`, prove
//!   `invariant_K(p1, c2)`. Emitted as `assert (invariant + accept + NOT
//!   invariant')`, expect `unsat` (UNSAT-to-break => sound bound).
//! - **unbounded witness** (ceiling = none only): with no aggregate cap, `n`
//!   charges of `per_tx` exceed `K*cap` for arbitrary `K`. Emitted, expect `sat`
//!   => REFUSE (fail-closed).
//!
//! ## Floor division
//!
//! `weighted_prev` uses SMT-LIB `div`. The Python model multiplies non-negative
//! operands (`p1 >= 0`, `remaining = W - eie in [0, W]`), so z3 `div` == floor ==
//! truncation; all three agree and the verdicts match the canonical prover.

use crate::error::CompileError;
use crate::parse::{Ceiling, InvariantDecl};

/// Which proof obligation to emit. The inductive step is the load-bearing one;
/// the others support tightness/minimality reasoning and the unbounded refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Obligation {
    /// `invariant_K(0,0)` holds (emit `assert (not base)`; expect unsat).
    Base,
    /// Inductive step preserves `invariant_K` (expect unsat to break => sound).
    Inductive,
    /// `invariant_K` is attained (expect sat => the bound is tight, not loose).
    Attainable,
    /// No aggregate cap => outflow unbounded (expect sat => REFUSE).
    Unbounded,
}

/// The only policy family the emitter can lower. Anything else is fail-closed
/// rejected via [`CompileError::UnsupportedPolicy`].
pub const SUPPORTED_FAMILY: &str = "sliding_window";

/// Reject an invariant whose family the emitter cannot lower (fail-closed). On
/// success returns the ceiling multiplier `M` for a `sliding_window` policy, or
/// `None` for `ceiling = none` (the unbounded family).
///
/// `Ceiling::Multiplier(0)` is also rejected: a `0*cap` aggregate ceiling admits
/// no positive charge and is not a meaningful policy (the canonical model uses
/// `M >= 1`).
fn family_multiplier(inv: &InvariantDecl) -> Result<Option<u64>, CompileError> {
    if inv.family != SUPPORTED_FAMILY {
        return Err(CompileError::UnsupportedPolicy(inv.family.clone()));
    }
    match inv.ceiling {
        Ceiling::None => Ok(None),
        Ceiling::Multiplier(0) => Err(CompileError::UnsupportedPolicy(format!(
            "{}(ceiling = 0)",
            inv.family
        ))),
        Ceiling::Multiplier(m) => Ok(Some(m)),
    }
}

/// Shared install-time invariants + charge domain, mirroring `base(...)` and the
/// `elapsed/a` domain asserts in the Python prover.
fn preamble() -> String {
    let mut s = String::new();
    s.push_str("(declare-const W_cap Int)\n");
    s.push_str("(declare-const per_tx Int)\n");
    s.push_str("(declare-const W Int)\n");
    s.push_str("(declare-const elapsed Int)\n");
    s.push_str("(declare-const a Int)\n");
    s.push_str("(declare-const p Int)\n");
    s.push_str("(declare-const c Int)\n");
    // base(W_cap, per_tx, W): install-time invariants from the deployed contract.
    s.push_str("(assert (> W_cap 0))\n");
    s.push_str("(assert (> per_tx 0))\n");
    s.push_str("(assert (<= per_tx W_cap))\n");
    s.push_str("(assert (<= W_cap (* 100 per_tx)))\n");
    s.push_str("(assert (>= W 60))\n");
    s
}

/// The transition definitions (`p1`, `c1`, `eie`, `remaining`, `weighted_prev`,
/// `c2`) and the `accept` predicate, for ceiling multiplier `m`. Shared by the
/// inductive and attainable obligations.
fn transition_defs(m: u64) -> String {
    let mut s = String::new();
    s.push_str("(define-fun p1 () Int (ite (>= elapsed W) (ite (< elapsed (* 2 W)) c 0) p))\n");
    s.push_str("(define-fun c1 () Int (ite (>= elapsed W) 0 c))\n");
    s.push_str("(define-fun eie () Int (ite (>= elapsed W) 0 elapsed))\n");
    s.push_str("(define-fun remaining () Int (- W eie))\n");
    // weighted_prev = floor(p1 * remaining / W). Operands non-negative => div is floor.
    s.push_str("(define-fun weighted_prev () Int (div (* p1 remaining) W))\n");
    s.push_str("(define-fun c2 () Int (+ c1 a))\n");
    // accept = weighted throughput check AND aggregate ceiling M*W_cap.
    s.push_str("(define-fun accept () Bool (and\n");
    s.push_str("  (<= (+ weighted_prev c1 a) W_cap)\n");
    s.push_str(&format!("  (<= (+ p1 c1 a) (* {m} W_cap))))\n"));
    s
}

/// `invariant_K` over a given pair of S-expressions, with bound `k`.
fn invariant_expr(p: &str, c: &str, k: u64) -> String {
    format!(
        "(and (>= {p} 0) (>= {c} 0) (<= {p} W_cap) (<= {c} W_cap) (<= (+ {p} {c}) (* {k} W_cap)))"
    )
}

/// Emit the SMT-LIB for one [`Obligation`] of a `sliding_window` invariant.
///
/// Fail-closed: an unsupported family (or `ceiling = 0`) returns
/// [`CompileError::UnsupportedPolicy`]. Requesting [`Obligation::Unbounded`] on a
/// bounded (`ceiling = M`) policy, or any bounded obligation on a `ceiling = none`
/// policy, is a logic error that returns [`CompileError::UnsupportedPolicy`] with
/// an explanatory token — the caller in [`crate::prove`] never does this.
pub fn emit(inv: &InvariantDecl, ob: Obligation) -> Result<String, CompileError> {
    let mult = family_multiplier(inv)?;
    let k = inv.bound;

    match (mult, ob) {
        // ── ceiling = none: only the unbounded witness is meaningful ──
        (None, Obligation::Unbounded) => Ok(emit_unbounded()),
        (None, _) => Err(CompileError::UnsupportedPolicy(format!(
            "{}(ceiling = none): only the unbounded obligation applies",
            inv.family
        ))),

        // ── ceiling = M: base / inductive / attainable ──
        (Some(_m), Obligation::Base) => Ok(emit_base(k)),
        (Some(m), Obligation::Inductive) => Ok(emit_inductive(m, k)),
        (Some(m), Obligation::Attainable) => Ok(emit_attainable(m, k)),
        (Some(_), Obligation::Unbounded) => Err(CompileError::UnsupportedPolicy(format!(
            "{}(ceiling = M): the unbounded obligation does not apply to a capped policy",
            inv.family
        ))),
    }
}

/// Convenience: emit the inductive obligation for the claimed bound, plus, for a
/// minimality check, the inductive obligation for `bound = k-1`. Returns
/// `(this_k_smt, prev_k_smt_opt)`. The prover uses this to decide tightness
/// (`k` sound AND `k-1` NOT sound => tight) without re-walking the AST.
pub fn emit_inductive_with_predecessor(
    inv: &InvariantDecl,
) -> Result<(String, Option<String>), CompileError> {
    let this = emit(inv, Obligation::Inductive)?;
    let prev = if inv.bound >= 1 {
        // predecessor invariant uses bound k-1; same family/ceiling.
        let pred = InvariantDecl {
            family: inv.family.clone(),
            ceiling: inv.ceiling.clone(),
            bound: inv.bound - 1,
        };
        // k-1 == 0 is a degenerate bound (0*cap admits only the empty state);
        // still emit it so the prover can confirm it is NOT inductive.
        Some(emit(&pred, Obligation::Inductive)?)
    } else {
        None
    };
    Ok((this, prev))
}

fn emit_base(k: u64) -> String {
    let mut s = String::new();
    s.push_str(
        "; base case: invariant_K(0,0) must hold. assert its negation; expect unsat.\n",
    );
    // The base state is the constant (0,0); only W_cap matters for the bound.
    s.push_str("(declare-const W_cap Int)\n");
    s.push_str("(assert (> W_cap 0))\n");
    s.push_str(&format!(
        "(assert (not {}))\n",
        invariant_expr("0", "0", k)
    ));
    s.push_str("(check-sat)\n");
    s
}

fn emit_inductive(m: u64, k: u64) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "; inductive step: ceiling M={m}, claimed bound K={k}. UNSAT to break => sound.\n"
    ));
    s.push_str(&preamble());
    // assume invariant_K(p,c)
    s.push_str(&format!("(assert {})\n", invariant_expr("p", "c", k)));
    // charge domain
    s.push_str("(assert (>= elapsed 0))\n");
    s.push_str("(assert (> a 0))\n");
    s.push_str("(assert (<= a per_tx))\n");
    s.push_str(&transition_defs(m));
    // assume accept
    s.push_str("(assert accept)\n");
    // NOT invariant_K(p1, c2)
    s.push_str(&format!(
        "(assert (not {}))\n",
        invariant_expr("p1", "c2", k)
    ));
    s.push_str("(check-sat)\n");
    s
}

fn emit_attainable(m: u64, k: u64) -> String {
    let mut s = String::new();
    s.push_str("; attainability: can an accepted charge reach p1+c2 == K*cap? SAT => tight.\n");
    s.push_str(&preamble());
    s.push_str(&format!("(assert {})\n", invariant_expr("p", "c", k)));
    s.push_str("(assert (>= elapsed 0))\n");
    s.push_str("(assert (> a 0))\n");
    s.push_str("(assert (<= a per_tx))\n");
    s.push_str(&transition_defs(m));
    s.push_str("(assert accept)\n");
    s.push_str(&format!("(assert (= (+ p1 c2) (* {k} W_cap)))\n"));
    s.push_str("(check-sat)\n");
    s
}

fn emit_unbounded() -> String {
    let mut s = String::new();
    s.push_str(
        "; unbounded witness: no aggregate cap. n charges of per_tx exceed K*cap\n\
         ; for arbitrary K (here 1000). SAT => window outflow is UNBOUNDED => REFUSE.\n",
    );
    s.push_str("(declare-const W_cap Int)\n");
    s.push_str("(declare-const per_tx Int)\n");
    s.push_str("(declare-const n Int)\n");
    s.push_str("(assert (> W_cap 0))\n");
    s.push_str("(assert (> per_tx 0))\n");
    s.push_str("(assert (<= per_tx W_cap))\n");
    s.push_str("(assert (> n 0))\n");
    s.push_str("(assert (> (* n per_tx) (* 1000 W_cap)))\n");
    s.push_str("(check-sat)\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inv(family: &str, ceiling: Ceiling, bound: u64) -> InvariantDecl {
        InvariantDecl {
            family: family.into(),
            ceiling,
            bound,
        }
    }

    #[test]
    fn unsupported_family_is_fail_closed() {
        let i = inv("token_bucket", Ceiling::Multiplier(2), 2);
        assert_eq!(
            emit(&i, Obligation::Inductive).unwrap_err(),
            CompileError::UnsupportedPolicy("token_bucket".into())
        );
    }

    #[test]
    fn ceiling_zero_is_fail_closed() {
        let i = inv("sliding_window", Ceiling::Multiplier(0), 2);
        assert!(matches!(
            emit(&i, Obligation::Inductive),
            Err(CompileError::UnsupportedPolicy(_))
        ));
    }

    #[test]
    fn inductive_smt_has_required_structure() {
        let i = inv("sliding_window", Ceiling::Multiplier(2), 2);
        let smt = emit(&i, Obligation::Inductive).unwrap();
        // base install-time invariants
        assert!(smt.contains("(assert (> W_cap 0))"));
        assert!(smt.contains("(assert (<= per_tx W_cap))"));
        assert!(smt.contains("(assert (<= W_cap (* 100 per_tx)))"));
        assert!(smt.contains("(assert (>= W 60))"));
        // transition: epoch roll, floor div, accept with ceiling 2
        assert!(smt.contains("(ite (>= elapsed W) (ite (< elapsed (* 2 W)) c 0) p)"));
        assert!(smt.contains("(div (* p1 remaining) W)"));
        assert!(smt.contains("(<= (+ p1 c1 a) (* 2 W_cap))"));
        // assert accept and the negated post-invariant with K=2
        assert!(smt.contains("(assert accept)"));
        assert!(smt.contains("(assert (not (and (>= p1 0)"));
        assert!(smt.contains("(<= (+ p1 c2) (* 2 W_cap))"));
        assert!(smt.trim_end().ends_with("(check-sat)"));
    }

    #[test]
    fn ceiling_multiplier_appears_in_aggregate_check() {
        let smt = emit(&inv("sliding_window", Ceiling::Multiplier(3), 2), Obligation::Inductive)
            .unwrap();
        assert!(smt.contains("(<= (+ p1 c1 a) (* 3 W_cap))"));
        // bound K=2 governs the invariant, not the ceiling.
        assert!(smt.contains("(<= (+ p1 c2) (* 2 W_cap))"));
    }

    #[test]
    fn base_smt_negates_invariant_at_origin() {
        let smt = emit(&inv("sliding_window", Ceiling::Multiplier(2), 2), Obligation::Base).unwrap();
        assert!(smt.contains("(assert (not (and (>= 0 0)"));
        assert!(smt.contains("(<= (+ 0 0) (* 2 W_cap))"));
        assert!(smt.trim_end().ends_with("(check-sat)"));
    }

    #[test]
    fn attainable_smt_pins_equality_to_k_cap() {
        let smt = emit(&inv("sliding_window", Ceiling::Multiplier(2), 2), Obligation::Attainable)
            .unwrap();
        assert!(smt.contains("(assert (= (+ p1 c2) (* 2 W_cap)))"));
        assert!(smt.contains("(assert accept)"));
    }

    #[test]
    fn unbounded_smt_for_none() {
        let smt = emit(&inv("sliding_window", Ceiling::None, 2), Obligation::Unbounded).unwrap();
        assert!(smt.contains("(declare-const n Int)"));
        assert!(smt.contains("(> (* n per_tx) (* 1000 W_cap))"));
        assert!(smt.trim_end().ends_with("(check-sat)"));
    }

    #[test]
    fn none_rejects_inductive_obligation() {
        // a per-tx-only policy has no inductive obligation; asking for it is a logic error.
        assert!(matches!(
            emit(&inv("sliding_window", Ceiling::None, 2), Obligation::Inductive),
            Err(CompileError::UnsupportedPolicy(_))
        ));
    }

    #[test]
    fn capped_rejects_unbounded_obligation() {
        assert!(matches!(
            emit(&inv("sliding_window", Ceiling::Multiplier(2), 2), Obligation::Unbounded),
            Err(CompileError::UnsupportedPolicy(_))
        ));
    }

    #[test]
    fn predecessor_helper_emits_k_minus_one() {
        let i = inv("sliding_window", Ceiling::Multiplier(2), 2);
        let (this, prev) = emit_inductive_with_predecessor(&i).unwrap();
        assert!(this.contains("(<= (+ p1 c2) (* 2 W_cap))"));
        let prev = prev.expect("k-1 obligation present for k=2");
        assert!(prev.contains("(<= (+ p1 c2) (* 1 W_cap))"));
    }

    #[test]
    fn predecessor_none_for_k_zero() {
        let i = inv("sliding_window", Ceiling::Multiplier(2), 0);
        let (_this, prev) = emit_inductive_with_predecessor(&i).unwrap();
        assert!(prev.is_none());
    }
}
