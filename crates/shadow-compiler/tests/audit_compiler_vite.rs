#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! The compiler and Vite audit, on the Rust core: the properties that need no oracle. The
//! TypeScript implementation answers the same inputs in `packages/compiler/test/audit-compiler.test.ts`.

use shadow_compiler::api::{JsOptions, Outcome, run};

fn options(generate: &str) -> JsOptions {
    JsOptions {
        filename: Some("audit.tsx".to_string()),
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
fn the_ref_method_does_not_shadow_a_name_the_module_uses() {
    for generate in ["dom", "ssr"] {
        let out = code(
            "export const A = () => { let r$; return <Inner ref={r$} />; };",
            generate,
        );
        assert!(!out.contains("ref(r$)"), "{out}");
        assert!(out.contains("const _ref$ = r$;"), "{out}");
    }
}

#[test]
fn the_ref_method_keeps_its_parameter_name_when_the_module_does_not_use_it() {
    let out = code("export const A = (p) => <Inner ref={p.el} />;", "dom");
    assert!(out.contains("ref(r$) {"), "{out}");
}

#[test]
fn a_directive_name_must_be_an_identifier() {
    for generate in ["dom", "ssr"] {
        for source in [
            "export const A = () => <div use:foo-bar={x} />;",
            "export const A = () => <div use:class={x} />;",
            "export const A = () => <div use:this={x} />;",
        ] {
            assert_eq!(error_code(source, generate), "BAD_ATTRIBUTE", "{source}");
        }
    }
}

#[test]
fn a_component_keeps_any_directive_prop_and_an_ordinary_directive_compiles() {
    let component = code("export const A = () => <Comp use:foo-bar={x} />;", "dom");
    assert!(component.contains("\"use:foo-bar\""), "{component}");
    let element = code("export const A = () => <div use:tooltip={x} />;", "dom");
    assert!(element.contains("_$use(tooltip,"), "{element}");
}

#[test]
fn a_dynamic_xml_attribute_is_set_in_the_xml_namespace() {
    let out = code(
        "export const A = () => <svg><text xml:lang={x()} xml:space={y} /></svg>;",
        "dom",
    );
    assert!(
        out.contains("\"http://www.w3.org/XML/1998/namespace\", \"xml:lang\", x())"),
        "{out}"
    );
    assert!(out.contains("\"xml:space\""), "{out}");
    assert_eq!(
        error_code("export const A = () => <div xmlns:x={x} />;", "dom"),
        "UNKNOWN_NAMESPACE"
    );
    let server = code(
        "export const A = () => <svg><text xml:lang={x()} /></svg>;",
        "ssr",
    );
    assert!(
        server.contains("_$ssrAttribute(\"xml:lang\", x())"),
        "{server}"
    );
}

fn wrapped(source: &str) -> Vec<String> {
    let options = JsOptions {
        hmr: Some(true),
        ..options("dom")
    };
    let Outcome::Code { code, .. } = run(source, &options) else {
        panic!("no code for {source}");
    };
    code.match_indices("_$component(_$$reg, \"")
        .map(|(at, found)| {
            let rest = &code[at + found.len()..];
            rest[..rest.find('"').unwrap()].to_string()
        })
        .collect()
}

fn accepts_itself(source: &str) -> bool {
    let options = JsOptions {
        hmr: Some(true),
        ..options("dom")
    };
    let Outcome::Code { code, .. } = run(source, &options) else {
        panic!("no code for {source}");
    };
    code.contains("import.meta.hot?.accept()")
}

const PAGE: &str = "export const Page = () => <b>hi</b>;\n";

#[test]
fn hot_updates_leave_constructors_and_helpers_as_written() {
    for source in [
        format!("function Point(x) {{ this.x = x; }}\nconst p = new Point(1);\n{PAGE}"),
        format!("function Point(x) {{ return {{ x }}; }}\nconst p = new (Point)(1);\n{PAGE}"),
        format!("const Point = (x) => ({{ x }});\nconst p = new Point(1);\n{PAGE}"),
        format!("function Point(x) {{ this.x = x; }}\n{PAGE}"),
        format!("const Total = (n) => n * 2;\nconst label = Total(2) + \"px\";\n{PAGE}"),
        format!("function Format(n) {{ return String(n); }}\n{PAGE}"),
    ] {
        assert_eq!(wrapped(&source), ["Page"], "{source}");
    }
    assert!(wrapped("function Item(p) { return <b onClick={() => this.go(p)} />; }").is_empty());
    assert_eq!(
        wrapped(
            "function Item(p) { const f = function () { return this; }; return <b>{f()}</b>; }"
        ),
        ["Item"]
    );
}

#[test]
fn hot_updates_wrap_components_that_hide_their_jsx() {
    assert_eq!(
        wrapped(
            "function Wrapper(props) { return props.children; }\nfunction Unused(props) { return props.children; }\nexport const Page = () => <Wrapper><b /></Wrapper>;"
        ),
        ["Wrapper", "Page"]
    );
    assert_eq!(
        wrapped("const Menu = (p) => p.items;\nexport const Page = () => <Menu.Item />;"),
        ["Menu", "Page"]
    );
    assert_eq!(
        wrapped(
            "const Layout = () => <main />;\nexport const Page = () => Layout({});\nconst Top = (p) => (p.a ? Page({}) : null);"
        ),
        ["Layout", "Page", "Top"]
    );
    assert_eq!(
        wrapped(
            "const A = () => { return B({}); };\nconst B = () => C({});\nconst C = () => <i />;"
        ),
        ["A", "B", "C"]
    );
    assert_eq!(
        wrapped("const Layout = () => <main />;\nconst Probe = () => { Layout({}); return 1; };"),
        ["Layout"]
    );
    assert_eq!(
        wrapped(
            "const Total = (n) => n;\nconst Sum = (n) => Total(n);\nexport const P = () => <b />;"
        ),
        ["P"]
    );
}

#[test]
fn a_module_accepts_its_own_update_only_when_every_export_is_a_wrapped_component() {
    assert!(accepts_itself("export const Page = () => <b />;"));
    assert!(!accepts_itself(
        "export function Point(x) { this.x = x; }\nexport const Page = () => <b />;"
    ));
    assert!(!accepts_itself(
        "export const Total = (n) => n * 2;\nexport const Page = () => <b />;"
    ));
    assert!(!accepts_itself(
        "export default function Point(x) { this.x = x; }\nexport const Page = () => <b />;"
    ));
    assert!(!accepts_itself(
        "function Point(x) { this.x = x; }\nexport { Point };\nexport const Page = () => <b />;"
    ));
    assert!(accepts_itself(
        "function Point(x) { this.x = x; }\nexport const Page = () => <b />;"
    ));
}

#[test]
fn an_overload_signature_is_a_type_and_the_implementation_decides() {
    assert_eq!(
        wrapped("export function Real(): unknown;\nexport function Real() { return <p />; }"),
        ["Real"]
    );
    for source in [
        "export function Real(): unknown;\nexport function Real() { return <p />; }",
        "export function Real(a: string): unknown;\nexport function Real(a: number): unknown;\nexport function Real(a: any) { return <p />; }",
        "export default function Real(): unknown;\nexport default function Real() { return <p />; }",
    ] {
        assert!(accepts_itself(source), "{source}");
    }
    assert!(!accepts_itself(
        "export function Point(x: number): unknown;\nexport function Point(x: any) { this.x = x; }\nexport const Page = () => <b />;"
    ));
}
