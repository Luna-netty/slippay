//! Discharge a spending-policy [`InvariantDecl`] against z3.
//!
//! [`crate::smt`] emits the SMT-LIB proof obligations as TEXT (zero-dependency).
//! This module discharges them by invoking z3 on a subprocess and parsing the
//! `sat`/`unsat` verdict, then assembling the canonical certificate:
//!
//! - **ISSUED K**: the inductive step at the claimed bound is `unsat` (sound),
//!   the bound is attainable (tight), and `K-1` is NOT inductive (minimal).
//! - **REFUSED**: ceiling = none is `sat` on the unbounded witness, OR the
//!   claimed bound could not be proved inductive. Fail-closed.
//!
//! ## z3 detection (two backends, no crate dependency)
//!
//! 1. the `z3` binary on `PATH` (`z3 -in`, feed SMT-LIB on stdin); else
//! 2. fall back to `python3 -c` using the installed `z3-solver`
//!    (`z3.parse_smt2_string` + `Solver`), printing `sat`/`unsat`.
//!
//! If neither backend is available, [`discharge`] returns
//! [`ProveError::NoSolver`] and the caller REFUSES (fail-closed — absence of a
//! checker is never a pass).

use std::io::Write;
use std::process::{Command, Stdio};

use crate::error::CompileError;
use crate::parse::{Ceiling, InvariantDecl};
use crate::smt::{self, Obligation};

/// A z3 verdict on one obligation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Sat,
    Unsat,
    Unknown,
}

/// Which solver backend serviced the discharge (reported by the CLI so the run
/// is reproducible / auditable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    /// The `z3` binary on PATH, fed SMT-LIB on stdin.
    Z3Binary,
    /// `python3 -c` driving the installed `z3-solver` package.
    Python3Z3,
}

impl Backend {
    pub fn describe(&self) -> &'static str {
        match self {
            Backend::Z3Binary => "z3 binary (PATH) — `z3 -in` on stdin",
            Backend::Python3Z3 => "python3 -c with z3-solver (z3.parse_smt2_string + Solver)",
        }
    }
}

/// Errors specific to discharging (distinct from compile/parse errors).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProveError {
    /// Neither a `z3` binary nor `python3` + `z3-solver` is available.
    NoSolver,
    /// The solver ran but its output could not be parsed into sat/unsat/unknown.
    UnparseableOutput(String),
    /// The solver subprocess failed to spawn or exited abnormally.
    SolverFailed(String),
    /// An obligation could not be lowered (propagated from [`crate::smt`]).
    Lowering(CompileError),
}

impl std::fmt::Display for ProveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProveError::NoSolver => write!(
                f,
                "no SMT solver available: neither `z3` on PATH nor `python3` + z3-solver"
            ),
            ProveError::UnparseableOutput(o) => write!(f, "could not parse solver output: {o}"),
            ProveError::SolverFailed(m) => write!(f, "solver invocation failed: {m}"),
            ProveError::Lowering(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ProveError {}

impl From<CompileError> for ProveError {
    fn from(e: CompileError) -> Self {
        ProveError::Lowering(e)
    }
}

/// The certificate verdict for an invariant directive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Certificate {
    /// The claimed (or corrected minimal) bound is proved sound and tight.
    Issued {
        /// The ceiling multiplier `M`, or `None` for per-tx-only (never Issued).
        ceiling: Ceiling,
        /// The proved bound `K` (window outflow `<= K * window_cap`).
        bound: u64,
        /// Whether the bound is attained (tight) and `K-1` is unsound (minimal).
        tight: bool,
        /// Diagnostic when the nominal ceiling is LOOSER than the proved bound
        /// (the weighted check binds tighter than the ceiling).
        diagnostic: Option<String>,
    },
    /// Fail-closed refusal: unbounded policy, or no provable bound.
    Refused { reason: String },
}

/// Locate an available solver backend, preferring the native `z3` binary.
pub fn detect_backend() -> Option<Backend> {
    if probe(Command::new("z3").arg("--version")) {
        return Some(Backend::Z3Binary);
    }
    // python3 present AND `import z3` succeeds.
    if probe(Command::new("python3").args(["-c", "import z3"])) {
        return Some(Backend::Python3Z3);
    }
    None
}

/// Run a probe command, returning true iff it spawns and exits 0.
fn probe(cmd: &mut Command) -> bool {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Discharge one SMT-LIB obligation, returning the z3 verdict.
pub fn check(backend: Backend, smt_text: &str) -> Result<Verdict, ProveError> {
    let out = match backend {
        Backend::Z3Binary => run_stdin(Command::new("z3").arg("-in"), smt_text)?,
        Backend::Python3Z3 => run_stdin(
            Command::new("python3").args(["-c", PY_DRIVER]),
            smt_text,
        )?,
    };
    parse_verdict(&out)
}

/// The python fallback: read SMT-LIB on stdin, parse it, check, print the verdict.
const PY_DRIVER: &str = "\
import sys, z3
src = sys.stdin.read()
s = z3.Solver()
s.add(z3.parse_smt2_string(src))
print(str(s.check()))
";

/// Spawn `cmd`, write `input` to its stdin, capture stdout. Maps spawn/IO/exit
/// failures to [`ProveError::SolverFailed`].
fn run_stdin(cmd: &mut Command, input: &str) -> Result<String, ProveError> {
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ProveError::SolverFailed(format!("spawn: {e}")))?;

    // Write the whole obligation to stdin, then drop the handle to send EOF.
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| ProveError::SolverFailed("child stdin unavailable".into()))?;
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| ProveError::SolverFailed(format!("write stdin: {e}")))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| ProveError::SolverFailed(format!("wait: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ProveError::SolverFailed(format!(
            "exit {:?}: {}",
            output.status.code(),
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Parse the LAST sat/unsat/unknown token from solver stdout. (z3 may emit
/// warnings or echo; the final `(check-sat)` verdict is what we want.)
fn parse_verdict(out: &str) -> Result<Verdict, ProveError> {
    let mut last = None;
    for tok in out.split_whitespace() {
        match tok {
            "sat" => last = Some(Verdict::Sat),
            "unsat" => last = Some(Verdict::Unsat),
            "unknown" => last = Some(Verdict::Unknown),
            _ => {}
        }
    }
    last.ok_or_else(|| ProveError::UnparseableOutput(out.trim().to_string()))
}

/// Discharge a full invariant directive and assemble its [`Certificate`].
///
/// Reproduces the canonical Python prover's decision procedure:
/// - ceiling = none => unbounded witness; SAT => REFUSED.
/// - ceiling = M => the claimed bound `K` must be inductive (`unsat`). If so,
///   tightness = attainable (`sat`) AND `K-1` not inductive (`sat`). If the
///   claimed `K` is NOT inductive, REFUSE (could not prove the claimed bound).
///   When `M > K`, attach the looser-ceiling diagnostic.
pub fn discharge(backend: Backend, inv: &InvariantDecl) -> Result<Certificate, ProveError> {
    match inv.ceiling {
        Ceiling::None => {
            let smt = smt::emit(inv, Obligation::Unbounded)?;
            let v = check(backend, &smt)?;
            // SAT (a witness exists) => unbounded => REFUSE. unsat/unknown also
            // REFUSE (fail-closed: we never ISSUE a per-tx-only policy).
            match v {
                Verdict::Sat => Ok(Certificate::Refused {
                    reason: "unbounded: no aggregate cap (per-tx cap only)".into(),
                }),
                _ => Ok(Certificate::Refused {
                    reason: "no aggregate cap; could not exhibit a finite bound".into(),
                }),
            }
        }
        Ceiling::Multiplier(m) => {
            let k = inv.bound;
            // 1. claimed bound must be inductive.
            let ind = check(backend, &smt::emit(inv, Obligation::Inductive)?)?;
            if ind != Verdict::Unsat {
                return Ok(Certificate::Refused {
                    reason: format!(
                        "claimed bound K={k} is NOT inductive under ceiling M={m} \
                         (inductive step is {ind:?}, expected unsat)"
                    ),
                });
            }
            // 2. tightness: attained AND K-1 not inductive.
            let attainable = check(backend, &smt::emit(inv, Obligation::Attainable)?)?;
            let pred_not_inductive = if k <= 1 {
                // K=0 is degenerate; K=1's predecessor (0) is trivially unsound,
                // matching the Python `K == 1 or not is_inductive(M, K-1)`.
                true
            } else {
                let pred = InvariantDecl {
                    family: inv.family.clone(),
                    ceiling: inv.ceiling.clone(),
                    bound: k - 1,
                };
                check(backend, &smt::emit(&pred, Obligation::Inductive)?)? != Verdict::Unsat
            };
            let tight = attainable == Verdict::Sat && pred_not_inductive;

            // 3. diagnostic: nominal ceiling looser than proved bound.
            let diagnostic = if m > k {
                Some(format!(
                    "nominal ceiling {m}*window_cap is LOOSER than the proved bound \
                     {k}*window_cap — the weighted check binds tighter than the ceiling"
                ))
            } else {
                None
            };

            Ok(Certificate::Issued {
                ceiling: inv.ceiling.clone(),
                bound: k,
                tight,
                diagnostic,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_verdict_picks_last_token() {
        assert_eq!(parse_verdict("unsat\n").unwrap(), Verdict::Unsat);
        assert_eq!(parse_verdict("sat").unwrap(), Verdict::Sat);
        assert_eq!(parse_verdict("unknown\n").unwrap(), Verdict::Unknown);
        // a warning line followed by the real verdict
        assert_eq!(
            parse_verdict("WARNING: blah\nunsat\n").unwrap(),
            Verdict::Unsat
        );
        assert!(matches!(
            parse_verdict("garbage with no verdict"),
            Err(ProveError::UnparseableOutput(_))
        ));
    }

    #[test]
    fn no_solver_displays_clearly() {
        assert_eq!(
            ProveError::NoSolver.to_string(),
            "no SMT solver available: neither `z3` on PATH nor `python3` + z3-solver"
        );
    }

    #[test]
    fn lowering_error_propagates_unsupported_family() {
        let inv = InvariantDecl {
            family: "token_bucket".into(),
            ceiling: Ceiling::Multiplier(2),
            bound: 2,
        };
        // detect a backend lazily; if none, the unsupported-family error must
        // still surface (lowering happens before the solver runs).
        let backend = detect_backend().unwrap_or(Backend::Z3Binary);
        let res = discharge(backend, &inv);
        assert!(matches!(
            res,
            Err(ProveError::Lowering(CompileError::UnsupportedPolicy(_)))
        ));
    }
}
