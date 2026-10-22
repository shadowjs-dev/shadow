#![allow(clippy::panic, clippy::unwrap_used, clippy::expect_used)]
//! The ESTree view of the syntax tree must be the tree the reference compiler walks: the
//! fixtures hold, for each source of the parity corpus, the node list that `oxc-parser` returns
//! (see tools/gen-tree-fixtures.mjs).

mod common;

use oxc_allocator::Allocator;
use serde::Deserialize;
use shadow_compiler::offsets::utf16_offset;
use shadow_compiler::parse::parse;
use shadow_compiler::tree::Tree;

#[derive(Deserialize)]
struct Fixture {
    filename: String,
    source: String,
    nodes: String,
}

fn depth_of(tree: &Tree<'_>, index: u32) -> usize {
    let mut depth = 0;
    let mut current = index;
    while tree.parent(current) != u32::MAX {
        current = tree.parent(current);
        depth += 1;
    }
    depth
}

fn rust_nodes(fixture: &Fixture) -> Vec<String> {
    let allocator = Allocator::default();
    let parsed = parse(&allocator, &fixture.source, &fixture.filename);
    assert!(
        parsed.diagnostics.is_empty(),
        "{}: {:?}",
        fixture.filename,
        parsed.diagnostics
    );
    let tree = Tree::build(&parsed.program);
    (0..u32::try_from(tree.len()).unwrap_or(0))
        .map(|index| {
            format!(
                "{:?}:{}:{}:{}",
                tree.ty(index),
                utf16_offset(&fixture.source, tree.start(index) as usize),
                utf16_offset(&fixture.source, tree.end(index) as usize),
                depth_of(&tree, index)
            )
        })
        .collect()
}

#[test]
fn tree_matches_the_reference_tree() {
    let handle = std::thread::Builder::new()
        .stack_size(256 * 1024 * 1024)
        .spawn(check)
        .unwrap_or_else(|e| panic!("{e}"));
    handle
        .join()
        .unwrap_or_else(|_| panic!("tree check panicked"));
}

fn check() {
    let text = common::read_gz(&common::fixture("tree.jsonl.gz"));
    let mut checked = 0;
    let mut failures = Vec::new();
    for line in text.lines() {
        let fixture: Fixture = serde_json::from_str(line).unwrap_or_else(|e| Fixture {
            filename: format!("bad fixture: {e}"),
            source: String::new(),
            nodes: String::new(),
        });
        let expected: Vec<&str> = fixture.nodes.split(' ').collect();
        let actual = rust_nodes(&fixture);
        checked += 1;
        if expected.len() != actual.len() || expected.iter().zip(&actual).any(|(a, b)| a != b) {
            let at = expected
                .iter()
                .zip(&actual)
                .position(|(a, b)| a != b)
                .unwrap_or(0);
            failures.push(format!(
                "{}: node {at}: expected {:?}, got {:?} (expected {} nodes, got {})",
                fixture.filename,
                expected.get(at),
                actual.get(at),
                expected.len(),
                actual.len()
            ));
        }
    }
    assert!(checked > 300, "fixtures missing: {checked}");
    assert!(
        failures.is_empty(),
        "{} of {checked} differ:\n{}",
        failures.len(),
        failures
            .iter()
            .take(15)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
