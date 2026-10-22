//! The state of one module while its JSX is compiled, and the text of nested JSX.

use std::borrow::Cow;
use std::cell::OnceCell;

use crate::bindings::unassignable_names;
use crate::fxhash::FxHashSet;

use oxc_ast::ast::ArrowFunctionBody;
use oxc_ast::ast_kind::AstKind;

use crate::error::{Result, unsupported};
use crate::ir::Namespace;
use crate::registry::Registry;
use crate::tree::{NO_PARENT, NodeIx, Tree, Ty};

/// How deep nested generation (JSX inside an expression inside JSX) may go before the input is handed
/// to the reference compiler. Each level uses a few kilobytes of stack.
const MAX_NESTING: u32 = 160;

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

    /// Final text of an expression node with nested JSX compiled.
    ///
    /// # Errors
    /// Fails when nested JSX is invalid, or nests deeper than this implementation handles.
    pub fn text(&mut self, node: NodeIx) -> Result<Cow<'a, str>> {
        let tree = self.tree;
        if !tree.has_jsx(node) {
            return Ok(Cow::Borrowed(self.slice(tree.start(node), tree.end(node))));
        }
        let mut nested: Vec<RootSite> = Vec::new();
        tree.walk(node, |current, _| {
            if tree.ty(current).is_jsx() {
                nested.push(self.site_of(current, node));
                return false;
            }
            true
        });
        let (start, end) = (tree.start(node), tree.end(node));
        if nested.is_empty() {
            return Ok(Cow::Borrowed(self.slice(start, end)));
        }
        let mut out = String::new();
        let mut position = start;
        for site in nested {
            let placed = self.place(&site)?;
            out.push_str(self.slice(position, placed.start));
            out.push_str(&placed.text);
            position = placed.end;
        }
        out.push_str(self.slice(position, end));
        Ok(Cow::Owned(out))
    }

    /// The span a JSX root replaces, and the text that replaces it. An element root that is the whole
    /// body of a function (`return <el/>;`, `() => <el/>`) replaces that body with the statements of
    /// the element, so no function is created to run them.
    ///
    /// # Errors
    /// Fails when the JSX is invalid.
    pub fn place(&mut self, site: &RootSite) -> Result<Placed> {
        let code = self.generate(site.jsx)?;
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
    pub fn generate(&mut self, jsx: NodeIx) -> Result<String> {
        self.nesting += 1;
        if self.nesting > MAX_NESTING {
            return unsupported("JSX nested inside expressions of JSX is too deep");
        }
        let result = self.generate_inner(jsx);
        self.nesting -= 1;
        result
    }

    fn generate_inner(&mut self, jsx: NodeIx) -> Result<String> {
        let root = self.lower_jsx(jsx, Namespace::Html, 0, &mut Vec::new(), false)?;
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
