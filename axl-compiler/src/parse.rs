//! Source text -> [`AgentSpec`]. A faithful port of `parseBind` (bind.mjs) and
//! `parseAgent` (compile.mjs), replicating the EXACT JS regex behaviour with
//! std-only hand parsing (no regex crate). The quirks are intentional and
//! tested:
//!
//! - body is the slice between the FIRST `{` and the LAST `}` — so two agent
//!   blocks in one document share a body (predicate bleed-through, P17/P18).
//! - the `bind` list is captured up to the FIRST `]` (`[^\]]*`).
//! - capabilities = split on `,`, trim, drop empties (P02–P06).
//! - `constrain` target capture is `\w+` only — stops at a dot (P10).
//! - predicates: per LINE, `prove\s*->\s*(.+)`, then `.trim()`, strip a single
//!   trailing `}` via `/\}\s*$/`, then `.trim()` again (P11–P16).
//! - `\w` is ASCII `[A-Za-z0-9_]`; non-ASCII names fail to parse (P21–P24).

use crate::error::CompileError;

/// One parsed agent block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSpec {
    pub name: String,
    pub capabilities: Vec<String>,
    pub schema: Option<String>,
    pub predicates: Vec<String>,
    /// Optional `invariant -> ...` safety-bound directive. `None` when the agent
    /// block declares no invariant. Parsing is fail-closed: a malformed or
    /// unsupported `invariant` line is an [`CompileError`], never a silent drop.
    pub invariant: Option<InvariantDecl>,
}

/// The aggregate ceiling knob of a sliding-window policy.
///
/// - [`Ceiling::Multiplier`]`(M)`: the policy caps window outflow against
///   `M * window_cap` (the deployed agent_wallet uses `M = 2`).
/// - [`Ceiling::None`]: per-tx cap only, NO aggregate window cap. This family is
///   UNBOUNDED — the prover REFUSES it (fail-closed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ceiling {
    /// Aggregate ceiling multiplier `M >= 1`.
    Multiplier(u64),
    /// No aggregate cap (per-tx only). Provably unbounded => REFUSED.
    None,
}

/// A parsed `invariant -> sliding_window(ceiling = <M|none>) bound <K>` directive.
///
/// `ceiling` is the policy's aggregate knob; `bound` is the CLAIMED safety bound
/// `K` (window outflow `<= K * window_cap`). The prover discharges whether `K`
/// is sound and tight via SMT-LIB + z3, reproducing the canonical Python model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvariantDecl {
    /// Policy family token (currently only `sliding_window` is supported).
    pub family: String,
    /// The aggregate ceiling multiplier, or `none` for per-tx-only.
    pub ceiling: Ceiling,
    /// The claimed bound `K`.
    pub bound: u64,
}

/// Result of parsing a single `bind <Agent> -> [...]` line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindDecl {
    pub agent: String,
    pub capabilities: Vec<String>,
}

/// JS `\w` == ASCII `[A-Za-z0-9_]`.
fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// JS regex `\s`. This is NOT ASCII-only and NOT `char::is_whitespace` (which
/// excludes U+FEFF and includes U+0085 NEL, neither of which JS `\s` matches).
/// The exact JS `\s` set: ASCII WS (space, tab, LF, VT, FF, CR) plus the Unicode
/// `WhiteSpace`/`LineTerminator` codepoints and the BOM. Hand-listed so the
/// structural parse and operand `.trim()` (Unicode-aware) agree on what
/// whitespace is. See [`crate::predicate`] for the mirrored copy.
fn is_ws(c: char) -> bool {
    matches!(
        c,
        '\u{0009}' // tab
        | '\u{000A}' // LF
        | '\u{000B}' // VT
        | '\u{000C}' // FF
        | '\u{000D}' // CR
        | '\u{0020}' // space
        | '\u{00A0}' // NBSP
        | '\u{1680}' // ogham space mark
        | '\u{2000}'..='\u{200A}' // en quad .. hair space
        | '\u{2028}' // line separator
        | '\u{2029}' // paragraph separator
        | '\u{202F}' // narrow NBSP
        | '\u{205F}' // medium mathematical space
        | '\u{3000}' // ideographic space
        | '\u{FEFF}' // BOM / zero-width no-break space
    )
}

/// Port of `parseBind`:
/// `/^\s*bind\s+(\w+)\s*->\s*\[([^\]]*)\]\s*$/`.
///
/// Anchored at both ends. On no match: [`CompileError::MalformedBind`].
pub fn parse_bind(line: &str) -> Result<BindDecl, CompileError> {
    let err = || CompileError::MalformedBind(line.to_string());
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0usize;
    let n = chars.len();

    // ^\s*
    while i < n && is_ws(chars[i]) {
        i += 1;
    }
    // bind
    if !starts_with_at(&chars, i, "bind") {
        return Err(err());
    }
    i += 4;
    // \s+  (at least one)
    let ws_start = i;
    while i < n && is_ws(chars[i]) {
        i += 1;
    }
    if i == ws_start {
        return Err(err());
    }
    // (\w+)  agent name
    let name_start = i;
    while i < n && is_word_char(chars[i]) {
        i += 1;
    }
    if i == name_start {
        return Err(err());
    }
    let agent: String = chars[name_start..i].iter().collect();
    // \s*
    while i < n && is_ws(chars[i]) {
        i += 1;
    }
    // ->
    if !starts_with_at(&chars, i, "->") {
        return Err(err());
    }
    i += 2;
    // \s*
    while i < n && is_ws(chars[i]) {
        i += 1;
    }
    // \[
    if i >= n || chars[i] != '[' {
        return Err(err());
    }
    i += 1;
    // ([^\]]*)  up to first ]
    let inner_start = i;
    while i < n && chars[i] != ']' {
        i += 1;
    }
    if i >= n {
        // no closing ] => no match
        return Err(err());
    }
    let inner: String = chars[inner_start..i].iter().collect();
    // \]
    i += 1;
    // \s*$
    while i < n && is_ws(chars[i]) {
        i += 1;
    }
    if i != n {
        return Err(err());
    }

    Ok(BindDecl {
        agent,
        capabilities: split_caps(&inner),
    })
}

/// Port of `parseAgent`.
///
/// 1. name via FIRST `/agent\s+(\w+)\s*\{/` match; no match => MalformedAgent.
/// 2. body = slice from first `{`+1 to last `}` (exclusive).
/// 3. capabilities via FIRST `/bind\s*->\s*\[([^\]]*)\]/` in body (else []).
/// 4. schema via FIRST `/constrain\s*->\s*(\w+)/` in body (Option).
/// 5. predicates: per body line, `/prove\s*->\s*(.+)/`, trim+strip trailing }+trim.
/// 6. invariant via FIRST `/invariant\s*->\s*(.+)/` in body (Option). A present
///    but malformed/unsupported directive is a [`CompileError`] (fail-closed).
pub fn parse_agent(text: &str) -> Result<AgentSpec, CompileError> {
    let chars: Vec<char> = text.chars().collect();

    // ── name: first /agent\s+(\w+)\s*\{/ ──
    let name = match find_agent_name(&chars) {
        Some(n) => n,
        None => return Err(CompileError::MalformedAgent),
    };

    // ── body: first '{' .. last '}' ──
    // Mirrors text.slice(indexOf('{')+1, lastIndexOf('}')).
    let first_brace = chars.iter().position(|&c| c == '{');
    let last_brace = chars.iter().rposition(|&c| c == '}');
    let body: String = match (first_brace, last_brace) {
        // JS slice clamps a negative/reversed range to empty rather than erroring.
        (Some(fb), Some(lb)) if lb > fb => chars[(fb + 1)..lb].iter().collect(),
        _ => String::new(),
    };

    // ── capabilities: first bind list in body ──
    let capabilities = match find_bind_inner(&body) {
        Some(inner) => split_caps(&inner),
        None => Vec::new(),
    };

    // ── schema: first constrain -> \w+ ──
    let schema = find_constrain_name(&body);

    // ── predicates: per line ──
    let mut predicates = Vec::new();
    for line in body.split('\n') {
        if let Some(rest) = match_prove(line) {
            // .trim().replace(/\}\s*$/,"").trim()
            let trimmed = rest.trim();
            let stripped = strip_trailing_brace(trimmed);
            predicates.push(stripped.trim().to_string());
        }
    }

    // ── invariant: first `invariant -> ...` directive (fail-closed) ──
    let invariant = match find_invariant_src(&body) {
        Some(src) => Some(parse_invariant(&src)?),
        None => None,
    };

    Ok(AgentSpec {
        name,
        capabilities,
        schema,
        predicates,
        invariant,
    })
}

/// Find the first `/invariant\s*->\s*(.+)/` directive body in `body`, returning
/// the captured remainder (the `(.+)` after the arrow). The capture stops at the
/// first JS line terminator AND at a trailing `}` (so the agent-block close brace
/// is not swallowed), then is trimmed. Returns `None` if no `invariant` keyword
/// is present (the directive is optional).
fn find_invariant_src(body: &str) -> Option<String> {
    let chars: Vec<char> = body.chars().collect();
    let n = chars.len();
    let mut start = 0usize;
    while start < n {
        if !starts_with_at(&chars, start, "invariant") {
            start += 1;
            continue;
        }
        let mut i = start + 9;
        // \s*
        while i < n && is_ws(chars[i]) {
            i += 1;
        }
        // ->
        if !starts_with_at(&chars, i, "->") {
            start += 1;
            continue;
        }
        i += 2;
        // (.+) up to first newline or JS line terminator.
        let cap_start = i;
        let mut cap_end = cap_start;
        while cap_end < n
            && chars[cap_end] != '\n'
            && !is_js_line_terminator(chars[cap_end])
        {
            cap_end += 1;
        }
        if cap_end == cap_start {
            start += 1;
            continue;
        }
        let rest: String = chars[cap_start..cap_end].iter().collect();
        // Strip a single trailing `}` (block close on the same line), then trim.
        let stripped = strip_trailing_brace(rest.trim());
        return Some(stripped.trim().to_string());
    }
    None
}

/// Parse the captured invariant remainder into an [`InvariantDecl`].
///
/// Grammar (after the `invariant ->` arrow):
///   `<family> ( ceiling = <M|none> ) bound <K>`
/// where `<family>` is a word token (only `sliding_window` is supported by the
/// prover — an unknown family is rejected at *compile/prove* time, not here, so
/// the AST faithfully records what was written), `<M>` is a non-negative integer
/// multiplier or the literal `none`, and `<K>` is a non-negative integer.
///
/// Fail-closed: any structural deviation => [`CompileError::MalformedInvariant`].
pub fn parse_invariant(src: &str) -> Result<InvariantDecl, CompileError> {
    let err = || CompileError::MalformedInvariant(src.to_string());
    let chars: Vec<char> = src.chars().collect();
    let n = chars.len();
    let mut i = 0usize;

    let skip_ws = |i: &mut usize| {
        while *i < n && is_ws(chars[*i]) {
            *i += 1;
        }
    };

    // \s*
    skip_ws(&mut i);
    // family: (\w+)
    let fam_start = i;
    while i < n && is_word_char(chars[i]) {
        i += 1;
    }
    if i == fam_start {
        return Err(err());
    }
    let family: String = chars[fam_start..i].iter().collect();

    skip_ws(&mut i);
    // (
    if i >= n || chars[i] != '(' {
        return Err(err());
    }
    i += 1;
    skip_ws(&mut i);
    // literal `ceiling`
    if !starts_with_at(&chars, i, "ceiling") {
        return Err(err());
    }
    i += 7;
    skip_ws(&mut i);
    // =
    if i >= n || chars[i] != '=' {
        return Err(err());
    }
    i += 1;
    skip_ws(&mut i);
    // <M|none>
    let val_start = i;
    while i < n && is_word_char(chars[i]) {
        i += 1;
    }
    if i == val_start {
        return Err(err());
    }
    let val_tok: String = chars[val_start..i].iter().collect();
    let ceiling = if val_tok == "none" {
        Ceiling::None
    } else {
        match val_tok.parse::<u64>() {
            Ok(m) => Ceiling::Multiplier(m),
            Err(_) => return Err(err()),
        }
    };

    skip_ws(&mut i);
    // )
    if i >= n || chars[i] != ')' {
        return Err(err());
    }
    i += 1;
    skip_ws(&mut i);
    // literal `bound`
    if !starts_with_at(&chars, i, "bound") {
        return Err(err());
    }
    i += 5;
    // \s+ (at least one separator before the integer)
    let ws0 = i;
    skip_ws(&mut i);
    if i == ws0 {
        return Err(err());
    }
    // <K>
    let k_start = i;
    while i < n && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i == k_start {
        return Err(err());
    }
    let bound: u64 = match chars[k_start..i].iter().collect::<String>().parse() {
        Ok(k) => k,
        Err(_) => return Err(err()),
    };

    // trailing \s* then end-of-input
    skip_ws(&mut i);
    if i != n {
        return Err(err());
    }

    Ok(InvariantDecl {
        family,
        ceiling,
        bound,
    })
}

/// Split a bind-inner string into capabilities: `split(',').map(trim).filter(non-empty)`.
pub fn split_caps(inner: &str) -> Vec<String> {
    inner
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn starts_with_at(chars: &[char], at: usize, lit: &str) -> bool {
    for (i, want) in (at..).zip(lit.chars()) {
        if chars.get(i) != Some(&want) {
            return false;
        }
    }
    true
}

/// Find the first `/agent\s+(\w+)\s*\{/` and return the captured name.
fn find_agent_name(chars: &[char]) -> Option<String> {
    let n = chars.len();
    let mut start = 0usize;
    while start < n {
        // try to match "agent" at `start`
        if !starts_with_at(chars, start, "agent") {
            start += 1;
            continue;
        }
        let mut i = start + 5;
        // \s+
        let ws_start = i;
        while i < n && is_ws(chars[i]) {
            i += 1;
        }
        if i == ws_start {
            start += 1;
            continue;
        }
        // (\w+)
        let name_start = i;
        while i < n && is_word_char(chars[i]) {
            i += 1;
        }
        if i == name_start {
            start += 1;
            continue;
        }
        let name: String = chars[name_start..i].iter().collect();
        // \s*
        while i < n && is_ws(chars[i]) {
            i += 1;
        }
        // \{
        if i < n && chars[i] == '{' {
            return Some(name);
        }
        // No '{' after the name => this 'agent' occurrence fails; keep scanning.
        start += 1;
    }
    None
}

/// Find the first `/bind\s*->\s*\[([^\]]*)\]/` in `body`, returning the inner
/// (pre-`]`) capture. The closing `]` is required for a match.
fn find_bind_inner(body: &str) -> Option<String> {
    let chars: Vec<char> = body.chars().collect();
    let n = chars.len();
    let mut start = 0usize;
    while start < n {
        if !starts_with_at(&chars, start, "bind") {
            start += 1;
            continue;
        }
        let mut i = start + 4;
        // \s*
        while i < n && is_ws(chars[i]) {
            i += 1;
        }
        // ->
        if !starts_with_at(&chars, i, "->") {
            start += 1;
            continue;
        }
        i += 2;
        // \s*
        while i < n && is_ws(chars[i]) {
            i += 1;
        }
        // \[
        if i >= n || chars[i] != '[' {
            start += 1;
            continue;
        }
        i += 1;
        // ([^\]]*)
        let inner_start = i;
        while i < n && chars[i] != ']' {
            i += 1;
        }
        if i >= n {
            // no closing ] anywhere after => this 'bind' fails to match; the
            // regex engine would also fail since [^\]]* cannot consume ] and
            // \] then has nothing. Keep scanning for another 'bind'.
            start += 1;
            continue;
        }
        let inner: String = chars[inner_start..i].iter().collect();
        return Some(inner);
    }
    None
}

/// Find the first `/constrain\s*->\s*(\w+)/` in `body`, returning the captured
/// `\w+` name (stops at first non-word char, e.g. a dot — P10).
fn find_constrain_name(body: &str) -> Option<String> {
    let chars: Vec<char> = body.chars().collect();
    let n = chars.len();
    let mut start = 0usize;
    while start < n {
        if !starts_with_at(&chars, start, "constrain") {
            start += 1;
            continue;
        }
        let mut i = start + 9;
        // \s*
        while i < n && is_ws(chars[i]) {
            i += 1;
        }
        // ->
        if !starts_with_at(&chars, i, "->") {
            start += 1;
            continue;
        }
        i += 2;
        // \s*
        while i < n && is_ws(chars[i]) {
            i += 1;
        }
        // (\w+)
        let name_start = i;
        while i < n && is_word_char(chars[i]) {
            i += 1;
        }
        if i == name_start {
            // zero word chars => no capture; keep scanning.
            start += 1;
            continue;
        }
        let name: String = chars[name_start..i].iter().collect();
        return Some(name);
    }
    None
}

/// Match `/prove\s*->\s*(.+)/` against a single line. Returns the `(.+)` capture.
///
/// Two JS-regex subtleties are load-bearing here and were previously wrong:
///
/// 1. `\s*(.+)` BACKTRACKS. The trailing `\s*` is greedy but `(.+)` then requires
///    at least one char, so on a whitespace-only tail the `\s*` gives back its last
///    char to `.+`. JS therefore captures " " (which `parse_agent`'s `.trim()`
///    reduces to ""), and `compileAgent` rejects the empty predicate with
///    `malformed predicate:`. A naive greedy `\s*` that eats the whole tail would
///    DROP the predicate silently (fail-closed regression). So: the capture is
///    non-empty iff there is a char (ws OR non-ws) after the literal `->`; the
///    `\s*` may give back its final char. We implement this by skipping NO
///    whitespace before `(.+)` and letting the surrounding `.trim()` collapse it.
///
/// 2. JS `.` (no `s` flag) does NOT match line terminators LF, CR, U+2028, U+2029.
///    `parse_agent` already splits on `\n`, so LF cannot appear; but a bare CR /
///    U+2028 / U+2029 mid-line must TRUNCATE the capture (JS `(.+)` stops there).
///    Capturing across them diverges the predicate string and can flip enforce().
///
/// The search for `prove` is unanchored (can share a line with `bind`, P13).
fn match_prove(line: &str) -> Option<String> {
    let chars: Vec<char> = line.chars().collect();
    let n = chars.len();
    let mut start = 0usize;
    while start < n {
        if !starts_with_at(&chars, start, "prove") {
            start += 1;
            continue;
        }
        let mut i = start + 5;
        // \s*
        while i < n && is_ws(chars[i]) {
            i += 1;
        }
        // ->
        if !starts_with_at(&chars, i, "->") {
            start += 1;
            continue;
        }
        i += 2;
        // `\s*(.+)`: do NOT pre-consume the trailing `\s*` here. The capture
        // start is the first char after `->`. JS backtracking hands the last
        // `\s*` char to `.+` when the tail is whitespace-only, so any non-empty
        // remainder (including a lone whitespace char) is a match.
        let cap_start = i;
        // `(.+)` stops at the first JS line terminator (CR / U+2028 / U+2029).
        let mut cap_end = cap_start;
        while cap_end < n && !is_js_line_terminator(chars[cap_end]) {
            cap_end += 1;
        }
        if cap_end == cap_start {
            // `(.+)` needs >=1 char; nothing here. Keep scanning for another
            // `prove` occurrence on this line.
            start += 1;
            continue;
        }
        let rest: String = chars[cap_start..cap_end].iter().collect();
        return Some(rest);
    }
    None
}

/// JS line terminators that regex `.` (without the `s` flag) excludes. `\n` is
/// never present in a `match_prove` input (the body is split on `\n`), so the
/// relevant ones for `(.+)` truncation are CR and the Unicode separators.
fn is_js_line_terminator(c: char) -> bool {
    matches!(c, '\u{000A}' | '\u{000D}' | '\u{2028}' | '\u{2029}')
}

/// Replicate JS `.replace(/\}\s*$/, "")`: remove a SINGLE trailing `}` followed
/// by trailing whitespace, anchored at end-of-string.
///
/// Operates on the already-`trim()`ed string. If the string ends with optional
/// trailing whitespace preceded by a `}`, drop the `}` and that whitespace.
/// (After a trim there is no trailing whitespace, so this reduces to: if it
/// ends with `}`, drop it. But we honor the general form for fidelity.)
pub fn strip_trailing_brace(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut end = chars.len();
    // \s*$  — consume trailing whitespace
    while end > 0 && is_ws(chars[end - 1]) {
        end -= 1;
    }
    // \}  — require a brace immediately before the trailing whitespace
    if end > 0 && chars[end - 1] == '}' {
        // Drop the brace and everything the \s*$ matched (the trailing ws too).
        let kept: String = chars[..(end - 1)].iter().collect();
        kept
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(spec: &AgentSpec) -> Vec<&str> {
        spec.capabilities.iter().map(|s| s.as_str()).collect()
    }

    // ── parse_bind ──
    #[test]
    fn parse_bind_basic() {
        let b = parse_bind("bind Settlement -> [read_balance, propose_payment]").unwrap();
        assert_eq!(b.agent, "Settlement");
        assert_eq!(b.capabilities, vec!["read_balance", "propose_payment"]);
    }

    #[test]
    fn parse_bind_malformed() {
        assert_eq!(
            parse_bind("bind Settlement -> read_balance"),
            Err(CompileError::MalformedBind(
                "bind Settlement -> read_balance".into()
            ))
        );
        assert!(parse_bind("notbind X -> [a]").is_err());
        assert!(parse_bind("bind -> [a]").is_err()); // missing name
    }

    #[test]
    fn parse_bind_empty_and_trailing_comma() {
        assert_eq!(parse_bind("bind X -> []").unwrap().capabilities, Vec::<String>::new());
        assert_eq!(parse_bind("bind X -> [a,]").unwrap().capabilities, vec!["a"]);
        assert_eq!(parse_bind("bind X -> [a,,b]").unwrap().capabilities, vec!["a", "b"]);
    }

    // ── parse_agent quirks ──
    #[test]
    fn p01_full_settlement() {
        let src = "agent Settlement {\n  bind -> [read_balance, propose_settlement]\n  constrain -> SettlementDecision\n  prove -> decision.amount <= account.balance\n}";
        let spec = parse_agent(src).unwrap();
        assert_eq!(spec.name, "Settlement");
        assert_eq!(caps(&spec), vec!["read_balance", "propose_settlement"]);
        assert_eq!(spec.schema.as_deref(), Some("SettlementDecision"));
        assert_eq!(spec.predicates, vec!["decision.amount <= account.balance"]);
    }

    #[test]
    fn p02_empty_bind() {
        let spec = parse_agent("agent E { bind -> [] }").unwrap();
        assert!(spec.capabilities.is_empty());
        assert_eq!(spec.schema, None);
        assert!(spec.predicates.is_empty());
    }

    #[test]
    fn p03_whitespace_only_bind() {
        let spec = parse_agent("agent E { bind -> [   ] }").unwrap();
        assert!(spec.capabilities.is_empty());
    }

    #[test]
    fn p04_trailing_comma() {
        assert_eq!(caps(&parse_agent("agent E { bind -> [a,] }").unwrap()), vec!["a"]);
    }

    #[test]
    fn p05_double_comma() {
        assert_eq!(caps(&parse_agent("agent E { bind -> [a,,b] }").unwrap()), vec!["a", "b"]);
    }

    #[test]
    fn p06_trim_entries() {
        assert_eq!(
            caps(&parse_agent("agent E { bind -> [ read_balance ,  propose ] }").unwrap()),
            vec!["read_balance", "propose"]
        );
    }

    #[test]
    fn p07_no_bind_block() {
        let spec = parse_agent("agent E { constrain -> S }").unwrap();
        assert!(spec.capabilities.is_empty());
        assert_eq!(spec.schema.as_deref(), Some("S"));
    }

    #[test]
    fn p08_no_constrain() {
        assert_eq!(parse_agent("agent E { bind -> [a] }").unwrap().schema, None);
    }

    #[test]
    fn p09_constrain_single_line() {
        assert_eq!(
            parse_agent("agent E { bind -> [a] constrain -> MySchema }").unwrap().schema.as_deref(),
            Some("MySchema")
        );
    }

    #[test]
    fn p10_constrain_stops_at_dot() {
        // \w+ stops at the dot.
        assert_eq!(
            parse_agent("agent E { constrain -> My.Schema }").unwrap().schema.as_deref(),
            Some("My")
        );
    }

    #[test]
    fn p11_trailing_brace_strip() {
        assert_eq!(
            parse_agent("agent E {\n prove -> x < 1 }").unwrap().predicates,
            vec!["x < 1"]
        );
    }

    #[test]
    fn p12_trailing_brace_and_space() {
        assert_eq!(
            parse_agent("agent E {\n prove -> x < 1 } \n").unwrap().predicates,
            vec!["x < 1"]
        );
    }

    #[test]
    fn p13_prove_shares_line_with_bind() {
        assert_eq!(
            parse_agent("agent E { bind -> [a] prove -> x < 1 }").unwrap().predicates,
            vec!["x < 1"]
        );
    }

    #[test]
    fn p14_multi_predicate_order() {
        assert_eq!(
            parse_agent("agent E {\n prove -> a < 1\n prove -> b > 2\n}").unwrap().predicates,
            vec!["a < 1", "b > 2"]
        );
    }

    #[test]
    fn p15_brace_in_quotes_preserved() {
        // closing quote follows the brace, so /\}\s*$/ does NOT match.
        assert_eq!(
            parse_agent("agent E {\n prove -> a == \"}\" \n}").unwrap().predicates,
            vec!["a == \"}\""]
        );
    }

    #[test]
    fn p16_no_comment_syntax() {
        assert_eq!(
            parse_agent("agent E {\n prove -> a < 1 // note\n}").unwrap().predicates,
            vec!["a < 1 // note"]
        );
    }

    #[test]
    fn p17_first_name_body_spans_both() {
        let spec = parse_agent("agent First { bind -> [a] }\nagent Second { bind -> [b] }").unwrap();
        assert_eq!(spec.name, "First");
        // body spans both blocks; first bind => caps=['a'].
        assert_eq!(caps(&spec), vec!["a"]);
    }

    #[test]
    fn p18_predicate_bleed_through() {
        let spec = parse_agent(
            "agent First {\n bind -> [a]\n prove -> x < 1\n}\nagent Second {\n prove -> y < 2\n}",
        )
        .unwrap();
        assert_eq!(spec.predicates, vec!["x < 1", "y < 2"]);
    }

    #[test]
    fn p19_foo_bar_throws() {
        assert_eq!(parse_agent("foo Bar { }"), Err(CompileError::MalformedAgent));
    }

    #[test]
    fn p20_missing_brace_throws() {
        assert_eq!(parse_agent("agent Bar"), Err(CompileError::MalformedAgent));
    }

    #[test]
    fn p21_underscore_name() {
        assert_eq!(parse_agent("agent my_agent { bind -> [a] }").unwrap().name, "my_agent");
    }

    #[test]
    fn p22_leading_digit_name() {
        assert_eq!(parse_agent("agent 1Drop { bind -> [a] }").unwrap().name, "1Drop");
    }

    #[test]
    fn p23_non_ascii_name_throws() {
        // \w is ASCII; 'Café' matches 'Caf' then 'é{' fails \s*\{.
        assert_eq!(
            parse_agent("agent Café { bind -> [read_balance] }"),
            Err(CompileError::MalformedAgent)
        );
    }

    #[test]
    fn p24_injection_name_throws() {
        assert_eq!(
            parse_agent("agent <script> { bind -> [read_balance] }"),
            Err(CompileError::MalformedAgent)
        );
    }

    #[test]
    fn strip_trailing_brace_cases() {
        assert_eq!(strip_trailing_brace("x < 1 }"), "x < 1 ");
        assert_eq!(strip_trailing_brace("x < 1"), "x < 1");
        assert_eq!(strip_trailing_brace("a == \"}\""), "a == \"}\"");
    }

    // ── regression: prove -> <whitespace-only> kept as "" (MEDIUM) ──
    #[test]
    fn prove_whitespace_only_tail_kept_as_empty() {
        // JS `\s*(.+)` backtracks: captures " " -> trim -> "". Rust must NOT drop
        // the predicate silently. parse_agent yields [""]; compile_agent then
        // errors `malformed predicate:` (fail-closed), matching JS exactly.
        let spec = parse_agent("agent X {\n prove -> \n}").unwrap();
        assert_eq!(spec.predicates, vec![""]);
        // single-line forms diverge the same way.
        assert_eq!(
            parse_agent("agent X { bind -> [read_balance] prove -> }").unwrap().predicates,
            vec![""]
        );
        // Boundary: `prove ->` with NOTHING after the arrow -> no predicate.
        assert!(parse_agent("agent X { prove ->}").unwrap().predicates.is_empty());
    }

    #[test]
    fn empty_predicate_compiles_to_malformed() {
        use crate::compile::{compile_agent, Registries};
        use crate::json;
        let spec = parse_agent("agent X {\n prove -> \n}").unwrap();
        let tools = json::parse("{}").unwrap();
        let schemas = json::parse("{}").unwrap();
        let reg = Registries { tools: &tools, schemas: &schemas };
        let err = compile_agent(&spec, &reg).unwrap_err();
        assert_eq!(err.to_string(), "malformed predicate: ");
    }

    // ── regression: predicate capture stops at JS line terminators (HIGH) ──
    #[test]
    fn prove_capture_stops_at_line_terminators() {
        // JS `.` (no s flag) excludes CR / U+2028 / U+2029. A tautology then the
        // terminator then the real guard: JS captures only the tautology.
        let cr = "agent S {\n prove -> 1 <= 2\rdecision.amount <= account.balance\n}";
        assert_eq!(parse_agent(cr).unwrap().predicates, vec!["1 <= 2"]);
        let ls = "agent S {\n prove -> 1 <= 2\u{2028}decision.amount <= account.balance\n}";
        assert_eq!(parse_agent(ls).unwrap().predicates, vec!["1 <= 2"]);
        let ps = "agent S {\n prove -> 1 <= 2\u{2029}decision.amount <= account.balance\n}";
        assert_eq!(parse_agent(ps).unwrap().predicates, vec!["1 <= 2"]);
        // Trailing-text form.
        assert_eq!(
            parse_agent("agent E {\n prove -> a < 1\rTRAILING\n}").unwrap().predicates,
            vec!["a < 1"]
        );
    }

    // ── regression: is_ws matches the full JS \s set (MEDIUM) ──
    #[test]
    fn unicode_whitespace_accepted_like_js() {
        // NBSP (U+00A0) as the keyword separator: JS \s matches it, so the parse
        // must succeed (it previously errored as malformed).
        assert_eq!(
            parse_agent("agent\u{a0}Settlement { bind -> [read_balance] }").unwrap().name,
            "Settlement"
        );
        assert_eq!(
            parse_bind("bind\u{a0}Settlement -> [read_balance]").unwrap().agent,
            "Settlement"
        );
        // A sweep of representative JS-\s codepoints in a separator position.
        for ws in ['\u{a0}', '\u{1680}', '\u{2000}', '\u{2009}', '\u{202f}', '\u{205f}', '\u{3000}', '\u{feff}'] {
            let src = format!("agent{ws}E {{ bind -> [read_balance] }}");
            assert_eq!(
                parse_agent(&src).unwrap().name,
                "E",
                "JS \\s codepoint U+{:04X} should parse as whitespace",
                ws as u32
            );
        }
    }

    // ── invariant directive parsing ──
    #[test]
    fn invariant_sliding_window_m2_k2() {
        let spec = parse_agent(
            "agent W {\n bind -> [propose_payment]\n invariant -> sliding_window(ceiling = 2) bound 2\n}",
        )
        .unwrap();
        assert_eq!(
            spec.invariant,
            Some(InvariantDecl {
                family: "sliding_window".into(),
                ceiling: Ceiling::Multiplier(2),
                bound: 2,
            })
        );
    }

    #[test]
    fn invariant_ceiling_none_parses() {
        let spec = parse_agent("agent W { invariant -> sliding_window(ceiling = none) bound 2 }").unwrap();
        assert_eq!(
            spec.invariant,
            Some(InvariantDecl {
                family: "sliding_window".into(),
                ceiling: Ceiling::None,
                bound: 2,
            })
        );
    }

    #[test]
    fn invariant_absent_is_none() {
        let spec = parse_agent("agent W { bind -> [propose_payment] }").unwrap();
        assert_eq!(spec.invariant, None);
    }

    #[test]
    fn invariant_loose_whitespace_and_trailing_brace() {
        // tolerate generous whitespace; strip the block-closing brace on the line.
        let spec =
            parse_agent("agent W {\n invariant ->   sliding_window( ceiling=3 )   bound   2  }\n")
                .unwrap();
        assert_eq!(
            spec.invariant,
            Some(InvariantDecl {
                family: "sliding_window".into(),
                ceiling: Ceiling::Multiplier(3),
                bound: 2,
            })
        );
    }

    #[test]
    fn invariant_unknown_family_still_parses_into_ast() {
        // The parser records the family verbatim; rejection of an unsupported
        // family happens at lowering/prove time (fail-closed there).
        let spec = parse_agent("agent W { invariant -> token_bucket(ceiling = 2) bound 2 }").unwrap();
        assert_eq!(spec.invariant.as_ref().unwrap().family, "token_bucket");
    }

    #[test]
    fn invariant_malformed_forms_fail_closed() {
        // missing bound clause
        assert!(matches!(
            parse_agent("agent W { invariant -> sliding_window(ceiling = 2) }"),
            Err(CompileError::MalformedInvariant(_))
        ));
        // missing ceiling keyword
        assert!(matches!(
            parse_agent("agent W { invariant -> sliding_window(2) bound 2 }"),
            Err(CompileError::MalformedInvariant(_))
        ));
        // missing parens
        assert!(matches!(
            parse_agent("agent W { invariant -> sliding_window ceiling = 2 bound 2 }"),
            Err(CompileError::MalformedInvariant(_))
        ));
        // non-integer bound
        assert!(matches!(
            parse_agent("agent W { invariant -> sliding_window(ceiling = 2) bound two }"),
            Err(CompileError::MalformedInvariant(_))
        ));
        // non-integer, non-none ceiling
        assert!(matches!(
            parse_agent("agent W { invariant -> sliding_window(ceiling = lots) bound 2 }"),
            Err(CompileError::MalformedInvariant(_))
        ));
        // garbage after the arrow
        assert!(matches!(
            parse_agent("agent W { invariant -> wat }"),
            Err(CompileError::MalformedInvariant(_))
        ));
        // trailing junk
        assert!(matches!(
            parse_agent("agent W { invariant -> sliding_window(ceiling = 2) bound 2 extra }"),
            Err(CompileError::MalformedInvariant(_))
        ));
    }

    #[test]
    fn invariant_direct_parser_entrypoint() {
        assert_eq!(
            parse_invariant("sliding_window(ceiling = 1) bound 1").unwrap(),
            InvariantDecl { family: "sliding_window".into(), ceiling: Ceiling::Multiplier(1), bound: 1 }
        );
        assert_eq!(
            parse_invariant("").unwrap_err(),
            CompileError::MalformedInvariant("".into())
        );
    }

    // ── regression: constrain arrow + NBSP keeps the schema (MEDIUM) ──
    #[test]
    fn constrain_arrow_unicode_ws_keeps_schema() {
        // NBSP after the arrow: JS `\s*` consumes it and resolves the schema.
        // Previously Rust returned None (silently dropped the output schema).
        assert_eq!(
            parse_agent("agent E { constrain ->\u{a0}Schema }").unwrap().schema.as_deref(),
            Some("Schema")
        );
    }
}
