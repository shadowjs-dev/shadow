#![allow(dead_code)]
//! Helpers shared by the integration tests.

use std::io::Read;

/// Reads a gzip-compressed text file, or panics with the path when it is missing or corrupt: a
/// test that cannot read its fixtures must fail.
#[allow(clippy::panic, clippy::expect_used)]
pub fn read_gz(path: &str) -> String {
    let file = std::fs::File::open(path).unwrap_or_else(|e| panic!("cannot open {path}: {e}"));
    let mut text = String::new();
    flate2::read::GzDecoder::new(file)
        .read_to_string(&mut text)
        .unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    text
}

/// Path of a fixture file of the crate.
pub fn fixture(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

/// Path of a file of the parity corpus.
pub fn corpus(name: &str) -> String {
    format!(
        "{}/../../packages/compiler/test/native/corpus/{name}",
        env!("CARGO_MANIFEST_DIR")
    )
}
