//! The state of one module while its JSX is compiled, and the text of nested JSX.

use std::borrow::Cow;
use std::cell::OnceCell;

use crate::bindings::unassignable_names;
use crate::fxhash::FxHashSet;

use oxc_ast::ast::ArrowFunctionBody;
use oxc_ast::ast_kind::AstKind;

use crate::error::{Result, fail_span};
use crate::fxhash::FxHashMap;
use crate::ir::Namespace;
use crate::lower::MAX_JSX_DEPTH;
use crate::registry::Registry;
use crate::tree::{NO_PARENT, NodeIx, Tree, Ty};

/// How deep nested generation (JSX inside an expression inside JSX) may go before the input is
/// refused with `JSX_TOO_DEEP`: the depth that [`MAX_JSX_DEPTH`] allows inside one tree, and the reference
/// compiler's limit across trees.
const MAX_NESTING: u32 = MAX_JSX_DEPTH;

/// A JSX root found in a program, with the node that holds it and the parentheses around it.
#[derive(Debug, Clone, Copy)]
pub struct RootSite {
    /// The JSX element or fragment.
    pub jsx: NodeIx,
    /// The root, or the outermost `ParenthesizedExpression` around it.
    pub top: NodeIx,
    /// What holds `top`; `None` when `top` is where the search started.
    pub owner: Option<NodeIx>,
}

/// What the code of one root reads before it runs: parameters of an arrow function that the root's code
/// is the body of, `((_await$, _self$) => code)(await value, this)`. The code of a root ends up inside
/// accessors, getters and methods, where `await` and `yield` are not allowed and `this` is another object.
#[derive(Default)]
struct Frame {
    names: Vec<String>,
    values: Vec<String>,
    this_name: Option<String>,
    arguments_name: Option<String>,
}

/// A piece of an expression whose text is not the source: nested JSX, or a node a local replaces.
enum Part {
    Site(RootSite),
    Local { start: u32, end: u32, text: String },
}

/// The span of the source that a root replaces, and its text.
#[derive(Debug, Clone)]
pub struct Placed {
    /// Byte offset where the replacement starts.
    pub start: u32,
    /// Byte offset where the replacement ends.
    pub end: u32,
    /// The replacement text.
    pub text: String,
}

/// Everything the lowering and the two generators share for one module.
pub struct Ctx<'t, 'a> {
    /// The module text every node position refers to.
    pub source: &'a str,
    /// The file name, used for the `id` of errors.
    pub filename: &'a str,
    /// The syntax tree.
    pub tree: &'t Tree<'a>,
    /// Imports, templates and delegated events.
    pub reg: Registry,
    /// Names of the module that are never assignable (`const`, imports); worked out on first use.
    immutable: OnceCell<FxHashSet<&'a str>>,
    /// Emit extra metadata for development builds.
    pub dev: bool,
    /// SSR only: stamp hydration keys on template roots.
    pub hydratable: bool,
    /// Generate for the server.
    pub ssr: bool,
    /// The statements of every element root that was generated as a function call,
    /// `(() => {\n<body>\n})()`; see [`Ctx::block_body`].
    pub blocks: FxHashSet<String>,
    nesting: u32,
    /// The roots being generated, innermost last.
    frames: Vec<Frame>,
    /// Nodes whose text is replaced by a local: the hoisted `await`/`yield` and the captured
    /// `this`/`arguments`.
    replaced: FxHashMap<NodeIx, String>,
    /// The generated code of every JSX root done so far, by root. A conditional child is read twice
    /// (whole, then its test and branches for the memoized form), and every read generates the JSX
    /// inside it again: without this a conditional nested n deep costs 2^n. Generating a root twice
    /// registers nothing the first time did not (templates and helpers are deduplicated), so the output
    /// is the same. The map lives for one compile and holds at most one entry per JSX node.
    generated: FxHashMap<NodeIx, String>,
}

/// The settings of a module's compilation that do not depend on the tree.
pub struct CtxSettings {
    /// Generate for the server.
    pub ssr: bool,
    /// Emit extra metadata for development builds.
    pub dev: bool,
    /// SSR only: stamp hydration keys on template roots.
    pub hydratable: bool,
}

impl<'t, 'a> Ctx<'t, 'a> {
    /// Creates the context of a module.
    #[must_use]
    pub fn new(
        source: &'a str,
        filename: &'a str,
        tree: &'t Tree<'a>,
        reg: Registry,
        settings: &CtxSettings,
    ) -> Self {
        Ctx {
            source,
            filename,
            tree,
            reg,
            immutable: OnceCell::new(),
            dev: settings.dev,
            hydratable: settings.hydratable,
            ssr: settings.ssr,
            blocks: FxHashSet::default(),
            nesting: 0,
            frames: Vec::new(),
            replaced: FxHashMap::default(),
            generated: FxHashMap::default(),
        }
    }

    /// The names of the module that can never be assigned (see [`unassignable_names`]).
    #[must_use]
    pub fn immutable(&self) -> &FxHashSet<&'a str> {
        self.immutable.get_or_init(|| unassignable_names(self.tree))
    }

    /// The source text of the byte range.
    #[must_use]
    pub fn slice(&self, start: u32, end: u32) -> &'a str {
        self.source.get(start as usize..end as usize).unwrap_or("")
    }

    /// The statements of an element root's wrapping function when `text` is exactly the call of
    /// one (`(() => {\n<body>\n})()`), else `None`.
    #[must_use]
    pub fn block_body<'s>(&self, text: &'s str) -> Option<&'s str> {
        let body = text.strip_prefix("(() => {\n")?.strip_suffix("\n})()")?;
        self.blocks.contains(body).then_some(body)
    }

    /// Finds the site of a JSX root: the parentheses around it and what holds them. `root` is the
    /// node a search started at (its parent is not looked at).
    #[must_use]
    pub fn site_of(&self, jsx: NodeIx, root: NodeIx) -> RootSite {
        let tree = self.tree;
        let mut top = jsx;
        let mut owner = if jsx == root {
            None
        } else {
            parent_of(tree, jsx)
        };
        while let Some(current) = owner {
            if tree.ty(current) != Ty::ParenthesizedExpression {
                break;
            }
            top = current;
            owner = if current == root {
                None
            } else {
                parent_of(tree, current)
            };
        }
        RootSite { jsx, top, owner }
    }

    /// Final text of an expression node with nested JSX compiled, in the HTML namespace.
    ///
    /// # Errors
    /// Fails when nested JSX is invalid, or nests deeper than this implementation handles.
    pub fn text(&mut self, node: NodeIx) -> Result<Cow<'a, str>> {
        self.text_of(node, Namespace::Html, None)
    }

    /// Final text of an expression node with nested JSX compiled; JSX in it is built in `ns`, the
    /// namespace of the element the expression sits in.
    ///
    /// # Errors
    /// Fails when nested JSX is invalid, or nests deeper than this implementation handles.
    pub fn text_in(&mut self, node: NodeIx, ns: Namespace) -> Result<Cow<'a, str>> {
        self.text_of(node, ns, None)
    }

    /// The text of an expression with its nested JSX compiled and its hoisted or captured nodes replaced
    /// by their locals. `own` is a node whose own replacement is not applied (the hoisted value itself).
    fn text_of(
        &mut self,
        node: NodeIx,
        ns: Namespace,
        own: Option<NodeIx>,
    ) -> Result<Cow<'a, str>> {
        let tree = self.tree;
        if !tree.has_jsx(node) && self.replaced.is_empty() {
            return Ok(Cow::Borrowed(self.slice(tree.start(node), tree.end(node))));
        }
        let mut parts: Vec<Part> = Vec::new();
        tree.walk(node, |current, _| {
            if Some(current) != own
                && let Some(local) = self.replaced.get(&current)
            {
                parts.push(Part::Local {
                    start: tree.start(current),
                    end: tree.end(current),
                    text: local.clone(),
                });
                return false;
            }
            if tree.ty(current).is_jsx() {
                parts.push(Part::Site(self.site_of(current, node)));
                return false;
            }
            true
        });
        let (start, end) = (tree.start(node), tree.end(node));
        if parts.is_empty() {
            return Ok(Cow::Borrowed(self.slice(start, end)));
        }
        let mut out = String::new();
        let mut position = start;
        for part in parts {
            let placed = match part {
                Part::Site(site) => self.place(&site, ns)?,
                Part::Local { start, end, text } => Placed { start, end, text },
            };
            out.push_str(self.slice(position, placed.start));
            out.push_str(&placed.text);
            position = placed.end;
        }
        out.push_str(self.slice(position, end));
        Ok(Cow::Owned(out))
    }

    /// Hoists the `await` and `yield` expressions of a root that belong to its own function.
    fn hoist_suspensions(&mut self, root: NodeIx) -> Result<()> {
        let tree = self.tree;
        let mut found: Vec<NodeIx> = Vec::new();
        tree.walk(root, |current, _| {
            let ty = tree.ty(current);
            if ty.is_function() || self.replaced.contains_key(&current) {
                return false;
            }
            if matches!(ty, Ty::AwaitExpression | Ty::YieldExpression) {
                found.push(current);
                // Whatever is awaited inside it runs in the value's own evaluation.
                return false;
            }
            true
        });
        for node in found {
            let count = self.frames.last().map_or(0, |frame| frame.names.len());
            let base = if count == 0 {
                "_await$".to_string()
            } else {
                format!("_await${}", count + 1)
            };
            let name = self.reg.local(&base);
            // The value is read where the root is written, so its text is the user's own.
            let value = self
                .text_of(node, Namespace::Html, Some(node))?
                .into_owned();
            if let Some(frame) = self.frames.last_mut() {
                frame.values.push(value);
                frame.names.push(name.clone());
            }
            self.replaced.insert(node, name);
        }
        Ok(())
    }

    /// Makes the uses of `this` and `arguments` below `node` read the locals of the root being generated,
    /// and refuses `super`, which cannot be passed on. A regular function or a class body has its own.
    ///
    /// # Errors
    /// `UNSUPPORTED_SUPER` when `node` uses `super` outside a function of its own.
    pub fn capture(&mut self, node: NodeIx) -> Result<()> {
        if self.frames.is_empty() {
            return Ok(());
        }
        enum Use {
            This,
            Arguments { shorthand: bool },
        }
        let tree = self.tree;
        let mut uses: Vec<(NodeIx, Use)> = Vec::new();
        let mut refused: Option<NodeIx> = None;
        tree.walk(node, |current, _| {
            if refused.is_some() || self.replaced.contains_key(&current) {
                return false;
            }
            let ty = tree.ty(current);
            if matches!(
                ty,
                Ty::FunctionExpression | Ty::FunctionDeclaration | Ty::ClassBody
            ) {
                return false;
            }
            match tree.node(current).kind {
                AstKind::Super(_) => refused = Some(current),
                AstKind::IdentifierReference(it) if it.name.as_str() == "arguments" => {
                    let shorthand = matches!(
                        tree.node(tree.parent(current)).kind,
                        AstKind::ObjectProperty(property) if property.shorthand
                    );
                    uses.push((current, Use::Arguments { shorthand }));
                }
                _ if ty == Ty::ThisExpression => uses.push((current, Use::This)),
                _ => {}
            }
            true
        });
        if let Some(at) = refused {
            return fail_span(
                "UNSUPPORTED_SUPER",
                "`super` cannot be used in a prop or in the children of a component: the generated props object is not the method's object. Read it into a variable first.",
                self.tree.start(at),
                self.tree.end(at),
            );
        }
        for (at, usage) in uses {
            let has = |frame: &Frame, this: bool| {
                if this {
                    frame.this_name.is_some()
                } else {
                    frame.arguments_name.is_some()
                }
            };
            let this = matches!(usage, Use::This);
            if !self.frames.last().is_some_and(|frame| has(frame, this)) {
                let name = self.reg.local(if this { "_self$" } else { "_args$" });
                if let Some(frame) = self.frames.last_mut() {
                    frame.names.push(name.clone());
                    frame
                        .values
                        .push(if this { "this" } else { "arguments" }.to_string());
                    if this {
                        frame.this_name = Some(name);
                    } else {
                        frame.arguments_name = Some(name);
                    }
                }
            }
            let name = self
                .frames
                .last()
                .and_then(|frame| {
                    if this {
                        frame.this_name.clone()
                    } else {
                        frame.arguments_name.clone()
                    }
                })
                .unwrap_or_default();
            let text = match usage {
                // `{ arguments }` is the property `arguments` read from the variable: it keeps its key.
                Use::Arguments { shorthand: true } => format!("arguments: {name}"),
                _ => name,
            };
            self.replaced.insert(at, text);
        }
        Ok(())
    }

    /// The span a JSX root replaces, and the text that replaces it. An element root that is the whole
    /// body of a function (`return <el/>;`, `() => <el/>`) replaces that body with the statements of
    /// the element, so no function is created to run them.
    ///
    /// # Errors
    /// Fails when the JSX is invalid.
    pub fn place(&mut self, site: &RootSite, ns: Namespace) -> Result<Placed> {
        let code = self.generate(site.jsx, ns)?;
        let tree = self.tree;
        if let (Some(body), Some(owner)) = (self.block_body(&code), site.owner) {
            let node = tree.node(owner);
            if node.ty == Ty::ReturnStatement {
                return Ok(Placed {
                    start: node.start,
                    end: node.end,
                    text: format!("{{\n{body}\n}}"),
                });
            }
            if let AstKind::ArrowFunctionExpression(arrow) = node.kind
                && !matches!(arrow.body, ArrowFunctionBody::FunctionBody(_))
            {
                return Ok(Placed {
                    start: tree.start(site.top),
                    end: tree.end(site.top),
                    text: format!("{{\n{body}\n}}"),
                });
            }
        }
        Ok(Placed {
            start: tree.start(site.jsx),
            end: tree.end(site.jsx),
            text: code,
        })
    }

    /// Generates the replacement expression for one JSX root.
    ///
    /// # Errors
    /// Fails when the JSX is invalid.
    pub fn generate(&mut self, jsx: NodeIx, ns: Namespace) -> Result<String> {
        if let Some(known) = self.generated.get(&jsx) {
            return Ok(known.clone());
        }
        // JSX inside an expression of JSX (`<a x={<b y={<c />} />} />`, `{ok && <b />}`) is generated while
        // its parent is, so these calls nest on the stack: this bounds the trees inside each other, as
        // `lower_jsx` bounds the depth of one tree.
        self.nesting += 1;
        let result = if self.nesting > MAX_NESTING {
            fail_span(
                "JSX_TOO_DEEP",
                format!("JSX is nested more than {MAX_NESTING} levels deep inside expressions."),
                self.tree.start(jsx),
                self.tree.end(jsx),
            )
        } else {
            self.generate_inner(jsx, ns)
        };
        self.nesting -= 1;
        if let Ok(code) = &result {
            self.generated.insert(jsx, code.clone());
        }
        result
    }

    fn generate_inner(&mut self, jsx: NodeIx, ns: Namespace) -> Result<String> {
        self.frames.push(Frame::default());
        let result = self.generate_frame(jsx, ns);
        let frame = self.frames.pop().unwrap_or_default();
        let code = result?;
        if frame.names.is_empty() {
            return Ok(code);
        }
        Ok(format!(
            "(({}) => {code})({})",
            frame.names.join(", "),
            frame.values.join(", ")
        ))
    }

    fn generate_frame(&mut self, jsx: NodeIx, ns: Namespace) -> Result<String> {
        self.hoist_suspensions(jsx)?;
        let root = self.lower_jsx(jsx, ns, 0, &mut Vec::new(), false)?;
        if self.ssr {
            self.generate_ssr(&root)
        } else {
            self.generate_dom(&root)
        }
    }
}

fn parent_of(tree: &Tree<'_>, node: NodeIx) -> Option<NodeIx> {
    let parent = tree.parent(node);
    if parent == NO_PARENT {
        None
    } else {
        Some(parent)
    }
}
