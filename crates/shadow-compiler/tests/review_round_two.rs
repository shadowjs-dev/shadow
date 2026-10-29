#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! The second review round: what the Rust core must do the way the reference compiler does, on input
//! the first round fixed in TypeScript only. The reference's own output is compared in
//! `packages/compiler/test/review2.test.ts`; these tests hold the properties that need no oracle.

use std::time::{Duration, Instant};

use shadow_compiler::api::{JsOptions, Outcome, run};

fn options(generate: &str) -> JsOptions {
    JsOptions {
        filename: Some("review.tsx".to_string()),
        generate: Some(generate.to_string()),
        ..JsOptions::default()
    }
}

fn code_of(outcome: Outcome) -> String {
    match outcome {
        Outcome::Code { code, .. } => code,
        Outcome::Error(error) => panic!("an error: {}", error.message()),
        Outcome::Unsupported(reason) => panic!("handed over: {reason}"),
        Outcome::Internal(reason) => panic!("internal: {reason}"),
    }
}

fn error_code_of(outcome: Outcome) -> String {
    match outcome {
        Outcome::Error(error) => error.diagnostic.code,
        Outcome::Code { .. } => panic!("expected an error, got code"),
        Outcome::Unsupported(reason) => panic!("handed over: {reason}"),
        Outcome::Internal(reason) => panic!("internal: {reason}"),
    }
}

#[test]
fn nested_conditionals_cost_linear_time() {
    // Each level used to generate its inner JSX twice: depth 26 took minutes.
    let depth = 26;
    let ternary = format!(
        "export const A = (p) => {}1{};",
        "<b>{p.a ? ".repeat(depth),
        " : <i />}</b>".repeat(depth)
    );
    let logical = format!(
        "export const A = (p) => {}1{};",
        "<b>{p.a && ".repeat(depth),
        "}</b>".repeat(depth)
    );
    for source in [ternary, logical] {
        for generate in ["dom", "ssr"] {
            let started = Instant::now();
            let code = code_of(run(&source, &options(generate)));
            assert!(code.contains("export const A"));
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "{generate}: {:?}",
                started.elapsed()
            );
        }
    }
}

#[test]
fn a_chain_of_ternaries_is_followed_without_recursion() {
    let chain: String = (0..20_000)
        .map(|index| format!("p.a{index} ? <i>{{{index}}}</i> : "))
        .collect();
    let source = format!("export const A = (p) => <b>{{{chain}null}}</b>;");
    for generate in ["dom", "ssr"] {
        let code = code_of(run(&source, &options(generate)));
        assert!(code.contains("p.a19999"));
    }
}

#[test]
fn jsx_nested_through_expressions_is_refused_past_the_limit() {
    let make = |depth: usize| {
        format!(
            "export const A = (p) => {}1{};",
            "<b>{p.a && ".repeat(depth),
            "}</b>".repeat(depth)
        )
    };
    for generate in ["dom", "ssr"] {
        code_of(run(&make(400), &options(generate)));
        assert_eq!(
            error_code_of(run(&make(401), &options(generate))),
            "JSX_TOO_DEEP"
        );
    }
}

#[test]
fn a_small_module_nested_to_the_brim_compiles_on_a_small_stack() {
    // Under 1 KiB the module is compiled on the calling thread: the deepest it can nest must fit the stack of any
    // thread Node.js uses.
    let depth = 110;
    let source = format!(
        "const A = () => {}1{};",
        "<b x={".repeat(depth),
        "}/>".repeat(depth)
    );
    assert!(source.len() < 1024, "{}", source.len());
    // The build that ships needs well under 512 KiB; the unoptimized one has far larger frames.
    let stack = if cfg!(debug_assertions) {
        16 * 1024 * 1024
    } else {
        512 * 1024
    };
    let handle = std::thread::Builder::new()
        .stack_size(stack)
        .spawn(move || run(&source, &JsOptions::default()))
        .unwrap();
    let outcome = handle.join().unwrap();
    assert!(!matches!(outcome, Outcome::Internal(_)));
}

#[test]
fn a_component_named_with_a_dash_is_a_bad_tag() {
    for name in ["Foo-Bar", "_foo-bar", "$x-y", "Ünï-code"] {
        let source = format!("export const A = () => <{name} x={{1}} />;");
        assert_eq!(error_code_of(run(&source, &options("dom"))), "BAD_TAG");
    }
    let custom = code_of(run(
        "export const A = () => <my-el x={1} />;",
        &options("dom"),
    ));
    assert!(!custom.contains("createComponent"));
}

#[test]
fn a_tag_starting_with_a_non_ascii_letter_is_jsx() {
    let code = code_of(run(
        "export const A = () => <Übersicht n={1} />;",
        &options("dom"),
    ));
    assert!(code.contains("createComponent(Übersicht"));
}
