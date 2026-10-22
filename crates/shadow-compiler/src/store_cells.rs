//! Pay for what you use: `useStore(<single value>)` builds a reactive cell, and a cell needs none of
//! the deep store (the proxies, the reconciler, the draft transactions). When the initial value is a
//! primitive, `null`, `undefined`, a function or a `Date`, the call is rewritten to the cell path:
//! `useSignal` from `@shadow-js/core`, the primitive `useStore` builds its cell from.
//!
//! Only calls of `useStore` imported from `@shadow-js/core` (or its `/store` entry, or as a namespace
//! member) are rewritten. A name bound more than once in the module (a shadowing parameter, a second
//! import) is left alone, and so is a wrapper re-exported from another package.

use crate::fxhash::{FxHashMap, FxHashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, Expression, ImportDeclarationSpecifier, ImportOrExportKind, ModuleExportName,
    ObjectPropertyKind, PropertyKey, PropertyKind, Statement, TSType, UnaryOperator,
};
use oxc_ast::ast_kind::AstKind;

use crate::classify::ix_of_expression;
use crate::error::Result;
use crate::origin::{Rope, SpliceEdit, splice};
use crate::parse::parse_module;
use crate::tree::{NodeIx, Tree, Ty};

const CORE: &str = "@shadow-js/core";
const ALIAS: &str = "useShadowSignal";

/// Result of the pass: the rewritten text, and whether any call was rewritten.
#[derive(Debug, Clone)]
pub struct StoreCellResult {
    /// The module text.
    pub code: String,
    /// True when at least one call was rewritten.
    pub changed: bool,
}

/// How many times each name is bound in the module: declarations, parameters, function and class
/// names, catch parameters and import bindings. A name bound once (by its import) is unshadowed.
/// Scopes are not resolved, so a repeated name counts as shadowed, which is the safe answer.
fn binding_counts<'a>(tree: &Tree<'a>) -> FxHashMap<&'a str, u32> {
    let mut counts: FxHashMap<&'a str, u32> = FxHashMap::default();
    let bind = |counts: &mut FxHashMap<&'a str, u32>, pattern: NodeIx| {
        let end = tree.subtree_end(pattern);
        for index in pattern..end {
            if tree.ty(index) == Ty::Identifier
                && let Some(name) = tree.name(index)
            {
                *counts.entry(name).or_insert(0) += 1;
            }
        }
    };
    for index in 0..u32::try_from(tree.len()).unwrap_or(0) {
        let node = tree.node(index);
        match node.ty {
            Ty::VariableDeclarator => bind(&mut counts, index + 1),
            Ty::FunctionDeclaration
            | Ty::FunctionExpression
            | Ty::ArrowFunctionExpression
            | Ty::ClassDeclaration
            | Ty::ClassExpression => {
                let id = match node.kind {
                    AstKind::Function(function) => function.id.as_ref().map(|id| id.name.as_str()),
                    AstKind::Class(class) => class.id.as_ref().map(|id| id.name.as_str()),
                    _ => None,
                };
                if let Some(name) = id {
                    *counts.entry(name).or_insert(0) += 1;
                }
                for child in tree.children(index) {
                    if tree.is_param(child) {
                        bind(&mut counts, child);
                    }
                }
            }
            Ty::CatchClause => {
                if let AstKind::CatchClause(clause) = node.kind
                    && clause.param.is_some()
                {
                    bind(&mut counts, index + 1);
                }
            }
            Ty::ImportDeclaration => {
                for child in tree.children(index) {
                    if matches!(
                        tree.node(child).kind,
                        AstKind::ImportSpecifier(_)
                            | AstKind::ImportDefaultSpecifier(_)
                            | AstKind::ImportNamespaceSpecifier(_)
                    ) && let Some(local) = tree.last_child(child)
                    {
                        bind(&mut counts, local);
                    }
                }
            }
            _ => {}
        }
    }
    counts
}

/// The names under which `useStore` is reachable from the core module: named and namespace imports.
fn imported_names<'a>(
    program: &'a oxc_ast::ast::Program<'a>,
) -> (FxHashSet<&'a str>, FxHashSet<&'a str>) {
    let mut named = FxHashSet::default();
    let mut namespaces = FxHashSet::default();
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind == ImportOrExportKind::Type {
            continue;
        }
        let source = declaration.source.value.as_str();
        if source != CORE && source != "@shadow-js/core/store" {
            continue;
        }
        let Some(specifiers) = &declaration.specifiers else {
            continue;
        };
        for specifier in specifiers {
            match specifier {
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(it) => {
                    namespaces.insert(it.local.name.as_str());
                }
                ImportDeclarationSpecifier::ImportSpecifier(it) => {
                    if it.import_kind == ImportOrExportKind::Type {
                        continue;
                    }
                    let imported = match &it.imported {
                        ModuleExportName::IdentifierName(name) => name.name.as_str(),
                        ModuleExportName::IdentifierReference(name) => name.name.as_str(),
                        ModuleExportName::StringLiteral(literal) => literal.value.as_str(),
                    };
                    if imported == "useStore" {
                        named.insert(it.local.name.as_str());
                    }
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {}
            }
        }
    }
    (named, namespaces)
}

/// True for a call's type arguments that keep it on the cell path (none, or one primitive keyword).
fn cell_type_arguments(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    let Some(arguments) = &call.type_arguments else {
        return true;
    };
    matches!(
        arguments.params.as_slice(),
        [TSType::TSNumberKeyword(_)
            | TSType::TSStringKeyword(_)
            | TSType::TSBooleanKeyword(_)
            | TSType::TSBigIntKeyword(_)
            | TSType::TSSymbolKeyword(_)
            | TSType::TSNullKeyword(_)
            | TSType::TSUndefinedKeyword(_)]
    )
}

/// True for an options argument that carries only `name` (the one option a cell uses).
fn name_only_options(argument: &Argument<'_>) -> bool {
    let Argument::ObjectExpression(object) = argument else {
        return false;
    };
    object.properties.iter().all(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if property.kind != PropertyKind::Init || property.computed || property.method {
            return false;
        }
        match &property.key {
            PropertyKey::StaticIdentifier(key) => key.name.as_str() == "name",
            PropertyKey::StringLiteral(key) => key.value.as_str() == "name",
            _ => false,
        }
    })
}

/// True when the initial value is a single value at run time whatever the expression evaluates to:
/// a primitive, `null`, `undefined`, a function or a `Date`.
fn is_cell_initial(argument: &Argument<'_>, counts: &FxHashMap<&str, u32>) -> bool {
    match argument {
        Argument::NumericLiteral(_)
        | Argument::StringLiteral(_)
        | Argument::BooleanLiteral(_)
        | Argument::NullLiteral(_)
        | Argument::BigIntLiteral(_)
        | Argument::TemplateLiteral(_)
        | Argument::ArrowFunctionExpression(_)
        | Argument::FunctionExpression(_) => true,
        Argument::UnaryExpression(unary) => {
            matches!(
                unary.operator,
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus
            ) && matches!(
                &unary.argument,
                Expression::NumericLiteral(_) | Expression::BigIntLiteral(_)
            )
        }
        Argument::Identifier(identifier) => {
            identifier.name.as_str() == "undefined"
                && counts.get("undefined").copied().unwrap_or(0) == 0
        }
        Argument::NewExpression(new) => {
            matches!(&new.callee, Expression::Identifier(callee) if callee.name.as_str() == "Date")
                && counts.get("Date").copied().unwrap_or(0) == 0
        }
        _ => false,
    }
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// True when `word` occurs in `source` with a word boundary on both sides (`/\bword\b/`).
fn contains_word(source: &str, word: &str) -> bool {
    let mut from = 0;
    while let Some(found) = source.get(from..).and_then(|rest| rest.find(word)) {
        let start = from + found;
        let end = start + word.len();
        let before = source
            .get(..start)
            .and_then(|head| head.chars().next_back());
        let after = source.get(end..).and_then(|tail| tail.chars().next());
        let boundary_before = before.is_none_or(|c| !is_word(c));
        let boundary_after = after.is_none_or(|c| !is_word(c));
        if boundary_before && boundary_after {
            return true;
        }
        from = start + 1;
        while !source.is_char_boundary(from) {
            from += 1;
        }
    }
    false
}

/// A name for the rewritten call that no identifier of the module already uses.
fn alias_for(source: &str) -> String {
    let mut alias = ALIAS.to_string();
    let mut n = 2;
    while contains_word(source, &alias) {
        alias = format!("{ALIAS}{n}");
        n += 1;
    }
    alias
}

/// Offset just after a shebang and the directive prologue of a module (`"use client";`). Code that
/// is added at the top of a module goes here, so the directives keep their meaning.
#[must_use]
pub fn leading_end(source: &str, program: &oxc_ast::ast::Program<'_>) -> usize {
    let mut end = 0;
    if source.starts_with("#!") {
        end = source
            .find('\n')
            .map_or(source.len(), |newline| newline + 1);
    }
    if let Some(last) = program.directives.last() {
        end = end.max(last.span.end as usize);
    }
    end
}

/// Rewrites `useStore(<single value>)` calls of the core module to the cell path. Returns the source
/// unchanged (and `changed: false`) when no call qualifies.
///
/// # Errors
/// Fails with `PARSE_ERROR` when the module does not parse.
pub fn specialize_store_cells(source: &str, filename: &str) -> Result<StoreCellResult> {
    if !source.contains("useStore") {
        return Ok(StoreCellResult {
            code: source.to_string(),
            changed: false,
        });
    }
    let allocator = Allocator::default();
    let parsed = parse_module(&allocator, source, filename)?;
    let tree = Tree::build(&parsed.program);
    Ok(match rewrite_store_cells(source, &parsed.program, &tree) {
        Some(rope) => StoreCellResult {
            code: rope.into_text(),
            changed: true,
        },
        None => StoreCellResult {
            code: source.to_string(),
            changed: false,
        },
    })
}

/// The rewritten text of a parsed module (with where each part of it comes from), or `None` when no
/// call qualifies.
#[must_use]
pub fn rewrite_store_cells<'a>(
    source: &str,
    program: &oxc_ast::ast::Program<'a>,
    tree: &Tree<'a>,
) -> Option<Rope> {
    let (named, namespaces) = imported_names(program);
    if named.is_empty() && namespaces.is_empty() {
        return None;
    }
    let counts = binding_counts(tree);
    let bound = |name: &str| counts.get(name).copied() == Some(1);
    let mut callees: Vec<(usize, usize)> = Vec::new();
    for index in 0..u32::try_from(tree.len()).unwrap_or(0) {
        let AstKind::CallExpression(call) = tree.node(index).kind else {
            continue;
        };
        if call.optional {
            continue;
        }
        let qualifies = match &call.callee {
            Expression::Identifier(callee) => {
                named.contains(callee.name.as_str()) && bound(callee.name.as_str())
            }
            Expression::StaticMemberExpression(member) => {
                !member.optional
                    && matches!(&member.object, Expression::Identifier(object)
                        if namespaces.contains(object.name.as_str()) && bound(object.name.as_str()))
                    && member.property.name.as_str() == "useStore"
            }
            _ => false,
        };
        if !qualifies || !cell_type_arguments(call) {
            continue;
        }
        let [initial, rest @ ..] = call.arguments.as_slice() else {
            continue;
        };
        if rest.len() > 1 {
            continue;
        }
        if let Some(options) = rest.first()
            && !name_only_options(options)
        {
            continue;
        }
        if !is_cell_initial(initial, &counts) {
            continue;
        }
        let callee = ix_of_expression(&call.callee);
        callees.push((tree.start(callee) as usize, tree.end(callee) as usize));
    }
    if callees.is_empty() {
        return None;
    }

    let alias = alias_for(source);
    let insert_at = leading_end(source, program);
    let import_line = format!("import {{ useSignal as {alias} }} from \"{CORE}\";");
    // Start of a line (or of the module): the import takes the line. After a directive: a new line first.
    let starts_line = insert_at == 0 || source.as_bytes().get(insert_at - 1) == Some(&b'\n');
    // The import is the first edit: where a call starts at the same offset, the import precedes it.
    let mut all = vec![SpliceEdit::text(
        insert_at,
        insert_at,
        if starts_line {
            format!("{import_line}\n")
        } else {
            format!("\n{import_line}")
        },
    )];
    all.extend(
        callees
            .into_iter()
            .map(|(start, end)| SpliceEdit::text(start, end, alias.as_str())),
    );
    Some(splice(source, 0, source.len(), &all))
}
