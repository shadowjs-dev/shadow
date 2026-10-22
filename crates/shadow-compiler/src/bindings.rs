//! Names of a module that can never be assigned.

use crate::fxhash::FxHashSet;

use oxc_ast::ast::VariableDeclarationKind;
use oxc_ast::ast_kind::AstKind;

use crate::tree::{NodeIx, Tree, Ty};

/// Adds the name of every `Identifier` in the subtree of `pattern` (the declaration's pattern, its
/// default values and its type annotation).
fn add_pattern<'a>(tree: &Tree<'a>, into: &mut FxHashSet<&'a str>, pattern: NodeIx) {
    let end = tree.subtree_end(pattern);
    for index in pattern..end {
        if tree.ty(index) == Ty::Identifier
            && let Some(name) = tree.name(index)
        {
            into.insert(name);
        }
    }
}

/// The names that can never be assigned: bindings declared `const` and imports, unless the same name
/// is also declared assignable (`let`, `var`, a parameter, a function or class name) anywhere in the
/// file. Scopes are not resolved, so a name declared in two places counts as assignable. The compiler
/// uses it to emit a `ref` assignment only where one is legal: assigning a `const` is a compile error
/// in the bundler, even in a branch that never runs.
#[must_use]
pub fn unassignable_names<'a>(tree: &Tree<'a>) -> FxHashSet<&'a str> {
    let mut constant: FxHashSet<&'a str> = FxHashSet::default();
    let mut assignable: FxHashSet<&'a str> = FxHashSet::default();
    for index in 0..u32::try_from(tree.len()).unwrap_or(0) {
        let node = tree.node(index);
        match node.ty {
            Ty::VariableDeclarator => {
                let parent = tree.parent(index);
                let is_const = matches!(
                    tree.node(parent).kind,
                    AstKind::VariableDeclaration(declaration)
                        if declaration.kind == VariableDeclarationKind::Const
                );
                let target = if is_const {
                    &mut constant
                } else {
                    &mut assignable
                };
                add_pattern(tree, target, index + 1);
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
                        add_pattern(tree, &mut constant, local);
                    }
                }
            }
            Ty::FunctionDeclaration | Ty::FunctionExpression | Ty::ArrowFunctionExpression => {
                if let AstKind::Function(function) = node.kind
                    && let Some(id) = &function.id
                {
                    assignable.insert(id.name.as_str());
                }
                for child in tree.children(index) {
                    if tree.is_param(child) {
                        add_pattern(tree, &mut assignable, child);
                    }
                }
            }
            Ty::ClassDeclaration | Ty::ClassExpression => {
                if let AstKind::Class(class) = node.kind
                    && let Some(id) = &class.id
                {
                    assignable.insert(id.name.as_str());
                }
            }
            Ty::CatchClause => {
                if let AstKind::CatchClause(clause) = node.kind
                    && clause.param.is_some()
                {
                    add_pattern(tree, &mut assignable, index + 1);
                }
            }
            _ => {}
        }
    }
    constant
        .into_iter()
        .filter(|name| !assignable.contains(name))
        .collect()
}
