#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! Malformed and hostile input must never panic, never crash the process and never give a different
//! answer twice: the compiler returns code, a `CompileError`, or hands the input back as unsupported.

use proptest::prelude::*;
use shadow_compiler::api::{JsOptions, Outcome, run};

/// Pieces that make a module look like JSX, TypeScript and a component, and break it in the ways a
/// typing human or a bad merge does.
const PIECES: &[&str] = &[
    "<",
    ">",
    "</",
    "/>",
    "<>",
    "</>",
    "{",
    "}",
    "(",
    ")",
    "[",
    "]",
    "=",
    "=>",
    "\"",
    "'",
    "`",
    "${",
    "&amp;",
    "&",
    "\\",
    ";",
    ",",
    ".",
    "...",
    "?.",
    "?",
    ":",
    "div",
    "span",
    "a",
    "Foo",
    "Foo.Bar",
    "this",
    "svg",
    "table",
    "tr",
    "td",
    "select",
    "option",
    "textarea",
    "script",
    "input",
    "br",
    "x",
    "y",
    "count",
    "props",
    "useStore",
    "import { useStore } from \"@shadow-js/core\";",
    "const ",
    "let ",
    "function ",
    "export ",
    "default ",
    "return ",
    "async ",
    "await ",
    "class ",
    "type ",
    "interface ",
    "as ",
    "satisfies ",
    "enum ",
    "onClick",
    "className",
    "ref",
    "key",
    "style",
    "innerHTML",
    "dangerouslySetInnerHTML",
    "use:x",
    "on:y",
    "prop:z",
    "attr:w",
    "bool:v",
    "class:c",
    "style:s",
    "xlink:href",
    "{...p}",
    "{/* c */}",
    "//",
    "/*",
    "*/",
    " ",
    "  ",
    "\n",
    "\r\n",
    "\t",
    "0",
    "1",
    "1e21",
    "-0",
    "'a'",
    "\"b\"",
    "`t`",
    "\u{e9}",
    "\u{1f600}",
    "\u{2028}",
    "\u{feff}",
    "\u{0}",
    "!",
    "!!",
    "typeof ",
    "new ",
    "<T>",
    "<T,>",
    "@dec ",
    "#priv",
    "#!",
    "\"use client\";",
    "$_",
    "_$",
    "_$template",
    "undefined",
    "NaN",
    "null",
    "true",
    "false",
];

fn module() -> impl Strategy<Value = String> {
    prop::collection::vec(prop::sample::select(PIECES), 0..80).prop_map(|parts| parts.concat())
}

fn options() -> impl Strategy<Value = JsOptions> {
    (
        prop::sample::select(vec![
            "a.tsx",
            "a.jsx",
            "a.ts",
            "a.mts",
            "a.js",
            "dir/a.tsx",
            "",
        ]),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
    )
        .prop_map(
            |(filename, ssr, dev, hmr, auto, hydratable, map)| JsOptions {
                filename: Some(filename.to_string()),
                generate: ssr.then(|| "ssr".to_string()),
                module_name: None,
                dev: Some(dev),
                auto_reactive: Some(auto),
                hmr: Some(hmr),
                hydratable: Some(hydratable),
                source_map: Some(map),
            },
        )
}

fn describe(outcome: &Outcome) -> String {
    match outcome {
        Outcome::Code {
            code,
            transformed,
            map,
        } => {
            format!(
                "code {transformed} {code} {:?}",
                map.as_ref().map(|m| &m.mappings)
            )
        }
        Outcome::Error(error) => format!("error {}", error.message()),
        Outcome::Unsupported(reason) => format!("unsupported {reason}"),
        Outcome::Internal(reason) => format!("internal {reason}"),
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 4000, ..ProptestConfig::default() })]

    #[test]
    fn arbitrary_token_soup_never_fails_internally(source in module(), options in options()) {
        let first = run(&source, &options);
        prop_assert!(!matches!(first, Outcome::Internal(_)), "internal failure: {}", describe(&first));
        let second = run(&source, &options);
        prop_assert_eq!(describe(&first), describe(&second));
    }

    #[test]
    fn arbitrary_text_never_fails_internally(source in "\\PC{0,300}", options in options()) {
        let outcome = run(&source, &options);
        prop_assert!(!matches!(outcome, Outcome::Internal(_)), "internal failure: {}", describe(&outcome));
    }

    #[test]
    fn a_module_with_one_component_survives_any_cut(cut in 0usize..400, fill in prop::sample::select(PIECES)) {
        let source = "import { useStore } from \"@shadow-js/core\";\nexport function C(props) {\n  const [n, setN] = useStore(0);\n  const d = n() * 2;\n  return <div class={props.c} onClick={() => setN((v) => v + 1)}>{d}<p>text &amp; more</p><input value={n()} /></div>;\n}\n";
        let mut cut = cut.min(source.len());
        while !source.is_char_boundary(cut) {
            cut -= 1;
        }
        let damaged = format!("{}{fill}{}", &source[..cut], &source[cut..]);
        let outcome = run(&damaged, &JsOptions::default());
        prop_assert!(!matches!(outcome, Outcome::Internal(_)), "internal failure: {}", describe(&outcome));
    }
}

fn nested(open: &str, close: &str, depth: usize) -> String {
    format!(
        "const a = {}1{};\nconst z = <a/>;\n",
        open.repeat(depth),
        close.repeat(depth)
    )
}

#[test]
fn deep_nesting_is_answered_without_crashing() {
    for (open, close) in [
        ("(", ")"),
        ("[", "]"),
        ("f(", ")"),
        ("{a:", "}"),
        ("() => ", ""),
        ("c ? 1 : ", ""),
        ("<div>", "</div>"),
    ] {
        for depth in [100, 2_000, 20_000, 120_000] {
            let source = if open.starts_with('<') {
                format!("const a = {}x{};", open.repeat(depth), close.repeat(depth))
            } else {
                nested(open, close, depth)
            };
            let outcome = run(&source, &JsOptions::default());
            assert!(
                !matches!(outcome, Outcome::Internal(_)),
                "{open} x {depth}: {}",
                describe(&outcome).chars().take(200).collect::<String>()
            );
        }
    }
}

#[test]
fn absurd_bracket_depth_is_refused() {
    let source = nested("(", ")", 400_000);
    match run(&source, &JsOptions::default()) {
        Outcome::Error(error) => {
            assert_eq!(error.diagnostic.code, "PARSE_ERROR");
            assert!(error.message().contains("nested too deeply"));
        }
        other => panic!("expected a refusal, got {}", describe(&other)),
    }
}

#[test]
fn the_output_does_not_depend_on_the_thread() {
    let source = "export const A = (props) => <ul>{props.items.map((i) => <li class={i.c}>{i.name}</li>)}</ul>;\n".repeat(40);
    let options = JsOptions::default();
    let here = describe(&run(&source, &options));
    let there = {
        let (source, options) = (source.clone(), options.clone());
        std::thread::spawn(move || describe(&run(&source, &options)))
            .join()
            .unwrap()
    };
    assert_eq!(here, there);
}

#[test]
fn concurrent_compilations_agree() {
    let sources: Vec<String> = (0..8)
        .map(|i| {
            format!(
                "export const C{i} = () => <div id=\"{i}\">{}</div>;\n",
                "<b>x</b>".repeat(200)
            )
        })
        .collect();
    let expected: Vec<String> = sources
        .iter()
        .map(|s| describe(&run(s, &JsOptions::default())))
        .collect();
    let handles: Vec<_> = sources
        .into_iter()
        .map(|source| {
            std::thread::spawn(move || {
                (0..20)
                    .map(|_| describe(&run(&source, &JsOptions::default())))
                    .collect::<Vec<_>>()
            })
        })
        .collect();
    for (handle, expected) in handles.into_iter().zip(expected) {
        for answer in handle.join().unwrap() {
            assert_eq!(answer, expected);
        }
    }
}

#[test]
fn ssr_attributes_named_like_object_members_go_to_the_reference() {
    for name in [
        "toString",
        "constructor",
        "__proto__",
        "hasOwnProperty",
        "valueOf",
    ] {
        let source = format!("export const A = () => <li {name}=\"1\">x</li>;\n");
        let ssr = JsOptions {
            generate: Some("ssr".to_string()),
            ..JsOptions::default()
        };
        assert!(
            matches!(run(&source, &ssr), Outcome::Unsupported(_)),
            "{name} on the server"
        );
        assert!(
            matches!(run(&source, &JsOptions::default()), Outcome::Code { .. }),
            "{name} in the browser"
        );
    }
}
