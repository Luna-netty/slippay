//! Integration suite for proof-carrying certificates: `axlc certify` and
//! `axlc verify-cert` end-to-end against z3.
//!
//! The library core (SHA-256, certificate assembly, load-bearing view, verify)
//! is unit-tested strict-TDD in `src/sha256.rs` and `src/certify.rs`. THESE
//! cases are the end-to-end regression net over the thin CLI glue + the real z3
//! discharge: the certificate reproduces, and a drifted bound / swapped spec is
//! caught fail-closed (the merge-gate behavior).
//!
//! Discharge cases are skipped (not failed) when no solver backend is available,
//! matching `invariant_prove.rs`, so the suite stays green without z3.

use std::io::Write;
use std::process::{Command, Stdio};

use axl_compiler::prove::detect_backend;
use axl_compiler::sha256::{sha256, to_hex};

const SPEC_M2: &str =
    "agent AgentWallet {\n  bind -> [read_balance, propose_payment]\n  invariant -> sliding_window(ceiling = 2) bound 2\n}\n";
const SPEC_M1: &str =
    "agent AgentWalletStrict {\n  bind -> [propose_payment]\n  invariant -> sliding_window(ceiling = 1) bound 1\n}\n";
const SPEC_NONE: &str =
    "agent AgentWalletNaive {\n  bind -> [propose_payment]\n  invariant -> sliding_window(ceiling = none) bound 2\n}\n";

/// Run an axlc subcommand feeding `spec` on stdin (spec path `-`). Returns
/// (exit_code, stdout, stderr).
fn run(args: &[&str], spec: &str) -> (i32, String, String) {
    let exe = env!("CARGO_BIN_EXE_axlc");
    let mut child = Command::new(exe)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn axlc");
    child.stdin.as_mut().unwrap().write_all(spec.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Write `contents` to a uniquely-named temp file and return its path.
fn temp_file(tag: &str, contents: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!("axlc_cert_test_{}_{}.json", std::process::id(), tag));
    std::fs::write(&p, contents).unwrap();
    p
}

#[test]
fn cli_certify_m2_issues_and_binds_onchain() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_certify_m2_issues_and_binds_onchain: no solver backend");
        return;
    }
    let (code, out, _) = run(&["certify", "-"], SPEC_M2);
    assert_eq!(code, 0, "M=2 ISSUES => exit 0");
    assert!(out.contains("\"kind\": \"axl-proof-certificate\""));
    assert!(out.contains("\"verdict\": \"ISSUED\""));
    assert!(out.contains("\"window_cap_multiplier\": 2"));
    assert!(out.contains("\"matches_deployed_enforcement\": true"));
    // The certificate's spec_sha256 IS the real SHA-256 of the spec bytes — the
    // genuine value for the on-chain ssl_hash.
    let expected_hash = to_hex(&sha256(SPEC_M2.as_bytes()));
    assert!(out.contains(&expected_hash), "cert must carry the real spec sha256");
    // ssl_hash must equal spec_sha256 (binding is to THIS spec).
    let occurrences = out.matches(&expected_hash).count();
    assert!(occurrences >= 2, "spec_sha256 also appears as onchain.ssl_hash");
}

#[test]
fn cli_certify_then_verify_roundtrips() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_certify_then_verify_roundtrips: no solver backend");
        return;
    }
    let (code, cert, _) = run(&["certify", "-"], SPEC_M2);
    assert_eq!(code, 0);
    let path = temp_file("roundtrip", &cert);
    let (vcode, vout, _) = run(&["verify-cert", "-", "--cert", path.to_str().unwrap()], SPEC_M2);
    assert_eq!(vcode, 0, "fresh certificate must verify VALID");
    assert!(vout.contains("VALID"));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn cli_verify_cert_detects_bound_drift() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_verify_cert_detects_bound_drift: no solver backend");
        return;
    }
    let (_, cert, _) = run(&["certify", "-"], SPEC_M2);
    // Tamper the proved bound — the drift a CI gate must catch.
    let tampered = cert.replace("\"bound\": 2", "\"bound\": 3");
    assert_ne!(tampered, cert, "tamper must change the certificate text");
    let path = temp_file("drift", &tampered);
    let (vcode, _vout, verr) = run(&["verify-cert", "-", "--cert", path.to_str().unwrap()], SPEC_M2);
    assert_eq!(vcode, 2, "drifted bound => INVALID => exit 2");
    assert!(verr.contains("INVALID"));
    assert!(verr.contains("bound"), "the mismatched field is named");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn cli_verify_cert_detects_spec_swap() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_verify_cert_detects_spec_swap: no solver backend");
        return;
    }
    // A certificate minted for M2 must not verify against a DIFFERENT spec (M1).
    let (_, cert_m2, _) = run(&["certify", "-"], SPEC_M2);
    let path = temp_file("swap", &cert_m2);
    let (vcode, _vout, verr) = run(&["verify-cert", "-", "--cert", path.to_str().unwrap()], SPEC_M1);
    assert_eq!(vcode, 2, "cert minted for another spec => INVALID");
    assert!(verr.contains("spec_sha256"), "the spec-hash mismatch is named");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn cli_certify_none_refused_exit_2() {
    if detect_backend().is_none() {
        eprintln!("SKIP cli_certify_none_refused_exit_2: no solver backend");
        return;
    }
    let (code, out, _) = run(&["certify", "-"], SPEC_NONE);
    assert_eq!(code, 2, "unbounded policy => REFUSED => exit 2");
    assert!(out.contains("\"verdict\": \"REFUSED\""));
    assert!(out.contains("\"onchain\": null"), "a refused policy has no on-chain params");
}

#[test]
fn cli_certify_no_invariant_is_usage_error() {
    // No solver needed: the missing-invariant check precedes discharge.
    let (code, _out, err) = run(&["certify", "-"], "agent W { bind -> [propose_payment] }");
    assert_eq!(code, 1);
    assert!(err.contains("declares no `invariant"));
}

#[test]
fn cli_certify_unsupported_family_fails_closed_exit_1() {
    // No solver needed: lowering rejects the family before any discharge.
    let (code, _out, err) = run(&["certify", "-"], "agent W { invariant -> token_bucket(ceiling = 2) bound 2 }");
    assert_eq!(code, 1, "unsupported family => CompileError => exit 1");
    assert!(err.contains("unsupported policy family: token_bucket"));
}
