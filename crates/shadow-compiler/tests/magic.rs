#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! Replays `tests/fixtures/magic.jsonl`, generated with the real `magic-string`
//! package by `tools/gen-magic-fixtures.mjs`, against the Rust port.

use std::time::Instant;

use serde_json::Value;
use shadow_compiler::magic::{MagicError, MagicString};

mod common;

fn fixtures() -> String {
    common::read_gz(&common::fixture("magic.jsonl.gz"))
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing string field {key}"))
}

fn usize_field(v: &Value, key: &str) -> usize {
    let n = v
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or_else(|| panic!("missing number field {key}"));
    usize::try_from(n).unwrap()
}

/// Applies one fixture op. Returns the library's error, if any.
fn apply(ms: &mut MagicString, op: &Value) -> Result<(), MagicError> {
    let content = op.get("content").and_then(Value::as_str).unwrap_or("");
    match str_field(op, "op") {
        "overwrite" => ms.overwrite(usize_field(op, "start8"), usize_field(op, "end8"), content),
        "appendLeft" => ms.append_left(usize_field(op, "index8"), content),
        "appendRight" => ms.append_right(usize_field(op, "index8"), content),
        "prepend" => {
            ms.prepend(content);
            Ok(())
        }
        "append" => {
            ms.append(content);
            Ok(())
        }
        other => panic!("unknown op {other}"),
    }
}

fn string_array(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn replays_every_fixture() {
    let started = Instant::now();
    let mut total = 0usize;
    let mut errors = 0usize;
    let mut maps = 0usize;

    for (line_no, line) in fixtures().lines().enumerate() {
        if line.is_empty() {
            continue;
        }
        total += 1;
        let case: Value = serde_json::from_str(line).unwrap();
        let original = str_field(&case, "original");
        let ctx = format!("case {line_no}: {original:?}");
        let mut ms = MagicString::new(original);
        let mut failure: Option<MagicError> = None;
        for op in case["ops"].as_array().unwrap() {
            let swallow = op.get("swallow").and_then(Value::as_bool) == Some(true);
            if let Err(e) = apply(&mut ms, op) {
                if swallow {
                    continue;
                }
                failure = Some(e);
                break;
            }
        }

        let result = &case["result"];
        if result["ok"] == Value::Bool(false) {
            errors += 1;
            let expected = str_field(result, "error");
            let err = failure.unwrap_or_else(|| panic!("{ctx}: expected error {expected:?}"));
            assert_eq!(err.message(), expected, "{ctx}: error message");
            continue;
        }
        if let Some(err) = failure {
            panic!("{ctx}: unexpected error {err}");
        }

        // toString
        assert_eq!(ms.render(), str_field(result, "text"), "{ctx}: text");
        assert_eq!(ms.to_string(), str_field(result, "text"), "{ctx}: display");

        // maps
        let source = case.get("source").and_then(Value::as_str);
        let include_content = case["includeContent"].as_bool().unwrap();
        let map = ms.generate_map(source, include_content);
        let expected = &result["map"];
        assert_eq!(expected["version"], 3, "{ctx}");
        assert_eq!(
            map.sources,
            string_array(&expected["sources"]),
            "{ctx}: sources"
        );
        match expected.get("sourcesContent") {
            Some(content) => assert_eq!(
                map.sources_content,
                Some(string_array(content)),
                "{ctx}: sourcesContent"
            ),
            None => assert_eq!(map.sources_content, None, "{ctx}: sourcesContent"),
        }
        assert_eq!(map.names, string_array(&expected["names"]), "{ctx}: names");
        assert_eq!(
            map.mappings,
            str_field(expected, "mappings"),
            "{ctx}: mappings"
        );
        assert!(expected.get("file").is_none(), "{ctx}");

        // The hand-rolled JSON must parse back to the same object.
        let json: Value = serde_json::from_str(&map.to_json()).unwrap();
        assert_eq!(&json, expected, "{ctx}: to_json");

        let decoded = ms.generate_decoded_map(source, include_content);
        let expected = &result["decoded"];
        assert_eq!(decoded.sources, string_array(&expected["sources"]), "{ctx}");
        match expected.get("sourcesContent") {
            Some(content) => assert_eq!(
                decoded.sources_content,
                Some(string_array(content)),
                "{ctx}"
            ),
            None => assert_eq!(decoded.sources_content, None, "{ctx}"),
        }
        assert_eq!(decoded.names, string_array(&expected["names"]), "{ctx}");
        let expected_lines = expected["mappings"].as_array().unwrap();
        assert_eq!(
            decoded.mappings.len(),
            expected_lines.len(),
            "{ctx}: line count"
        );
        for (i, (got, want)) in decoded.mappings.iter().zip(expected_lines).enumerate() {
            let want: Vec<Vec<u64>> = want
                .as_array()
                .unwrap()
                .iter()
                .map(|seg| {
                    seg.as_array()
                        .unwrap()
                        .iter()
                        .map(|n| n.as_u64().unwrap())
                        .collect()
                })
                .collect();
            let got: Vec<Vec<u64>> = got
                .iter()
                .map(|seg| seg.iter().map(|&n| u64::from(n)).collect())
                .collect();
            assert_eq!(got, want, "{ctx}: decoded line {i}");
        }
        maps += 1;
    }

    assert!(total >= 5000, "expected at least 5000 cases, got {total}");
    eprintln!(
        "magic fixtures: {total} cases ({errors} errors, {maps} maps compared) in {:?}",
        started.elapsed()
    );
}

/// 20,000 non-overlapping edits on a ~4 MB source. Not timing-asserting: it
/// only proves that nothing is quadratic (the test would otherwise take
/// minutes). The wall time is printed with `--nocapture`.
#[test]
fn twenty_thousand_edits_on_four_megabytes() {
    const EDITS: usize = 20_000;
    let line = "const value = <div class=\"a\">{x} \u{1F600} caf\u{e9}</div>;\n";
    let repeat = 4 * 1024 * 1024 / line.len() + 1;
    let source = line.repeat(repeat);
    assert!(source.len() >= 4 * 1024 * 1024);
    let line_len = line.len();
    let lines = source.len() / line_len;
    let step = lines / EDITS;
    assert!(step >= 1);

    // Positions inside each chosen line: the `<div` (ASCII) at byte 14..18.
    let mut targets = Vec::with_capacity(EDITS);
    for k in 0..EDITS {
        targets.push(k * step * line_len + 14);
    }

    let started = Instant::now();

    // Forward order.
    let mut ms = MagicString::new(source.as_str());
    for &t in &targets {
        ms.overwrite(t, t + 4, "h(\"div\"").unwrap();
        ms.append_left(t + 4, "/*l*/").unwrap();
        ms.append_right(t, "/*r*/").unwrap();
    }
    ms.prepend("// head\n");
    ms.append("\n// tail");
    let out = ms.render();
    let map = ms.generate_map(Some("big.tsx"), true);
    let forward = started.elapsed();
    assert!(out.starts_with("// head\n") && out.ends_with("\n// tail"));
    assert!(!map.mappings.is_empty());

    // Reverse order (worst case for a naive "search from the last chunk" scheme).
    let started = Instant::now();
    let mut ms = MagicString::new(source.as_str());
    for &t in targets.iter().rev() {
        ms.overwrite(t, t + 4, "h(\"div\"").unwrap();
    }
    let out2 = ms.render();
    let _ = ms.generate_decoded_map(None, false);
    let reverse = started.elapsed();
    assert!(out2.len() > source.len());

    eprintln!(
        "20,000 edits on {} bytes: forward + render + map {forward:?}, reverse + render + decoded {reverse:?}",
        source.len()
    );
}
