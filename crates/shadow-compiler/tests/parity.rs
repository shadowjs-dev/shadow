#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! The Rust compiler must reproduce, byte for byte, what the JavaScript compiler recorded in the
//! parity corpus (packages/compiler/test/native/corpus): the code, the `transformed` flag, the source
//! map, and for failing inputs the `CompileError` (message, code, positions, frame).

mod common;

use serde::Deserialize;
use shadow_compiler::compile::{CompileFailure, Options, Target, compile};

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct CaseOptions {
    filename: Option<String>,
    generate: Option<String>,
    module_name: Option<String>,
    dev: Option<bool>,
    auto_reactive: Option<bool>,
    hmr: Option<bool>,
    hydratable: Option<bool>,
    source_map: Option<bool>,
}

#[derive(Deserialize)]
struct ExpectedMap {
    sources: Vec<String>,
    #[serde(rename = "sourcesContent")]
    sources_content: Option<Vec<String>>,
    names: Vec<String>,
    mappings: String,
}

#[derive(Deserialize)]
struct ExpectedDiagnostic {
    code: String,
    message: String,
    start: usize,
    end: usize,
    line: usize,
    column: usize,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Expect {
    Ok {
        code: String,
        transformed: bool,
        map: Option<ExpectedMap>,
    },
    Error {
        message: String,
        frame: String,
        id: String,
        diagnostic: ExpectedDiagnostic,
    },
    Throws,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    source: String,
    #[serde(default)]
    options: CaseOptions,
    expect: Expect,
}

fn options_of(case: &CaseOptions) -> Options {
    Options {
        filename: case.filename.clone(),
        generate: if case.generate.as_deref() == Some("ssr") {
            Target::Ssr
        } else {
            Target::Dom
        },
        module_name: case.module_name.clone(),
        dev: case.dev.unwrap_or(false),
        auto_reactive: case.auto_reactive.unwrap_or(true),
        hmr: case.hmr.unwrap_or(false),
        hydratable: case.hydratable.unwrap_or(true),
        source_map: case.source_map.unwrap_or(true),
    }
}

fn first_difference(expected: &str, actual: &str) -> String {
    let mut line = 1;
    let mut column = 0;
    for (a, b) in expected.chars().zip(actual.chars()) {
        if a != b {
            break;
        }
        if a == '\n' {
            line += 1;
            column = 0;
        } else {
            column += 1;
        }
    }
    let at = |text: &str| text.lines().nth(line - 1).unwrap_or("<end>").to_string();
    format!(
        "first difference at line {line} column {column}\n  expected: {}\n  actual:   {}",
        at(expected),
        at(actual)
    )
}

/// Inputs the Rust compiler hands to the reference by design (COMPILER-11): the TypeScript
/// wrapper answers them with `@shadow-js/compiler`, and the parity test of the package checks the answer.
const HANDED_OVER: &[&str] = &["an attribute named like a member of every object"];

/// Returns a description of the mismatch, or `None` when the case passes.
fn check(case: &Case) -> Option<String> {
    let options = options_of(&case.options);
    let result = compile(&case.source, &options);
    match (&case.expect, result) {
        (
            Expect::Ok {
                code,
                transformed,
                map,
            },
            Ok(output),
        ) => {
            if &output.code != code {
                return Some(format!(
                    "code differs\n{}",
                    first_difference(code, &output.code)
                ));
            }
            if output.transformed != *transformed {
                return Some(format!(
                    "transformed: expected {transformed}, got {}",
                    output.transformed
                ));
            }
            match (map, &output.map) {
                (None, None) => None,
                (Some(expected), Some(actual)) => {
                    if expected.sources != actual.sources
                        || expected.sources_content.as_deref()
                            != Some(std::slice::from_ref(&case.source))
                        || !expected.names.is_empty()
                    {
                        return Some("source map header differs".to_string());
                    }
                    if expected.mappings != actual.mappings {
                        return Some(format!(
                            "source map mappings differ\n{}",
                            first_difference(&expected.mappings, &actual.mappings)
                        ));
                    }
                    None
                }
                (Some(_), None) => Some("expected a source map, got none".to_string()),
                (None, Some(_)) => Some("expected no source map, got one".to_string()),
            }
        }
        (
            Expect::Error {
                message,
                frame,
                id,
                diagnostic,
            },
            Err(CompileFailure::Error(error)),
        ) => {
            let d = &error.diagnostic;
            if d.code != diagnostic.code
                || d.message != diagnostic.message
                || d.start != diagnostic.start
                || d.end != diagnostic.end
                || d.line != diagnostic.line
                || d.column != diagnostic.column
            {
                return Some(format!(
                    "diagnostic differs: expected {:?}, got {:?}",
                    (
                        &diagnostic.code,
                        &diagnostic.message,
                        diagnostic.start,
                        diagnostic.end,
                        diagnostic.line,
                        diagnostic.column
                    ),
                    (&d.code, &d.message, d.start, d.end, d.line, d.column)
                ));
            }
            if &error.frame != frame || &error.id != id || &error.message() != message {
                return Some("error frame, id or message differs".to_string());
            }
            None
        }
        (Expect::Throws, _) => Some("the reference throws a non-CompileError".to_string()),
        (Expect::Ok { .. }, Err(CompileFailure::Error(error))) => {
            Some(format!("unexpected error {}", error.message()))
        }
        (_, Err(CompileFailure::Unsupported(reason))) if HANDED_OVER.contains(&reason.as_str()) => {
            None
        }
        (_, Err(CompileFailure::Unsupported(reason))) => Some(format!("unsupported: {reason}")),
        (Expect::Error { .. }, Ok(_)) => Some("expected an error, got output".to_string()),
    }
}

fn run_file(name: &str) {
    let text = common::read_gz(&common::corpus(name));
    let mut failures: Vec<String> = Vec::new();
    let mut total = 0;
    for line in text.lines() {
        let case: Case =
            serde_json::from_str(line).unwrap_or_else(|e| panic!("bad corpus line: {e}"));
        total += 1;
        if let Some(problem) = check(&case) {
            failures.push(format!("{}: {problem}", case.id));
        }
    }
    assert!(total > 0, "{name} is empty");
    eprintln!("{name}: {total} cases checked");
    assert!(
        failures.is_empty(),
        "{} of {total} cases of {name} differ:\n{}",
        failures.len(),
        failures
            .iter()
            .take(8)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n---\n")
    );
}

fn with_big_stack(name: &'static str) {
    let handle = std::thread::Builder::new()
        .stack_size(512 * 1024 * 1024)
        .spawn(move || run_file(name))
        .unwrap_or_else(|e| panic!("{e}"));
    if let Err(payload) = handle.join() {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn tests_corpus() {
    with_big_stack("tests.jsonl.gz");
}

#[test]
fn errors_corpus() {
    with_big_stack("errors.jsonl.gz");
}

#[test]
fn real_corpus() {
    with_big_stack("real.jsonl.gz");
}

#[test]
fn options_matrix_corpus() {
    with_big_stack("options-matrix.jsonl.gz");
}
