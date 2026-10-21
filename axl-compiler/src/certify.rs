//! Proof-carrying certificates: turn an `axlc prove` discharge into a
//! deterministic, independently-verifiable artifact that binds a proof to the
//! EXACT spec bytes and to the on-chain install parameters.
//!
//! ## Why this is the moat (not the proof itself)
//!
//! The z3 proof of the sliding-window bound is replicable — a competent FV
//! engineer ports the ~40-line SMT model in weeks. What is NOT freely
//! replicable is making that proof **inescapable, portable, and bound to the
//! deployment**:
//!
//! - **inescapable**: `verify_cert` re-discharges and asserts byte-equality, so
//!   a CI merge-gate (or a counterparty) can reject any spec whose deployed
//!   bound drifted from its proof. (Closes the "axlc-gate is fictional / proof
//!   can silently drift" gap.)
//! - **portable**: the certificate is a small JSON a third party verifies with
//!   `axlc verify-cert` — the substrate for a network standard / forcing
//!   function ("present a valid certificate to participate").
//! - **bound to deployment**: `spec_sha256` is a real SHA-256 of the spec (the
//!   genuine value for the contract's `ssl_hash`), and `onchain.window_cap_
//!   multiplier` is the PROVED bound K, so the conformance test can read K from
//!   the certificate instead of hard-coding `window_cap * 2`. (Closes the
//!   "K hard-coded, not read from the certificate" and "ssl_hash is dummy
//!   'ab'.repeat(32)" gaps.)
//!
//! The certificate carries ONLY what is mechanically checkable. The solver
//! identity (`backend`) is recorded for auditability but is NOT part of the
//! verified (load-bearing) view — the verdict must reproduce, the solver that
//! produced it is metadata.

use crate::parse::{Ceiling, InvariantDecl};
use crate::prove::Certificate;
use crate::sha256::{sha256, to_hex};
use crate::value::Value;

/// The crate version stamped into the certificate. A version bump invalidates
/// existing certificates (re-certify), because the proof/lowering semantics are
/// versioned with the compiler.
pub const AXL_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The certificate's `kind` tag — a stable discriminator a verifier keys on.
pub const CERT_KIND: &str = "axl-proof-certificate";

/// The fixed real-time-window multiplier the deployed smart-wallet enforces
/// (`prev_spent + cur_spent + amount <= 2 * window_cap`, lib.rs N-A3). A
/// certificate whose proved bound does NOT equal the on-chain multiplier is a
/// conformance failure and is surfaced by [`build_certificate`]'s diagnostic.
pub const ONCHAIN_ENFORCED_MULTIPLIER: u64 = 2;

/// The comparable, load-bearing projection of a certificate — everything that
/// must reproduce for the certificate to be valid. Excludes purely
/// informational fields (`backend`, free-text `claim`). Derived from a [`Value`]
/// fail-closed: any missing/ill-typed required field yields `None`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadBearing {
    pub kind: String,
    pub axl_version: String,
    pub spec_sha256: String,
    pub agent: String,
    pub family: String,
    /// Normalized ceiling token: `"none"` or the decimal multiplier.
    pub ceiling: String,
    pub bound: u64,
    pub verdict: String,
    /// Present (Some) only for an ISSUED certificate.
    pub tight: Option<bool>,
    /// Present (Some) only for an ISSUED certificate: the on-chain `ssl_hash`
    /// (== spec_sha256) and the enforced window multiplier (== bound K).
    pub onchain_ssl_hash: Option<String>,
    pub onchain_multiplier: Option<u64>,
}

/// Build a deterministic certificate [`Value`] from a discharge result.
///
/// Pure assembly: no solver is invoked here (the caller runs
/// [`crate::prove::discharge`] and passes its [`Certificate`]). `spec_src` is the
/// EXACT spec text whose SHA-256 binds the certificate to its source.
pub fn build_certificate(
    spec_src: &str,
    agent: &str,
    inv: &InvariantDecl,
    verdict: &Certificate,
    backend_desc: &str,
) -> Value {
    let spec_hash = to_hex(&sha256(spec_src.as_bytes()));

    let ceiling_value = match inv.ceiling {
        Ceiling::Multiplier(m) => Value::Number(m as f64),
        Ceiling::None => Value::String("none".to_string()),
    };
    let invariant = Value::Object(vec![
        ("family".to_string(), Value::String(inv.family.clone())),
        ("ceiling".to_string(), ceiling_value),
        ("bound".to_string(), Value::Number(inv.bound as f64)),
    ]);

    // Fields shared by both verdicts, in a fixed order (determinism).
    let mut fields: Vec<(String, Value)> = vec![
        ("kind".to_string(), Value::String(CERT_KIND.to_string())),
        ("axl_version".to_string(), Value::String(AXL_VERSION.to_string())),
        ("spec_sha256".to_string(), Value::String(spec_hash.clone())),
        ("agent".to_string(), Value::String(agent.to_string())),
        ("invariant".to_string(), invariant),
    ];

    match verdict {
        Certificate::Issued { bound, tight, diagnostic, .. } => {
            fields.push(("verdict".to_string(), Value::String("ISSUED".to_string())));
            fields.push(("tight".to_string(), Value::Bool(*tight)));
            fields.push((
                "diagnostic".to_string(),
                match diagnostic {
                    Some(d) => Value::String(d.clone()),
                    None => Value::Null,
                },
            ));
            // The on-chain binding: the proved bound K IS the window multiplier
            // the deployed contract must enforce, and the spec hash IS the
            // session's ssl_hash. A conformance test reads K from here instead of
            // hard-coding `window_cap * 2`.
            let onchain = Value::Object(vec![
                ("ssl_hash".to_string(), Value::String(spec_hash.clone())),
                ("window_cap_multiplier".to_string(), Value::Number(*bound as f64)),
                (
                    "claim".to_string(),
                    Value::String(format!(
                        "real-time window outflow <= {bound} * window_cap"
                    )),
                ),
                (
                    "matches_deployed_enforcement".to_string(),
                    Value::Bool(*bound == ONCHAIN_ENFORCED_MULTIPLIER),
                ),
            ]);
            fields.push(("onchain".to_string(), onchain));
        }
        Certificate::Refused { reason } => {
            fields.push(("verdict".to_string(), Value::String("REFUSED".to_string())));
            fields.push(("refused_reason".to_string(), Value::String(reason.clone())));
            fields.push(("onchain".to_string(), Value::Null));
        }
    }

    fields.push(("backend".to_string(), Value::String(backend_desc.to_string())));
    Value::Object(fields)
}

/// Extract the load-bearing projection of a certificate, fail-closed.
pub fn load_bearing_view(cert: &Value) -> Option<LoadBearing> {
    // A non-object certificate has no fields — fail closed.
    if !matches!(cert, Value::Object(_)) {
        return None;
    }

    let as_string = |v: Value| -> Option<String> {
        match v {
            Value::String(s) => Some(s),
            _ => None,
        }
    };
    let as_u64 = |v: Value| -> Option<u64> {
        match v {
            Value::Number(n) if n.is_finite() && n >= 0.0 && n.fract() == 0.0 => Some(n as u64),
            _ => None,
        }
    };
    // Normalize a ceiling operand to a comparison token: a non-negative integer
    // renders as its decimal; the literal `none` stays `none`. Anything else is
    // malformed (fail-closed).
    let ceiling_token = |v: Value| -> Option<String> {
        match v {
            Value::Number(n) if n.is_finite() && n >= 0.0 && n.fract() == 0.0 => {
                Some(format!("{}", n as u64))
            }
            Value::String(s) => Some(s),
            _ => None,
        }
    };

    // Required fields — absence/ill-type fails the whole projection.
    let kind = as_string(cert.get("kind"))?;
    let axl_version = as_string(cert.get("axl_version"))?;
    let spec_sha256 = as_string(cert.get("spec_sha256"))?;
    let agent = as_string(cert.get("agent"))?;
    let family = as_string(cert.resolve_path("invariant.family"))?;
    let ceiling = ceiling_token(cert.resolve_path("invariant.ceiling"))?;
    let bound = as_u64(cert.resolve_path("invariant.bound"))?;
    let verdict = as_string(cert.get("verdict"))?;

    // Optional fields — present only for ISSUED. A present-but-ill-typed `tight`
    // is malformed (fail-closed); absent is a clean None.
    let tight = match cert.get("tight") {
        Value::Bool(b) => Some(b),
        Value::Undefined => None,
        _ => return None,
    };
    let onchain_ssl_hash = as_string(cert.resolve_path("onchain.ssl_hash"));
    let onchain_multiplier = as_u64(cert.resolve_path("onchain.window_cap_multiplier"));

    Some(LoadBearing {
        kind,
        axl_version,
        spec_sha256,
        agent,
        family,
        ceiling,
        bound,
        verdict,
        tight,
        onchain_ssl_hash,
        onchain_multiplier,
    })
}

/// Verify a provided certificate against a freshly recomputed one. Valid iff both
/// project to a load-bearing view AND those views are equal. Returns the list of
/// mismatched field descriptions when invalid (empty list ⇒ a view failed to
/// parse).
pub fn verify(provided: &Value, recomputed: &Value) -> Result<(), Vec<String>> {
    let lr = match load_bearing_view(recomputed) {
        Some(v) => v,
        None => return Err(vec!["recomputed certificate is malformed".to_string()]),
    };
    let lp = match load_bearing_view(provided) {
        Some(v) => v,
        None => {
            return Err(vec![
                "provided certificate is malformed or missing required fields".to_string(),
            ])
        }
    };

    let mut errs = Vec::new();
    let mut diff = |field: &str, p: String, r: String| {
        if p != r {
            errs.push(format!("{field}: provided={p:?} recomputed={r:?}"));
        }
    };
    diff("kind", lp.kind, lr.kind);
    diff("axl_version", lp.axl_version, lr.axl_version);
    diff("spec_sha256", lp.spec_sha256, lr.spec_sha256);
    diff("agent", lp.agent, lr.agent);
    diff("family", lp.family, lr.family);
    diff("ceiling", lp.ceiling, lr.ceiling);
    diff("bound", lp.bound.to_string(), lr.bound.to_string());
    diff("verdict", lp.verdict, lr.verdict);
    diff("tight", format!("{:?}", lp.tight), format!("{:?}", lr.tight));
    diff(
        "onchain.ssl_hash",
        format!("{:?}", lp.onchain_ssl_hash),
        format!("{:?}", lr.onchain_ssl_hash),
    );
    diff(
        "onchain.window_cap_multiplier",
        format!("{:?}", lp.onchain_multiplier),
        format!("{:?}", lr.onchain_multiplier),
    );

    if errs.is_empty() {
        Ok(())
    } else {
        Err(errs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json;

    fn issued_m2() -> Certificate {
        Certificate::Issued {
            ceiling: Ceiling::Multiplier(2),
            bound: 2,
            tight: true,
            diagnostic: None,
        }
    }

    fn inv_m2() -> InvariantDecl {
        InvariantDecl {
            family: "sliding_window".into(),
            ceiling: Ceiling::Multiplier(2),
            bound: 2,
        }
    }

    const SPEC_M2: &str =
        "agent AgentWallet {\n  bind -> [read_balance, propose_payment]\n  invariant -> sliding_window(ceiling = 2) bound 2\n}\n";

    // ── build_certificate: ISSUED ──
    #[test]
    fn issued_cert_has_expected_load_bearing_fields() {
        let cert = build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary");
        let lb = load_bearing_view(&cert).expect("issued cert must project");
        assert_eq!(lb.kind, CERT_KIND);
        assert_eq!(lb.axl_version, AXL_VERSION);
        assert_eq!(lb.spec_sha256, to_hex(&sha256(SPEC_M2.as_bytes())));
        assert_eq!(lb.agent, "AgentWallet");
        assert_eq!(lb.family, "sliding_window");
        assert_eq!(lb.ceiling, "2");
        assert_eq!(lb.bound, 2);
        assert_eq!(lb.verdict, "ISSUED");
        assert_eq!(lb.tight, Some(true));
        // on-chain binding: ssl_hash == spec hash, multiplier == proved K.
        assert_eq!(lb.onchain_ssl_hash.as_deref(), Some(lb.spec_sha256.as_str()));
        assert_eq!(lb.onchain_multiplier, Some(2));
    }

    #[test]
    fn issued_cert_is_deterministic() {
        // Same inputs ⇒ byte-identical serialization (determinism is required for
        // a verifiable artifact).
        let a = json::to_string(&build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary"));
        let b = json::to_string(&build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary"));
        assert_eq!(a, b);
    }

    #[test]
    fn backend_is_not_load_bearing() {
        // Two certs differing ONLY in backend must verify against each other —
        // the solver identity is metadata, the verdict is what must reproduce.
        let a = build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary (PATH)");
        let b = build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "python3 + z3-solver");
        assert!(verify(&a, &b).is_ok());
    }

    // ── build_certificate: REFUSED ──
    #[test]
    fn refused_cert_omits_tight_and_onchain() {
        let refused = Certificate::Refused {
            reason: "claimed bound K=1 is NOT inductive under ceiling M=2".into(),
        };
        let inv = InvariantDecl {
            family: "sliding_window".into(),
            ceiling: Ceiling::Multiplier(2),
            bound: 1,
        };
        let cert = build_certificate(SPEC_M2, "AgentWallet", &inv, &refused, "z3 binary");
        let lb = load_bearing_view(&cert).expect("refused cert must project");
        assert_eq!(lb.verdict, "REFUSED");
        assert_eq!(lb.tight, None);
        assert_eq!(lb.onchain_ssl_hash, None);
        assert_eq!(lb.onchain_multiplier, None);
    }

    #[test]
    fn ceiling_none_normalizes_to_none_token() {
        let refused = Certificate::Refused { reason: "unbounded".into() };
        let inv = InvariantDecl {
            family: "sliding_window".into(),
            ceiling: Ceiling::None,
            bound: 2,
        };
        let cert = build_certificate(SPEC_M2, "AgentWallet", &inv, &refused, "z3 binary");
        let lb = load_bearing_view(&cert).unwrap();
        assert_eq!(lb.ceiling, "none");
    }

    // ── verify: round-trip + tamper detection ──
    #[test]
    fn verify_accepts_identical() {
        let cert = build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary");
        assert!(verify(&cert, &cert).is_ok());
    }

    #[test]
    fn verify_rejects_tampered_bound() {
        // Serialize, flip the proved bound in the JSON, re-parse: verification
        // must fail (this is the drift a CI gate catches).
        let cert = build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary");
        let tampered_src = json::to_string(&cert).replace("\"bound\":2", "\"bound\":3");
        assert_ne!(tampered_src, json::to_string(&cert), "tamper must change the text");
        let tampered = json::parse(&tampered_src).unwrap();
        let errs = verify(&tampered, &cert).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("bound")), "errors: {errs:?}");
    }

    #[test]
    fn verify_rejects_spec_hash_mismatch() {
        // A certificate minted for a DIFFERENT spec must not verify against this
        // spec's recomputed certificate.
        let other_spec = "agent AgentWallet {\n  invariant -> sliding_window(ceiling = 2) bound 2\n}\n";
        let provided = build_certificate(other_spec, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary");
        let recomputed = build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary");
        let errs = verify(&provided, &recomputed).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("spec_sha256")), "errors: {errs:?}");
    }

    #[test]
    fn malformed_cert_fails_closed() {
        // A non-object, or an object missing required fields, projects to None and
        // verify treats it as invalid (never a silent pass).
        assert!(load_bearing_view(&Value::Null).is_none());
        assert!(load_bearing_view(&Value::Object(vec![])).is_none());
        let good = build_certificate(SPEC_M2, "AgentWallet", &inv_m2(), &issued_m2(), "z3 binary");
        assert!(verify(&Value::Null, &good).is_err());
    }
}
