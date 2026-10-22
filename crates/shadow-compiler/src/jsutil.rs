//! Helpers that reproduce the exact behavior of JavaScript built-ins the reference compiler uses.
//!
//! The reference compiler is TypeScript, so its output text depends on `JSON.stringify`,
//! `Number.prototype.toString`, `String.prototype.trim`, `String.prototype.toLowerCase` and the
//! regular-expression character classes. Each helper here is a port of one of those and is tested
//! against recorded JavaScript output.

use std::fmt::Write as _;

/// Appends `value` as a JavaScript string literal, like `JSON.stringify(value)`.
///
/// Escapes `"` and `\`, the C0 controls (short forms for `\b \f \n \r \t`, `\u00xx` in lower case for
/// the others). U+007F, U+2028 and U+2029 are written as they are, like `JSON.stringify` does.
///
/// # Examples
///
/// ```
/// let mut out = String::new();
/// shadow_compiler::jsutil::push_json_string(&mut out, "a\"b\n");
/// assert_eq!(out, "\"a\\\"b\\n\"");
/// ```
pub fn push_json_string(out: &mut String, value: &str) {
    out.push('"');
    let mut run_start = 0;
    for (index, byte) in value.bytes().enumerate() {
        let escape: Option<&str> = match byte {
            b'"' => Some("\\\""),
            b'\\' => Some("\\\\"),
            0x08 => Some("\\b"),
            0x0c => Some("\\f"),
            b'\n' => Some("\\n"),
            b'\r' => Some("\\r"),
            b'\t' => Some("\\t"),
            0x00..=0x1f => None,
            _ => continue,
        };
        out.push_str(value.get(run_start..index).unwrap_or(""));
        match escape {
            Some(text) => out.push_str(text),
            None => {
                let _ = write!(out, "\\u{byte:04x}");
            }
        }
        run_start = index + 1;
    }
    out.push_str(value.get(run_start..).unwrap_or(""));
    out.push('"');
}

/// Returns `value` as a JavaScript string literal, like `JSON.stringify(value)`.
///
/// # Examples
///
/// ```
/// assert_eq!(shadow_compiler::jsutil::json_string("x\ty"), "\"x\\ty\"");
/// ```
#[must_use]
pub fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    push_json_string(&mut out, value);
    out
}

/// Formats a finite number like `String(value)` in JavaScript (`Number::toString(10)`).
///
/// Integers below 1e21 print without an exponent, other magnitudes use the shortest digits that
/// round-trip, with the ECMAScript rules for where the exponent form starts. `NaN` and the
/// infinities print as `NaN`, `Infinity` and `-Infinity`; both zeros print as `0`.
///
/// # Examples
///
/// ```
/// use shadow_compiler::jsutil::number_to_string;
/// assert_eq!(number_to_string(1.5), "1.5");
/// assert_eq!(number_to_string(1e21), "1e+21");
/// assert_eq!(number_to_string(0.000001), "0.000001");
/// assert_eq!(number_to_string(1e-7), "1e-7");
/// assert_eq!(number_to_string(-0.0), "0");
/// ```
#[must_use]
pub fn number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    let negative = value < 0.0;
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .unwrap_or((scientific.as_str(), "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    // The value is 0.<digits> * 10^n.
    let k = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let n = exponent + 1;
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        let split = usize::try_from(n).unwrap_or(0);
        out.push_str(digits.get(..split).unwrap_or(""));
        out.push('.');
        out.push_str(digits.get(split..).unwrap_or(""));
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        let exp = n - 1;
        out.push_str(digits.get(..1).unwrap_or(""));
        if k > 1 {
            out.push('.');
            out.push_str(digits.get(1..).unwrap_or(""));
        }
        out.push('e');
        out.push(if exp < 0 { '-' } else { '+' });
        let _ = write!(out, "{}", exp.abs());
    }
    out
}

/// True for the characters JavaScript treats as whitespace in `String.prototype.trim` and in the
/// `\s` class: the `WhiteSpace` and `LineTerminator` productions (U+FEFF included, U+0085 excluded).
///
/// # Examples
///
/// ```
/// use shadow_compiler::jsutil::is_js_whitespace;
/// assert!(is_js_whitespace('\u{feff}'));
/// assert!(!is_js_whitespace('\u{85}'));
/// ```
#[must_use]
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// Like `String.prototype.trim`.
///
/// # Examples
///
/// ```
/// assert_eq!(shadow_compiler::jsutil::js_trim("\u{feff} a \u{a0}"), "a");
/// ```
#[must_use]
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

/// Like `String.prototype.trimEnd` for the characters in [`is_js_whitespace`].
#[must_use]
pub fn js_trim_end(value: &str) -> &str {
    value.trim_end_matches(is_js_whitespace)
}

/// Like `String.prototype.toLowerCase`.
///
/// # Examples
///
/// ```
/// assert_eq!(shadow_compiler::jsutil::lower(" DIV"), " div");
/// ```
#[must_use]
pub fn lower(value: &str) -> String {
    value.to_lowercase()
}

/// True when the first character of `name` changes under `toLowerCase`, or is `_` or `$`: the
/// compiler's test for a component tag (`first !== first.toLowerCase() || first === "_" || first === "$"`).
///
/// # Examples
///
/// ```
/// use shadow_compiler::jsutil::first_is_upper_like;
/// assert!(first_is_upper_like("Foo"));
/// assert!(first_is_upper_like("_x"));
/// assert!(!first_is_upper_like("div"));
/// ```
#[must_use]
pub fn first_is_upper_like(name: &str) -> bool {
    match name.chars().next() {
        None => false,
        Some(first) => {
            if first == '_' || first == '$' {
                return true;
            }
            // `charAt(0)` is one UTF-16 unit: half of an astral character lowercases to itself.
            if first.len_utf16() != 1 {
                return false;
            }
            let mut lowered = first.to_lowercase();
            lowered.next() != Some(first) || lowered.next().is_some()
        }
    }
}

/// True for an ASCII identifier of the form `[A-Za-z_$][A-Za-z0-9_$]*`.
///
/// # Examples
///
/// ```
/// use shadow_compiler::jsutil::is_ascii_identifier;
/// assert!(is_ascii_identifier("$a1"));
/// assert!(!is_ascii_identifier("1a"));
/// assert!(!is_ascii_identifier("a-b"));
/// ```
#[must_use]
pub fn is_ascii_identifier(name: &str) -> bool {
    let mut bytes = name.bytes();
    match bytes.next() {
        Some(b) if b.is_ascii_alphabetic() || b == b'_' || b == b'$' => {}
        _ => return false,
    }
    bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$')
}

/// Number of UTF-16 code units in `value`, like `String.prototype.length`.
#[must_use]
pub fn utf16_len(value: &str) -> usize {
    if value.is_ascii() {
        value.len()
    } else {
        value.chars().map(char::len_utf16).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_strings() {
        assert_eq!(json_string(""), "\"\"");
        assert_eq!(json_string("a\u{1}b"), "\"a\\u0001b\"");
        assert_eq!(json_string("\u{7f}\u{2028}"), "\"\u{7f}\u{2028}\"");
        assert_eq!(json_string("é😀"), "\"é😀\"");
        assert_eq!(json_string("\u{1f}"), "\"\\u001f\"");
    }

    #[test]
    fn numbers() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (100.0, "100"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (123_456_789_012_345_680_000.0, "123456789012345680000"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1e-6, "0.000001"),
            (1.5e-7, "1.5e-7"),
            (1e-7, "1e-7"),
            (5e-324, "5e-324"),
            (f64::MAX, "1.7976931348623157e+308"),
            (4.35, "4.35"),
            (123.456, "123.456"),
            (0.000_123, "0.000123"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
        ];
        for (value, expected) in cases {
            assert_eq!(number_to_string(*value), *expected, "{value:?}");
        }
    }

    #[test]
    fn whitespace_and_case() {
        assert_eq!(js_trim("\u{85}x\u{85}"), "\u{85}x\u{85}");
        assert_eq!(js_trim("\u{3000}\u{feff}x\u{2029}"), "x");
        assert!(first_is_upper_like("Éa"));
        assert!(!first_is_upper_like("éa"));
        assert!(!first_is_upper_like("日本"));
        assert!(!first_is_upper_like("\u{10400}x"));
        assert_eq!(utf16_len("a😀"), 3);
    }
}
