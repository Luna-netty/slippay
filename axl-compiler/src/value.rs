//! Self-contained JSON-like dynamic value — the Rust analog of the JS runtime
//! value the Axl compiler evaluates predicates against.
//!
//! CRITICAL distinction: `Null` (a *present* JSON `null`) vs `Undefined` (a
//! *missing* path / absent field). JS relational coercion treats `null` as `0`
//! but `undefined` as `NaN`, and `undefined === undefined` is `true` while
//! `null === undefined` is `false`. Conflating them silently changes which
//! predicates pass, so they are distinct variants here.
//!
//! `Number` is `f64` (JS has exactly one numeric type). `Object` is a
//! `Vec<(String, Value)>`: insertion order is irrelevant to semantics — only
//! key lookup matters — so a flat assoc list is sufficient and serde-free.

/// A dynamic value mirroring the JS values this compiler manipulates.
///
/// `PartialEq` is derived for test/equality convenience (assertions, registry
/// equality checks). It is structural and follows IEEE-754 for `f64` (so
/// `NaN != NaN`). For JS `===` semantics across the Null/Undefined distinction,
/// use [`Value::strict_eq`] instead — the derived `PartialEq` treats `Null` and
/// `Undefined` as distinct variants (which agrees with JS) but is otherwise a
/// plain structural compare and is NOT the operator the evaluator uses.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// A *present* JSON `null` (coerces to 0 under JS relational comparison).
    Null,
    /// A *missing* path / absent field (coerces to NaN; `=== undefined` only).
    /// JSON text can never parse to this — it arises solely from path misses.
    Undefined,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    /// Mirror of JS `o == null ? undefined : o[k]`.
    ///
    /// Returns `Undefined` when `self` is not an object, or the key is absent.
    /// A present object value (including a present `Null`) is returned as-is.
    pub fn get(&self, key: &str) -> Value {
        match self {
            Value::Object(entries) => {
                for (k, v) in entries {
                    if k == key {
                        return v.clone();
                    }
                }
                Value::Undefined
            }
            // Non-object (including Null/Undefined) => property access yields
            // undefined in the reduce (o == null short-circuits to undefined).
            _ => Value::Undefined,
        }
    }

    /// Resolve a dotted path against `self`, JS-`reduce`-style and
    /// Undefined-propagating: `path.split('.').reduce((o,k) => o==null ? undefined : o[k], self)`.
    ///
    /// An empty segment list (impossible here — `split` always yields >=1) or
    /// any missing/`null` intermediate collapses to `Undefined`.
    pub fn resolve_path(&self, dotted: &str) -> Value {
        let mut cur = self.clone();
        for seg in dotted.split('.') {
            cur = match cur {
                // o == null (null OR undefined) => undefined for the rest.
                Value::Null | Value::Undefined => return Value::Undefined,
                ref other => other.get(seg),
            };
        }
        cur
    }

    /// JS `ToNumber` for the cases this compiler hits after operand resolution:
    /// - `Null`      -> 0      (Number(null) === 0)
    /// - `Undefined` -> NaN    (Number(undefined) is NaN)
    /// - `Bool`      -> 0 / 1
    /// - `String`    -> JS string-to-number (trimmed; ""/whitespace -> 0; else parse-or-NaN)
    /// - `Number`    -> self
    /// - `Array`     -> JS `ToPrimitive(array, Number)` = `Number(array.join(","))`:
    ///   `Number([])` is `0`, `Number([5])` is `5`, `Number([1,2])` is `NaN`. A
    ///   nested array stringifies recursively (JS `Array.prototype.toString`).
    /// - `Object`    -> NaN (`Number({})` is `NaN`; plain objects have no useful
    ///   `valueOf`/`toString` numeric coercion, so this is faithful).
    pub fn to_number(&self) -> f64 {
        match self {
            Value::Null => 0.0,
            Value::Undefined => f64::NAN,
            Value::Bool(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            Value::Number(n) => *n,
            Value::String(s) => js_string_to_number(s),
            // JS Array ToNumber goes through ToString first (Array.prototype.join
            // with ","), THEN StringToNumber on the joined text. Matches
            // Number([5]) === 5, Number([]) === 0, Number([1,2]) === NaN.
            Value::Array(_) => js_string_to_number(&self.js_array_to_string()),
            Value::Object(_) => f64::NAN,
        }
    }

    /// JS `Array.prototype.toString` (== `join(",")`): each element is stringified
    /// (`null`/`undefined` -> "", nested arrays recurse), joined with ",".
    /// Only used as the first step of `ToNumber(array)`.
    fn js_array_to_string(&self) -> String {
        match self {
            Value::Array(items) => items
                .iter()
                .map(|v| v.js_to_string_for_join())
                .collect::<Vec<_>>()
                .join(","),
            _ => String::new(),
        }
    }

    /// JS `String(x)` for the element-of-array-join case: `null`/`undefined`
    /// render as the empty string inside `join`; numbers/bools/strings render
    /// their value; nested arrays recurse. Objects render `[object Object]`
    /// (which `Number` then maps to `NaN`), matching JS.
    fn js_to_string_for_join(&self) -> String {
        match self {
            Value::Null | Value::Undefined => String::new(),
            Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
            Value::Number(n) => {
                if n.is_nan() {
                    "NaN".to_string()
                } else if n.is_infinite() {
                    if *n > 0.0 { "Infinity" } else { "-Infinity" }.to_string()
                } else if *n == n.trunc() && n.abs() < 1e15 {
                    (*n as i64).to_string()
                } else {
                    format!("{n}")
                }
            }
            Value::String(s) => s.clone(),
            Value::Array(_) => self.js_array_to_string(),
            Value::Object(_) => "[object Object]".to_string(),
        }
    }

    /// JS strict equality `===`: same type-tag AND same value.
    ///
    /// - `Number`: IEEE-754 equality, so `NaN === NaN` is `false`.
    /// - `Null === Null` => true; `Undefined === Undefined` => true;
    ///   `Null === Undefined` => false (distinct type tags).
    /// - `Bool`/`String`: value equality.
    /// - `Array`/`Object`: reference identity in JS. The `Value` model has no
    ///   aliasing (every resolve clones), so reference identity of two composite
    ///   operands is UNDECIDABLE here. We return `false` (not strictly equal).
    ///
    /// IMPORTANT asymmetry, and why a separate [`Value::ne_fail_closed`] exists:
    /// returning `false` for composites is the conservative/fail-closed answer
    /// for `==` (a guard `prove -> a == b` then reports a violation where JS
    /// might pass — over-block, safe), but it is FAIL-OPEN for `!=`, because
    /// `Op::Ne` computes `!strict_eq` => `!false` => `true` (predicate PASSES).
    /// A `prove -> x != y` guard meant to block when two object/array fields are
    /// the same JS reference would be silently bypassed. So `Op::Ne` MUST NOT use
    /// `!strict_eq` for composite operands — it uses [`Value::ne_fail_closed`].
    pub fn strict_eq(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Undefined, Value::Undefined) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            // f64 == handles NaN!=NaN exactly like JS Number === Number.
            (Value::Number(a), Value::Number(b)) => a == b,
            (Value::String(a), Value::String(b)) => a == b,
            // Different type tags, or composite operands: not strictly equal.
            _ => false,
        }
    }

    /// True iff this is a composite (`Array`/`Object`) value — the operand class
    /// whose JS reference identity this model cannot observe.
    fn is_composite(&self) -> bool {
        matches!(self, Value::Array(_) | Value::Object(_))
    }

    /// JS `!==` for `Op::Ne`, made fail-CLOSED on the undecidable composite case.
    ///
    /// For primitive operands this is exactly `!strict_eq` (faithful to JS).
    /// For two composite operands, JS `a !== b` is `false` (no violation) iff
    /// `a` and `b` are the SAME reference — which we cannot observe. Treating
    /// them as not-equal (`!strict_eq == true`) would PASS the predicate, which
    /// is fail-open for a guard that exists to block same-reference cases. So we
    /// return `false` (predicate fails => violation => BLOCK) whenever either
    /// operand is composite. This is a deliberate, documented divergence from a
    /// naive `!strict_eq`: undecidable identity resolves to the safe answer.
    pub fn ne_fail_closed(&self, other: &Value) -> bool {
        if self.is_composite() || other.is_composite() {
            // Undecidable reference identity => fail closed (block).
            return false;
        }
        !self.strict_eq(other)
    }

    /// Borrow the inner string when `self` is a `String` (used for the JS
    /// string-vs-string lexicographic branch of relational comparison).
    pub fn js_string(&self) -> Option<&str> {
        match self {
            Value::String(s) => Some(s.as_str()),
            _ => None,
        }
    }
}

/// Faithful JS `Number(string)` (a.k.a. StringNumericLiteral / `ToNumber` on a
/// string) for every reachable form:
/// - trim leading/trailing whitespace; empty (or all-whitespace) -> 0;
/// - exactly `Infinity` / `+Infinity` / `-Infinity` -> ±∞ (case-sensitive);
/// - radix literals `0x..`/`0o..`/`0b..` (unsigned only) -> their integer value;
/// - otherwise a DECIMAL JS numeric literal (`[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?`),
///   else `NaN`.
///
/// Why not delegate straight to `f64::from_str`: Rust's parser ALSO accepts
/// `inf`, `Inf`, `INF`, `infinity`, `-inf`, `+inf`, `nan`, `NaN`, none of which
/// JS `Number()` accepts (they are all `NaN` in JS). Falling through to
/// `from_str` for those is FAIL-OPEN for a relational guard (Rust would compute
/// `"-inf" <= 50` as `true` where JS computes `false`). So we whitelist exactly
/// the JS-accepted decimal grammar and parse only that.
fn js_string_to_number(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    // JS infinity tokens are case-SENSITIVE and exactly these three.
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    // JS radix literals: 0x/0o/0b, UNSIGNED only (Number("-0x10") is NaN).
    if t.len() > 2 {
        let bytes = t.as_bytes();
        if bytes[0] == b'0' {
            let radix = match bytes[1] {
                b'x' | b'X' => Some(16u32),
                b'o' | b'O' => Some(8u32),
                b'b' | b'B' => Some(2u32),
                _ => None,
            };
            if let Some(r) = radix {
                let digits = &t[2..];
                return match u128::from_str_radix(digits, r) {
                    Ok(v) => v as f64,
                    Err(_) => f64::NAN,
                };
            }
        }
    }
    // Decimal path: accept ONLY the JS decimal numeric grammar, then parse.
    // This excludes Rust's inf/Inf/nan/etc. (none match this whitelist) and
    // Rust-only suffixes — anything not matching is JS `NaN`.
    if is_js_decimal_numeric(t) {
        t.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$` — the JS decimal StringNumericLiteral
/// grammar (excluding Infinity, handled above). Hand-rolled, ASCII-only.
fn is_js_decimal_numeric(t: &str) -> bool {
    let chars: Vec<char> = t.chars().collect();
    let n = chars.len();
    let mut i = 0;
    if i < n && (chars[i] == '+' || chars[i] == '-') {
        i += 1;
    }
    // mantissa: either \d+\.?\d*  or  \.\d+
    let mut saw_digit = false;
    let int_start = i;
    while i < n && chars[i].is_ascii_digit() {
        i += 1;
        saw_digit = true;
    }
    if i < n && chars[i] == '.' {
        i += 1;
        let frac_start = i;
        while i < n && chars[i].is_ascii_digit() {
            i += 1;
            saw_digit = true;
        }
        // a leading-dot form requires fractional digits (".": invalid; ".5": ok)
        if int_start == i.saturating_sub(1) && frac_start == i && !saw_digit {
            return false;
        }
    }
    if !saw_digit {
        return false;
    }
    // optional exponent
    if i < n && (chars[i] == 'e' || chars[i] == 'E') {
        i += 1;
        if i < n && (chars[i] == '+' || chars[i] == '-') {
            i += 1;
        }
        let exp_start = i;
        while i < n && chars[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp_start {
            return false;
        }
    }
    i == n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(pairs: Vec<(&str, Value)>) -> Value {
        Value::Object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    #[test]
    fn get_missing_is_undefined() {
        let v = obj(vec![("a", Value::Number(1.0))]);
        assert!(matches!(v.get("b"), Value::Undefined));
        assert!(matches!(v.get("a"), Value::Number(_)));
    }

    #[test]
    fn get_on_non_object_is_undefined() {
        assert!(matches!(Value::Number(1.0).get("a"), Value::Undefined));
        assert!(matches!(Value::Null.get("a"), Value::Undefined));
    }

    #[test]
    fn resolve_path_deep_missing_is_undefined_not_panic() {
        // E26: a.b.c on {a:{}} => undefined, no TypeError.
        let v = obj(vec![("a", obj(vec![]))]);
        assert!(matches!(v.resolve_path("a.b.c"), Value::Undefined));
    }

    #[test]
    fn resolve_path_present() {
        let v = obj(vec![("flags", obj(vec![("in", Value::Number(1.0))]))]);
        // E17: flags.in resolves to 1.
        assert!(matches!(v.resolve_path("flags.in"), Value::Number(n) if n == 1.0));
    }

    #[test]
    fn to_number_null_is_zero_undefined_is_nan() {
        assert_eq!(Value::Null.to_number(), 0.0);
        assert!(Value::Undefined.to_number().is_nan());
    }

    #[test]
    fn to_number_bool_string() {
        assert_eq!(Value::Bool(true).to_number(), 1.0);
        assert_eq!(Value::Bool(false).to_number(), 0.0);
        assert_eq!(Value::String("  42 ".into()).to_number(), 42.0);
        assert_eq!(Value::String("".into()).to_number(), 0.0);
        assert!(Value::String("foo".into()).to_number().is_nan());
    }

    #[test]
    fn strict_eq_number_nan() {
        assert!(Value::Number(5.0).strict_eq(&Value::Number(5.0)));
        assert!(!Value::Number(f64::NAN).strict_eq(&Value::Number(f64::NAN)));
    }

    #[test]
    fn strict_eq_null_vs_undefined() {
        // E20/E21 footgun: undefined === undefined true; null !== undefined.
        assert!(Value::Undefined.strict_eq(&Value::Undefined));
        assert!(Value::Null.strict_eq(&Value::Null));
        assert!(!Value::Null.strict_eq(&Value::Undefined));
    }

    #[test]
    fn strict_eq_string_vs_number() {
        // E05/E27: no coercion across type tags.
        assert!(!Value::String("5".into()).strict_eq(&Value::Number(5.0)));
    }

    #[test]
    fn strict_eq_bool() {
        assert!(Value::Bool(true).strict_eq(&Value::Bool(true)));
        assert!(!Value::Bool(true).strict_eq(&Value::Bool(false)));
    }

    // ── regression: != fail-open on composite operands ──
    #[test]
    fn ne_composite_operands_fail_closed() {
        // HIGH finding: `x != x` on an array is `false` in JS (same ref). A naive
        // `!strict_eq` returns true (PASS = fail-open). ne_fail_closed -> false.
        let arr = Value::Array(vec![Value::Number(1.0), Value::Number(2.0)]);
        assert!(!arr.ne_fail_closed(&arr));
        let obj = Value::Object(vec![("a".into(), Value::Number(1.0))]);
        assert!(!obj.ne_fail_closed(&obj));
        // Mixed composite-on-one-side also fails closed.
        assert!(!arr.ne_fail_closed(&Value::Number(5.0)));
        assert!(!Value::Number(5.0).ne_fail_closed(&obj));
    }

    #[test]
    fn ne_primitive_operands_match_js() {
        // Primitives keep faithful JS `!==` (== !strict_eq).
        assert!(Value::Number(6.0).ne_fail_closed(&Value::Number(5.0)));
        assert!(!Value::Number(5.0).ne_fail_closed(&Value::Number(5.0)));
        assert!(Value::String("a".into()).ne_fail_closed(&Value::String("b".into())));
        // undefined !== undefined => false (JS).
        assert!(!Value::Undefined.ne_fail_closed(&Value::Undefined));
        // null !== undefined => true (JS, distinct tags).
        assert!(Value::Null.ne_fail_closed(&Value::Undefined));
    }

    // ── regression: array ToPrimitive in ToNumber ──
    #[test]
    fn to_number_array_to_primitive() {
        // JS Number([5]) === 5, Number([]) === 0, Number([1,2]) === NaN.
        assert_eq!(Value::Array(vec![Value::Number(5.0)]).to_number(), 5.0);
        assert_eq!(Value::Array(vec![]).to_number(), 0.0);
        assert!(Value::Array(vec![Value::Number(1.0), Value::Number(2.0)])
            .to_number()
            .is_nan());
        // Number({}) === NaN.
        assert!(Value::Object(vec![]).to_number().is_nan());
    }

    // ── regression: js_string_to_number infinity/nan tokens (Rust f64 leak) ──
    #[test]
    fn string_to_number_rejects_rust_inf_nan_tokens() {
        // JS Number() of all of these is NaN; Rust f64::from_str would parse them.
        for tok in ["inf", "Inf", "INF", "infinity", "-inf", "+inf", "nan", "NaN", "NAN"] {
            assert!(
                js_string_to_number(tok).is_nan(),
                "{tok:?} should coerce to NaN like JS Number()"
            );
        }
        // But the exact JS infinity tokens DO parse.
        assert!(js_string_to_number("Infinity").is_infinite() && js_string_to_number("Infinity") > 0.0);
        assert!(js_string_to_number("+Infinity").is_infinite() && js_string_to_number("+Infinity") > 0.0);
        assert!(js_string_to_number("-Infinity").is_infinite() && js_string_to_number("-Infinity") < 0.0);
    }

    // ── regression: js_string_to_number hex/oct/bin ──
    #[test]
    fn string_to_number_radix_literals() {
        // JS Number("0x10")=16, Number("0o17")=15, Number("0b101")=5.
        assert_eq!(js_string_to_number("0x10"), 16.0);
        assert_eq!(js_string_to_number("0X1F"), 31.0);
        assert_eq!(js_string_to_number("0o17"), 15.0);
        assert_eq!(js_string_to_number("0b101"), 5.0);
        // surrounding whitespace tolerated (trimmed first).
        assert_eq!(js_string_to_number("  0x1F  "), 31.0);
        // signed radix forms are NaN in JS (Number("-0x10") is NaN).
        assert!(js_string_to_number("-0x10").is_nan());
        assert!(js_string_to_number("+0b1").is_nan());
        // decimal path still works.
        assert_eq!(js_string_to_number("42"), 42.0);
        assert_eq!(js_string_to_number("-3.5"), -3.5);
        assert_eq!(js_string_to_number("1e3"), 1000.0);
        assert_eq!(js_string_to_number(".5"), 0.5);
        // non-numeric => NaN.
        assert!(js_string_to_number("foo").is_nan());
        assert!(js_string_to_number("1,2").is_nan());
    }
}
