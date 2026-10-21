//! Integration suite for the `invariant` directive: parse, SMT-LIB emission,
//! and end-to-end `axlc prove` discharge against z3.
//!
//! The end-to-end cases reproduce the canonical Python prover's verdicts
//! (`agents/axl/proofs/spending_policy_prover.py`):
//!   - ceiling = 2 (deployed) -> ISSUED K=2, tight
//!   - ceiling = 1            -> ISSUED K=1, tight
//!   - ceiling = 3            -> ISSUED K=2, tight, + looser-ceiling diagnostic
//!   - ceiling = none         -> REFUSED (unbounded, fail-closed, exit 2)
//!   - unsupported family     -> CompileError (fail-closed, exit 1)
//!
//! Prove cases are skipped (not failed) if NO solver backend is available, so
//! the suite stays green on a machine without z3. Parse + emission cases never
//! need a solver and always run.

use std::io::Write;
use std::process::{Command, Stdio};

use axl_compiler::parse::{parse_agent, parse_invariant, Ceiling, InvariantDecl};
use axl_compiler::prove::{detect_backend, discharge, Certificate, Verdict};
use axl_compiler::smt::{self, Obligation};
use axl_compiler::CompileError;

// ── parse ──────────────────────────────────────────────────────────────────

#[test]
fn parse_valid_sliding_window_variants() {
    let m2 = parse_agent("agent W { invariant -> sliding_window(ceiling = 2) bound 2 }").unwrap();
    assert_eq!(
        m2.invariant,
        Some(InvariantDecl {
            family: "sliding_window".into(),
            ceiling: Ceiling::Multiplier(2),
            bound: 2,
        })
    );
    let none = parse_agent("agent W { invariant -> sliding_window(ceiling = none) bound 2 }").unwrap();
    assert_eq!(none.invariant.unwrap().ceiling, Ceiling::None);
}

#[test]
fn parse_malformed_invariant_is_compile_error() {
    for bad in [
        "agent W { invariant -> sliding_window(ceiling = 2) }",   // no bound
        "agent W { invariant -> sliding_window(2) bound 2 }",     // no ceiling kw
        "agent W { invariant -> sliding_window ceiling = 2 bound 2 }", // no parens
        "agent W { invariant -> sliding_window(ceiling = 2) bound x }", // bad K
        "agent W { invariant -> nonsense }",                      // garbage
    ] {
        assert!(
            matches!(parse_agent(bad), Err(CompileError::MalformedInvariant(_))),
            "expected MalformedInvariant for {bad:?}"
        );
    }
}

#[test]
fn parse_unsupported_family_records_into_ast_then_fails_at_lowering() {
    // parse keeps the family verbatim ...
    let spec = parse_agent("agent W { invariant -> token_bucket(ceiling = 2) bound 2 }").unwrap();
    let inv = spec.invariant.unwrap();
    assert_eq!(inv.family, "token_bucket");
    // ... lowering is where the fail-closed rejection happens.
    assert_eq!(
        smt::emit(&inv, Obligation::Inductive).unwrap_err(),
        CompileError::UnsupportedPolicy("token_bucket".into())
    );
}

#[test]
fn parse_invariant_direct() {
    assert_eq!(
        parse_invariant("sliding_window(ceiling = 2) bound 2").unwrap(),
        InvariantDecl { family: "sliding_window".into(), ceiling: Ceiling::Multiplier(2), bound: 2 }
    );
}

// ── SMT-LIB emission (golden-ish structural assertions) ──────────────────────

fn inv(ceiling: Ceiling, bound: u64) -> InvariantDecl {
    InvariantDecl { family: "sliding_window".into(), ceiling, bound }
}

#[test]
fn emit_inductive_reproduces_canonical_transition() {
    let smt = smt::emit(&inv(Ceiling::Multiplier(2), 2), Obligation::Inductive).unwrap();
    // install-time base
    for needle in [
        "(assert (> W_cap 0))",
        "(assert (> per_tx 0))",
        "(assert (<= per_tx W_cap))",
        "(assert (<= W_cap (* 100 per_tx)))",
        "(assert (>= W 60))",
    ] {
        assert!(smt.contains(needle), "missing {needle}");
    }
    // epoch roll (carry/drop/keep) + floor div weighted_prev
    assert!(smt.contains("(ite (>= elapsed W) (ite (< elapsed (* 2 W)) c 0) p)"));
    assert!(smt.contains("(div (* p1 remaining) W)"));
    // accept: weighted check + aggregate ceiling M=2
    assert!(smt.contains("(<= (+ weighted_prev c1 a) W_cap)"));
    assert!(smt.contains("(<= (+ p1 c1 a) (* 2 W_cap))"));
    // assume accept, negate post-invariant with K=2
    assert!(smt.contains("(assert accept)"));
    assert!(smt.contains("(assert (not (and (>= p1 0)"));
    assert!(smt.contains("(<= (+ p1 c2) (* 2 W_cap))"));
    assert!(smt.trim_end().ends_with("(check-sat)"));
}

#[test]
fn emit_distinguishes_ceiling_from_bound() {
    // M=3 ceiling, K=2 bound: ceiling drives accept, bound drives invariant.
    let smt = smt::emit(&inv(Ceiling::Multiplier(3), 2), Obligation::Inductive).unwrap();
    assert!(smt.contains("(<= (+ p1 c1 a) (* 3 W_cap))")); // ceiling 3
    assert!(smt.contains("(<= (+ p1 c2) (* 2 W_cap))")); // bound 2
}

#[test]
fn emit_unbounded_witness_for_none() {
    let smt = smt::emit(&inv(Ceiling::None, 2), Obligation::Unbounded).unwrap();
    assert!(smt.contains("(declare-const n Int)"));
    assert!(smt.contains("(> (* n per_tx) (* 1000 W_cap))"));
}

#[test]
fn emit_fail_closed_on_unsupported_family() {
    let bad = InvariantDecl { family: "leaky_bucket".into(), ceiling: Ceiling::Multiplier(2), bound: 2 };
    assert!(matches!(
        smt::emit(&bad, Obligation::Inductive),
        Err(CompileError::UnsupportedPolicy(_))
    ));
}

// ── library-level discharge (when a solver is present) ───────────────────────

#[test]
fn discharge_matches_canonical_verdicts() {
    let Some(backend) = detect_backend() else {
        eprintln!("SKIP discharge_matches_canonical_verdicts: no solver backend");
        return;
    };

    // M=2 -> ISSUED K=2 tight, no diagnostic
    match discharge(backend, &inv(Ceiling::Multiplier(2), 2)).unwrap() {
        Certificate::Issued { bound, tight, diagnostic, .. } => {
            assert_eq!(bound, 2);
            assert!(tight);
            assert!(diagnostic.is_none());
        }
        c => panic!("M=2 expected Issued, got {c:?}"),
    }

    // M=1 -> ISSUED K=1 tight
    match discharge(backend, &inv(Ceiling::Multiplier(1), 1)).unwrap() {
        Certificate::Issued { bound, tight, .. } => {
            assert_eq!(bound, 1);
            assert!(tight);
        }
        c => panic!("M=1 expected Issued, got {c:?}"),
    }

    // M=3, K=2 -> ISSUED K=2 tight + looser-ceiling diagnostic
    match discharge(backend, &inv(Ceiling::Multiplier(3), 2)).unwrap() {
        Certificate::Issued { bound, tight, diagnostic, .. } => {
            assert_eq!(bound, 2);
            assert!(tight);
            assert!(diagnostic.is_some(), "M=3 should carry the looser-ceiling diagnostic");
        }
        c => panic!("M=3 expected Issued, got {c:?}"),
    }

    // none -> REFUSED (unbounded)
    match discharge(backend, &inv(Ceiling::None, 2)).unwrap() {
        Certificate::Refused { reason } => assert!(reason.contains("unbounded")),
        c => panic!("none expected Refused, got {c:?}"),
    }
}

#[test]
fn discharge_refuses_overclaimed_bound() {
    let Some(backend) = detect_backend() else {
        eprintln!("SKIP discharge_refuses_overclaimed_bound: no solver backend");
        return;
    };
    // claim K=1 under ceiling M=2: NOT inductive (the deployed policy needs K=2).
    // Fail-closed: REFUSED, never silently downgraded to a pass.
    match discharge(backend, &inv(Ceiling::Multiplier(2), 1)).unwrap() {
        Certificate::Refused { reason } => assert!(reason.contains("NOT inductive")),
        c => panic!("overclaimed K=1@M=2 expected Refused, got {c:?}"),
    }
}

#[test]
fn check_inductive_obligation_is_unsat_for_deployed_policy() {
    let Some(backend) = detect_backend() else {
        eprintln!("SKIP check_inductive_obligation_is_unsat: no solver backend");
        return;
    };
    let smt = smt::emit(&inv(Ceiling::Multiplier(2), 2), Obligation::Inductive).unwrap();
    assert_eq!(axl_compiler::prove::check(backend, &smt).unwrap(), Verdict::Unsat);
    // the unbounded witness is SAT
    let smt_unb = smt::emit(&inv(Ceiling::None, 2), Obligation::Unbounded).unwrap();
    assert_eq!(axl_compiler::prove::check(backend, &smt_unb).unwrap(), Verdict::Sat);
}

// ── end-to-end CLI: `axlc prove` exit codes + output ─────────────────────────

fn run_prove(spec: &str) -> (i32, String, String) {
    let exe = env!("CARGO_BIN_EXE_axlc");
    let mut child = Command::new(exe)
        .args(["prove", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn axlc");
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(spec.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn cli_prove_m2_issues_k2() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_prove_m2_issues_k2: no solver backend");
        return;
    }
    let (code, out, _) = run_prove("agent W { invariant -> sliding_window(ceiling = 2) bound 2 }");
    assert_eq!(code, 0, "M=2 should ISSUE (exit 0)");
    assert!(out.contains("certified bound K = 2"));
    assert!(out.contains("ISSUED"));
    assert!(!out.contains("DIAGNOSTIC"), "M=2 has no looser-ceiling diagnostic");
}

#[test]
fn cli_prove_m1_issues_k1() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_prove_m1_issues_k1: no solver backend");
        return;
    }
    let (code, out, _) = run_prove("agent W { invariant -> sliding_window(ceiling = 1) bound 1 }");
    assert_eq!(code, 0);
    assert!(out.contains("certified bound K = 1"));
    assert!(out.contains("ISSUED"));
}

#[test]
fn cli_prove_m3_issues_k2_with_diagnostic() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_prove_m3_issues_k2_with_diagnostic: no solver backend");
        return;
    }
    let (code, out, _) = run_prove("agent W { invariant -> sliding_window(ceiling = 3) bound 2 }");
    assert_eq!(code, 0);
    assert!(out.contains("certified bound K = 2"));
    assert!(out.contains("DIAGNOSTIC"));
    assert!(out.contains("LOOSER"));
    assert!(out.contains("ISSUED"));
}

#[test]
fn cli_prove_none_refuses_with_exit_2() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_prove_none_refuses_with_exit_2: no solver backend");
        return;
    }
    let (code, out, _) = run_prove("agent W { invariant -> sliding_window(ceiling = none) bound 2 }");
    assert_eq!(code, 2, "unbounded policy => REFUSED => exit 2");
    assert!(out.contains("REFUSED"));
    assert!(out.contains("unbounded"));
}

#[test]
fn cli_prove_unsupported_family_fails_closed_exit_1() {
    // No solver needed: lowering rejects the family before any discharge.
    let (code, _out, err) = run_prove("agent W { invariant -> token_bucket(ceiling = 2) bound 2 }");
    assert_eq!(code, 1, "unsupported family => CompileError => exit 1");
    assert!(err.contains("unsupported policy family: token_bucket"));
}

#[test]
fn cli_prove_no_invariant_is_usage_error() {
    let (code, _out, err) = run_prove("agent W { bind -> [propose_payment] }");
    assert_eq!(code, 1);
    assert!(err.contains("declares no `invariant"));
}

#[test]
fn cli_prove_emit_smt_does_not_invoke_solver() {
    // --emit-smt prints obligations and exits 0 regardless of solver presence.
    let exe = env!("CARGO_BIN_EXE_axlc");
    let mut child = Command::new(exe)
        .args(["prove", "-", "--emit-smt"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(b"agent W { invariant -> sliding_window(ceiling = 2) bound 2 }")
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    let s = String::from_utf8_lossy(&out.stdout);
    assert!(s.contains("(check-sat)"));
    assert!(s.contains("obligation: inductive step"));
    assert!(s.contains("obligation: base case"));
}
