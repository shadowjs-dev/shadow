#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! `value` on `progress` and `meter` is written as an attribute, which the runtime removes for `null`
//! and `undefined`: the number property would write `value="0"`, a determinate bar, where the server
//! leaves the attribute out. The TypeScript implementation answers the same inputs in
//! `packages/compiler/test/progress-value.test.ts`.

use shadow_compiler::api::{JsOptions, Outcome, run};

fn dom(source: &str) -> String {
    let options = JsOptions {
        filename: Some("progress.tsx".to_string()),
        generate: Some("dom".to_string()),
        ..JsOptions::default()
    };
    match run(source, &options) {
        Outcome::Code { code, .. } => code,
        Outcome::Error(error) => panic!("an error: {}", error.message()),
        Outcome::Unsupported(reason) => panic!("handed over: {reason}"),
        Outcome::Internal(reason) => panic!("internal: {reason}"),
    }
}

#[test]
fn a_dynamic_value_on_progress_and_meter_is_an_attribute() {
    for tag in ["progress", "meter", "li"] {
        let out = dom(&format!("export const A = (p) => <{tag} value={{p.v}} />;"));
        assert!(
            out.contains("_$setAttribute(_el$, \"value\", p.v)"),
            "{tag}: {out}"
        );
        assert!(!out.contains(".value ="), "{tag}: {out}");
    }
}

#[test]
fn the_other_elements_with_a_value_property_still_get_the_property() {
    for tag in ["input", "textarea", "option", "button", "data", "output"] {
        let out = dom(&format!("export const A = (p) => <{tag} value={{p.v}} />;"));
        assert!(out.contains(".value = "), "{tag}: {out}");
    }
}
