//! The entry point the bindings (Node.js, WebAssembly) share: loosely typed options in, a flat
//! outcome out, and no panic or stack overflow escapes.

use std::panic::{AssertUnwindSafe, catch_unwind};

use crate::compile::{CompileFailure, Options, Target, compile};
use crate::diagnostics::CompileError;

/// Options as the bindings pass them. Every field is optional; `None` takes the default.
#[derive(Debug, Clone, Default)]
pub struct JsOptions {
    /// Module name; its extension selects the parser language.
    pub filename: Option<String>,
    /// `"ssr"` for the server target, anything else is the browser target.
    pub generate: Option<String>,
    /// Module the runtime helpers are imported from.
    pub module_name: Option<String>,
    /// Development output (only `true` enables it).
    pub dev: Option<bool>,
    /// Forgiving reactivity (only `false` disables it).
    pub auto_reactive: Option<bool>,
    /// Hot module replacement wrappers (only `true` enables it).
    pub hmr: Option<bool>,
    /// SSR hydration keys (only `false` disables them).
    pub hydratable: Option<bool>,
    /// Produce a source map (only `false` disables it).
    pub source_map: Option<bool>,
}

impl JsOptions {
    fn to_options(&self) -> Options {
        Options {
            filename: self.filename.clone(),
            generate: if self.generate.as_deref() == Some("ssr") {
                Target::Ssr
            } else {
                Target::Dom
            },
            module_name: self.module_name.clone(),
            dev: self.dev == Some(true),
            auto_reactive: self.auto_reactive != Some(false),
            hmr: self.hmr == Some(true),
            hydratable: self.hydratable != Some(false),
            source_map: self.source_map != Some(false),
        }
    }
}

/// The source map of a result, in the pieces a JavaScript `SourceMap` is built from.
#[derive(Debug, Clone)]
pub struct MapOut {
    /// `sources[0]`.
    pub source: Option<String>,
    /// The encoded mappings.
    pub mappings: String,
}

/// What a compilation came to.
#[derive(Debug, Clone)]
pub enum Outcome {
    /// Code was produced.
    Code {
        /// The module text.
        code: String,
        /// False when nothing was rewritten.
        transformed: bool,
        /// The source map, when asked for and when something was rewritten as JSX.
        map: Option<MapOut>,
    },
    /// The reference compiler throws this `CompileError`.
    Error(CompileError),
    /// The input needs the reference compiler.
    Unsupported(String),
    /// A bug of this implementation: the input needs the reference compiler.
    Internal(String),
}

/// Sources shorter than this compile on the calling thread: a module of that size cannot nest
/// deeper than half its length in bytes, and the parser needs under 2 KiB of stack per level, so
/// the stack of any thread Node.js runs JavaScript or the thread pool on is enough.
const INLINE_LIMIT: usize = 1024;

/// Bracket nesting beyond this is refused before parsing: the stack of the compile thread (1 GiB)
/// would run out for the parser's recursion, and no real module nests anywhere near it. The
/// WebAssembly build has the same limit: its host runs it on a stack of that size when the input is deep.
const MAX_BRACKET_DEPTH: usize = 150_000;

/// The deepest bracket nesting of the text, counted without regard for strings and comments (an
/// over-estimate is harmless: it only decides whether a module is refused or moved to a big stack).
fn bracket_depth(source: &str) -> usize {
    let mut depth: usize = 0;
    let mut deepest: usize = 0;
    for byte in source.bytes() {
        match byte {
            b'(' | b'[' | b'{' => {
                depth += 1;
                deepest = deepest.max(depth);
            }
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    deepest
}

fn too_deep() -> Outcome {
    Outcome::Error(CompileError {
        diagnostic: crate::diagnostics::Diagnostic {
            code: "PARSE_ERROR".to_string(),
            message: "The source is nested too deeply to compile.".to_string(),
            start: 0,
            end: 1,
            line: 1,
            column: 0,
        },
        frame: String::new(),
        id: String::new(),
    })
}

/// Compiles a module. Never panics and never overflows the stack; an input the implementation
/// cannot reproduce, or a panic, comes back as [`Outcome::Unsupported`] or [`Outcome::Internal`] so
/// the caller can hand it to the reference compiler. A module nested thousands of levels deep runs
/// on a thread with a large stack (the reference compiler's parser crashes the process long before).
#[must_use]
pub fn run(source: &str, options: &JsOptions) -> Outcome {
    if source.len() < INLINE_LIMIT {
        return run_inline(source, options);
    }
    if bracket_depth(source) > MAX_BRACKET_DEPTH {
        let mut outcome = too_deep();
        if let Outcome::Error(error) = &mut outcome {
            let id = options
                .filename
                .clone()
                .unwrap_or_else(|| "module.tsx".to_string());
            error.id = id;
            error.frame = crate::diagnostics::code_frame(source, 0);
        }
        return outcome;
    }
    run_on_large_stack(source, options)
}

#[cfg(target_arch = "wasm32")]
fn run_on_large_stack(source: &str, options: &JsOptions) -> Outcome {
    run_inline(source, options)
}

#[cfg(not(target_arch = "wasm32"))]
fn run_on_large_stack(source: &str, options: &JsOptions) -> Outcome {
    worker::submit(source, options).unwrap_or_else(|| run_inline(source, options))
}

#[cfg(not(target_arch = "wasm32"))]
mod worker {
    //! A thread with a large stack per calling thread, started on first use and reused.

    use std::cell::RefCell;
    use std::sync::mpsc::{Sender, channel};

    use super::{JsOptions, Outcome, run_inline};

    /// Stack sizes tried in turn; the memory is reserved, not committed.
    const STACKS: [usize; 3] = [1 << 30, 256 << 20, 64 << 20];

    struct Job {
        source: String,
        options: JsOptions,
        reply: Sender<Outcome>,
    }

    thread_local! {
        static WORKER: RefCell<Option<Sender<Job>>> = const { RefCell::new(None) };
    }

    fn start() -> Option<Sender<Job>> {
        for stack in STACKS {
            let (sender, receiver) = channel::<Job>();
            let spawned = std::thread::Builder::new()
                .name("shadow-compiler".to_string())
                .stack_size(stack)
                .spawn(move || {
                    while let Ok(job) = receiver.recv() {
                        let outcome = run_inline(&job.source, &job.options);
                        let _ = job.reply.send(outcome);
                    }
                });
            if spawned.is_ok() {
                return Some(sender);
            }
        }
        None
    }

    /// Runs the compilation on this thread's worker; `None` when no worker could be started.
    pub(super) fn submit(source: &str, options: &JsOptions) -> Option<Outcome> {
        WORKER.with(|cell| {
            let mut slot = cell.borrow_mut();
            for _ in 0..2 {
                if slot.is_none() {
                    *slot = start();
                }
                let sender = slot.as_ref()?;
                let (reply, answer) = channel();
                let job = Job {
                    source: source.to_string(),
                    options: options.clone(),
                    reply,
                };
                if sender.send(job).is_ok()
                    && let Ok(outcome) = answer.recv()
                {
                    return Some(outcome);
                }
                // The worker is gone (it can only die by a stack overflow handler abort, but be safe).
                *slot = None;
            }
            None
        })
    }
}

fn run_inline(source: &str, options: &JsOptions) -> Outcome {
    let options = options.to_options();
    match catch_unwind(AssertUnwindSafe(|| compile(source, &options))) {
        Ok(Ok(output)) => {
            let map = output.map.map(|map| MapOut {
                source: map.sources.first().cloned(),
                mappings: map.mappings,
            });
            Outcome::Code {
                code: output.code,
                transformed: output.transformed,
                map,
            }
        }
        Ok(Err(CompileFailure::Error(error))) => Outcome::Error(*error),
        Ok(Err(CompileFailure::Unsupported(reason))) => Outcome::Unsupported(reason),
        Err(payload) => {
            let message = payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic".to_string());
            Outcome::Internal(message)
        }
    }
}
