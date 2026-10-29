#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! The seventh review round, on the Rust core: the properties that need no oracle. The reference's own
//! output is compared with all four implementations in `packages/compiler/test/review-r7.test.ts`.

use shadow_compiler::api::{JsOptions, Outcome, run};

fn options(generate: &str) -> JsOptions {
    JsOptions {
        filename: Some("review.tsx".to_string()),
        generate: Some(generate.to_string()),
        ..JsOptions::default()
    }
}

fn code(source: &str, generate: &str) -> String {
    match run(source, &options(generate)) {
        Outcome::Code { code, .. } => code,
        Outcome::Error(error) => panic!("an error: {}", error.message()),
        Outcome::Unsupported(reason) => panic!("handed over: {reason}"),
        Outcome::Internal(reason) => panic!("internal: {reason}"),
    }
}

fn error_code(source: &str, generate: &str) -> String {
    match run(source, &options(generate)) {
        Outcome::Error(error) => error.diagnostic.code,
        Outcome::Code { .. } => panic!("expected an error, got code"),
        Outcome::Unsupported(reason) => panic!("handed over: {reason}"),
        Outcome::Internal(reason) => panic!("internal: {reason}"),
    }
}

#[test]
fn awaited_values_are_read_before_the_jsx() {
    for generate in ["dom", "ssr"] {
        let out = code(
            "export const A = async (p) => <C v={await p.x}>{await p.y}</C>;",
            generate,
        );
        // The awaits sit in the call that applies the arrow, not in an accessor or a getter.
        assert!(out.contains(")(await p.x, await p.y)"), "{out}");
    }
}

#[test]
fn an_expression_that_starts_with_a_brace_is_parenthesized() {
    let out = code("export const A = (p) => <div>{{ a: 1 }[p.k]}</div>;", "dom");
    assert!(out.contains("() => ({ a: 1 }[p.k])"), "{out}");
}

#[test]
fn this_in_component_props_is_captured() {
    let out = code(
        "export const o = { render() { return <Show title={this.name} />; } };",
        "dom",
    );
    assert!(out.contains("_self$.name"), "{out}");
    assert!(out.contains(")(this)"), "{out}");
    assert_eq!(
        error_code(
            "export class A extends B { render() { return <Show t={super.x} />; } }",
            "dom"
        ),
        "UNSUPPORTED_SUPER"
    );
}

#[test]
fn nesting_the_parser_repairs_is_refused() {
    for jsx in [
        "<p><span><div /></span></p>",
        "<ul><li><b><li /></b></li></ul>",
        "<dl><dd><dd /></dd></dl>",
        "<nobr><nobr /></nobr>",
        "<optgroup><optgroup /></optgroup>",
        "<textarea><b /></textarea>",
    ] {
        assert_eq!(
            error_code(&format!("export const A = () => {jsx};"), "dom"),
            "INVALID_HTML_NESTING",
            "{jsx}"
        );
    }
    for jsx in [
        "<p><button><div /></button></p>",
        "<ul><li><ul><li /></ul></li></ul>",
        "<p><Card><div /></Card></p>",
    ] {
        code(&format!("export const A = () => {jsx};"), "dom");
    }
}

#[test]
fn conditional_jsx_in_svg_is_built_in_svg() {
    let out = code(
        "export const A = (c) => <svg>{c && <title />}</svg>;",
        "dom",
    );
    assert!(out.contains("template(\"<title></title>\", 1)"), "{out}");
}

#[test]
fn a_tag_opened_with_whitespace_or_a_comment_is_jsx() {
    for source in [
        "export const A = () => < div />;",
        "export const A = () => </*c*/div />;",
    ] {
        assert!(code(source, "dom").contains("template"));
    }
}
