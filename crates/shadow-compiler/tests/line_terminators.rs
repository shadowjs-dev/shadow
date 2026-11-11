#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! ECMAScript ends a line at LF, CR, U+2028 and U+2029, and counts CR LF as one terminator. An error
//! in a module that uses any of them is reported at the line a reader sees, as the TypeScript
//! implementation reports it.

use shadow_compiler::compile::{CompileFailure, Options, Target, compile};
use shadow_compiler::diagnostics::CompileError;

const TERMINATORS: [(&str, &str); 5] = [
    ("LF", "\n"),
    ("CR LF", "\r\n"),
    ("CR", "\r"),
    ("U+2028", "\u{2028}"),
    ("U+2029", "\u{2029}"),
];

fn failure(source: &str) -> CompileError {
    let options = Options {
        filename: Some("a.tsx".to_string()),
        generate: Target::Dom,
        ..Options::default()
    };
    match compile(source, &options) {
        Err(CompileFailure::Error(error)) => *error,
        other => panic!("expected a CompileError, got {other:?}"),
    }
}

fn position(source: &str) -> (String, usize, usize) {
    let error = failure(source);
    (
        error.diagnostic.code,
        error.diagnostic.line,
        error.diagnostic.column,
    )
}

/// A `useStore` module, so the error is traced back through a rewrite, with non-BMP text before it.
fn rewritten(terminator: &str) -> String {
    [
        "import { useStore } from \"@shadow-js/core\";",
        "// x \u{1F600}",
        "const [n] = useStore(0);",
        "export const view = <p><div/></p>;",
    ]
    .join(terminator)
}

#[test]
fn an_error_is_on_the_line_a_reader_sees() {
    for (name, terminator) in TERMINATORS {
        assert_eq!(
            position(&rewritten(terminator)),
            ("INVALID_HTML_NESTING".to_string(), 4, 20),
            "{name}: error after a rewrite"
        );
        let plain = ["export const a = 1;", "export const view = <p><div/></p>;"].join(terminator);
        assert_eq!(
            position(&plain),
            ("INVALID_HTML_NESTING".to_string(), 2, 20),
            "{name}: error without a rewrite"
        );
        let syntax = ["const a = 1;", "const b = 2;", "const view = <div>;"].join(terminator);
        assert_eq!(
            position(&syntax),
            ("PARSE_ERROR".to_string(), 3, 18),
            "{name}: syntax error"
        );
    }
}

#[test]
fn the_code_frame_shows_the_line_of_the_error() {
    let frame = "   4 | export const view = <p><div/></p>;\n     |                     ^";
    for (name, terminator) in TERMINATORS {
        assert_eq!(failure(&rewritten(terminator)).frame, frame, "{name}");
    }
}

#[test]
fn a_module_that_mixes_every_terminator_is_counted_terminator_by_terminator() {
    let source = "const a = 1;\r\nconst b = 2;\rconst c = 3;\u{2028}const d = 4;\u{2029}const e = 5;\nconst view = <div>;";
    assert_eq!(position(source), ("PARSE_ERROR".to_string(), 6, 18));
}

#[test]
fn a_cr_lf_file_keeps_its_code_frame_with_the_cr() {
    let source = "export const view = <p><div/></p>;\r\nconst after = 1;";
    let error = failure(source);
    assert_eq!((error.diagnostic.line, error.diagnostic.column), (1, 20));
    assert_eq!(
        error.frame,
        "   1 | export const view = <p><div/></p>;\r\n     |                     ^"
    );
}
