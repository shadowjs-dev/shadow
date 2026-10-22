#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! The `useStore` pass and the derived-constant pass rewrite the module before the JSX is compiled.
//! Every position the compiler reports, in an error or in the source map, is a position of the module
//! as it was written.

use shadow_compiler::compile::{CompileFailure, Options, Target, compile};

const BAD: &str = "<p><div/></p>";
const STORE_IMPORT: &str = "import { useStore } from \"@shadow-js/core\";";

fn lines(parts: &[&str]) -> String {
    let mut text = parts.join("\n");
    text.push('\n');
    text
}

fn cell_source() -> String {
    lines(&[
        STORE_IMPORT,
        "const [n] = useStore(0);",
        "export const keep = n;",
        &format!("export const view = {BAD};"),
    ])
}

fn derive_source() -> String {
    lines(&[
        "import { useSignal } from \"@shadow-js/core\";",
        "export function C() {",
        "  const [n] = useSignal(0);",
        &format!("  const label = n() > 1 ? [\"\u{1F600}\", {BAD}] : null;"),
        "  return <section>{label}</section>;",
        "}",
    ])
}

fn props_source() -> String {
    lines(&[
        &format!("export function C({{ icon = <b>x</b>, note = {BAD} }}) {{"),
        "  return <section>{icon}{note}</section>;",
        "}",
    ])
}

fn map_source() -> String {
    lines(&[
        "\"use client\";",
        STORE_IMPORT,
        "export function C({ title = \"t\" }) {",
        "  const [n] = useStore(0);",
        "  const double = n() * 2;",
        "  return <section class={title}>{double}</section>;",
        "}",
        "export const after = <p>{1 + 1}</p>;",
    ])
}

/// 1-based line and 0-based column (UTF-16 units) of a UTF-16 offset.
fn place(text: &str, offset16: usize) -> (usize, usize) {
    let mut line = 1;
    let mut line_start = 0;
    let mut units = 0;
    for c in text.chars() {
        if units >= offset16 {
            break;
        }
        units += c.len_utf16();
        if c == '\n' {
            line += 1;
            line_start = units;
        }
    }
    (line, offset16 - line_start)
}

fn utf16_index_of(text: &str, needle: &str) -> usize {
    let byte = text.find(needle).expect("the needle is in the text");
    text[..byte].encode_utf16().count()
}

fn failure(source: &str, target: Target) -> shadow_compiler::diagnostics::CompileError {
    let options = Options {
        filename: Some("view.tsx".to_string()),
        generate: target,
        ..Options::default()
    };
    match compile(source, &options) {
        Err(CompileFailure::Error(error)) => *error,
        other => panic!("expected a CompileError, got {other:?}"),
    }
}

fn expect_error_at_bad(source: &str, target: Target) {
    let error = failure(source, target);
    let start = utf16_index_of(source, BAD);
    let (line, column) = place(source, start);
    let d = &error.diagnostic;
    assert_eq!(d.code, "INVALID_HTML_NESTING");
    assert_eq!(
        (d.start, d.end, d.line, d.column),
        (start, start + BAD.len(), line, column)
    );
    let text = source.split('\n').nth(line - 1).unwrap();
    assert_eq!(
        error.frame,
        format!("{line:>4} | {text}\n     | {}^", " ".repeat(column))
    );
    assert_eq!(
        error.message(),
        format!(
            "view.tsx:{line}:{column} INVALID_HTML_NESTING: {}\n{}",
            d.message, error.frame
        )
    );
}

#[test]
fn an_error_after_the_use_store_rewrite_points_into_the_source() {
    expect_error_at_bad(&cell_source(), Target::Dom);
    expect_error_at_bad(&cell_source(), Target::Ssr);
    assert_eq!(failure(&cell_source(), Target::Dom).diagnostic.line, 4);
}

#[test]
fn an_error_inside_a_derived_constant_points_at_the_written_expression() {
    expect_error_at_bad(&derive_source(), Target::Dom);
    expect_error_at_bad(&derive_source(), Target::Ssr);
    assert!(
        !failure(&derive_source(), Target::Dom)
            .frame
            .contains("_$derived")
    );
}

#[test]
fn an_error_in_a_default_value_that_moved_into_the_body_points_at_the_parameter() {
    expect_error_at_bad(&props_source(), Target::Dom);
    assert_eq!(failure(&props_source(), Target::Dom).diagnostic.line, 1);
}

#[test]
fn a_syntax_error_is_reported_where_it_always_was() {
    let source = lines(&[STORE_IMPORT, "const [n] = useStore(0);", "const v = <div>;"]);
    let error = failure(&source, Target::Dom);
    assert_eq!(error.diagnostic.code, "PARSE_ERROR");
    assert_eq!(error.diagnostic.line, 3);
}

/// Decodes the VLQ `mappings` into lines of `(generated column, source line, source column)`.
fn decode(mappings: &str) -> Vec<Vec<(i64, i64, i64)>> {
    const ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let (mut line, mut column) = (0i64, 0i64);
    let mut out = Vec::new();
    for generated_line in mappings.split(';') {
        let mut generated_column = 0i64;
        let mut segments = Vec::new();
        for segment in generated_line.split(',').filter(|s| !s.is_empty()) {
            let mut values = Vec::new();
            let (mut value, mut shift) = (0i64, 0u32);
            for c in segment.chars() {
                let digit = i64::try_from(ALPHABET.find(c).unwrap()).unwrap();
                value += (digit & 31) << shift;
                if digit & 32 == 0 {
                    values.push(if value & 1 == 1 {
                        -(value >> 1)
                    } else {
                        value >> 1
                    });
                    value = 0;
                    shift = 0;
                } else {
                    shift += 5;
                }
            }
            generated_column += values[0];
            line += values[2];
            column += values[3];
            segments.push((generated_column, line, column));
        }
        out.push(segments);
    }
    out
}

/// The 1-based line and 0-based column of the module that the first `needle` of the generated code
/// comes from.
fn origin_of(source: &str, needle: &str) -> (i64, i64) {
    let options = Options {
        filename: Some("view.tsx".to_string()),
        ..Options::default()
    };
    let output = compile(source, &options).unwrap_or_else(|_| panic!("the module compiles"));
    let map = output.map.expect("a source map");
    let (generated_line, generated_column) =
        place(&output.code, utf16_index_of(&output.code, needle));
    let segments = decode(&map.mappings);
    let row = &segments[generated_line - 1];
    let (_, line, column) = row
        .iter()
        .rev()
        .find(|segment| segment.0 <= i64::try_from(generated_column).unwrap())
        .expect("a segment at or before the column");
    (line + 1, *column)
}

#[test]
fn the_source_map_keeps_the_lines_of_the_module_through_both_rewrites() {
    let source = map_source();
    let options = Options::default();
    let output = compile(&source, &options).unwrap_or_else(|_| panic!("the module compiles"));
    assert!(output.code.contains("useShadowSignal(0)"));
    assert!(output.code.contains("_$derived("));
    assert_eq!(origin_of(&source, "export const after"), (8, 0));
    assert_eq!(origin_of(&source, "export function C"), (3, 0));
    assert_eq!(
        origin_of(&source, "useShadowSignal(0)"),
        (4, i64::try_from("  const [n] = ".len()).unwrap())
    );
    assert_eq!(
        origin_of(&source, "n() * 2"),
        (5, i64::try_from("  const double = ".len()).unwrap())
    );
}
