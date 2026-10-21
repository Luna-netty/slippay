//! Hand-rolled, std-only JSON parser + serializer. No serde, no third-party
//! crates.
//!
//! The parser produces [`crate::value::Value`], mapping JSON `null` to
//! [`Value::Null`] (NEVER `Undefined` — `Undefined` is unproducible from text,
//! it only arises from path misses at eval time). The serializer is used by the
//! CLI to emit the contract / request config / enforce results as JSON.
//!
//! Recursive-descent over a char vector. It NEVER panics AND never aborts:
//! every fallible step returns `Result<_, JsonError>`, and array/object nesting
//! is bounded by [`MAX_DEPTH`] — input deeper than that returns
//! [`JsonError::TooDeep`] instead of overflowing the native stack (a SIGABRT
//! that `catch_unwind` cannot trap). Numbers are parsed into `f64` (JS's single
//! numeric type), matching the runtime value model.

use crate::value::Value;
use std::fmt;

/// The maximum array/object nesting depth the parser (and serializer) will
/// descend before returning [`JsonError::TooDeep`]. Far above any legitimate Axl
/// registry / ctx (a few levels), far below the native-stack overflow point
/// (~22k frames on an 8 MiB main-thread stack), so the guard converts an
/// unrecoverable SIGABRT into a recoverable `Result`.
pub const MAX_DEPTH: usize = 256;

/// Errors the JSON parser can report. All recoverable; no panics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonError {
    UnexpectedEof,
    UnexpectedChar { pos: usize, found: char },
    InvalidNumber { pos: usize },
    InvalidEscape { pos: usize },
    TrailingData { pos: usize },
    /// Nesting exceeded [`MAX_DEPTH`]. Returned INSTEAD of overflowing the native
    /// stack (which would abort the process — `catch_unwind` cannot trap it).
    TooDeep { pos: usize, max: usize },
}

impl fmt::Display for JsonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JsonError::UnexpectedEof => write!(f, "unexpected end of JSON input"),
            JsonError::UnexpectedChar { pos, found } => {
                write!(f, "unexpected character {found:?} at position {pos}")
            }
            JsonError::InvalidNumber { pos } => write!(f, "invalid number at position {pos}"),
            JsonError::InvalidEscape { pos } => write!(f, "invalid string escape at position {pos}"),
            JsonError::TrailingData { pos } => write!(f, "trailing data after JSON value at position {pos}"),
            JsonError::TooDeep { pos, max } => {
                write!(f, "JSON nesting too deep (>{max}) at position {pos}")
            }
        }
    }
}

impl std::error::Error for JsonError {}

/// Parse a complete JSON document into a [`Value`]. Trailing non-whitespace is
/// an error ([`JsonError::TrailingData`]).
pub fn parse(s: &str) -> Result<Value, JsonError> {
    let chars: Vec<char> = s.chars().collect();
    let mut p = Parser { chars: &chars, pos: 0, depth: 0 };
    p.skip_ws();
    let v = p.parse_value()?;
    p.skip_ws();
    if p.pos != p.chars.len() {
        return Err(JsonError::TrailingData { pos: p.pos });
    }
    Ok(v)
}

/// Serialize a [`Value`] to compact JSON. `Undefined` is serialized as `null`
/// (JSON has no undefined); it should not appear in serialized output paths in
/// practice, but this keeps the function total.
pub fn to_string(v: &Value) -> String {
    let mut out = String::new();
    write_value(v, &mut out, None, 0);
    out
}

/// Serialize a [`Value`] to pretty (2-space indented) JSON.
pub fn to_string_pretty(v: &Value) -> String {
    let mut out = String::new();
    write_value(v, &mut out, Some(2), 0);
    out
}

struct Parser<'a> {
    chars: &'a [char],
    pos: usize,
    /// Current array/object nesting depth. Incremented on entry to
    /// `parse_array`/`parse_object`, decremented on exit. Guards the native
    /// recursion against a stack-overflow abort on adversarial nesting.
    depth: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.chars.get(self.pos).copied();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn parse_value(&mut self) -> Result<Value, JsonError> {
        self.skip_ws();
        match self.peek() {
            None => Err(JsonError::UnexpectedEof),
            Some('{') => self.parse_object(),
            Some('[') => self.parse_array(),
            Some('"') => self.parse_string().map(Value::String),
            Some('t') | Some('f') => self.parse_bool(),
            Some('n') => self.parse_null(),
            Some(c) if c == '-' || c.is_ascii_digit() => self.parse_number(),
            Some(c) => Err(JsonError::UnexpectedChar { pos: self.pos, found: c }),
        }
    }

    fn parse_object(&mut self) -> Result<Value, JsonError> {
        // Depth guard BEFORE recursing into values. Returns a recoverable error
        // instead of overflowing the native stack on adversarial nesting.
        if self.depth >= MAX_DEPTH {
            return Err(JsonError::TooDeep { pos: self.pos, max: MAX_DEPTH });
        }
        self.depth += 1;
        let r = self.parse_object_inner();
        self.depth -= 1;
        r
    }

    fn parse_object_inner(&mut self) -> Result<Value, JsonError> {
        // consume '{'
        self.bump();
        let mut entries: Vec<(String, Value)> = Vec::new();
        self.skip_ws();
        if self.peek() == Some('}') {
            self.bump();
            return Ok(Value::Object(entries));
        }
        loop {
            self.skip_ws();
            match self.peek() {
                Some('"') => {}
                None => return Err(JsonError::UnexpectedEof),
                Some(c) => return Err(JsonError::UnexpectedChar { pos: self.pos, found: c }),
            }
            let key = self.parse_string()?;
            self.skip_ws();
            match self.bump() {
                Some(':') => {}
                None => return Err(JsonError::UnexpectedEof),
                Some(c) => return Err(JsonError::UnexpectedChar { pos: self.pos - 1, found: c }),
            }
            let val = self.parse_value()?;
            entries.push((key, val));
            self.skip_ws();
            match self.bump() {
                Some(',') => continue,
                Some('}') => return Ok(Value::Object(entries)),
                None => return Err(JsonError::UnexpectedEof),
                Some(c) => return Err(JsonError::UnexpectedChar { pos: self.pos - 1, found: c }),
            }
        }
    }

    fn parse_array(&mut self) -> Result<Value, JsonError> {
        // Depth guard BEFORE recursing into elements (see parse_object).
        if self.depth >= MAX_DEPTH {
            return Err(JsonError::TooDeep { pos: self.pos, max: MAX_DEPTH });
        }
        self.depth += 1;
        let r = self.parse_array_inner();
        self.depth -= 1;
        r
    }

    fn parse_array_inner(&mut self) -> Result<Value, JsonError> {
        // consume '['
        self.bump();
        let mut items: Vec<Value> = Vec::new();
        self.skip_ws();
        if self.peek() == Some(']') {
            self.bump();
            return Ok(Value::Array(items));
        }
        loop {
            let val = self.parse_value()?;
            items.push(val);
            self.skip_ws();
            match self.bump() {
                Some(',') => continue,
                Some(']') => return Ok(Value::Array(items)),
                None => return Err(JsonError::UnexpectedEof),
                Some(c) => return Err(JsonError::UnexpectedChar { pos: self.pos - 1, found: c }),
            }
        }
    }

    fn parse_string(&mut self) -> Result<String, JsonError> {
        // consume opening quote
        self.bump();
        let mut s = String::new();
        loop {
            match self.bump() {
                None => return Err(JsonError::UnexpectedEof),
                Some('"') => return Ok(s),
                Some('\\') => {
                    let esc_pos = self.pos - 1;
                    match self.bump() {
                        Some('"') => s.push('"'),
                        Some('\\') => s.push('\\'),
                        Some('/') => s.push('/'),
                        Some('b') => s.push('\u{0008}'),
                        Some('f') => s.push('\u{000C}'),
                        Some('n') => s.push('\n'),
                        Some('r') => s.push('\r'),
                        Some('t') => s.push('\t'),
                        Some('u') => {
                            let cp = self.parse_hex4(esc_pos)?;
                            // Handle surrogate pairs.
                            if (0xD800..=0xDBFF).contains(&cp) {
                                // high surrogate; expect a following \uXXXX low surrogate
                                if self.bump() != Some('\\') || self.bump() != Some('u') {
                                    return Err(JsonError::InvalidEscape { pos: esc_pos });
                                }
                                let lo = self.parse_hex4(esc_pos)?;
                                if !(0xDC00..=0xDFFF).contains(&lo) {
                                    return Err(JsonError::InvalidEscape { pos: esc_pos });
                                }
                                let c = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                                match char::from_u32(c) {
                                    Some(ch) => s.push(ch),
                                    None => return Err(JsonError::InvalidEscape { pos: esc_pos }),
                                }
                            } else if (0xDC00..=0xDFFF).contains(&cp) {
                                // lone low surrogate
                                return Err(JsonError::InvalidEscape { pos: esc_pos });
                            } else {
                                match char::from_u32(cp) {
                                    Some(ch) => s.push(ch),
                                    None => return Err(JsonError::InvalidEscape { pos: esc_pos }),
                                }
                            }
                        }
                        _ => return Err(JsonError::InvalidEscape { pos: esc_pos }),
                    }
                }
                Some(c) => s.push(c),
            }
        }
    }

    fn parse_hex4(&mut self, esc_pos: usize) -> Result<u32, JsonError> {
        let mut val: u32 = 0;
        for _ in 0..4 {
            match self.bump() {
                Some(c) => match c.to_digit(16) {
                    Some(d) => val = val * 16 + d,
                    None => return Err(JsonError::InvalidEscape { pos: esc_pos }),
                },
                None => return Err(JsonError::UnexpectedEof),
            }
        }
        Ok(val)
    }

    fn parse_bool(&mut self) -> Result<Value, JsonError> {
        if self.match_literal("true") {
            Ok(Value::Bool(true))
        } else if self.match_literal("false") {
            Ok(Value::Bool(false))
        } else {
            Err(JsonError::UnexpectedChar {
                pos: self.pos,
                found: self.peek().unwrap_or(' '),
            })
        }
    }

    fn parse_null(&mut self) -> Result<Value, JsonError> {
        if self.match_literal("null") {
            // JSON null maps to Value::Null, NOT Undefined.
            Ok(Value::Null)
        } else {
            Err(JsonError::UnexpectedChar {
                pos: self.pos,
                found: self.peek().unwrap_or(' '),
            })
        }
    }

    fn match_literal(&mut self, lit: &str) -> bool {
        let start = self.pos;
        for want in lit.chars() {
            if self.peek() == Some(want) {
                self.pos += 1;
            } else {
                self.pos = start;
                return false;
            }
        }
        true
    }

    fn parse_number(&mut self) -> Result<Value, JsonError> {
        let start = self.pos;
        // optional minus
        if self.peek() == Some('-') {
            self.bump();
        }
        // int part
        match self.peek() {
            Some('0') => {
                self.bump();
            }
            Some(c) if c.is_ascii_digit() => {
                while matches!(self.peek(), Some(d) if d.is_ascii_digit()) {
                    self.bump();
                }
            }
            _ => return Err(JsonError::InvalidNumber { pos: start }),
        }
        // frac
        if self.peek() == Some('.') {
            self.bump();
            if !matches!(self.peek(), Some(d) if d.is_ascii_digit()) {
                return Err(JsonError::InvalidNumber { pos: start });
            }
            while matches!(self.peek(), Some(d) if d.is_ascii_digit()) {
                self.bump();
            }
        }
        // exp
        if matches!(self.peek(), Some('e') | Some('E')) {
            self.bump();
            if matches!(self.peek(), Some('+') | Some('-')) {
                self.bump();
            }
            if !matches!(self.peek(), Some(d) if d.is_ascii_digit()) {
                return Err(JsonError::InvalidNumber { pos: start });
            }
            while matches!(self.peek(), Some(d) if d.is_ascii_digit()) {
                self.bump();
            }
        }
        let slice: String = self.chars[start..self.pos].iter().collect();
        match slice.parse::<f64>() {
            Ok(n) => Ok(Value::Number(n)),
            Err(_) => Err(JsonError::InvalidNumber { pos: start }),
        }
    }
}

// ── serializer ───────────────────────────────────────────────────────────────

fn write_value(v: &Value, out: &mut String, indent: Option<usize>, depth: usize) {
    // Symmetry with the parser's depth guard: a Value nested beyond MAX_DEPTH
    // (which the std-only parser can no longer produce, but which a caller could
    // construct by hand) would otherwise overflow the native stack here. Cap it
    // to `null` rather than abort. `to_string` is infallible by signature, so we
    // cannot return an error — truncation is the conservative total behaviour.
    if depth > MAX_DEPTH {
        out.push_str("null");
        return;
    }
    match v {
        Value::Null | Value::Undefined => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&format_number(*n)),
        Value::String(s) => write_json_string(s, out),
        Value::Array(items) => write_array(items, out, indent, depth),
        Value::Object(entries) => write_object(entries, out, indent, depth),
    }
}

fn write_array(items: &[Value], out: &mut String, indent: Option<usize>, depth: usize) {
    if items.is_empty() {
        out.push_str("[]");
        return;
    }
    out.push('[');
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        newline_indent(out, indent, depth + 1);
        write_value(item, out, indent, depth + 1);
    }
    newline_indent(out, indent, depth);
    out.push(']');
}

fn write_object(entries: &[(String, Value)], out: &mut String, indent: Option<usize>, depth: usize) {
    if entries.is_empty() {
        out.push_str("{}");
        return;
    }
    out.push('{');
    for (i, (k, val)) in entries.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        newline_indent(out, indent, depth + 1);
        write_json_string(k, out);
        out.push(':');
        if indent.is_some() {
            out.push(' ');
        }
        write_value(val, out, indent, depth + 1);
    }
    newline_indent(out, indent, depth);
    out.push('}');
}

fn newline_indent(out: &mut String, indent: Option<usize>, depth: usize) {
    if let Some(step) = indent {
        out.push('\n');
        for _ in 0..(step * depth) {
            out.push(' ');
        }
    }
}

/// Format an `f64` JSON-style: integral values without a trailing `.0`,
/// non-finite values as `null` (JSON cannot represent NaN/Infinity).
fn format_number(n: f64) -> String {
    if !n.is_finite() {
        return "null".to_string();
    }
    if n == n.trunc() && n.abs() < 1e15 {
        // Integral: print without decimal point. -0.0 normalizes to 0.
        let i = n as i64;
        return i.to_string();
    }
    // Rust's default f64 Display gives a shortest round-trippable form.
    let s = format!("{n}");
    s
}

fn write_json_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_null_is_value_null_not_undefined() {
        assert!(matches!(parse("null"), Ok(Value::Null)));
    }

    #[test]
    fn parse_primitives() {
        assert!(matches!(parse("true"), Ok(Value::Bool(true))));
        assert!(matches!(parse("false"), Ok(Value::Bool(false))));
        assert!(matches!(parse("42"), Ok(Value::Number(n)) if n == 42.0));
        assert!(matches!(parse("-3.5"), Ok(Value::Number(n)) if n == -3.5));
        assert!(matches!(parse("1e3"), Ok(Value::Number(n)) if n == 1000.0));
    }

    #[test]
    fn parse_string_with_escapes() {
        match parse(r#""a\n\"b\\""#) {
            Ok(Value::String(s)) => assert_eq!(s, "a\n\"b\\"),
            other => panic!("expected string, got {other:?}"),
        }
    }

    #[test]
    fn parse_unicode_escape() {
        match parse(r#""Aé""#) {
            Ok(Value::String(s)) => assert_eq!(s, "Aé"),
            other => panic!("expected string, got {other:?}"),
        }
    }

    #[test]
    fn parse_surrogate_pair() {
        // U+1F600 grinning face
        match parse(r#""😀""#) {
            Ok(Value::String(s)) => assert_eq!(s, "\u{1F600}"),
            other => panic!("expected string, got {other:?}"),
        }
    }

    #[test]
    fn parse_object_and_array() {
        let v = parse(r#"{"a":[1,2,{"b":null}],"c":true}"#).expect("parse ok");
        match v {
            Value::Object(entries) => {
                assert_eq!(entries.len(), 2);
                assert_eq!(entries[0].0, "a");
            }
            other => panic!("expected object, got {other:?}"),
        }
    }

    #[test]
    fn parse_rejects_trailing_data() {
        assert_eq!(parse("1 2"), Err(JsonError::TrailingData { pos: 2 }));
    }

    #[test]
    fn parse_rejects_unclosed() {
        assert!(matches!(parse("{"), Err(JsonError::UnexpectedEof)));
        assert!(matches!(parse("["), Err(JsonError::UnexpectedEof)));
        assert!(matches!(parse(r#""abc"#), Err(JsonError::UnexpectedEof)));
    }

    #[test]
    fn parse_empty_is_eof() {
        assert_eq!(parse(""), Err(JsonError::UnexpectedEof));
        assert_eq!(parse("   "), Err(JsonError::UnexpectedEof));
    }

    #[test]
    fn roundtrip_compact() {
        let v = parse(r#"{"a":1,"b":[true,false,null],"c":"x"}"#).unwrap();
        let s = to_string(&v);
        assert_eq!(s, r#"{"a":1,"b":[true,false,null],"c":"x"}"#);
    }

    #[test]
    fn serialize_integral_no_dot() {
        assert_eq!(to_string(&Value::Number(5.0)), "5");
        assert_eq!(to_string(&Value::Number(-3.0)), "-3");
        assert_eq!(to_string(&Value::Number(2.5)), "2.5");
    }

    #[test]
    fn pretty_has_newlines() {
        let v = parse(r#"{"a":1}"#).unwrap();
        let s = to_string_pretty(&v);
        assert!(s.contains('\n'));
        assert!(s.contains("  \"a\": 1"));
    }

    #[test]
    fn serialize_string_escapes() {
        assert_eq!(to_string(&Value::String("a\"b\n".into())), r#""a\"b\n""#);
    }

    // ── regression: deep nesting returns TooDeep, never aborts (HIGH) ──
    #[test]
    fn deep_nesting_returns_too_deep_not_abort() {
        // 100k nested arrays would overflow the native stack (SIGABRT) without
        // the depth guard. With it, a recoverable Err is returned.
        let deep_arrays = "[".repeat(100_000);
        match parse(&deep_arrays) {
            Err(JsonError::TooDeep { max, .. }) => assert_eq!(max, MAX_DEPTH),
            other => panic!("expected TooDeep, got {other:?}"),
        }
        // Nested objects trigger identically.
        let deep_objects = "{\"a\":".repeat(100_000);
        match parse(&deep_objects) {
            Err(JsonError::TooDeep { max, .. }) => assert_eq!(max, MAX_DEPTH),
            other => panic!("expected TooDeep for objects, got {other:?}"),
        }
    }

    #[test]
    fn depth_at_limit_parses_above_limit_rejected() {
        // MAX_DEPTH nested arrays parse OK; MAX_DEPTH+1 is rejected.
        let ok = format!("{}1{}", "[".repeat(MAX_DEPTH), "]".repeat(MAX_DEPTH));
        assert!(parse(&ok).is_ok(), "depth == MAX_DEPTH must parse");
        let too = format!(
            "{}1{}",
            "[".repeat(MAX_DEPTH + 1),
            "]".repeat(MAX_DEPTH + 1)
        );
        assert!(
            matches!(parse(&too), Err(JsonError::TooDeep { .. })),
            "depth == MAX_DEPTH+1 must be TooDeep"
        );
    }
}
