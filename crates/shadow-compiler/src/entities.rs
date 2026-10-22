//! HTML entity decoding with the semantics of `decodeHTMLStrict` from the `entities` npm package.
//!
//! This is a byte-for-byte port of `decodeHTMLStrict` from `entities` 8.1.0, the function the
//! JavaScript compiler calls to decode entities in JSX text and JSX string attribute values.
//!
//! The rules of "strict" mode, as implemented by the reference:
//!
//! - A reference only decodes when it ends in a semicolon. `&amp` and `&#65` are left alone, and
//!   so are legacy forms such as `&copy` followed by other text.
//! - Named references (`&name;`) use the full HTML5 table (2125 names, some expanding to two code
//!   points). Names are case-sensitive and the whole text between `&` and `;` must be a known
//!   name, so `&notit;` and `&ampfoo;` are left alone.
//! - Numeric references accept decimal (`&#65;`) and hexadecimal (`&#x41;`, `&#X41;`) forms with
//!   any number of leading zeros. At least one digit is required.
//! - Numeric values of zero, surrogates (`0xD800..=0xDFFF`), and anything above `0x10FFFF`
//!   decode to U+FFFD. Values `0x80..=0x9F` are remapped through windows-1252 (the five holes
//!   `0x81`, `0x8D`, `0x8F`, `0x90`, and `0x9D` stay as the control character).
//! - A bare `&`, an unknown `&foo;`, and malformed numeric references are copied through.
//!
//! JavaScript strings are UTF-16 and can hold lone surrogates, but the reference never produces
//! one (surrogate references become U+FFFD), so the output is always valid UTF-8.

use std::borrow::Cow;

// The generated table lives next to this file, not in an `entities/` directory.
#[path = "entities_table.rs"]
mod entities_table;

use entities_table::{ENTITIES, MAX_NAME_LEN, MIN_NAME_LEN};

/// Largest valid code point plus one. Numeric values are clamped to this so they never overflow.
const CODE_POINT_LIMIT: u32 = 0x11_0000;

/// The replacement character, used for NUL, surrogates, and out-of-range numeric references.
const REPLACEMENT: char = '\u{FFFD}';

/// Windows-1252 replacements for the code points `0x80..=0x9F`. Zero means "keep the control".
const C1_REPLACEMENTS: [u16; 32] = [
    0x20AC, 0, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039,
    0x0152, 0, 0x017D, 0, 0, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC,
    0x2122, 0x0161, 0x203A, 0x0153, 0, 0x017E, 0x0178,
];

/// The text a single reference decodes to.
enum Replacement {
    /// A named reference (one or two code points).
    Named(&'static str),
    /// A numeric reference (one code point).
    Numeric(char),
}

/// Decodes HTML entities like `decodeHTMLStrict` of the `entities` package (version 8.1.0).
///
/// Only references terminated by a semicolon are decoded. Input without an `&` is returned
/// borrowed with no allocation; so is input whose `&` characters do not start a valid
/// reference.
///
/// # Examples
///
/// ```
/// use std::borrow::Cow;
/// use shadow_compiler::entities::decode_html_strict;
///
/// assert_eq!(decode_html_strict("a &amp; b &lt;c&gt; &#65;&#x42;"), "a & b <c> AB");
/// // Without a semicolon nothing is decoded in strict mode.
/// assert_eq!(decode_html_strict("&amp &#65"), "&amp &#65");
/// // Invalid code points become U+FFFD; 0x80..=0x9F use windows-1252.
/// assert_eq!(decode_html_strict("&#0;&#xD800;&#128;"), "\u{FFFD}\u{FFFD}\u{20AC}");
/// // No ampersand: no allocation.
/// assert!(matches!(decode_html_strict("plain text"), Cow::Borrowed(_)));
/// ```
pub fn decode_html_strict(input: &str) -> Cow<'_, str> {
    let Some(first) = input.find('&') else {
        return Cow::Borrowed(input);
    };
    let mut result = String::new();
    let mut replaced = false;
    // Start of the not yet copied part of the input.
    let mut chunk_start = 0;
    let mut offset = first;
    loop {
        let entity_start = offset + 1;
        match decode_reference(input.as_bytes(), entity_start) {
            Some((replacement, next)) => {
                if !replaced {
                    replaced = true;
                    result.reserve(input.len());
                }
                result.push_str(input.get(chunk_start..offset).unwrap_or_default());
                match replacement {
                    Replacement::Named(text) => result.push_str(text),
                    Replacement::Numeric(c) => result.push(c),
                }
                chunk_start = next;
                offset = next;
            }
            // Rejected: the `&` stays in the pending chunk and scanning resumes right after it.
            None => offset = entity_start,
        }
        match input.get(offset..).and_then(|rest| rest.find('&')) {
            Some(skip) => offset += skip,
            None => break,
        }
    }
    if !replaced {
        return Cow::Borrowed(input);
    }
    result.push_str(input.get(chunk_start..).unwrap_or_default());
    Cow::Owned(result)
}

/// Decodes the reference whose first byte after the `&` is at `start`.
///
/// Returns the replacement and the index of the first byte after the reference, or `None` when
/// the text is not a valid strict reference.
fn decode_reference(bytes: &[u8], start: usize) -> Option<(Replacement, usize)> {
    match bytes.get(start)? {
        b'#' => decode_numeric(bytes, start + 1),
        b if b.is_ascii_alphabetic() => decode_named(bytes, start),
        _ => None,
    }
}

/// Decodes `name;` starting at `start`, where the name is a key of the entity table.
fn decode_named(bytes: &[u8], start: usize) -> Option<(Replacement, usize)> {
    let mut end = start;
    // Scan one past the longest name so that over-long runs are rejected without a full scan.
    while end - start <= MAX_NAME_LEN && bytes.get(end).is_some_and(u8::is_ascii_alphanumeric) {
        end += 1;
    }
    let len = end - start;
    if !(MIN_NAME_LEN..=MAX_NAME_LEN).contains(&len) || bytes.get(end) != Some(&b';') {
        return None;
    }
    let name = bytes.get(start..end)?;
    let index = ENTITIES
        .binary_search_by(|(candidate, _)| candidate.as_bytes().cmp(name))
        .ok()?;
    let (_, text) = ENTITIES.get(index)?;
    Some((Replacement::Named(text), end + 1))
}

/// Decodes the digits and the closing semicolon of a numeric reference. `start` is the index of
/// the byte after the `#`.
fn decode_numeric(bytes: &[u8], start: usize) -> Option<(Replacement, usize)> {
    let hex = matches!(bytes.get(start), Some(b'x' | b'X'));
    let digits_start = if hex { start + 1 } else { start };
    let radix: u32 = if hex { 16 } else { 10 };
    let mut value: u32 = 0;
    let mut end = digits_start;
    while let Some(digit) = bytes.get(end).and_then(|&b| char::from(b).to_digit(radix)) {
        // Clamping keeps the value in range; once above 0x10FFFF it can only stay above it.
        value = value
            .saturating_mul(radix)
            .saturating_add(digit)
            .min(CODE_POINT_LIMIT);
        end += 1;
    }
    if end == digits_start || bytes.get(end) != Some(&b';') {
        return None;
    }
    Some((Replacement::Numeric(code_point_to_char(value)), end + 1))
}

/// Maps a numeric reference value to the character it decodes to.
fn code_point_to_char(value: u32) -> char {
    let value = match value {
        0 | 0xD800..=0xDFFF | CODE_POINT_LIMIT.. => return REPLACEMENT,
        0x80..=0x9F => {
            let index = usize::try_from(value - 0x80).unwrap_or(0);
            match C1_REPLACEMENTS.get(index) {
                Some(&mapped) if mapped != 0 => u32::from(mapped),
                _ => value,
            }
        }
        _ => value,
    };
    char::from_u32(value).unwrap_or(REPLACEMENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode(input: &str) -> String {
        decode_html_strict(input).into_owned()
    }

    #[test]
    fn no_ampersand_is_borrowed() {
        for input in ["", "plain", "h\u{e9}llo \u{1F600}", "100%;#"] {
            assert!(matches!(decode_html_strict(input), Cow::Borrowed(s) if s == input));
        }
    }

    #[test]
    fn rejected_ampersands_are_borrowed_and_unchanged() {
        for input in ["&", "a & b", "&&&", "&foo;", "&amp", "&#;", "&#65", "AT&T"] {
            assert!(matches!(decode_html_strict(input), Cow::Borrowed(s) if s == input));
        }
    }

    #[test]
    fn decodes_basic_named_entities() {
        assert_eq!(decode("&amp;"), "&");
        assert_eq!(decode("&lt;&gt;&quot;&apos;"), "<>\"'");
        assert_eq!(decode("a&nbsp;b"), "a\u{a0}b");
        assert_eq!(decode("caf&eacute;"), "caf\u{e9}");
        assert_eq!(decode("&amp;amp;"), "&amp;");
        assert_eq!(decode("&AMP;&Amp;"), "&&Amp;");
    }

    #[test]
    fn decodes_multi_code_point_and_astral_entities() {
        assert_eq!(decode("&fjlig;"), "fj");
        assert_eq!(decode("&NotEqualTilde;"), "\u{2242}\u{338}");
        assert_eq!(decode("&Afr;"), "\u{1D504}");
        assert_eq!(decode("&CounterClockwiseContourIntegral;"), "\u{2233}");
    }

    #[test]
    fn strict_mode_leaves_references_without_semicolon_alone() {
        assert_eq!(decode("&amp"), "&amp");
        assert_eq!(decode("&amp b"), "&amp b");
        assert_eq!(decode("&copy 2024"), "&copy 2024");
        assert_eq!(decode("&#65"), "&#65");
        assert_eq!(decode("&#x41"), "&#x41");
        assert_eq!(decode("&#65 ;"), "&#65 ;");
    }

    #[test]
    fn whole_name_must_match() {
        assert_eq!(decode("&notit;"), "&notit;");
        assert_eq!(decode("&ampfoo;"), "&ampfoo;");
        assert_eq!(decode("&ampfoo"), "&ampfoo");
        assert_eq!(decode("&am;"), "&am;");
        assert_eq!(decode("&copy2;"), "&copy2;");
        assert_eq!(decode("&amp;foo"), "&foo");
        assert_eq!(decode("&notin;"), "\u{2209}");
        assert_eq!(decode("&not;it"), "\u{ac}it");
    }

    #[test]
    fn names_are_case_sensitive_and_digits_allowed() {
        assert_eq!(decode("&Aacute;&aacute;"), "\u{c1}\u{e1}");
        assert_eq!(decode("&AACUTE;"), "&AACUTE;");
        assert_eq!(decode("&frac12;&sup1;"), "\u{bd}\u{b9}");
    }

    #[test]
    fn unknown_and_bare_ampersands_are_copied() {
        assert_eq!(decode("&foo; & &; &&amp;"), "&foo; & &; &&");
        assert_eq!(decode("&"), "&");
        assert_eq!(decode("a&"), "a&");
        assert_eq!(decode("&\u{e9};"), "&\u{e9};");
        assert_eq!(decode("&1;"), "&1;");
        assert_eq!(decode("& amp;"), "& amp;");
    }

    #[test]
    fn decodes_decimal_and_hex_numeric_references() {
        assert_eq!(decode("&#65;&#66;"), "AB");
        assert_eq!(decode("&#x41;&#X42;&#x4a;&#x4A;"), "ABJJ");
        assert_eq!(decode("&#0000065;&#x0000041;"), "AA");
        assert_eq!(decode("&#128512;&#x1F600;"), "\u{1F600}\u{1F600}");
        assert_eq!(decode("&#10;"), "\n");
        assert_eq!(decode("&#xA0;&#160;"), "\u{a0}\u{a0}");
    }

    #[test]
    fn malformed_numeric_references_are_kept() {
        for input in [
            "&#;", "&#x;", "&#X;", "&#xZ;", "&#a;", "&# 1;", "&#-1;", "&#x 1;", "&#", "&#x", "&#1",
            "&#65a;", "&#x41g;",
        ] {
            assert_eq!(decode(input), input);
        }
    }

    #[test]
    fn invalid_code_points_become_the_replacement_character() {
        assert_eq!(decode("&#0;"), "\u{FFFD}");
        assert_eq!(decode("&#x0;"), "\u{FFFD}");
        assert_eq!(decode("&#xD800;"), "\u{FFFD}");
        assert_eq!(decode("&#xDBFF;&#xDC00;"), "\u{FFFD}\u{FFFD}");
        assert_eq!(decode("&#57343;"), "\u{FFFD}");
        assert_eq!(decode("&#x110000;"), "\u{FFFD}");
        assert_eq!(decode("&#1114112;"), "\u{FFFD}");
        assert_eq!(decode("&#99999999999999999999999999999;"), "\u{FFFD}");
        assert_eq!(decode("&#xFFFFFFFFFFFFFFFFFFFFFFFF;"), "\u{FFFD}");
        assert_eq!(decode("&#x10FFFF;"), "\u{10FFFF}");
        assert_eq!(decode("&#xE000;"), "\u{E000}");
    }

    #[test]
    fn c1_range_is_remapped_through_windows_1252() {
        assert_eq!(decode("&#128;"), "\u{20AC}");
        assert_eq!(decode("&#x80;"), "\u{20AC}");
        assert_eq!(decode("&#130;"), "\u{201A}");
        assert_eq!(decode("&#x9f;"), "\u{178}");
        assert_eq!(decode("&#159;"), "\u{178}");
        assert_eq!(decode("&#145;&#146;"), "\u{2018}\u{2019}");
        // The holes stay as the C1 control character.
        for hole in [0x81_u32, 0x8D, 0x8F, 0x90, 0x9D] {
            let expected = char::from_u32(hole).map(String::from).unwrap_or_default();
            assert_eq!(decode(&format!("&#{hole};")), expected);
        }
        // Neighbors of the window are untouched.
        assert_eq!(decode("&#127;&#160;"), "\u{7f}\u{a0}");
    }

    #[test]
    fn very_long_numeric_references() {
        let zeros = "0".repeat(5000);
        assert_eq!(decode(&format!("&#{zeros}65;")), "A");
        assert_eq!(decode(&format!("&#x{zeros}41;")), "A");
        assert_eq!(decode(&format!("&#{zeros}65")), format!("&#{zeros}65"));
    }

    #[test]
    fn mixed_text_and_unicode() {
        assert_eq!(
            decode("\u{1F600}&amp;\u{e9}&#x41;&nbsp&lt;\u{4e2d}"),
            "\u{1F600}&\u{e9}A&nbsp<\u{4e2d}"
        );
        assert_eq!(decode("&amp;&amp;&amp;"), "&&&");
        assert_eq!(decode("&&amp;&"), "&&&");
        assert_eq!(decode("x&#38;amp;y"), "x&amp;y");
    }

    #[test]
    fn decoded_output_is_not_decoded_again() {
        assert_eq!(decode("&#38;#65;"), "&#65;");
        assert_eq!(decode("&amp;lt;"), "&lt;");
    }

    #[test]
    fn table_is_sorted_unique_and_well_formed() {
        assert_eq!(ENTITIES.len(), 2125);
        let mut longest = 0;
        let mut shortest = usize::MAX;
        for pair in ENTITIES.windows(2) {
            if let [(a, _), (b, _)] = pair {
                assert!(a.as_bytes() < b.as_bytes(), "{a} must sort before {b}");
            }
        }
        for (name, text) in ENTITIES {
            assert!(name.bytes().all(|b| b.is_ascii_alphanumeric()), "{name}");
            assert!(
                name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic),
                "{name}"
            );
            assert!(!text.is_empty() && text.chars().count() <= 2, "{name}");
            longest = longest.max(name.len());
            shortest = shortest.min(name.len());
        }
        assert_eq!(longest, MAX_NAME_LEN);
        assert_eq!(shortest, MIN_NAME_LEN);
    }

    #[test]
    fn every_table_entry_round_trips() {
        for (name, text) in ENTITIES {
            assert_eq!(decode(&format!("&{name};")), *text, "{name}");
            assert_eq!(decode(&format!("&{name}")), format!("&{name}"), "{name}");
        }
    }

    #[test]
    fn code_point_conversion_boundaries() {
        assert_eq!(code_point_to_char(0), REPLACEMENT);
        assert_eq!(code_point_to_char(1), '\u{1}');
        assert_eq!(code_point_to_char(0x7F), '\u{7f}');
        assert_eq!(code_point_to_char(0xD7FF), '\u{d7ff}');
        assert_eq!(code_point_to_char(0xD800), REPLACEMENT);
        assert_eq!(code_point_to_char(0xDFFF), REPLACEMENT);
        assert_eq!(code_point_to_char(0xE000), '\u{e000}');
        assert_eq!(code_point_to_char(0x10FFFF), '\u{10ffff}');
        assert_eq!(code_point_to_char(0x110000), REPLACEMENT);
        assert_eq!(code_point_to_char(u32::MAX), REPLACEMENT);
    }
}
