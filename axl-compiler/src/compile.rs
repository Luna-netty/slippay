//! Orchestrator: `compileToolset`, `compileAgent`, `toRequestConfig`,
//! `enforce`. Holds the three fail-closed boundaries:
//!
//! 1. unknown capability (default-deny toolset),
//! 2. unknown schema,
//! 3. a strict output schema MUST declare `additionalProperties: false`.
//!
//! Registries are passed as [`Value::Object`] (tools registry, schemas
//! registry), mirroring the JS plain-object registries and staying serde-free.

use crate::error::CompileError;
use crate::parse::AgentSpec;
use crate::predicate::{compile_predicate, Predicate};
use crate::value::Value;

/// A compiled inference contract: the action space (tools), the optional
/// engine-enforced output schema, and the decidable predicates.
#[derive(Debug, Clone)]
pub struct InferenceContract {
    pub agent: String,
    pub tools: Vec<Value>,
    pub output_schema: Option<Value>,
    pub predicates: Vec<Predicate>,
}

/// The two registries `compileAgent` resolves against. Each is a
/// [`Value::Object`] mapping name -> definition.
pub struct Registries<'a> {
    pub tools: &'a Value,
    pub schemas: &'a Value,
}

/// Result of running every predicate against a candidate output+context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnforceResult {
    pub ok: bool,
    pub violations: Vec<String>,
}

/// Port of `compileToolset`: resolve each capability against the tools registry.
/// Default-deny + fail-closed: an unknown capability is an error
/// ([`CompileError::UnknownCapability`]), never a silent drop.
pub fn compile_toolset(caps: &[String], tools: &Value) -> Result<Vec<Value>, CompileError> {
    let mut out = Vec::with_capacity(caps.len());
    for cap in caps {
        match lookup(tools, cap) {
            // A present-but-null def is treated as "missing" exactly like JS
            // `if (!def)` (null/undefined are falsy). A present object/other is
            // pushed as-is.
            Some(def) if !is_falsy(&def) => out.push(def),
            _ => return Err(CompileError::UnknownCapability(cap.clone())),
        }
    }
    Ok(out)
}

/// Port of `compileAgent`: compile the toolset (throws on unknown capability
/// FIRST), then resolve the output schema (throws on unknown schema), then
/// compile predicates.
pub fn compile_agent(spec: &AgentSpec, reg: &Registries) -> Result<InferenceContract, CompileError> {
    // compileToolset runs before schema resolution (FC02 ordering).
    let tools = compile_toolset(&spec.capabilities, reg.tools)?;

    let output_schema = match &spec.schema {
        None => None,
        Some(name) => match lookup(reg.schemas, name) {
            Some(schema) if !is_falsy(&schema) => Some(schema),
            _ => return Err(CompileError::UnknownSchema(name.clone())),
        },
    };

    let mut predicates = Vec::with_capacity(spec.predicates.len());
    for src in &spec.predicates {
        predicates.push(compile_predicate(src)?);
    }

    Ok(InferenceContract {
        agent: spec.name.clone(),
        tools,
        output_schema,
        predicates,
    })
}

/// Port of `toRequestConfig`. Each tool gets `strict: true` (object spread +
/// overwrite). If an output schema is present it MUST have
/// `additionalProperties === false`, else fail-closed
/// ([`CompileError::StrictSchemaNeedsAdditionalPropertiesFalse`]). Emits
/// `{ tools, output_config? }` as a [`Value::Object`].
pub fn to_request_config(c: &InferenceContract) -> Result<Value, CompileError> {
    // Each tool carries `strict: true`, which (per the Anthropic GA strict
    // tool-use contract) requires its `input_schema` to satisfy the same strict
    // restrictions as a structured-output schema — `additionalProperties: false`
    // on EVERY object node. Validate BEFORE stamping strict, fail-closed,
    // symmetric with the output-schema branch below. The JS reference stamped
    // strict unconditionally; that is the latent fail-open this guards.
    for t in &c.tools {
        if let Value::Object(entries) = t {
            if let Some((_, input_schema)) =
                entries.iter().find(|(k, _)| k == "input_schema")
            {
                // An object input_schema must be strict-recursive. A non-object
                // (or absent) input_schema carries no object nodes to guard.
                if matches!(input_schema, Value::Object(_)) && !is_strict_recursive(input_schema)
                {
                    return Err(CompileError::StrictSchemaNeedsAdditionalPropertiesFalse);
                }
            }
        }
    }

    // tools.map(t => ({ ...t, strict: true }))
    let strict_tools: Vec<Value> = c.tools.iter().map(with_strict_true).collect();

    let mut req: Vec<(String, Value)> = vec![("tools".to_string(), Value::Array(strict_tools))];

    if let Some(schema) = &c.output_schema {
        // additionalProperties !== false on ANY object node => throw. The GA API
        // requires additionalProperties:false on EVERY nested object, not just
        // the root; a root-only check is fail-open (emits a 400-rejected payload).
        if !is_strict_recursive(schema) {
            return Err(CompileError::StrictSchemaNeedsAdditionalPropertiesFalse);
        }
        let format = Value::Object(vec![
            ("type".to_string(), Value::String("json_schema".to_string())),
            ("schema".to_string(), schema.clone()),
        ]);
        let output_config = Value::Object(vec![("format".to_string(), format)]);
        req.push(("output_config".to_string(), output_config));
    }

    Ok(Value::Object(req))
}

/// Port of `enforce`: collect the `source` of every predicate that evaluates to
/// false against `ctx`. `ok` iff there are no violations.
pub fn enforce(c: &InferenceContract, ctx: &Value) -> EnforceResult {
    let violations: Vec<String> = c
        .predicates
        .iter()
        .filter(|p| !p.eval(ctx))
        .map(|p| p.source.clone())
        .collect();
    EnforceResult {
        ok: violations.is_empty(),
        violations,
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// Registry lookup `registry[key]`. Returns `None` when `registry` is not an
/// object or the key is absent; otherwise the present value (which may be a
/// present `Null`).
fn lookup(registry: &Value, key: &str) -> Option<Value> {
    match registry {
        Value::Object(entries) => {
            for (k, v) in entries {
                if k == key {
                    return Some(v.clone());
                }
            }
            None
        }
        _ => None,
    }
}

/// JS falsiness for a registry def: `null` (and our `Undefined`) are falsy, so
/// `if (!def)` treats them as missing. Other values (objects, etc.) are truthy.
/// (We do not treat `false`/`0`/`""` as defs in practice, but for total fidelity
/// with `if (!def)` they would be falsy too.)
fn is_falsy(v: &Value) -> bool {
    match v {
        Value::Null | Value::Undefined => true,
        Value::Bool(b) => !b,
        Value::Number(n) => *n == 0.0 || n.is_nan(),
        Value::String(s) => s.is_empty(),
        Value::Array(_) | Value::Object(_) => false,
    }
}

/// Clone a tool object and set `strict: true` (object spread `{...t, strict:true}`).
///
/// If `t` is an object, copy its entries (overwriting any existing `strict`),
/// then ensure `strict: true` is present. If `t` is NOT an object (degenerate),
/// JS `{...nonObject, strict:true}` yields `{strict:true}` for primitives — we
/// mirror that by producing `{ strict: true }`.
fn with_strict_true(t: &Value) -> Value {
    match t {
        Value::Object(entries) => {
            let mut out: Vec<(String, Value)> = Vec::with_capacity(entries.len() + 1);
            let mut had_strict = false;
            for (k, v) in entries {
                if k == "strict" {
                    out.push(("strict".to_string(), Value::Bool(true)));
                    had_strict = true;
                } else {
                    out.push((k.clone(), v.clone()));
                }
            }
            if !had_strict {
                out.push(("strict".to_string(), Value::Bool(true)));
            }
            Value::Object(out)
        }
        // {...primitive, strict:true} => {strict:true}; {...array,...} would
        // spread indices, but tool defs are always objects in practice.
        _ => Value::Object(vec![("strict".to_string(), Value::Bool(true))]),
    }
}

/// True iff `schema` is strict-recursive: EVERY object node declaring
/// `"type":"object"` (reachable via `properties`, `items`, `anyOf`, `allOf`,
/// `oneOf`, `$defs`, `definitions`, or the root) declares
/// `additionalProperties: false`. Anything else (missing, `true`, non-bool) on
/// any such node => false, which triggers the fail-closed error.
///
/// The Anthropic structured-outputs / strict-tool GA API requires
/// `additionalProperties:false` on every nested object, not just the root; a
/// root-only check is fail-open (emits a payload the API rejects with 400). A
/// subschema WITHOUT `"type":"object"` (e.g. `{}`, `{"type":"string"}`, or a
/// `$ref`) carries no object constraint and is not required to declare it —
/// matching the GA rule and keeping `input_schema:{}` fixtures valid.
fn is_strict_recursive(schema: &Value) -> bool {
    match schema {
        Value::Object(entries) => {
            // Is THIS node an object-typed schema? If so it must declare
            // additionalProperties:false.
            let declares_object = entries
                .iter()
                .any(|(k, v)| k == "type" && matches!(v, Value::String(s) if s == "object"));
            if declares_object {
                let ap_false = entries
                    .iter()
                    .find(|(k, _)| k == "additionalProperties")
                    .map(|(_, v)| matches!(v, Value::Bool(false)))
                    .unwrap_or(false);
                if !ap_false {
                    return false;
                }
            }
            // Recurse into every value that can hold nested subschemas. We walk
            // ALL values structurally (cheap, total) rather than enumerating only
            // known keywords, so an object buried under any keyword is still
            // checked. `additionalProperties:false`/`type:"object"` scalars are
            // leaves and short-circuit fine.
            for (_, v) in entries {
                if !is_strict_recursive(v) {
                    return false;
                }
            }
            true
        }
        Value::Array(items) => items.iter().all(is_strict_recursive),
        // Scalars carry no object constraint.
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json;
    use crate::parse::parse_agent;

    fn tools_registry() -> Value {
        json::parse(
            r#"{
              "read_balance":       {"name":"read_balance","description":"","input_schema":{}},
              "propose_settlement": {"name":"propose_settlement","description":"","input_schema":{}},
              "transfer_funds":     {"name":"transfer_funds","description":"","input_schema":{}}
            }"#,
        )
        .unwrap()
    }

    fn schemas_registry() -> Value {
        json::parse(
            r#"{ "SettlementDecision": {"type":"object","properties":{"amount":{"type":"number"},"recipient":{"type":"string"}}} }"#,
        )
        .unwrap()
    }

    fn tool_name(v: &Value) -> Option<String> {
        if let Value::Object(entries) = v {
            for (k, val) in entries {
                if k == "name" {
                    if let Value::String(s) = val {
                        return Some(s.clone());
                    }
                }
            }
        }
        None
    }

    #[test]
    fn fc01_unknown_capability() {
        let tools = tools_registry();
        let err = compile_toolset(
            &["read_balance".to_string(), "wire_to_cayman".to_string()],
            &tools,
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "unknown capability: wire_to_cayman");
    }

    #[test]
    fn empty_binding_empty_toolset() {
        let tools = tools_registry();
        assert_eq!(compile_toolset(&[], &tools).unwrap().len(), 0);
    }

    #[test]
    fn fc02_unknown_capability_before_schema() {
        let spec = parse_agent("agent S { bind -> [nope] }").unwrap();
        let tools = tools_registry();
        let schemas = json::parse("{}").unwrap();
        let reg = Registries { tools: &tools, schemas: &schemas };
        assert_eq!(
            compile_agent(&spec, &reg).unwrap_err().to_string(),
            "unknown capability: nope"
        );
    }

    #[test]
    fn fc03_unknown_schema() {
        let spec = parse_agent("agent S { bind -> [read_balance] constrain -> Ghost }").unwrap();
        let tools = tools_registry();
        let schemas = json::parse("{}").unwrap();
        let reg = Registries { tools: &tools, schemas: &schemas };
        assert_eq!(
            compile_agent(&spec, &reg).unwrap_err().to_string(),
            "unknown schema: Ghost"
        );
    }

    #[test]
    fn compiles_bound_out_tool_absent() {
        let src = "agent Settlement {\n  bind -> [read_balance, propose_settlement]\n  constrain -> SettlementDecision\n}";
        let spec = parse_agent(src).unwrap();
        let tools = tools_registry();
        let schemas = schemas_registry();
        let reg = Registries { tools: &tools, schemas: &schemas };
        let c = compile_agent(&spec, &reg).unwrap();
        let names: Vec<String> = c.tools.iter().filter_map(tool_name).collect();
        assert!(names.contains(&"read_balance".to_string()));
        assert!(names.contains(&"propose_settlement".to_string()));
        assert!(!names.contains(&"transfer_funds".to_string()));
    }

    #[test]
    fn to_request_config_strict_tools() {
        let spec = parse_agent("agent S { bind -> [read_balance] }").unwrap();
        let tools = tools_registry();
        let schemas = schemas_registry();
        let reg = Registries { tools: &tools, schemas: &schemas };
        let c = compile_agent(&spec, &reg).unwrap();
        let req = to_request_config(&c).unwrap();
        // tools array, each with strict:true; no output_config.
        if let Value::Object(entries) = &req {
            let tools_v = entries.iter().find(|(k, _)| k == "tools").map(|(_, v)| v).unwrap();
            if let Value::Array(items) = tools_v {
                for t in items {
                    if let Value::Object(te) = t {
                        assert!(te.iter().any(|(k, v)| k == "strict" && matches!(v, Value::Bool(true))));
                    }
                }
            } else {
                panic!("tools not array");
            }
            assert!(entries.iter().all(|(k, _)| k != "output_config"));
        } else {
            panic!("req not object");
        }
    }

    #[test]
    fn fc04_loose_schema_rejected() {
        let loose = json::parse(r#"{"type":"object","properties":{"x":{"type":"string"}}}"#).unwrap();
        let c = InferenceContract {
            agent: "S".into(),
            tools: vec![],
            output_schema: Some(loose),
            predicates: vec![],
        };
        assert_eq!(
            to_request_config(&c).unwrap_err().to_string(),
            "strict schema requires additionalProperties: false"
        );
    }

    #[test]
    fn fc05_additional_properties_true_rejected() {
        let loose = json::parse(r#"{"type":"object","additionalProperties":true}"#).unwrap();
        let c = InferenceContract {
            agent: "S".into(),
            tools: vec![],
            output_schema: Some(loose),
            predicates: vec![],
        };
        assert!(to_request_config(&c).is_err());
    }

    #[test]
    fn strict_schema_emits_output_config() {
        let strict = json::parse(
            r#"{"type":"object","properties":{"amount":{"type":"number"}},"required":["amount"],"additionalProperties":false}"#,
        )
        .unwrap();
        let c = InferenceContract {
            agent: "S".into(),
            tools: vec![],
            output_schema: Some(strict),
            predicates: vec![],
        };
        let req = to_request_config(&c).unwrap();
        let s = json::to_string(&req);
        assert!(s.contains("\"output_config\""));
        assert!(s.contains("\"json_schema\""));
    }

    #[test]
    fn enforce_violations_named_in_order() {
        let src = "agent Settlement {\n  bind -> [read_balance, propose_settlement]\n  constrain -> SettlementDecision\n  prove -> decision.amount <= account.balance\n  prove -> decision.recipient in account.allowlist\n}";
        let spec = parse_agent(src).unwrap();
        let tools = tools_registry();
        let schemas = schemas_registry();
        let reg = Registries { tools: &tools, schemas: &schemas };
        let c = compile_agent(&spec, &reg).unwrap();
        let ctx = json::parse(
            r#"{"decision":{"amount":999,"recipient":"GEVIL"},"account":{"balance":50,"allowlist":["GA"]}}"#,
        )
        .unwrap();
        let r = enforce(&c, &ctx);
        assert!(!r.ok);
        assert_eq!(
            r.violations,
            vec![
                "decision.amount <= account.balance".to_string(),
                "decision.recipient in account.allowlist".to_string()
            ]
        );
    }

    // ── regression: nested object missing additionalProperties:false (HIGH) ──
    #[test]
    fn nested_object_without_additional_properties_false_rejected() {
        // Root has additionalProperties:false but a nested object property does
        // not. Root-only check passes (fail-open, GA API 400s it); recursive
        // check rejects fail-closed.
        let schema = json::parse(
            r#"{"type":"object","properties":{"amount":{"type":"number"},"address":{"type":"object","properties":{"street":{"type":"string"}}}},"required":["amount"],"additionalProperties":false}"#,
        )
        .unwrap();
        let c = InferenceContract {
            agent: "Deep".into(),
            tools: vec![],
            output_schema: Some(schema),
            predicates: vec![],
        };
        assert_eq!(
            to_request_config(&c).unwrap_err().to_string(),
            "strict schema requires additionalProperties: false"
        );
    }

    #[test]
    fn fully_strict_nested_schema_accepted() {
        // Same shape but the nested object DOES declare additionalProperties:false.
        let schema = json::parse(
            r#"{"type":"object","properties":{"amount":{"type":"number"},"address":{"type":"object","properties":{"street":{"type":"string"}},"additionalProperties":false}},"required":["amount"],"additionalProperties":false}"#,
        )
        .unwrap();
        let c = InferenceContract {
            agent: "Deep".into(),
            tools: vec![],
            output_schema: Some(schema),
            predicates: vec![],
        };
        assert!(to_request_config(&c).is_ok());
    }

    // ── regression: loose tool input_schema gets no strict:true (HIGH) ──
    #[test]
    fn loose_tool_input_schema_rejected() {
        // A bound tool whose object input_schema omits additionalProperties:false
        // must NOT be stamped strict:true (GA API 400s strict + loose schema).
        let loose_tool = json::parse(
            r#"{"name":"read_balance","input_schema":{"type":"object","properties":{"account":{"type":"string"}}}}"#,
        )
        .unwrap();
        let c = InferenceContract {
            agent: "T".into(),
            tools: vec![loose_tool],
            output_schema: None,
            predicates: vec![],
        };
        assert_eq!(
            to_request_config(&c).unwrap_err().to_string(),
            "strict schema requires additionalProperties: false"
        );
    }

    #[test]
    fn strict_tool_input_schema_and_empty_schema_accepted() {
        // input_schema:{} (no type:object) carries no object constraint -> OK
        // (keeps the shipped flat fixtures valid). A fully strict object schema
        // is also OK.
        let empty = json::parse(r#"{"name":"a","input_schema":{}}"#).unwrap();
        let strict = json::parse(
            r#"{"name":"b","input_schema":{"type":"object","properties":{},"additionalProperties":false}}"#,
        )
        .unwrap();
        let c = InferenceContract {
            agent: "T".into(),
            tools: vec![empty, strict],
            output_schema: None,
            predicates: vec![],
        };
        assert!(to_request_config(&c).is_ok());
    }

    #[test]
    fn enforce_conformant_passes() {
        let src = "agent Settlement {\n  bind -> [read_balance, propose_settlement]\n  constrain -> SettlementDecision\n  prove -> decision.amount <= account.balance\n  prove -> decision.recipient in account.allowlist\n}";
        let spec = parse_agent(src).unwrap();
        let tools = tools_registry();
        let schemas = schemas_registry();
        let reg = Registries { tools: &tools, schemas: &schemas };
        let c = compile_agent(&spec, &reg).unwrap();
        let ctx = json::parse(
            r#"{"decision":{"amount":29,"recipient":"GA"},"account":{"balance":50,"allowlist":["GA","GB"]}}"#,
        )
        .unwrap();
        assert!(enforce(&c, &ctx).ok);
    }
}
