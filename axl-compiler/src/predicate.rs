//! `prove`-stage: compile a predicate string into an evaluable form and
//! evaluate it against a context [`Value`]. Faithful port of `resolveOperand`,
//! `OPS`, and `compilePredicate` from compile.mjs.
//!
//! Operator semantics mirror JS exactly:
//! - `< <= > >=` implement JS *Abstract Relational Comparison*: string-vs-string
//!   is lexicographic; otherwise `ToNumber` both sides and any `NaN` => `false`.
//! - `== !=` are strict equality (`=== / !==`).
//! - `in` requires the rhs to be an Array AND to contain an element strictly
//!   equal to the lhs (object membership and string containment are NOT
//!   supported — fail-closed, E13/E15/E25).

use crate::error::CompileError;
use crate::value::Value;

/// Comparison operators, in the JS alternation order (`<=` before `<`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Le,
    Ge,
    Eq,
    Ne,
    Lt,
    Gt,
    In,
}

impl Op {
    fn token(&self) -> &'static str {
        match self {
            Op::Le => "<=",
            Op::Ge => ">=",
            Op::Eq => "==",
            Op::Ne => "!=",
            Op::Lt => "<",
            Op::Gt => ">",
            Op::In => "in",
        }
    }

    /// The op alternation in EXACT JS order. Order is load-bearing: `<=` must be
    /// tried before `<` so `a <= b` does not split on `<` (E03).
    fn alternation() -> [Op; 7] {
        [Op::Le, Op::Ge, Op::Eq, Op::Ne, Op::Lt, Op::Gt, Op::In]
    }
}

/// An operand: a number/string literal resolved at compile time, or a dotted
/// path resolved against the context at eval time.
#[derive(Debug, Clone, PartialEq)]
pub enum Operand {
    Number(f64),
    Str(String),
    Path(String),
}

/// A compiled predicate: the original source plus the parsed lhs/op/rhs.
#[derive(Debug, Clone, PartialEq)]
pub struct Predicate {
    pub source: String,
    pub lhs: Operand,
    pub op: Op,
    pub rhs: Operand,
}

/// JS regex `\s` — the full set (NOT ASCII-only, NOT `char::is_whitespace`).
/// Mirror of the copy in [`crate::parse`]; both gate the regex-equivalent splits
/// on this so `a <NBSP> <= <NBSP> b` splits in Rust exactly as JS `\s+` would.
fn is_ws(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
        | '\u{000A}'
        | '\u{000B}'
        | '\u{000C}'
        | '\u{000D}'
        | '\u{0020}'
        | '\u{00A0}'
        | '\u{1680}'
        | '\u{2000}'..='\u{200A}'
        | '\u{2028}'
        | '\u{2029}'
        | '\u{202F}'
        | '\u{205F}'
        | '\u{3000}'
        | '\u{FEFF}'
    )
}

/// Port of `resolveOperand`'s literal classification (the eval-time path lookup
/// is done separately). Trims, then:
/// - `^-?\d+(\.\d+)?$` => Number
/// - `^["'].*["']$`    => Str (strip first+last char)
/// - else              => Path
pub fn resolve_operand(token: &str) -> Operand {
    let t = token.trim();
    if is_number_literal(t) {
        // Safe: is_number_literal guarantees a parseable decimal.
        let n = t.parse::<f64>().unwrap_or(f64::NAN);
        return Operand::Number(n);
    }
    if is_quoted_literal(t) {
        // strip first and last char (JS slice(1,-1)).
        let chars: Vec<char> = t.chars().collect();
        let inner: String = chars[1..chars.len() - 1].iter().collect();
        return Operand::Str(inner);
    }
    Operand::Path(t.to_string())
}

/// `^-?\d+(\.\d+)?$`
fn is_number_literal(t: &str) -> bool {
    let chars: Vec<char> = t.chars().collect();
    let n = chars.len();
    if n == 0 {
        return false;
    }
    let mut i = 0;
    if chars[0] == '-' {
        i = 1;
    }
    // \d+
    let int_start = i;
    while i < n && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i == int_start {
        return false;
    }
    // (\.\d+)?
    if i < n && chars[i] == '.' {
        i += 1;
        let frac_start = i;
        while i < n && chars[i].is_ascii_digit() {
            i += 1;
        }
        if i == frac_start {
            return false;
        }
    }
    i == n
}

/// `^["'].*["']$` — starts and ends with a quote char (either `"` or `'`),
/// length >= 2. `.*` accepts any internal content (including spaces and the
/// other quote char), matching JS `/^["'].*["']$/`.
fn is_quoted_literal(t: &str) -> bool {
    let chars: Vec<char> = t.chars().collect();
    if chars.len() < 2 {
        return false;
    }
    let first = chars[0];
    let last = chars[chars.len() - 1];
    (first == '"' || first == '\'') && (last == '"' || last == '\'')
}

/// Resolve an [`Operand`] to a [`Value`] against `ctx` (paths resolved now).
fn operand_value(op: &Operand, ctx: &Value) -> Value {
    match op {
        Operand::Number(n) => Value::Number(*n),
        Operand::Str(s) => Value::String(s.clone()),
        Operand::Path(p) => ctx.resolve_path(p),
    }
}

/// Port of `compilePredicate`:
/// `/^(.+?)\s+(<=|>=|==|!=|<|>|in)\s+(.+)$/` (non-greedy lhs).
///
/// On no match: [`CompileError::MalformedPredicate`] with the trimmed source.
pub fn compile_predicate(src: &str) -> Result<Predicate, CompileError> {
    let trimmed = src.trim().to_string();
    let chars: Vec<char> = trimmed.chars().collect();
    let n = chars.len();

    // Non-greedy lhs `(.+?)`: the regex tries the SHORTEST lhs first, i.e. the
    // LEFTMOST split point. We scan positions left-to-right; at each boundary we
    // require: >=1 char of lhs already consumed, then \s+, then a valid op, then
    // \s+, then >=1 char of rhs to end-of-string. The first boundary that
    // satisfies all of that wins — exactly the regex's leftmost-match behaviour.
    //
    // `i` marks the start of the run of whitespace separating lhs from op.
    // lhs = chars[0..i] (must be non-empty => i >= 1).
    for i in 1..n {
        // Need at least one whitespace char at position i.
        if !is_ws(chars[i]) {
            continue;
        }
        // Consume \s+ (greedy) starting at i.
        let mut ws_end = i;
        while ws_end < n && is_ws(chars[ws_end]) {
            ws_end += 1;
        }
        // Try each operator in JS alternation order at position ws_end.
        for op in Op::alternation() {
            let tok = op.token();
            if !slice_eq(&chars, ws_end, tok) {
                continue;
            }
            let after_op = ws_end + tok.chars().count();
            // Need \s+ after the operator.
            if after_op >= n || !is_ws(chars[after_op]) {
                continue;
            }
            let mut rhs_ws_end = after_op;
            while rhs_ws_end < n && is_ws(chars[rhs_ws_end]) {
                rhs_ws_end += 1;
            }
            // (.+)$ — rhs must be non-empty and run to end.
            if rhs_ws_end >= n {
                continue;
            }
            // Match! lhs = [0..i], rhs = [rhs_ws_end..n].
            let lhs_str: String = chars[0..i].iter().collect();
            let rhs_str: String = chars[rhs_ws_end..n].iter().collect();
            return Ok(Predicate {
                source: trimmed.clone(),
                lhs: resolve_operand(&lhs_str),
                op,
                rhs: resolve_operand(&rhs_str),
            });
        }
    }
    Err(CompileError::MalformedPredicate(trimmed))
}

/// True iff `chars[at..]` starts with `lit`.
fn slice_eq(chars: &[char], at: usize, lit: &str) -> bool {
    for (i, want) in (at..).zip(lit.chars()) {
        if chars.get(i) != Some(&want) {
            return false;
        }
    }
    true
}

impl Predicate {
    /// Evaluate this predicate against `ctx`, applying the op with JS coercion.
    pub fn eval(&self, ctx: &Value) -> bool {
        let a = operand_value(&self.lhs, ctx);
        let b = operand_value(&self.rhs, ctx);
        match self.op {
            Op::Eq => a.strict_eq(&b),
            // NOT `!a.strict_eq(&b)`: that is fail-OPEN for composite operands
            // (undecidable reference identity -> `!false` -> predicate PASSES).
            // `ne_fail_closed` returns `false` (violation) for any composite
            // operand, matching the crate's fail-closed contract. See value.rs.
            Op::Ne => a.ne_fail_closed(&b),
            Op::Lt => js_relational(Rel::Lt, &a, &b),
            Op::Le => js_relational(Rel::Le, &a, &b),
            Op::Gt => js_relational(Rel::Gt, &a, &b),
            Op::Ge => js_relational(Rel::Ge, &a, &b),
            Op::In => js_in(&a, &b),
        }
    }
}

#[derive(Clone, Copy)]
enum Rel {
    Lt,
    Le,
    Gt,
    Ge,
}

/// JS Abstract Relational Comparison for `< <= > >=`.
///
/// If BOTH operands are strings: lexicographic by char (JS compares by UTF-16
/// code unit; for the BMP/ASCII inputs Axl predicates carry, char order agrees).
/// Otherwise: ToNumber both; if either is NaN the result is `false` for ALL four
/// relations (the "undefined" relational result coerces to false).
fn js_relational(rel: Rel, a: &Value, b: &Value) -> bool {
    if let (Some(sa), Some(sb)) = (a.js_string(), b.js_string()) {
        // String-vs-string lexicographic.
        let ord = lexicographic_cmp(sa, sb);
        return match rel {
            Rel::Lt => ord == std::cmp::Ordering::Less,
            Rel::Le => ord != std::cmp::Ordering::Greater,
            Rel::Gt => ord == std::cmp::Ordering::Greater,
            Rel::Ge => ord != std::cmp::Ordering::Less,
        };
    }
    let na = a.to_number();
    let nb = b.to_number();
    if na.is_nan() || nb.is_nan() {
        // JS: a NaN operand makes <, <=, >, >= all false.
        return false;
    }
    match rel {
        Rel::Lt => na < nb,
        Rel::Le => na <= nb,
        Rel::Gt => na > nb,
        Rel::Ge => na >= nb,
    }
}

/// JS string `<` compares by UTF-16 code unit. We compare by Unicode scalar
/// value (char), which agrees with UTF-16 order across the BMP. Supplementary
/// chars (surrogate pairs) order differently in raw UTF-16, but Axl predicate
/// strings never carry them, so this is faithful for the input domain.
fn lexicographic_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.chars().cmp(b.chars())
}

/// JS `'in'` op: `Array.isArray(b) && b.includes(a)`.
///
/// `includes` uses SameValueZero; we approximate with strict_eq, which agrees
/// for every value an Axl predicate produces (no NaN membership is tested).
/// rhs that is a String/Object/Undefined => not an Array => `false`.
fn js_in(a: &Value, b: &Value) -> bool {
    match b {
        Value::Array(items) => items.iter().any(|e| e.strict_eq(a)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(pairs: Vec<(&str, Value)>) -> Value {
        Value::Object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    fn num(n: f64) -> Value {
        Value::Number(n)
    }
    fn s(x: &str) -> Value {
        Value::String(x.to_string())
    }

    fn eval(src: &str, c: &Value) -> bool {
        compile_predicate(src).unwrap().eval(c)
    }

    // ── operand resolution / op extraction ──
    #[test]
    fn e03_op_extraction_le_before_lt() {
        let p = compile_predicate("decision.x <= 10").unwrap();
        assert_eq!(p.op, Op::Le);
        assert_eq!(p.lhs, Operand::Path("decision.x".into()));
        assert_eq!(p.rhs, Operand::Number(10.0));
    }

    #[test]
    fn e18_within_not_in_operator() {
        let p = compile_predicate("within <= 5").unwrap();
        assert_eq!(p.source, "within <= 5");
        assert_eq!(p.op, Op::Le);
        assert_eq!(p.lhs, Operand::Path("within".into()));
        assert!(eval("within <= 5", &ctx(vec![("within", num(3.0))])));
    }

    #[test]
    fn e19_login_not_in_operator() {
        let p = compile_predicate("login.x == 1").unwrap();
        assert_eq!(p.source, "login.x == 1");
        assert_eq!(p.op, Op::Eq);
    }

    #[test]
    fn e17_in_as_path_segment() {
        // flags.in == 1 — the 'in' is a path SEGMENT, op is ==.
        let p = compile_predicate("flags.in == 1").unwrap();
        assert_eq!(p.op, Op::Eq);
        assert_eq!(p.lhs, Operand::Path("flags.in".into()));
        assert!(eval(
            "flags.in == 1",
            &ctx(vec![("flags", ctx(vec![("in", num(1.0))]))])
        ));
    }

    // ── relational ──
    #[test]
    fn e01_le_equal() {
        assert!(eval("a <= b", &ctx(vec![("a", num(5.0)), ("b", num(5.0))])));
    }

    #[test]
    fn e02_lt_strict() {
        assert!(!eval("a < b", &ctx(vec![("a", num(5.0)), ("b", num(5.0))])));
    }

    #[test]
    fn e07_negative_literal() {
        assert!(eval("a > -3", &ctx(vec![("a", num(-2.0))])));
    }

    #[test]
    fn e08_decimal_literal() {
        assert!(eval("a <= 2.5", &ctx(vec![("a", num(2.5))])));
    }

    #[test]
    fn e09_missing_path_never_passes_bound() {
        // undefined < 5 => NaN-compare => false.
        assert!(!eval("a < 5", &Value::Object(vec![])));
    }

    #[test]
    fn e10_string_lhs_vs_number_false() {
        // 'foo' < 5 => ToNumber('foo')=NaN => false.
        assert!(!eval("'foo' < 5", &Value::Object(vec![])));
    }

    // ── equality ──
    #[test]
    fn e04_eq_number_literal() {
        assert!(eval("a == 5", &ctx(vec![("a", num(5.0))])));
    }

    #[test]
    fn e05_eq_strict_no_coercion() {
        assert!(!eval("a == 5", &ctx(vec![("a", s("5"))])));
    }

    #[test]
    fn e06_ne() {
        assert!(eval("a != 5", &ctx(vec![("a", num(6.0))])));
    }

    #[test]
    fn e16_single_quoted_with_spaces() {
        assert!(eval(
            "a == 'hello world'",
            &ctx(vec![("a", s("hello world"))])
        ));
    }

    #[test]
    fn e20_e21_missing_paths_equal() {
        // undefined === undefined => true.
        assert!(eval("a == b", &ctx(vec![])));
        assert!(eval("a == b", &Value::Object(vec![])));
    }

    #[test]
    fn e22_booleans_via_paths() {
        assert!(eval(
            "a == b",
            &ctx(vec![("a", Value::Bool(true)), ("b", Value::Bool(true))])
        ));
    }

    #[test]
    fn e26_deep_missing_path_safe() {
        assert!(!eval("a.b.c == 1", &ctx(vec![("a", Value::Object(vec![]))])));
    }

    #[test]
    fn e27_quoted_number_is_string() {
        // rhs "42" is a String literal; 42 !== '42'.
        assert!(!eval("a == \"42\"", &ctx(vec![("a", num(42.0))])));
    }

    // ── in ──
    #[test]
    fn e11_in_array_includes() {
        assert!(eval(
            "x in y",
            &ctx(vec![("x", s("GA")), ("y", Value::Array(vec![s("GA"), s("GB")]))])
        ));
    }

    #[test]
    fn e12_in_array_excludes() {
        assert!(!eval(
            "x in y",
            &ctx(vec![("x", s("GZ")), ("y", Value::Array(vec![s("GA")]))])
        ));
    }

    #[test]
    fn e13_in_object_false() {
        assert!(!eval(
            "x in y",
            &ctx(vec![("x", s("a")), ("y", ctx(vec![("a", num(1.0))]))])
        ));
    }

    #[test]
    fn e14_in_missing_rhs_false() {
        assert!(!eval("x in y", &ctx(vec![("x", s("a"))])));
    }

    #[test]
    fn e15_in_string_not_membership() {
        assert!(!eval("x in y", &ctx(vec![("x", s("a")), ("y", s("abc"))])));
    }

    #[test]
    fn e23_in_numeric_membership() {
        assert!(eval(
            "x in y",
            &ctx(vec![("x", num(3.0)), ("y", Value::Array(vec![num(1.0), num(2.0), num(3.0)]))])
        ));
    }

    #[test]
    fn e24_in_number_literal_lhs() {
        assert!(eval(
            "3 in y",
            &ctx(vec![("y", Value::Array(vec![num(1.0), num(2.0), num(3.0)]))])
        ));
    }

    #[test]
    fn e25_in_quoted_string_rhs_false() {
        assert!(!eval("x in \"abc\"", &ctx(vec![("x", s("a"))])));
    }

    // ── malformed ──
    #[test]
    fn fc06_no_operator() {
        assert_eq!(
            compile_predicate("just text"),
            Err(CompileError::MalformedPredicate("just text".into()))
        );
    }

    #[test]
    fn fc07_tilde_eq_not_op() {
        assert_eq!(
            compile_predicate("a ~= b"),
            Err(CompileError::MalformedPredicate("a ~= b".into()))
        );
    }

    #[test]
    fn fc08_arrow_not_op() {
        assert_eq!(
            compile_predicate("a => b"),
            Err(CompileError::MalformedPredicate("a => b".into()))
        );
    }

    // ── lexicographic string comparison (JS relational on two strings) ──
    #[test]
    fn lexicographic_strings() {
        // '9' < '10' is FALSE in JS string comparison ('9' > '1').
        assert!(!eval(
            "a < b",
            &ctx(vec![("a", s("9")), ("b", s("10"))])
        ));
        // 'abc' < 'abd' true.
        assert!(eval("a < b", &ctx(vec![("a", s("abc")), ("b", s("abd"))])));
    }

    #[test]
    fn null_coerces_to_zero_relational() {
        // null < 5 => Number(null)=0 => 0 < 5 => true (distinct from undefined).
        assert!(eval("a < 5", &ctx(vec![("a", Value::Null)])));
        // undefined < 5 => false.
        assert!(!eval("a < 5", &ctx(vec![("a", Value::Undefined)])));
    }

    // ── regression: != fail-open on composite operands (HIGH) ──
    #[test]
    fn ne_same_array_field_is_violation() {
        // JS: `x != x` with {x:[1,2]} is `false` (same ref) -> predicate FAILS
        // -> violation. Rust must NOT compute `!strict_eq` (= true = PASS).
        let c = ctx(vec![(
            "x",
            Value::Array(vec![Value::Number(1.0), Value::Number(2.0)]),
        )]);
        assert!(!eval("x != x", &c), "x != x on an array must be false (block)");
        // The simplest aliasing form: two paths to the same array field.
        let shared = Value::Array(vec![s("GA"), s("GB")]);
        let c2 = ctx(vec![(
            "decision",
            Value::Object(vec![("allowlist".into(), shared)]),
        )]);
        assert!(
            !eval("decision.allowlist != decision.allowlist", &c2),
            "self-!= on a composite field must be a violation"
        );
    }

    // ── regression: array ToPrimitive in relational comparison (MEDIUM) ──
    #[test]
    fn relational_array_to_primitive() {
        // JS: [5] <= 50 -> 5 <= 50 -> true; [] <= 5 -> 0 <= 5 -> true.
        assert!(eval("a <= 50", &ctx(vec![("a", Value::Array(vec![num(5.0)]))])));
        assert!(eval("a <= 5", &ctx(vec![("a", Value::Array(vec![]))])));
        assert!(eval(
            "a <= b",
            &ctx(vec![("a", Value::Array(vec![])), ("b", num(0.0))])
        ));
        // [1,2] is NaN -> all relations false.
        assert!(!eval(
            "a <= 50",
            &ctx(vec![("a", Value::Array(vec![num(1.0), num(2.0)]))])
        ));
    }

    // ── regression: hex/inf string operands in relational comparison ──
    #[test]
    fn relational_string_radix_and_inf() {
        // "0x10" -> 16 <= 50 -> true (JS Number("0x10")=16).
        assert!(eval("a <= 50", &ctx(vec![("a", s("0x10"))])));
        assert!(eval("a >= 5", &ctx(vec![("a", s("0x10"))])));
        // "-inf" -> NaN in JS -> -inf<=50 must be FALSE (was fail-open: Rust f64
        // parsed -inf to -INFINITY and approved). This is the fail-open guard.
        assert!(!eval("a <= 50", &ctx(vec![("a", s("-inf"))])));
        assert!(!eval("a <= 50", &ctx(vec![("a", s("Inf"))])));
    }
}
