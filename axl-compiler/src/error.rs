//! Single [`CompileError`] enum, the Rust analog of the JS `Error` strings.
//!
//! Display text MUST byte-match the JS error messages, because the integration
//! suite asserts on them (e.g. `unknown capability: wire_to_cayman`,
//! `strict schema requires additionalProperties: false`). The library NEVER
//! panics — every fallible operation returns `Result<_, CompileError>`.

use crate::json::JsonError;
use std::fmt;

/// Every error the Axl compiler library can return.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompileError {
    /// Port of `parseBind` throw: `malformed bind declaration: ${line}`.
    MalformedBind(String),
    /// Port of `parseAgent` throw when the name regex does not match.
    MalformedAgent,
    /// Port of `compilePredicate` throw: `malformed predicate: ${src}`.
    MalformedPredicate(String),
    /// `compileToolset` fail-closed: `unknown capability: ${cap}`.
    UnknownCapability(String),
    /// `compileAgent` fail-closed: `unknown schema: ${name}`.
    UnknownSchema(String),
    /// `toRequestConfig` fail-closed: schema missing `additionalProperties:false`.
    StrictSchemaNeedsAdditionalPropertiesFalse,
    /// `invariant` directive references a policy family the prover cannot lower
    /// to SMT-LIB. Fail-closed: an unknown/unsupported family is REFUSED, never
    /// silently passed. The string is the offending family token (e.g. `token_bucket`).
    UnsupportedPolicy(String),
    /// `invariant` directive was syntactically malformed (could not parse the
    /// `invariant -> sliding_window(ceiling = <M|none>) bound <K>` form). The
    /// string is the offending source line. Fail-closed.
    MalformedInvariant(String),
    /// Wraps a std-only JSON parse failure at the CLI/registry boundary. No JS
    /// analog (JS used native objects); kept distinct so a registry-load failure
    /// is never confused with a spec/semantic error.
    Json(JsonError),
}

impl fmt::Display for CompileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CompileError::MalformedBind(line) => write!(f, "malformed bind declaration: {line}"),
            CompileError::MalformedAgent => write!(f, "malformed agent block"),
            CompileError::MalformedPredicate(src) => write!(f, "malformed predicate: {src}"),
            CompileError::UnknownCapability(cap) => write!(f, "unknown capability: {cap}"),
            CompileError::UnknownSchema(name) => write!(f, "unknown schema: {name}"),
            CompileError::StrictSchemaNeedsAdditionalPropertiesFalse => {
                write!(f, "strict schema requires additionalProperties: false")
            }
            CompileError::UnsupportedPolicy(family) => {
                write!(f, "unsupported policy family: {family}")
            }
            CompileError::MalformedInvariant(line) => {
                write!(f, "malformed invariant declaration: {line}")
            }
            CompileError::Json(e) => write!(f, "invalid JSON: {e}"),
        }
    }
}

impl std::error::Error for CompileError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            CompileError::Json(e) => Some(e),
            _ => None,
        }
    }
}

impl From<JsonError> for CompileError {
    fn from(e: JsonError) -> Self {
        CompileError::Json(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_byte_match_js() {
        assert_eq!(
            CompileError::MalformedBind("bind X -> y".into()).to_string(),
            "malformed bind declaration: bind X -> y"
        );
        assert_eq!(CompileError::MalformedAgent.to_string(), "malformed agent block");
        assert_eq!(
            CompileError::MalformedPredicate("just text".into()).to_string(),
            "malformed predicate: just text"
        );
        assert_eq!(
            CompileError::UnknownCapability("wire_to_cayman".into()).to_string(),
            "unknown capability: wire_to_cayman"
        );
        assert_eq!(
            CompileError::UnknownSchema("NopeSchema".into()).to_string(),
            "unknown schema: NopeSchema"
        );
        assert_eq!(
            CompileError::StrictSchemaNeedsAdditionalPropertiesFalse.to_string(),
            "strict schema requires additionalProperties: false"
        );
        assert_eq!(
            CompileError::UnsupportedPolicy("token_bucket".into()).to_string(),
            "unsupported policy family: token_bucket"
        );
        assert_eq!(
            CompileError::MalformedInvariant("invariant -> wat".into()).to_string(),
            "malformed invariant declaration: invariant -> wat"
        );
    }

    #[test]
    fn from_json_error() {
        let e: CompileError = JsonError::UnexpectedEof.into();
        assert!(matches!(e, CompileError::Json(JsonError::UnexpectedEof)));
    }
}
