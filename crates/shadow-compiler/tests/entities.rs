#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! Differential and performance tests for `shadow_compiler::entities::decode_html_strict`.
//!
//! The fixture file is produced by `tools/gen-entities-fixtures.mjs` using the real
//! `decodeHTMLStrict` of the `entities` npm package (8.1.0).

use std::borrow::Cow;
use std::time::{Duration, Instant};

use serde::Deserialize;
use shadow_compiler::entities::decode_html_strict;

#[derive(Deserialize)]
struct Fixture {
    input: String,
    output: String,
}

mod common;

fn fixtures() -> String {
    common::read_gz(&common::fixture("entities.jsonl.gz"))
}

#[test]
fn matches_the_js_implementation_on_every_fixture() {
    let mut count = 0_usize;
    let mut failures = Vec::new();
    for (line_number, line) in fixtures().lines().enumerate() {
        if line.is_empty() {
            continue;
        }
        let fixture: Fixture = match serde_json::from_str(line) {
            Ok(fixture) => fixture,
            Err(error) => {
                failures.push(format!("line {}: invalid JSON: {error}", line_number + 1));
                continue;
            }
        };
        count += 1;
        let actual = decode_html_strict(&fixture.input);
        if actual != fixture.output {
            if failures.len() < 20 {
                failures.push(format!(
                    "line {}: input {:?}: expected {:?}, got {:?}",
                    line_number + 1,
                    fixture.input,
                    fixture.output,
                    actual
                ));
            } else {
                failures.push(String::new());
            }
        }
        let has_amp = fixture.input.contains('&');
        if !has_amp && !matches!(actual, Cow::Borrowed(_)) {
            failures.push(format!(
                "line {}: expected a borrowed result",
                line_number + 1
            ));
        }
    }
    assert!(
        count >= 50_000,
        "fixture file is unexpectedly small: {count}"
    );
    let shown: Vec<_> = failures.iter().filter(|f| !f.is_empty()).collect();
    assert!(
        failures.is_empty(),
        "{} mismatches out of {count}; first ones:\n{}",
        failures.len(),
        shown
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn fixtures_cover_at_least_twenty_thousand_random_strings() {
    assert!(fixtures().lines().count() >= 20_000 + 2125);
}

fn assert_fast(name: &str, input: &str) {
    let started = Instant::now();
    let output = decode_html_strict(input);
    let elapsed = started.elapsed();
    assert_eq!(output, input, "{name}: nothing should be decoded");
    assert!(
        elapsed < Duration::from_secs(2),
        "{name}: took {elapsed:?} for {} bytes (quadratic behavior?)",
        input.len()
    );
}

#[test]
fn many_ampersands_are_linear() {
    assert_fast("ampersands", &"&".repeat(1 << 20));
}

#[test]
fn repeated_hash_prefixes_are_linear() {
    assert_fast("amp-hash", &"&#".repeat(1 << 19));
    assert_fast("amp-hash-x", &"&#x".repeat(350_000));
}

#[test]
fn long_unterminated_runs_are_linear() {
    assert_fast("digits", &format!("&#{}", "1".repeat(1 << 20)));
    assert_fast("hex digits", &format!("&#x{}", "f".repeat(1 << 20)));
    assert_fast("name", &format!("&{}", "a".repeat(1 << 20)));
    assert_fast("amp-names", &"&amp".repeat(1 << 18));
    assert_fast("amp-digits", &"&#12".repeat(1 << 18));
    assert_fast(
        "amp-long-names",
        &"&CounterClockwiseContourIntegra".repeat(1 << 15),
    );
}

#[test]
fn dense_valid_entities_decode_in_linear_time() {
    let input = "&amp;&#65;&#x42;&NotEqualTilde;".repeat(40_000);
    let started = Instant::now();
    let output = decode_html_strict(&input);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(
        output.len(),
        40_000 * ("&A".len() + "B".len() + "\u{2242}\u{338}".len())
    );
}
