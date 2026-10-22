//! The compiler pipeline: `useStore` cells, derived constants, JSX lowering and generation, HMR.

use crate::fxhash::FxHashSet;

use oxc_allocator::Allocator;
use oxc_ast::ast::Program;

use crate::ctx::{Ctx, CtxSettings, RootSite};
use crate::derive::derive_locals;
use crate::diagnostics::{CompileError, to_compile_error_in};
use crate::error::{Failure, unsupported};
use crate::hmr::{apply_hmr, hmr_epilogue, hmr_prelude};
use crate::magic::MagicString;
use crate::origin::{Origin, Retracer, Rope};
use crate::parse::parse_module;
use crate::registry::Registry;
use crate::store_cells::{leading_end, rewrite_store_cells};
use crate::tree::{Tree, Ty};

/// Which kind of output [`compile`] produces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Target {
    /// Browser rendering (also used to hydrate server markup).
    #[default]
    Dom,
    /// Server rendering to strings.
    Ssr,
}

/// Options of [`compile`]. The same options as `CompileOptions` of the JavaScript compiler, minus the
/// plugin list (a module with plugins takes the JavaScript path).
#[derive(Debug, Clone)]
pub struct Options {
    /// Name of the module; its extension selects the parser language.
    pub filename: Option<String>,
    /// Output flavor.
    pub generate: Target,
    /// Module the generated code imports its runtime helpers from.
    pub module_name: Option<String>,
    /// Development output.
    pub dev: bool,
    /// Forgiving reactivity.
    pub auto_reactive: bool,
    /// Wrap the top-level components so an edit swaps them in place.
    pub hmr: bool,
    /// `ssr` target only: mark each template root with a hydration key.
    pub hydratable: bool,
    /// Produce a source map.
    pub source_map: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            filename: None,
            generate: Target::Dom,
            module_name: None,
            dev: false,
            auto_reactive: true,
            hmr: false,
            hydratable: true,
            source_map: true,
        }
    }
}

/// A source map from the generated code back to the module, in the pieces a JavaScript
/// `SourceMap` is built from. The map has one source (whose content is the input text) and no names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceMapOutput {
    /// `sources`: the file name, with `\\` written as `/`.
    pub sources: Vec<String>,
    /// The encoded `mappings`.
    pub mappings: String,
}

/// What [`compile`] returns.
#[derive(Debug, Clone)]
pub struct Output {
    /// The module text.
    pub code: String,
    /// Source map from `code` back to the input.
    pub map: Option<SourceMapOutput>,
    /// False when nothing was rewritten.
    pub transformed: bool,
}

/// Why [`compile`] did not produce code.
#[derive(Debug, Clone)]
pub enum CompileFailure {
    /// The reference compiler throws a `CompileError` for this input.
    Error(Box<CompileError>),
    /// This implementation does not reproduce the reference for this input; use the reference.
    Unsupported(String),
}

const JSX_HINT_FIRST: &[u8] = b"<";

/// True when the text may hold JSX: a `<` followed by a letter, `_`, `$` or `>` (`/<[A-Za-z_$>]/`).
fn has_jsx_hint(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0;
    while let Some(found) = bytes
        .get(index..)
        .and_then(|rest| rest.iter().position(|&b| b == JSX_HINT_FIRST[0]))
    {
        let at = index + found;
        if let Some(&next) = bytes.get(at + 1)
            && (next.is_ascii_alphabetic() || next == b'_' || next == b'$' || next == b'>')
        {
            return true;
        }
        index = at + 1;
    }
    false
}

/// Compiles the JSX in a module into calls to the ShadowJS runtime, and rewrites single-value
/// `useStore` calls to signal cells. It is a pure function: the output depends only on the
/// arguments. Code outside JSX keeps its exact text and position.
///
/// # Errors
/// [`CompileFailure::Error`] where the reference throws a `CompileError`, and
/// [`CompileFailure::Unsupported`] where the input needs the reference compiler.
///
/// # Examples
///
/// ```
/// use shadow_compiler::compile::{compile, Options};
///
/// let output = compile("export const A = () => <h1>Hello</h1>;", &Options::default());
/// let output = output.map_err(|_| ()).unwrap_or_else(|()| unreachable!());
/// assert!(output.transformed);
/// assert!(output.code.contains("from \"@shadow-js/web\""));
/// ```
pub fn compile(source: &str, options: &Options) -> std::result::Result<Output, CompileFailure> {
    let filename = options.filename.as_deref().unwrap_or("module.tsx");
    let mut rewrites = Rewrites::default();
    run(source, options, filename, &mut rewrites).map_err(|stage| match stage {
        StageFailure::Error { text, fail } => CompileFailure::Error(Box::new(to_compile_error_in(
            source,
            &text,
            &fail,
            filename,
            &rewrites.chain(source),
        ))),
        StageFailure::Unsupported(reason) => CompileFailure::Unsupported(reason),
    })
}

/// The two passes that rewrite the text before the JSX is compiled, as far as they have run: the
/// positions of every later stage are positions of the rewritten text, and these say where each part
/// of it comes from.
#[derive(Default)]
struct Rewrites {
    /// The `useStore` cells, read from the module.
    cells: Option<Rope>,
    /// The derived constants, read from the text after the cells.
    derived: Option<Rope>,
}

impl Rewrites {
    /// The origins of the rewrites in the order they ran.
    fn chain(&self, source: &str) -> Vec<Origin> {
        origins(source, self.cells.as_ref(), self.derived.as_ref())
    }
}

/// The origins of the rewrites of `source` in the order they ran.
fn origins(source: &str, cells: Option<&Rope>, derived: Option<&Rope>) -> Vec<Origin> {
    let mut chain = Vec::new();
    let mut old = source;
    if let Some(cells) = cells {
        chain.push(Origin::new(cells, old));
        old = cells.text();
    }
    if let Some(derived) = derived {
        chain.push(Origin::new(derived, old));
    }
    chain
}

/// A failure together with the text its offsets refer to.
enum StageFailure {
    Error {
        text: String,
        fail: crate::error::Fail,
    },
    Unsupported(String),
}

fn stage<T>(result: crate::error::Result<T>, text: &str) -> std::result::Result<T, StageFailure> {
    result.map_err(|failure| match failure {
        Failure::Error(fail) => StageFailure::Error {
            text: text.to_string(),
            fail,
        },
        Failure::Unsupported(reason) => StageFailure::Unsupported(reason),
    })
}

fn run(
    source: &str,
    options: &Options,
    filename: &str,
    rewrites: &mut Rewrites,
) -> std::result::Result<Output, StageFailure> {
    let Rewrites { cells, derived } = rewrites;
    let unchanged = |code: &str, transformed: bool| Output {
        code: code.to_string(),
        map: None,
        transformed,
    };
    // A module with no `useStore` and no `<` that could open JSX has nothing to rewrite.
    if !source.contains("useStore") && !has_jsx_hint(source) {
        return Ok(unchanged(source, false));
    }
    let target = options.generate;
    let runtime_default = if target == Target::Ssr {
        "@shadow-js/web/server"
    } else {
        "@shadow-js/web"
    };

    // Parse once. `useStore(<single value>)` calls become cell calls first; the rewrite runs on
    // modules without JSX too, which is why it is reported through `transformed` on every path.
    let first_allocator = Allocator::default();
    let first = stage(parse_module(&first_allocator, source, filename), source)?;
    let first_tree = Tree::build(&first.program);
    if source.contains("useStore") {
        *cells = rewrite_store_cells(source, &first.program, &first_tree);
    }
    let cells_changed = cells.is_some();
    // The cell rewrite is rare: after it the module is parsed again.
    let cells_allocator = Allocator::default();
    let cells_parsed;
    let cells_tree;
    let (text0, program0, tree0): (&str, &Program<'_>, &Tree<'_>) = match &*cells {
        Some(rope) => {
            let code = rope.text();
            cells_parsed = stage(parse_module(&cells_allocator, code, filename), code)?;
            cells_tree = Tree::build(&cells_parsed.program);
            (code, &cells_parsed.program, &cells_tree)
        }
        None => (source, &first.program, &first_tree),
    };
    if !has_jsx_hint(text0)
        || !(0..u32::try_from(tree0.len()).unwrap_or(0)).any(|i| tree0.ty(i).is_jsx())
    {
        return Ok(unchanged(text0, cells_changed));
    }
    if options.auto_reactive {
        let import_from = options.module_name.as_deref().unwrap_or(runtime_default);
        *derived = stage(derive_locals(text0, tree0, program0, import_from), text0)?;
    }

    // From here on `input` is the (possibly rewritten) text every node position refers to.
    let second_allocator = Allocator::default();
    let second;
    let second_tree;
    let (input, program, tree): (&str, &Program<'_>, &Tree<'_>) = match &*derived {
        Some(rope) => {
            let code = rope.text();
            second = stage(parse_module(&second_allocator, code, filename), code)?;
            second_tree = Tree::build(&second.program);
            (code, &second.program, &second_tree)
        }
        None => (text0, program0, tree0),
    };

    let mut taken: FxHashSet<String> = FxHashSet::default();
    let mut roots: Vec<crate::tree::NodeIx> = Vec::new();
    tree.walk(0, |node, _| {
        if matches!(tree.ty(node), Ty::Identifier | Ty::JSXIdentifier)
            && let Some(name) = tree.name(node)
            && (name.starts_with('_') || name.starts_with('$'))
        {
            taken.insert(name.to_string());
        }
        if tree.ty(node).is_jsx() {
            roots.push(node);
            return false;
        }
        true
    });
    if roots.is_empty() {
        return Ok(unchanged(text0, cells_changed));
    }

    let module_name = options
        .module_name
        .clone()
        .unwrap_or_else(|| runtime_default.to_string());
    let registry = Registry::new(taken, module_name);
    let settings = CtxSettings {
        ssr: target == Target::Ssr,
        dev: options.dev,
        hydratable: options.hydratable,
    };
    let mut ctx = Ctx::new(input, filename, tree, registry, &settings);

    let mut magic = MagicString::new(input);
    for root in roots {
        let site: RootSite = ctx.site_of(root, 0);
        let placed = stage(ctx.place(&site), input)?;
        if let Err(error) = magic.overwrite(placed.start as usize, placed.end as usize, placed.text)
        {
            return unsupported_stage(error.message());
        }
    }
    let hmr_runtime = format!(
        "{}/hmr",
        options.module_name.as_deref().unwrap_or("@shadow-js/web")
    );
    let mut hmr_prefix = String::new();
    let mut hmr_suffix = String::new();
    if options.hmr && target == Target::Dom {
        let result = stage(
            apply_hmr(program, tree, &mut magic, &mut ctx.reg, &hmr_runtime),
            input,
        )?;
        if result.components > 0 {
            hmr_prefix = hmr_prelude(&mut ctx.reg, &hmr_runtime, filename);
            if result.self_accepting {
                hmr_suffix = hmr_epilogue(&mut ctx.reg, &hmr_runtime);
            }
        }
    }
    let epilogue = format!("{}{hmr_suffix}", ctx.reg.epilogue());
    let prelude = format!("{}{hmr_prefix}", ctx.reg.prelude());
    let insert_at = leading_end(input, program);
    if !prelude.is_empty() {
        if insert_at == 0 {
            magic.prepend(&prelude);
        } else if let Err(error) = magic.append_left(insert_at, &format!("\n{prelude}")) {
            return unsupported_stage(error.message());
        }
    }
    if !epilogue.is_empty() {
        magic.append(&epilogue);
    }
    let map = if options.source_map {
        let generated = if cells.is_none() && derived.is_none() {
            magic.generate_map(Some(filename), false)
        } else {
            // The positions of the map are those of the rewritten text: trace them back to the module.
            let chain = origins(source, cells.as_ref(), derived.as_ref());
            magic.generate_retraced_map(Some(filename), &mut Retracer::new(&chain, input, source))
        };
        Some(SourceMapOutput {
            sources: generated.sources,
            mappings: generated.mappings,
        })
    } else {
        None
    };
    Ok(Output {
        code: magic.render(),
        map,
        transformed: true,
    })
}

fn unsupported_stage<T>(reason: &str) -> std::result::Result<T, StageFailure> {
    match unsupported::<T>(reason) {
        Err(Failure::Unsupported(reason)) => Err(StageFailure::Unsupported(reason)),
        _ => Err(StageFailure::Unsupported(reason.to_string())),
    }
}
