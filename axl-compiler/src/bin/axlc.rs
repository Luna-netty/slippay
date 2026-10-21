//! `axlc` — the Axl compiler CLI. Thin wrapper over the library.
//!
//! Subcommands:
//!   axlc parse   <spec.axl>
//!   axlc compile <spec.axl> --tools tools.json --schemas schemas.json
//!   axlc request <spec.axl> --tools tools.json --schemas schemas.json
//!   axlc enforce <spec.axl> --tools tools.json --schemas schemas.json --ctx ctx.json
//!   axlc prove   <spec.axl> [--emit-smt]
//!
//! `compile` prints BOTH the InferenceContract and the Anthropic request config
//! (from `to_request_config`) as JSON. Spec may be read from a file or `-`/stdin.
//!
//! `prove` lowers the agent's `invariant` directive to SMT-LIB and discharges it
//! with z3 (binary on PATH, else `python3` + z3-solver). It prints ISSUED K or
//! REFUSED and exits non-zero on REFUSED. `--emit-smt` dumps the obligations
//! without invoking the solver.
//!
//! Exit codes:
//!   0  ok
//!   1  usage error or CompileError (compile/parse failure, bad flags, IO/JSON)
//!   2  enforce found violations, OR `prove` REFUSED (no provable safety bound)
//!
//! NEVER panics on bad input: every fallible step is `Result`-mapped; all errors
//! go to stderr with a clear message and a non-zero exit code.

use std::io::Read;
use std::process::ExitCode;

use axl_compiler::certify::{build_certificate, verify as verify_certificate};
use axl_compiler::compile::{compile_agent, enforce, to_request_config, Registries};
use axl_compiler::json;
use axl_compiler::parse::{parse_agent, AgentSpec};
use axl_compiler::prove::{detect_backend, discharge, Backend, Certificate, ProveError};
use axl_compiler::smt::{self, Obligation};
use axl_compiler::value::Value;
use axl_compiler::{Ceiling, CompileError, InferenceContract, InvariantDecl};

/// CLI-level error (usage/IO) distinct from a library `CompileError`.
#[derive(Debug)]
enum CliError {
    Usage(String),
    Io(String),
    Compile(CompileError),
    Prove(ProveError),
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliError::Usage(m) => write!(f, "usage error: {m}"),
            CliError::Io(m) => write!(f, "io error: {m}"),
            CliError::Compile(e) => write!(f, "{e}"),
            CliError::Prove(e) => write!(f, "{e}"),
        }
    }
}

impl From<CompileError> for CliError {
    fn from(e: CompileError) -> Self {
        CliError::Compile(e)
    }
}

impl From<ProveError> for CliError {
    fn from(e: ProveError) -> Self {
        // An unsupported-policy lowering error is fundamentally a CompileError;
        // surface it as such so fail-closed messages read consistently.
        match e {
            ProveError::Lowering(c) => CliError::Compile(c),
            other => CliError::Prove(other),
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => {
            if code == 0 {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(code as u8)
            }
        }
        Err(e) => {
            eprintln!("axlc: {e}");
            // Usage/IO/Compile all map to exit code 1.
            ExitCode::from(1)
        }
    }
}

const USAGE: &str = "\
axlc — Axl agent-block compiler

USAGE:
    axlc parse   <spec.axl>
    axlc compile <spec.axl> --tools <tools.json> --schemas <schemas.json>
    axlc request <spec.axl> --tools <tools.json> --schemas <schemas.json>
    axlc enforce <spec.axl> --tools <tools.json> --schemas <schemas.json> --ctx <ctx.json>
    axlc prove   <spec.axl> [--emit-smt]
    axlc certify <spec.axl>
    axlc verify-cert <spec.axl> --cert <cert.json>

Use '-' as <spec.axl> to read the spec from stdin.

`certify` discharges the invariant and emits a deterministic proof-carrying
certificate (JSON) to stdout: spec SHA-256, proved bound K, tightness, and the
on-chain binding (ssl_hash + window_cap_multiplier). `verify-cert` re-discharges
and asserts the provided certificate reproduces — the merge-gate / third-party
check that the deployed bound has not drifted from its proof.

EXIT CODES:
    0  ok (prove ISSUED / verify-cert VALID)
    1  usage / compile error
    2  enforce violations, prove/certify REFUSED, OR verify-cert INVALID (drift)";

fn run() -> Result<i32, CliError> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return Err(CliError::Usage(format!("missing subcommand\n\n{USAGE}")));
    }

    let sub = args[0].as_str();
    if sub == "-h" || sub == "--help" || sub == "help" {
        println!("{USAGE}");
        return Ok(0);
    }

    let rest = &args[1..];
    match sub {
        "parse" => cmd_parse(rest),
        "compile" => cmd_compile(rest),
        "request" => cmd_request(rest),
        "enforce" => cmd_enforce(rest),
        "prove" => cmd_prove(rest),
        "certify" => cmd_certify(rest),
        "verify-cert" => cmd_verify_cert(rest),
        other => Err(CliError::Usage(format!("unknown subcommand '{other}'\n\n{USAGE}"))),
    }
}

/// Parsed flags + positional spec path.
struct Parsed {
    spec_path: Option<String>,
    tools: Option<String>,
    schemas: Option<String>,
    ctx: Option<String>,
    cert: Option<String>,
    emit_smt: bool,
}

fn parse_flags(args: &[String]) -> Result<Parsed, CliError> {
    let mut p = Parsed {
        spec_path: None,
        tools: None,
        schemas: None,
        ctx: None,
        cert: None,
        emit_smt: false,
    };
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "--tools" => {
                p.tools = Some(take_value(args, &mut i, "--tools")?);
            }
            "--schemas" => {
                p.schemas = Some(take_value(args, &mut i, "--schemas")?);
            }
            "--ctx" => {
                p.ctx = Some(take_value(args, &mut i, "--ctx")?);
            }
            "--cert" => {
                p.cert = Some(take_value(args, &mut i, "--cert")?);
            }
            "--emit-smt" => {
                p.emit_smt = true;
            }
            flag if flag.starts_with("--") => {
                return Err(CliError::Usage(format!("unknown flag '{flag}'")));
            }
            _ => {
                if p.spec_path.is_some() {
                    return Err(CliError::Usage(format!(
                        "unexpected extra argument '{a}'"
                    )));
                }
                p.spec_path = Some(a.clone());
            }
        }
        i += 1;
    }
    Ok(p)
}

fn take_value(args: &[String], i: &mut usize, flag: &str) -> Result<String, CliError> {
    if *i + 1 >= args.len() {
        return Err(CliError::Usage(format!("flag {flag} requires a value")));
    }
    *i += 1;
    Ok(args[*i].clone())
}

fn read_spec(path: &Option<String>) -> Result<String, CliError> {
    match path {
        None => Err(CliError::Usage("missing <spec.axl> argument".to_string())),
        Some(p) if p == "-" => {
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| CliError::Io(format!("reading stdin: {e}")))?;
            Ok(buf)
        }
        Some(p) => std::fs::read_to_string(p)
            .map_err(|e| CliError::Io(format!("reading '{p}': {e}"))),
    }
}

fn read_json_file(path: &str) -> Result<Value, CliError> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| CliError::Io(format!("reading '{path}': {e}")))?;
    json::parse(&text).map_err(|e| CliError::Compile(CompileError::Json(e)))
}

fn require<'a>(opt: &'a Option<String>, flag: &str) -> Result<&'a str, CliError> {
    opt.as_deref()
        .ok_or_else(|| CliError::Usage(format!("missing required flag {flag}")))
}

// ── subcommands ──────────────────────────────────────────────────────────────

fn cmd_parse(args: &[String]) -> Result<i32, CliError> {
    let flags = parse_flags(args)?;
    let src = read_spec(&flags.spec_path)?;
    let spec = parse_agent(&src)?;
    println!("{}", json::to_string_pretty(&agent_spec_to_value(&spec)));
    Ok(0)
}

fn cmd_compile(args: &[String]) -> Result<i32, CliError> {
    let flags = parse_flags(args)?;
    let src = read_spec(&flags.spec_path)?;
    let tools = read_json_file(require(&flags.tools, "--tools")?)?;
    let schemas = read_json_file(require(&flags.schemas, "--schemas")?)?;

    let spec = parse_agent(&src)?;
    let reg = Registries { tools: &tools, schemas: &schemas };
    let contract = compile_agent(&spec, &reg)?;
    let request = to_request_config(&contract)?;

    // Print BOTH the InferenceContract and the request config.
    let out = Value::Object(vec![
        ("contract".to_string(), contract_to_value(&contract)),
        ("request_config".to_string(), request),
    ]);
    println!("{}", json::to_string_pretty(&out));
    Ok(0)
}

fn cmd_request(args: &[String]) -> Result<i32, CliError> {
    let flags = parse_flags(args)?;
    let src = read_spec(&flags.spec_path)?;
    let tools = read_json_file(require(&flags.tools, "--tools")?)?;
    let schemas = read_json_file(require(&flags.schemas, "--schemas")?)?;

    let spec = parse_agent(&src)?;
    let reg = Registries { tools: &tools, schemas: &schemas };
    let contract = compile_agent(&spec, &reg)?;
    let request = to_request_config(&contract)?;
    println!("{}", json::to_string_pretty(&request));
    Ok(0)
}

fn cmd_enforce(args: &[String]) -> Result<i32, CliError> {
    let flags = parse_flags(args)?;
    let src = read_spec(&flags.spec_path)?;
    let tools = read_json_file(require(&flags.tools, "--tools")?)?;
    let schemas = read_json_file(require(&flags.schemas, "--schemas")?)?;
    let ctx = read_json_file(require(&flags.ctx, "--ctx")?)?;

    let spec = parse_agent(&src)?;
    let reg = Registries { tools: &tools, schemas: &schemas };
    let contract = compile_agent(&spec, &reg)?;
    let result = enforce(&contract, &ctx);

    let out = Value::Object(vec![
        ("ok".to_string(), Value::Bool(result.ok)),
        (
            "violations".to_string(),
            Value::Array(result.violations.iter().cloned().map(Value::String).collect()),
        ),
    ]);
    println!("{}", json::to_string_pretty(&out));
    // Non-conformant output => exit 2.
    Ok(if result.ok { 0 } else { 2 })
}

/// `axlc prove <spec.axl> [--emit-smt]`.
///
/// Parse the agent, require an `invariant` directive (no directive => usage
/// error: there is nothing to prove), lower it to SMT-LIB, and discharge with
/// z3. Prints ISSUED K or REFUSED. `--emit-smt` dumps the obligations to stdout
/// WITHOUT invoking the solver (offline inspection / golden capture).
///
/// Exit codes: 0 = ISSUED, 2 = REFUSED (fail-closed), 1 = usage/compile/solver.
fn cmd_prove(args: &[String]) -> Result<i32, CliError> {
    let flags = parse_flags(args)?;
    let src = read_spec(&flags.spec_path)?;
    let spec = parse_agent(&src)?;

    let inv = match &spec.invariant {
        Some(i) => i,
        None => {
            return Err(CliError::Usage(format!(
                "agent '{}' declares no `invariant -> ...` directive; nothing to prove",
                spec.name
            )))
        }
    };

    if flags.emit_smt {
        emit_all_smt(inv)?;
        return Ok(0);
    }

    // Fail closed on an unsupported family BEFORE announcing discharge: lower a
    // representative obligation; an unsupported family errors here, cleanly.
    smt::emit(inv, representative_obligation(inv))?;

    let backend = detect_backend().ok_or(CliError::Prove(ProveError::NoSolver))?;
    println!("agent {} — discharging invariant via {}", spec.name, backend.describe());
    println!(
        "  policy: {}(ceiling = {}) claimed bound K = {}",
        inv.family,
        ceiling_label(&inv.ceiling),
        inv.bound
    );

    let cert = discharge(backend, inv)?;
    match cert {
        Certificate::Issued { ceiling, bound, tight, diagnostic } => {
            println!("  inductive over ALL action sequences ?  yes  (invariant_K, UNSAT to break)");
            println!("  certified bound K = {bound}  -> window outflow <= {bound}*window_cap");
            println!("  tight (bound attained, K-1 unsound) ?  {tight}");
            if let Some(d) = diagnostic {
                println!("  DIAGNOSTIC: {d}");
            }
            let _ = ceiling;
            println!("  CERTIFICATE: ISSUED — outflow <= {bound}*window_cap, machine-checked.");
            Ok(0)
        }
        Certificate::Refused { reason } => {
            println!("  CERTIFICATE: REFUSED — {reason}. Fail-closed.");
            // REFUSED is a non-conformant verdict => exit 2 (same family as enforce).
            Ok(2)
        }
    }
}

/// Shared by `certify` and `verify-cert`: parse the spec, require an `invariant`,
/// fail-closed family check, detect a backend, discharge with z3, and assemble the
/// certificate [`Value`]. Returns `(certificate, is_issued, backend)`.
fn discharge_to_certificate(src: &str) -> Result<(Value, bool, Backend), CliError> {
    let spec = parse_agent(src)?;
    let inv = match &spec.invariant {
        Some(i) => i,
        None => {
            return Err(CliError::Usage(format!(
                "agent '{}' declares no `invariant -> ...` directive; nothing to certify",
                spec.name
            )))
        }
    };
    // Fail closed on an unsupported family BEFORE discharge (mirrors cmd_prove).
    smt::emit(inv, representative_obligation(inv))?;
    let backend = detect_backend().ok_or(CliError::Prove(ProveError::NoSolver))?;
    let cert = discharge(backend, inv)?;
    let is_issued = matches!(cert, Certificate::Issued { .. });
    let cert_value = build_certificate(src, &spec.name, inv, &cert, backend.describe());
    Ok((cert_value, is_issued, backend))
}

/// `axlc certify <spec.axl>` — discharge the invariant and emit a deterministic
/// proof-carrying certificate (JSON) to stdout. Exit 0 = ISSUED, 2 = REFUSED
/// (the certificate is emitted either way; the exit code lets CI gate on it).
fn cmd_certify(args: &[String]) -> Result<i32, CliError> {
    let flags = parse_flags(args)?;
    let src = read_spec(&flags.spec_path)?;
    let (cert_value, is_issued, _backend) = discharge_to_certificate(&src)?;
    println!("{}", json::to_string_pretty(&cert_value));
    Ok(if is_issued { 0 } else { 2 })
}

/// `axlc verify-cert <spec.axl> --cert <cert.json>` — re-discharge the spec and
/// assert the provided certificate reproduces. This is the merge-gate / third-
/// party check: it catches any drift between the deployed bound and its proof,
/// and any spec edit not re-certified (spec_sha256 mismatch). Exit 0 = VALID,
/// 2 = INVALID (fail-closed).
fn cmd_verify_cert(args: &[String]) -> Result<i32, CliError> {
    let flags = parse_flags(args)?;
    let src = read_spec(&flags.spec_path)?;
    let cert_path = require(&flags.cert, "--cert")?;
    let provided = read_json_file(cert_path)?;
    let (recomputed, _is_issued, backend) = discharge_to_certificate(&src)?;
    match verify_certificate(&provided, &recomputed) {
        Ok(()) => {
            println!(
                "VALID — certificate reproduces (re-discharged via {}).",
                backend.describe()
            );
            Ok(0)
        }
        Err(mismatches) => {
            eprintln!("INVALID — certificate does not reproduce (proof/spec drift):");
            for m in &mismatches {
                eprintln!("  - {m}");
            }
            Ok(2)
        }
    }
}

/// The obligation that is always defined for a given ceiling — used only to
/// trigger fail-closed family validation early (its verdict is discarded here).
fn representative_obligation(inv: &InvariantDecl) -> Obligation {
    match inv.ceiling {
        Ceiling::None => Obligation::Unbounded,
        Ceiling::Multiplier(_) => Obligation::Inductive,
    }
}

/// Human label for a ceiling in CLI output.
fn ceiling_label(c: &Ceiling) -> String {
    match c {
        Ceiling::Multiplier(m) => m.to_string(),
        Ceiling::None => "none".to_string(),
    }
}

/// Emit every applicable SMT-LIB obligation for an invariant to stdout, each
/// fenced by a comment header. Used by `--emit-smt`.
fn emit_all_smt(inv: &InvariantDecl) -> Result<(), CliError> {
    match inv.ceiling {
        Ceiling::None => {
            println!("; ── obligation: unbounded witness (ceiling = none) ──");
            print!("{}", smt::emit(inv, Obligation::Unbounded)?);
        }
        Ceiling::Multiplier(_) => {
            println!("; ── obligation: base case ──");
            print!("{}", smt::emit(inv, Obligation::Base)?);
            println!("; ── obligation: inductive step (claimed bound K) ──");
            print!("{}", smt::emit(inv, Obligation::Inductive)?);
            println!("; ── obligation: attainability (tightness) ──");
            print!("{}", smt::emit(inv, Obligation::Attainable)?);
        }
    }
    Ok(())
}

// ── Value projections for CLI output (no serde) ──────────────────────────────

fn agent_spec_to_value(spec: &AgentSpec) -> Value {
    Value::Object(vec![
        ("name".to_string(), Value::String(spec.name.clone())),
        (
            "capabilities".to_string(),
            Value::Array(spec.capabilities.iter().cloned().map(Value::String).collect()),
        ),
        (
            "schema".to_string(),
            match &spec.schema {
                Some(s) => Value::String(s.clone()),
                None => Value::Null,
            },
        ),
        (
            "predicates".to_string(),
            Value::Array(spec.predicates.iter().cloned().map(Value::String).collect()),
        ),
        (
            "invariant".to_string(),
            match &spec.invariant {
                Some(inv) => Value::Object(vec![
                    ("family".to_string(), Value::String(inv.family.clone())),
                    (
                        "ceiling".to_string(),
                        match &inv.ceiling {
                            Ceiling::Multiplier(m) => Value::Number(*m as f64),
                            Ceiling::None => Value::Null,
                        },
                    ),
                    ("bound".to_string(), Value::Number(inv.bound as f64)),
                ]),
                None => Value::Null,
            },
        ),
    ])
}

fn contract_to_value(c: &InferenceContract) -> Value {
    let predicates = Value::Array(
        c.predicates
            .iter()
            .map(|p| Value::String(p.source.clone()))
            .collect(),
    );
    Value::Object(vec![
        ("agent".to_string(), Value::String(c.agent.clone())),
        ("tools".to_string(), Value::Array(c.tools.clone())),
        (
            "output_schema".to_string(),
            match &c.output_schema {
                Some(s) => s.clone(),
                None => Value::Null,
            },
        ),
        ("predicates".to_string(), predicates),
    ])
}
