//! Integration fidelity suite: ports all 28 JS assertions (bind.test.mjs,
//! compile.test.mjs, structured.test.mjs) 1:1, plus the verified JS-coercion
//! edge cases and parser quirks. This is the regression net proving semantic
//! equivalence with `agents/axl/{bind,compile}.mjs`.

use axl_compiler::compile::{
    compile_agent, compile_toolset, enforce, to_request_config, Registries,
};
use axl_compiler::json;
use axl_compiler::parse::{parse_agent, parse_bind};
use axl_compiler::predicate::{compile_predicate, Op, Operand};
use axl_compiler::value::Value;

// ── shared registries (mirroring the JS test fixtures) ──

fn registry_bind() -> Value {
    json::parse(
        r#"{
          "read_balance":    {"name":"read_balance","description":"read an account balance","input_schema":{"type":"object"}},
          "propose_payment": {"name":"propose_payment","description":"propose a payment for approval","input_schema":{"type":"object"}},
          "transfer_funds":  {"name":"transfer_funds","description":"MOVE money irreversibly","input_schema":{"type":"object"}},
          "rotate_recipient":{"name":"rotate_recipient","description":"change a payout address","input_schema":{"type":"object"}}
        }"#,
    )
    .unwrap()
}

fn tools_compile() -> Value {
    json::parse(
        r#"{
          "read_balance":       {"name":"read_balance","description":"","input_schema":{}},
          "propose_settlement": {"name":"propose_settlement","description":"","input_schema":{}},
          "transfer_funds":     {"name":"transfer_funds","description":"","input_schema":{}}
        }"#,
    )
    .unwrap()
}

fn schemas_compile() -> Value {
    json::parse(
        r#"{ "SettlementDecision": {"type":"object","properties":{"amount":{"type":"number"},"recipient":{"type":"string"}}} }"#,
    )
    .unwrap()
}

fn tools_structured() -> Value {
    json::parse(
        r#"{
          "read_balance":       {"name":"read_balance","description":"","input_schema":{"type":"object","properties":{},"additionalProperties":false}},
          "propose_settlement": {"name":"propose_settlement","description":"","input_schema":{"type":"object","properties":{},"additionalProperties":false}},
          "transfer_funds":     {"name":"transfer_funds","description":"","input_schema":{"type":"object","properties":{},"additionalProperties":false}}
        }"#,
    )
    .unwrap()
}

fn strict_schema() -> Value {
    json::parse(
        r#"{"type":"object","properties":{"amount":{"type":"number"},"recipient":{"type":"string"}},"required":["amount","recipient"],"additionalProperties":false}"#,
    )
    .unwrap()
}

const SRC_FULL: &str = "agent Settlement {\n  bind -> [read_balance, propose_settlement]\n  constrain -> SettlementDecision\n  prove -> decision.amount <= account.balance\n  prove -> decision.recipient in account.allowlist\n}";

const SRC_STRUCTURED: &str = "agent Settlement {\n  bind -> [read_balance, propose_settlement]\n  constrain -> SettlementDecision\n}";

fn tool_names(tools: &[Value]) -> Vec<String> {
    tools
        .iter()
        .filter_map(|t| {
            if let Value::Object(entries) = t {
                for (k, v) in entries {
                    if k == "name" {
                        if let Value::String(s) = v {
                            return Some(s.clone());
                        }
                    }
                }
            }
            None
        })
        .collect()
}

// ════════════════════════════════════════════════════════════════════════════
// bind.test.mjs — 6 assertions
// ════════════════════════════════════════════════════════════════════════════
mod bind_tests {
    use super::*;

    #[test]
    fn parses_bind_into_capability_set() {
        let b = parse_bind("bind Settlement -> [read_balance, propose_payment]").unwrap();
        assert_eq!(b.agent, "Settlement");
        assert_eq!(b.capabilities, vec!["read_balance", "propose_payment"]);
    }

    #[test]
    fn emitted_toolset_exactly_bound_caps() {
        let reg = registry_bind();
        let tools = compile_toolset(
            &["read_balance".into(), "propose_payment".into()],
            &reg,
        )
        .unwrap();
        let mut names = tool_names(&tools);
        names.sort();
        assert_eq!(names, vec!["propose_payment", "read_balance"]);
    }

    #[test]
    fn unbound_capability_mechanically_absent() {
        let reg = registry_bind();
        let tools = compile_toolset(
            &["read_balance".into(), "propose_payment".into()],
            &reg,
        )
        .unwrap();
        let names = tool_names(&tools);
        assert!(!names.contains(&"transfer_funds".to_string()));
        assert!(!names.contains(&"rotate_recipient".to_string()));
    }

    #[test]
    fn unknown_capability_fails_closed() {
        let reg = registry_bind();
        let err = compile_toolset(&["read_balance".into(), "wire_to_cayman".into()], &reg)
            .unwrap_err();
        // JS: /unknown capability: wire_to_cayman/
        assert_eq!(err.to_string(), "unknown capability: wire_to_cayman");
    }

    #[test]
    fn empty_binding_empty_toolset() {
        let reg = registry_bind();
        assert_eq!(compile_toolset(&[], &reg).unwrap().len(), 0);
    }

    #[test]
    fn end_to_end_injection_cannot_add_tool() {
        let reg = registry_bind();
        let b = parse_bind("bind Settlement -> [read_balance, propose_payment]").unwrap();
        let tools = compile_toolset(&b.capabilities, &reg).unwrap();
        assert!(!tool_names(&tools).contains(&"transfer_funds".to_string()));
    }
}

// ════════════════════════════════════════════════════════════════════════════
// compile.test.mjs — 10 assertions
// ════════════════════════════════════════════════════════════════════════════
mod compile_tests {
    use super::*;

    fn reg<'a>(t: &'a Value, s: &'a Value) -> Registries<'a> {
        Registries { tools: t, schemas: s }
    }

    #[test]
    fn parses_agent_block_parts() {
        let spec = parse_agent(SRC_FULL).unwrap();
        assert_eq!(spec.name, "Settlement");
        assert_eq!(spec.capabilities, vec!["read_balance", "propose_settlement"]);
        assert_eq!(spec.schema.as_deref(), Some("SettlementDecision"));
        assert_eq!(
            spec.predicates,
            vec![
                "decision.amount <= account.balance",
                "decision.recipient in account.allowlist",
            ]
        );
    }

    #[test]
    fn compiles_bind_with_forbidden_tool_absent() {
        let t = tools_compile();
        let s = schemas_compile();
        let c = compile_agent(&parse_agent(SRC_FULL).unwrap(), &reg(&t, &s)).unwrap();
        let mut names = tool_names(&c.tools);
        names.sort();
        assert_eq!(names, vec!["propose_settlement", "read_balance"]);
        assert!(!names.contains(&"transfer_funds".to_string()));
    }

    #[test]
    fn compiles_constrain_into_resolved_schema() {
        let t = tools_compile();
        let s = schemas_compile();
        let c = compile_agent(&parse_agent(SRC_FULL).unwrap(), &reg(&t, &s)).unwrap();
        // outputSchema equals SCHEMAS.SettlementDecision (structural equality).
        let expected = json::parse(
            r#"{"type":"object","properties":{"amount":{"type":"number"},"recipient":{"type":"string"}}}"#,
        )
        .unwrap();
        assert_eq!(
            json::to_string(c.output_schema.as_ref().unwrap()),
            json::to_string(&expected)
        );
    }

    #[test]
    fn prove_compiles_to_real_code_arithmetic() {
        let within = compile_predicate("decision.amount <= account.balance").unwrap();
        let ctx_ok =
            json::parse(r#"{"decision":{"amount":10},"account":{"balance":50}}"#).unwrap();
        let ctx_bad =
            json::parse(r#"{"decision":{"amount":99},"account":{"balance":50}}"#).unwrap();
        assert!(within.eval(&ctx_ok));
        assert!(!within.eval(&ctx_bad));
    }

    #[test]
    fn prove_set_membership() {
        let member = compile_predicate("decision.recipient in account.allowlist").unwrap();
        let ok = json::parse(r#"{"decision":{"recipient":"GA"},"account":{"allowlist":["GA","GB"]}}"#)
            .unwrap();
        let bad = json::parse(
            r#"{"decision":{"recipient":"GEVIL"},"account":{"allowlist":["GA","GB"]}}"#,
        )
        .unwrap();
        assert!(member.eval(&ok));
        assert!(!member.eval(&bad));
    }

    #[test]
    fn enforce_rejects_naming_violations() {
        let t = tools_compile();
        let s = schemas_compile();
        let c = compile_agent(&parse_agent(SRC_FULL).unwrap(), &reg(&t, &s)).unwrap();
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

    #[test]
    fn enforce_passes_conformant() {
        let t = tools_compile();
        let s = schemas_compile();
        let c = compile_agent(&parse_agent(SRC_FULL).unwrap(), &reg(&t, &s)).unwrap();
        let ctx = json::parse(
            r#"{"decision":{"amount":29,"recipient":"GA"},"account":{"balance":50,"allowlist":["GA","GB"]}}"#,
        )
        .unwrap();
        assert!(enforce(&c, &ctx).ok);
    }

    #[test]
    fn binding_unknown_tool_fails_closed() {
        let t = tools_compile();
        let s = schemas_compile();
        let spec = parse_agent("agent X { bind -> [read_balance, wire_to_cayman] }").unwrap();
        let err = compile_agent(&spec, &reg(&t, &s)).unwrap_err();
        assert_eq!(err.to_string(), "unknown capability: wire_to_cayman");
    }

    #[test]
    fn constrain_unknown_schema_fails_closed() {
        let t = tools_compile();
        let s = schemas_compile();
        let spec = parse_agent("agent X { bind -> [read_balance] constrain -> NopeSchema }").unwrap();
        let err = compile_agent(&spec, &reg(&t, &s)).unwrap_err();
        assert_eq!(err.to_string(), "unknown schema: NopeSchema");
    }

    #[test]
    fn compile_predicate_source_preserved() {
        // Extra: source is the trimmed predicate string.
        let p = compile_predicate("  decision.amount <= account.balance  ").unwrap();
        assert_eq!(p.source, "decision.amount <= account.balance");
    }
}

// ════════════════════════════════════════════════════════════════════════════
// structured.test.mjs — 4 assertions
// ════════════════════════════════════════════════════════════════════════════
mod structured_tests {
    use super::*;

    fn get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
        if let Value::Object(entries) = v {
            for (k, val) in entries {
                if k == key {
                    return Some(val);
                }
            }
        }
        None
    }

    #[test]
    fn emits_output_config_json_schema() {
        let t = tools_structured();
        let s = json::parse(&format!(
            r#"{{"SettlementDecision":{}}}"#,
            json::to_string(&strict_schema())
        ))
        .unwrap();
        let c = compile_agent(
            &parse_agent(SRC_STRUCTURED).unwrap(),
            &Registries { tools: &t, schemas: &s },
        )
        .unwrap();
        let req = to_request_config(&c).unwrap();
        let oc = get(&req, "output_config").unwrap();
        let fmt = get(oc, "format").unwrap();
        assert_eq!(
            get(fmt, "type").unwrap().js_string(),
            Some("json_schema")
        );
        // schema equals STRICT_SCHEMA structurally.
        assert_eq!(
            json::to_string(get(fmt, "schema").unwrap()),
            json::to_string(&strict_schema())
        );
    }

    #[test]
    fn emits_strict_tools_bound_out_absent() {
        let t = tools_structured();
        let s = json::parse(&format!(
            r#"{{"SettlementDecision":{}}}"#,
            json::to_string(&strict_schema())
        ))
        .unwrap();
        let c = compile_agent(
            &parse_agent(SRC_STRUCTURED).unwrap(),
            &Registries { tools: &t, schemas: &s },
        )
        .unwrap();
        let req = to_request_config(&c).unwrap();
        let tools = get(&req, "tools").unwrap();
        if let Value::Array(items) = tools {
            // every tool strict:true
            for item in items {
                assert_eq!(
                    get(item, "strict"),
                    Some(&Value::Bool(true)),
                    "every tool must be strict"
                );
            }
            assert!(!tool_names(items).contains(&"transfer_funds".to_string()));
        } else {
            panic!("tools not array");
        }
    }

    #[test]
    fn loose_schema_fails_closed() {
        let t = tools_structured();
        let loose = json::parse(r#"{"type":"object","properties":{"x":{"type":"string"}}}"#).unwrap();
        let s = json::parse(&format!(
            r#"{{"SettlementDecision":{}}}"#,
            json::to_string(&loose)
        ))
        .unwrap();
        let c = compile_agent(
            &parse_agent(SRC_STRUCTURED).unwrap(),
            &Registries { tools: &t, schemas: &s },
        )
        .unwrap();
        let err = to_request_config(&c).unwrap_err();
        // JS: /strict schema requires additionalProperties:\s*false/
        assert_eq!(
            err.to_string(),
            "strict schema requires additionalProperties: false"
        );
    }

    #[test]
    fn no_constrain_no_output_config_tools_strict() {
        let t = tools_structured();
        let s = json::parse(&format!(
            r#"{{"SettlementDecision":{}}}"#,
            json::to_string(&strict_schema())
        ))
        .unwrap();
        let c = compile_agent(
            &parse_agent("agent S { bind -> [read_balance] }").unwrap(),
            &Registries { tools: &t, schemas: &s },
        )
        .unwrap();
        let req = to_request_config(&c).unwrap();
        assert!(get(&req, "output_config").is_none());
        if let Some(Value::Array(items)) = get(&req, "tools") {
            for item in items {
                assert_eq!(get(item, "strict"), Some(&Value::Bool(true)));
            }
        } else {
            panic!("tools not array");
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// coercion edges — verified JS-coercion behaviour
// ════════════════════════════════════════════════════════════════════════════
mod coercion_edges {
    use super::*;

    fn ctx(s: &str) -> Value {
        json::parse(s).unwrap()
    }

    fn eval(src: &str, c: &Value) -> bool {
        compile_predicate(src).unwrap().eval(c)
    }

    #[test]
    fn undefined_le_5_is_false() {
        // E09: missing path => undefined; undefined <= 5 => false.
        assert!(!eval("a <= 5", &ctx("{}")));
    }

    #[test]
    fn null_lt_5_is_true() {
        // null < 5 => Number(null)=0 => 0 < 5 => true. Distinct from undefined.
        assert!(eval("a < 5", &ctx(r#"{"a":null}"#)));
    }

    #[test]
    fn string_9_lt_string_10_is_false() {
        // Lexicographic: '9' > '1' so '9' < '10' is false.
        assert!(!eval("a < b", &ctx(r#"{"a":"9","b":"10"}"#)));
    }

    #[test]
    fn string_10_strict_ne_number_10() {
        // E27-style: '10' !== 10.
        assert!(!eval("a == 10", &ctx(r#"{"a":"10"}"#)));
        assert!(eval("a != 10", &ctx(r#"{"a":"10"}"#)));
    }

    #[test]
    fn in_non_array_is_false() {
        // E13/E15: object and string rhs are not membership.
        assert!(!eval("x in y", &ctx(r#"{"x":"a","y":{"a":1}}"#)));
        assert!(!eval("x in y", &ctx(r#"{"x":"a","y":"abc"}"#)));
    }

    #[test]
    fn string_5_lt_10_is_true() {
        // '5' < 10 : not both strings => ToNumber('5')=5, 5 < 10 => true.
        assert!(eval("a < 10", &ctx(r#"{"a":"5"}"#)));
    }

    #[test]
    fn quoted_number_literal_is_string() {
        // E27: a == "42" with a:42 => false (quoted => string).
        assert!(!eval("a == \"42\"", &ctx(r#"{"a":42}"#)));
    }

    #[test]
    fn two_missing_paths_eq_is_true() {
        // E20/E21: undefined === undefined => true.
        assert!(eval("a == b", &ctx("{}")));
    }
}

// ════════════════════════════════════════════════════════════════════════════
// parser quirks — body-slice, non-greedy lhs, mixed-quote strip, empty bind
// ════════════════════════════════════════════════════════════════════════════
mod parser_quirks {
    use super::*;

    #[test]
    fn last_brace_body_slice_truncation() {
        // P17/P18: body = first '{' .. last '}', spanning both blocks.
        let spec =
            parse_agent("agent First { bind -> [a] }\nagent Second { bind -> [b] }").unwrap();
        assert_eq!(spec.name, "First");
        assert_eq!(spec.capabilities, vec!["a"]);

        let bleed = parse_agent(
            "agent First {\n bind -> [a]\n prove -> x < 1\n}\nagent Second {\n prove -> y < 2\n}",
        )
        .unwrap();
        assert_eq!(bleed.predicates, vec!["x < 1", "y < 2"]);
    }

    #[test]
    fn non_greedy_predicate_lhs() {
        // E03: '<=' wins over '<'; lhs is the shortest (leftmost split).
        let p = compile_predicate("decision.x <= 10").unwrap();
        assert_eq!(p.op, Op::Le);
        assert_eq!(p.lhs, Operand::Path("decision.x".into()));
        assert_eq!(p.rhs, Operand::Number(10.0));
    }

    #[test]
    fn mixed_quote_strip() {
        // E16: single-quoted rhs with spaces strips to internal content.
        let p = compile_predicate("a == 'hello world'").unwrap();
        assert_eq!(p.rhs, Operand::Str("hello world".into()));
        // double-quoted too
        let p2 = compile_predicate(r#"a == "foo""#).unwrap();
        assert_eq!(p2.rhs, Operand::Str("foo".into()));
    }

    #[test]
    fn empty_bind_empty_caps() {
        assert!(parse_agent("agent E { bind -> [] }").unwrap().capabilities.is_empty());
        assert!(parse_agent("agent E { bind -> [   ] }").unwrap().capabilities.is_empty());
    }

    #[test]
    fn brace_inside_quotes_not_stripped() {
        // P15: a == "}" preserves the brace.
        let spec = parse_agent("agent E {\n prove -> a == \"}\" \n}").unwrap();
        assert_eq!(spec.predicates, vec!["a == \"}\""]);
    }

    #[test]
    fn in_within_path_not_operator() {
        // E18/E19: 'within' / 'login' do not split on the 'in' substring.
        assert_eq!(compile_predicate("within <= 5").unwrap().op, Op::Le);
        assert_eq!(compile_predicate("login.x == 1").unwrap().op, Op::Eq);
        // flags.in is a path segment.
        let p = compile_predicate("flags.in == 1").unwrap();
        assert_eq!(p.op, Op::Eq);
        assert_eq!(p.lhs, Operand::Path("flags.in".into()));
    }

    #[test]
    fn malformed_predicate_messages() {
        // FC06/FC07/FC08.
        assert_eq!(
            compile_predicate("just text").unwrap_err().to_string(),
            "malformed predicate: just text"
        );
        assert_eq!(
            compile_predicate("a ~= b").unwrap_err().to_string(),
            "malformed predicate: a ~= b"
        );
        assert_eq!(
            compile_predicate("a => b").unwrap_err().to_string(),
            "malformed predicate: a => b"
        );
    }

    #[test]
    fn malformed_agent_messages() {
        // P19/P20/P23/P24.
        assert_eq!(parse_agent("foo Bar { }").unwrap_err().to_string(), "malformed agent block");
        assert_eq!(parse_agent("agent Bar").unwrap_err().to_string(), "malformed agent block");
        assert_eq!(
            parse_agent("agent Café { bind -> [read_balance] }").unwrap_err().to_string(),
            "malformed agent block"
        );
        assert_eq!(
            parse_agent("agent <script> { bind -> [read_balance] }").unwrap_err().to_string(),
            "malformed agent block"
        );
    }
}
