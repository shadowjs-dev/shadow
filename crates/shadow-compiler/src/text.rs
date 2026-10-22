//! Text helpers for JSX: whitespace rules, HTML escaping and property keys.

use crate::entities::decode_html_strict;
use crate::jsutil::{is_ascii_identifier, json_string};

/// Applies the JSX whitespace rules to raw JSX text (after decoding entities): lines are trimmed
/// at the places a newline was, empty lines vanish, remaining lines join with one space.
///
/// # Examples
///
/// ```
/// use shadow_compiler::text::clean_jsx_text;
/// assert_eq!(clean_jsx_text("  hello\n   world  \n"), "  hello world");
/// assert_eq!(clean_jsx_text("a &amp; b"), "a & b");
/// ```
#[must_use]
pub fn clean_jsx_text(raw: &str) -> String {
    let decoded = decode_html_strict(raw);
    let lines = split_lines(&decoded);
    let mut last_non_empty = 0;
    for (index, line) in lines.iter().enumerate() {
        if line.chars().any(|c| c != ' ' && c != '\t') {
            last_non_empty = index;
        }
    }
    let last = lines.len().saturating_sub(1);
    let mut out = String::with_capacity(decoded.len());
    for (index, line) in lines.iter().enumerate() {
        let mut text: String = if line.contains('\t') {
            line.replace('\t', " ")
        } else {
            (*line).to_string()
        };
        if index != 0 {
            text = text.trim_start_matches(' ').to_string();
        }
        if index != last {
            text = text.trim_end_matches(' ').to_string();
        }
        if !text.is_empty() {
            out.push_str(&text);
            if index != last_non_empty {
                out.push(' ');
            }
        }
    }
    out
}

/// Splits like `text.split(/\r\n|\n|\r/)`.
fn split_lines(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut lines = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while let Some(&byte) = bytes.get(index) {
        if byte == b'\n' {
            lines.push(text.get(start..index).unwrap_or(""));
            index += 1;
            start = index;
        } else if byte == b'\r' {
            lines.push(text.get(start..index).unwrap_or(""));
            index += if bytes.get(index + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
            start = index;
        } else {
            index += 1;
        }
    }
    lines.push(text.get(start..).unwrap_or(""));
    lines
}

/// Escapes text for an HTML template string (`&`, `<`, `>`).
///
/// # Examples
///
/// ```
/// assert_eq!(shadow_compiler::text::escape_html_text("a<b>&"), "a&lt;b&gt;&amp;");
/// ```
#[must_use]
pub fn escape_html_text(value: &str) -> String {
    if !value.bytes().any(|b| matches!(b, b'&' | b'<' | b'>')) {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len() + 8);
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(c),
        }
    }
    out
}

/// Escapes a value for a double-quoted HTML attribute (`&` and `"`).
///
/// # Examples
///
/// ```
/// assert_eq!(shadow_compiler::text::escape_html_attribute("a\"&"), "a&quot;&amp;");
/// ```
#[must_use]
pub fn escape_html_attribute(value: &str) -> String {
    if !value.bytes().any(|b| matches!(b, b'&' | b'"')) {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len() + 8);
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

/// Property key for an object literal: a bare identifier when possible, else a JSON string.
///
/// # Examples
///
/// ```
/// use shadow_compiler::text::property_key;
/// assert_eq!(property_key("class"), "class");
/// assert_eq!(property_key("data-x"), "\"data-x\"");
/// ```
#[must_use]
pub fn property_key(name: &str) -> String {
    if is_ascii_identifier(name) {
        name.to_string()
    } else {
        json_string(name)
    }
}
