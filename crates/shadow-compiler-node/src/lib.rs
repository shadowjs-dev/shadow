//! Node.js binding for the ShadowJS compiler.

#![allow(clippy::needless_pass_by_value)]

use napi::Result;
// Not on Apple targets: mimalloc keeps its per-thread heap in a fixed pthread slot (108 and 109) that every
// copy of it in the process shares, so a second copy of this addon (a second installed version of
// `@shadow-js/compiler`, or the npm build beside the cargo build) read the first copy's heap pointers
// and crashed on load. The system allocator has no such global state; the other platforms keep the
// ordinary thread-local variables of mimalloc, which each copy has of its own.
#[cfg(not(target_vendor = "apple"))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

use napi::bindgen_prelude::{AsyncTask, Task};
use napi_derive::napi;
use shadow_compiler::api::{Outcome, run};

/// Options of one compilation, the same as `CompileOptions` of the JavaScript compiler without the
/// plugin list.
#[napi(object)]
#[derive(Clone, Default)]
pub struct NativeOptions {
    /// Module name; its extension selects the parser language.
    pub filename: Option<String>,
    /// `"dom"` or `"ssr"`.
    pub generate: Option<String>,
    /// Module the runtime helpers are imported from.
    pub module_name: Option<String>,
    /// Development output.
    pub dev: Option<bool>,
    /// Forgiving reactivity.
    pub auto_reactive: Option<bool>,
    /// Hot module replacement wrappers.
    pub hmr: Option<bool>,
    /// SSR hydration keys.
    pub hydratable: Option<bool>,
    /// Produce a source map.
    pub source_map: Option<bool>,
}

/// The result of one compilation.
#[napi(object)]
pub struct NativeOutput {
    /// `0` code produced, `1` the reference throws a `CompileError`, `2` hand the input to the
    /// reference compiler, `3` an internal failure (hand the input to the reference compiler).
    pub kind: u32,
    /// The generated module text (`kind` 0), else empty.
    pub code: String,
    /// False when nothing was rewritten (`kind` 0).
    pub transformed: bool,
    /// Source map `sources[0]` (`kind` 0 with a map).
    pub map_source: Option<String>,
    /// Encoded source map mappings (`kind` 0 with a map).
    pub map_mappings: Option<String>,
    /// Error code (`kind` 1).
    pub error_code: Option<String>,
    /// Error message without the position (`kind` 1) or the reason (`kind` 2 and 3).
    pub error_message: Option<String>,
    /// UTF-16 offset where the error starts (`kind` 1).
    pub error_start: Option<u32>,
    /// UTF-16 offset where the error ends (`kind` 1).
    pub error_end: Option<u32>,
    /// 1-based line of the error (`kind` 1).
    pub error_line: Option<u32>,
    /// 0-based column of the error (`kind` 1).
    pub error_column: Option<u32>,
    /// Code frame of the error (`kind` 1).
    pub error_frame: Option<String>,
}

fn to_output(outcome: Outcome) -> NativeOutput {
    let mut output = NativeOutput {
        kind: 0,
        code: String::new(),
        transformed: false,
        map_source: None,
        map_mappings: None,
        error_code: None,
        error_message: None,
        error_start: None,
        error_end: None,
        error_line: None,
        error_column: None,
        error_frame: None,
    };
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
            output.error_start = u32::try_from(error.diagnostic.start).ok();
            output.error_end = u32::try_from(error.diagnostic.end).ok();
            output.error_line = u32::try_from(error.diagnostic.line).ok();
            output.error_column = u32::try_from(error.diagnostic.column).ok();
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

fn options_of(options: Option<NativeOptions>) -> shadow_compiler::api::JsOptions {
    let options = options.unwrap_or_default();
    shadow_compiler::api::JsOptions {
        filename: options.filename,
        generate: options.generate,
        module_name: options.module_name,
        dev: options.dev,
        auto_reactive: options.auto_reactive,
        hmr: options.hmr,
        hydratable: options.hydratable,
        source_map: options.source_map,
    }
}

/// Compiles a module on the calling thread.
#[napi]
pub fn compile_sync(source: String, options: Option<NativeOptions>) -> NativeOutput {
    to_output(run(&source, &options_of(options)))
}

/// A compilation that runs on the libuv thread pool.
pub struct CompileTask {
    source: String,
    options: shadow_compiler::api::JsOptions,
}

impl Task for CompileTask {
    type Output = NativeOutput;
    type JsValue = NativeOutput;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(to_output(run(&self.source, &self.options)))
    }

    fn resolve(&mut self, _env: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Compiles a module on a worker thread; the promise resolves with the result.
#[napi]
pub fn compile_async(source: String, options: Option<NativeOptions>) -> AsyncTask<CompileTask> {
    AsyncTask::new(CompileTask {
        source,
        options: options_of(options),
    })
}

/// The version of the compiler crate.
#[napi]
#[must_use]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
