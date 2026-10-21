//! # axl-compiler
//!
//! Standalone, std-only Rust port of the Axl agent-block compiler
//! (`agents/axl/{bind,compile}.mjs`). One declarative agent block compiles into
//! one inference contract with three MECHANICAL guarantees:
//!
//! - **bind** -> `compile_toolset`: the exact `tools=[...]` array (action
//!   space). A bound-out tool has no schema, so the model cannot emit a
//!   `tool_use` for it — prompt injection cannot conjure a tool that does not
//!   exist in the request.
//! - **constrain** -> the engine-enforced output schema. Emitted as
//!   `output_config.format` (json_schema = constrained decoding) by
//!   [`to_request_config`].
//! - **prove** -> decidable predicates compiled to deterministic CODE
//!   (arithmetic / membership / equality), never delegated to an LLM judge.
//!
//! ## Enforcement boundaries (fail-closed, default-deny)
//!
//! 1. unknown capability => [`CompileError::UnknownCapability`] (never a silent drop).
//! 2. unknown schema => [`CompileError::UnknownSchema`].
//! 3. a strict output schema MUST declare `additionalProperties: false`, else
//!    [`CompileError::StrictSchemaNeedsAdditionalPropertiesFalse`].
//!
//! ## Invariants
//!
//! - ZERO external dependencies (std only): hand-rolled JSON
//!   parser+serializer ([`json`]) and hand-rolled regex-equivalent parsing
//!   ([`parse`]).
//! - The library NEVER panics OR aborts on malformed input: every fallible
//!   operation returns `Result<_, CompileError>`; there is no
//!   `unwrap`/`expect`/indexing on user-controlled data in the library paths.
//!   The hand-rolled JSON parser bounds nesting depth ([`json::MAX_DEPTH`]) so
//!   adversarially deep input returns [`json::JsonError::TooDeep`] rather than
//!   overflowing the native stack (an abort `catch_unwind` cannot trap).
//! - Faithful JS coercion semantics: `Undefined` (missing path) is distinct
//!   from `Null` (present JSON null); relational ops follow JS Abstract
//!   Relational Comparison; `==`/`!=` are strict equality.

pub mod certify;
pub mod compile;
pub mod error;
pub mod json;
pub mod parse;
pub mod predicate;
pub mod prove;
pub mod sha256;
pub mod smt;
pub mod value;

// ── curated public API surface (the Rust analog of the named JS exports) ──
pub use compile::{
    compile_agent, compile_toolset, enforce, to_request_config, EnforceResult, InferenceContract,
    Registries,
};
pub use error::CompileError;
pub use json::JsonError;
pub use parse::{parse_agent, parse_bind, parse_invariant, AgentSpec, BindDecl, Ceiling, InvariantDecl};
pub use predicate::{compile_predicate, Op, Operand, Predicate};
pub use prove::{discharge, detect_backend, Backend, Certificate, ProveError, Verdict};
pub use smt::{emit as emit_smt, Obligation};
pub use value::Value;
