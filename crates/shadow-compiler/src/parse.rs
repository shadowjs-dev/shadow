//! Parsing: the parser options and the language rules of the reference compiler.

use oxc_allocator::Allocator;

use crate::error::{Fail, Failure, Result};
use oxc_parser::{ParseOptions, Parser, ParserReturn};
use oxc_span::SourceType;

/// The language a file name selects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    /// TypeScript with JSX (`.tsx`).
    Tsx,
    /// TypeScript (`.ts`, `.mts`, `.cts`).
    Ts,
    /// JavaScript with JSX (everything else, `.jsx` and `.js` included).
    Jsx,
}

/// The language of `filename`, from its extension (case-insensitive).
///
/// # Examples
///
/// ```
/// use shadow_compiler::parse::{language_of, Language};
/// assert_eq!(language_of("a.TSX"), Language::Tsx);
/// assert_eq!(language_of("a.mts"), Language::Ts);
/// assert_eq!(language_of("a.js"), Language::Jsx);
/// ```
#[must_use]
pub fn language_of(filename: &str) -> Language {
    let lower = filename.to_lowercase();
    if lower.ends_with(".tsx") {
        Language::Tsx
    } else if lower.ends_with(".ts") || lower.ends_with(".mts") || lower.ends_with(".cts") {
        Language::Ts
    } else {
        Language::Jsx
    }
}

/// The oxc source type for a language: always a module.
#[must_use]
pub fn source_type_of(language: Language) -> SourceType {
    match language {
        Language::Tsx => SourceType::tsx(),
        Language::Ts => SourceType::ts(),
        Language::Jsx => SourceType::jsx(),
    }
    .with_module(true)
}

/// Parses `source` as `filename` selects: a module, with parentheses preserved. Syntax errors are in
/// the returned diagnostics; the caller turns the first one into the compile error.
#[must_use]
pub fn parse<'a>(allocator: &'a Allocator, source: &'a str, filename: &str) -> ParserReturn<'a> {
    let source_type = source_type_of(language_of(filename));
    let options = ParseOptions {
        enable_ident_hashes: false,
        ..ParseOptions::default()
    };
    Parser::new(allocator, source, source_type)
        .with_options(options)
        .parse()
}

/// Parses a module and turns the first syntax error into the compiler's `PARSE_ERROR`.
///
/// # Errors
/// Fails with `PARSE_ERROR`, positioned at the first label of the parser's first diagnostic.
pub fn parse_module<'a>(
    allocator: &'a Allocator,
    source: &'a str,
    filename: &str,
) -> Result<ParserReturn<'a>> {
    let parsed = parse(allocator, source, filename);
    if let Some(first) = parsed.diagnostics.first() {
        let (start, end) = match first.labels.first() {
            Some(label) => {
                let start = label.offset();
                (start, Some(start + label.len()))
            }
            None => (0, None),
        };
        return Err(Failure::Error(Fail {
            code: "PARSE_ERROR",
            message: first.message.to_string(),
            start,
            end,
        }));
    }
    Ok(parsed)
}
