//! WebAssembly binding for the ShadowJS compiler.
//!
//! The module has no imports. The host allocates memory with [`alloc`], writes the source and the
//! options (a JSON object) into it, calls [`compile`], reads the result (a JSON object, prefixed by
//! its length as a little-endian `u32`) and frees every block with [`dealloc`].

#![allow(unsafe_code)]

use serde::{Deserialize, Serialize};
use shadow_compiler::api::{JsOptions, Outcome, run};

/// The options object the host sends.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Options {
    filename: Option<String>,
    generate: Option<String>,
    module_name: Option<String>,
    dev: Option<bool>,
    auto_reactive: Option<bool>,
    hmr: Option<bool>,
    hydratable: Option<bool>,
    source_map: Option<bool>,
}

/// The result object the host reads. The fields are the ones of the Node.js addon's output.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Output {
    kind: u32,
    code: String,
    transformed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    map_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    map_mappings: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_start: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_end: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_column: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_frame: Option<String>,
}

fn to_output(outcome: Outcome) -> Output {
    let mut output = Output::default();
    match outcome {
        Outcome::Code {
            code,
            transformed,
            map,
        } => {
            output.code = code;
            output.transformed = transformed;
            if let Some(map) = map {
                output.map_source = map.source;
                output.map_mappings = Some(map.mappings);
            }
        }
        Outcome::Error(error) => {
            output.kind = 1;
            output.error_code = Some(error.diagnostic.code);
            output.error_message = Some(error.diagnostic.message);
            output.error_start = Some(error.diagnostic.start);
            output.error_end = Some(error.diagnostic.end);
            output.error_line = Some(error.diagnostic.line);
            output.error_column = Some(error.diagnostic.column);
            output.error_frame = Some(error.frame);
        }
        Outcome::Unsupported(reason) => {
            output.kind = 2;
            output.error_message = Some(reason);
        }
        Outcome::Internal(reason) => {
            output.kind = 3;
            output.error_message = Some(reason);
        }
    }
    output
}

/// Compiles `source` with the JSON `options`; returns the JSON result.
///
/// Exposed for tests of this crate as well as for the exported entry point.
#[must_use]
pub fn compile_json(source: &str, options: &[u8]) -> Vec<u8> {
    let parsed: Options = serde_json::from_slice(options).unwrap_or_default();
    let options = JsOptions {
        filename: parsed.filename,
        generate: parsed.generate,
        module_name: parsed.module_name,
        dev: parsed.dev,
        auto_reactive: parsed.auto_reactive,
        hmr: parsed.hmr,
        hydratable: parsed.hydratable,
        source_map: parsed.source_map,
    };
    let output = to_output(run(source, &options));
    serde_json::to_vec(&output).unwrap_or_default()
}

/// Allocates `len` bytes in the module's memory for the host to write into.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut block = vec![0u8; len].into_boxed_slice();
    let pointer = block.as_mut_ptr();
    std::mem::forget(block);
    pointer
}

/// Frees a block returned by [`alloc`] or [`compile`].
///
/// # Safety
/// `pointer` and `len` must be exactly the pointer and the length of a block that this module
/// handed out and that has not been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(pointer: *mut u8, len: usize) {
    if pointer.is_null() {
        return;
    }
    // SAFETY: the caller passes back a block from `alloc` or `compile` (a boxed slice of `len` bytes).
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(pointer, len)) });
}

/// Compiles the source and returns a block holding the result: a little-endian `u32` length
/// followed by that many bytes of JSON. Free it with [`dealloc`] (its size is `4 + length`).
///
/// # Safety
/// `source` must point to `source_len` readable bytes of UTF-8 and `options` to `options_len`
/// readable bytes, both from [`alloc`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn compile(
    source: *const u8,
    source_len: usize,
    options: *const u8,
    options_len: usize,
) -> *mut u8 {
    // SAFETY: the caller guarantees both ranges are readable for their lengths.
    let (source_bytes, option_bytes) = unsafe {
        (
            std::slice::from_raw_parts(source, source_len),
            std::slice::from_raw_parts(options, options_len),
        )
    };
    let text = String::from_utf8_lossy(source_bytes);
    let json = compile_json(&text, option_bytes);
    let mut block = Vec::with_capacity(json.len() + 4);
    block.extend_from_slice(&u32::try_from(json.len()).unwrap_or(u32::MAX).to_le_bytes());
    block.extend_from_slice(&json);
    let mut boxed = block.into_boxed_slice();
    let pointer = boxed.as_mut_ptr();
    std::mem::forget(boxed);
    pointer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_a_component() {
        let json = compile_json(
            "export const A = () => <b>hi</b>;",
            br#"{"filename":"a.tsx"}"#,
        );
        let value: serde_json::Value = serde_json::from_slice(&json).unwrap_or_default();
        assert_eq!(value["kind"], 0);
        assert!(
            value["code"]
                .as_str()
                .is_some_and(|code| code.contains("_$template"))
        );
    }

    #[test]
    fn reports_errors() {
        let json = compile_json("const a = <div>;", br#"{"filename":"a.tsx"}"#);
        let value: serde_json::Value = serde_json::from_slice(&json).unwrap_or_default();
        assert_eq!(value["kind"], 1);
        assert_eq!(value["errorCode"], "PARSE_ERROR");
    }
}
