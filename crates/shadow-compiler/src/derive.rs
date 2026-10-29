//! Forgiving reactivity: inside a component, a `const` computed from reactive reads (`const double =
//! count() * 2`, `const { title } = props`) stays live wherever it is used, without a function or a
//! `useMemo`. The declaration becomes a derived value and its references read it, so `{double}` and
//! `{double()}` both work and update. Plain constants, hooks and functions are left alone. Runs as a
//! source-to-source pass before JSX compilation.

use crate::fxhash::{FxHashMap, FxHashSet};

use oxc_ast::ast::{
    ArrowFunctionBody, BindingPattern, Expression, PropertyKey, Statement, VariableDeclarationKind,
};
use oxc_ast::ast_kind::AstKind;

use crate::classify::{is_dynamic, ix_of_expression, unwrap_parens};
use crate::error::{Result, unsupported};
use crate::jsutil::{json_string, number_to_string};
use crate::origin::{Rope, SpliceEdit, splice};
use crate::store_cells::leading_end;
use crate::tree::{NO_PARENT, NodeIx, Tree, Ty};

type Edit = SpliceEdit;

/// `/^[A-Z][A-Za-z0-9_$]*$/`.
fn is_component_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z'))
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$')
}

/// The names of hooks and primitives whose result is not derived:
/// `/^(?:use|create)[A-Z]|^(?:batch|untrack|...)$/`.
fn is_hook_name(name: &str) -> bool {
    for prefix in ["use", "create"] {
        if let Some(rest) = name.strip_prefix(prefix)
            && rest.starts_with(|c: char| c.is_ascii_uppercase())
        {
            return true;
        }
    }
    matches!(
        name,
        "batch"
            | "untrack"
            | "onMount"
            | "onCleanup"
            | "onError"
            | "catchError"
            | "mapArray"
            | "indexArray"
            | "mergeProps"
            | "splitProps"
            | "children"
            | "lazy"
            | "render"
            | "hydrate"
            | "flushSync"
            | "runWithOwner"
            | "getOwner"
    )
}

/// The name of an `Identifier` or `PrivateIdentifier` node, as `str(node, "name")` reads it.
fn node_name<'a>(tree: &Tree<'a>, node: NodeIx) -> &'a str {
    match tree.node(node).kind {
        AstKind::PrivateIdentifier(it) => it.name.as_str(),
        _ => tree.name(node).unwrap_or(""),
    }
}

/// True when the initializer is a hook-like call, or an `await`/`yield`.
fn is_hook_init(tree: &Tree<'_>, init: NodeIx) -> bool {
    let root = unwrap_parens(tree, init);
    match tree.node(root).kind {
        AstKind::AwaitExpression(_) | AstKind::YieldExpression(_) => true,
        AstKind::CallExpression(call) => {
            let callee = ix_of_expression(&call.callee);
            match tree.ty(callee) {
                Ty::Identifier => is_hook_name(node_name(tree, callee)),
                Ty::MemberExpression => {
                    let property = match tree.node(callee).kind {
                        AstKind::StaticMemberExpression(member) => {
                            Some(member.property.name.as_str())
                        }
                        AstKind::PrivateFieldExpression(member) => Some(member.field.name.as_str()),
                        AstKind::ComputedMemberExpression(member) => match &member.expression {
                            Expression::Identifier(it) => Some(it.name.as_str()),
                            _ => None,
                        },
                        _ => None,
                    };
                    property.is_some_and(is_hook_name)
                }
                _ => false,
            }
        }
        _ => false,
    }
}

/// True when the subtree holds JSX anywhere, nested functions included.
fn contains_jsx_deep(tree: &Tree<'_>, node: NodeIx) -> bool {
    let end = tree.subtree_end(node);
    (node..end).any(|index| tree.ty(index).is_jsx())
}

/// The params of a function node, in order.
fn params_of(tree: &Tree<'_>, function: NodeIx) -> Vec<NodeIx> {
    tree.children(function)
        .filter(|&child| tree.is_param(child))
        .collect()
}

/// A function that is a component candidate: PascalCase name, plain function, at most one param.
struct ComponentFunction {
    node: NodeIx,
}

/// Finds PascalCase-named functions with at most one parameter.
fn components(tree: &Tree<'_>) -> Vec<ComponentFunction> {
    let mut found = Vec::new();
    let consider = |found: &mut Vec<ComponentFunction>, function: NodeIx, name: Option<&str>| {
        let Some(name) = name else {
            return;
        };
        if !is_component_name(name) || !tree.ty(function).is_function() {
            return;
        }
        let plain = match tree.node(function).kind {
            AstKind::Function(it) => !it.r#async && !it.generator,
            AstKind::ArrowFunctionExpression(it) => !it.r#async,
            _ => false,
        };
        if !plain || params_of(tree, function).len() > 1 {
            return;
        }
        found.push(ComponentFunction { node: function });
    };
    for index in 0..u32::try_from(tree.len()).unwrap_or(0) {
        let node = tree.node(index);
        match node.kind {
            AstKind::Function(function) if node.ty == Ty::FunctionDeclaration => {
                consider(
                    &mut found,
                    index,
                    function.id.as_ref().map(|id| id.name.as_str()),
                );
            }
            AstKind::VariableDeclarator(declarator) => {
                let BindingPattern::BindingIdentifier(id) = &declarator.id else {
                    continue;
                };
                let Some(init) = &declarator.init else {
                    continue;
                };
                let target = unwrap_parens(tree, ix_of_expression(init));
                if matches!(
                    tree.ty(target),
                    Ty::ArrowFunctionExpression | Ty::FunctionExpression
                ) {
                    consider(&mut found, target, Some(id.name.as_str()));
                }
            }
            _ => {}
        }
    }
    found
}

struct Candidate<'a> {
    name: &'a str,
    /// Statement/declarator context for the rewrite.
    declarator: NodeIx,
    init: Option<NodeIx>,
    from_props: Option<FromProps>,
    wrapped: bool,
    used: bool,
}

#[derive(Clone)]
struct FromProps {
    props_name: String,
    key: String,
    fallback: Option<NodeIx>,
}

#[derive(Clone, Copy)]
struct Reference {
    node: NodeIx,
    parent: NodeIx,
    callee: bool,
    in_closure: bool,
    in_jsx: bool,
}

struct Found<'a> {
    refs: FxHashMap<&'a str, Vec<Reference>>,
    redeclared: FxHashSet<&'a str>,
}

/// Adds the names bound by a pattern that the set `names` holds.
fn collect_binding_names<'a>(
    tree: &Tree<'a>,
    pattern: NodeIx,
    names: &FxHashSet<&'a str>,
    out: &mut FxHashSet<&'a str>,
) {
    let mut stack = vec![pattern];
    while let Some(node) = stack.pop() {
        match tree.ty(node) {
            Ty::Identifier => {
                if let Some(name) = tree.name(node)
                    && let Some(&known) = names.get(name)
                {
                    out.insert(known);
                }
            }
            Ty::ObjectPattern => {
                for child in tree.children(node) {
                    match tree.ty(child) {
                        Ty::RestElement => stack.push(child),
                        Ty::Property => {
                            if let Some(value) = tree.last_child(child) {
                                stack.push(value);
                            }
                        }
                        _ => {}
                    }
                }
            }
            Ty::ArrayPattern => {
                for child in tree.children(node) {
                    if matches!(
                        tree.ty(child),
                        Ty::Identifier
                            | Ty::ObjectPattern
                            | Ty::ArrayPattern
                            | Ty::AssignmentPattern
                            | Ty::RestElement
                    ) {
                        stack.push(child);
                    }
                }
            }
            Ty::AssignmentPattern => {
                if let Some(left) = tree.children(node).next() {
                    stack.push(left);
                }
            }
            Ty::RestElement => {
                if let Some(argument) = tree.children(node).next() {
                    stack.push(argument);
                }
            }
            _ => {}
        }
    }
}

/// True when `node` (an Identifier) is read as a value in its parent.
fn is_reference(tree: &Tree<'_>, node: NodeIx, parent: NodeIx) -> bool {
    let parent_node = tree.node(parent);
    match parent_node.kind {
        AstKind::StaticMemberExpression(member) => {
            // `object.property`: only the object is read.
            ix_of_expression(&member.object) == node
        }
        AstKind::ComputedMemberExpression(_) | AstKind::PrivateFieldExpression(_) => true,
        AstKind::ObjectProperty(property) => {
            tree.last_child(parent) == Some(node) || property.computed
        }
        AstKind::BindingProperty(property) => {
            tree.last_child(parent) == Some(node) || property.computed
        }
        AstKind::AssignmentTargetPropertyProperty(property) => {
            tree.last_child(parent) == Some(node) || property.computed
        }
        AstKind::AssignmentTargetPropertyIdentifier(_) => tree.last_child(parent) == Some(node),
        AstKind::VariableDeclarator(declarator) => declarator
            .init
            .as_ref()
            .is_some_and(|init| ix_of_expression(init) == node),
        AstKind::AssignmentExpression(assignment) => ix_of_expression(&assignment.right) == node,
        AstKind::UpdateExpression(_)
        | AstKind::LabeledStatement(_)
        | AstKind::BreakStatement(_)
        | AstKind::ContinueStatement(_)
        | AstKind::MethodDefinition(_)
        | AstKind::PropertyDefinition(_)
        | AstKind::ExportSpecifier(_)
        | AstKind::ImportSpecifier(_) => false,
        AstKind::ArrowFunctionExpression(arrow) => {
            !matches!(arrow.body, ArrowFunctionBody::FunctionBody(_))
                && tree.last_child(parent) == Some(node)
        }
        AstKind::Function(_) => false,
        _ => true,
    }
}

struct Frame {
    node: NodeIx,
    parent: Option<NodeIx>,
    closure: bool,
    jsx: bool,
    depth: u32,
}

/// All simple identifier references to `names` inside `root`, skipping declarations and non-references.
fn references<'a>(tree: &Tree<'a>, root: NodeIx, names: &FxHashSet<&'a str>) -> Found<'a> {
    let mut refs: FxHashMap<&'a str, Vec<Reference>> = FxHashMap::default();
    let mut redeclared: FxHashSet<&'a str> = FxHashSet::default();
    let mut stack = vec![Frame {
        node: root,
        parent: None,
        closure: false,
        jsx: false,
        depth: 0,
    }];
    while let Some(frame) = stack.pop() {
        let Frame {
            node,
            parent,
            closure,
            jsx,
            depth,
        } = frame;
        let ty = tree.ty(node);
        if ty.is_ts() && !ty.is_ts_transparent() {
            continue;
        }
        let mut child_closure = closure;
        let mut child_jsx = jsx;
        if node != root && ty.is_function() {
            child_closure = true;
            for param in params_of(tree, node) {
                collect_binding_names(tree, param, names, &mut redeclared);
            }
            if let AstKind::Function(function) = tree.node(node).kind
                && let Some(id) = &function.id
                && let Some(&known) = names.get(id.name.as_str())
            {
                redeclared.insert(known);
            }
        }
        if matches!(ty, Ty::JSXExpressionContainer | Ty::JSXSpreadAttribute) {
            child_jsx = true;
        }
        if ty == Ty::VariableDeclarator {
            // Declarations of the same name below the component's own top level shadow it.
            if closure || depth > 2 {
                collect_binding_names(tree, node + 1, names, &mut redeclared);
            }
            // The declared identifiers are not references; only the initializer is read.
            if let AstKind::VariableDeclarator(declarator) = tree.node(node).kind
                && let Some(init) = &declarator.init
            {
                stack.push(Frame {
                    node: ix_of_expression(init),
                    parent: Some(node),
                    closure: child_closure,
                    jsx: child_jsx,
                    depth: depth + 1,
                });
            }
            continue;
        }
        if matches!(ty, Ty::FunctionDeclaration | Ty::ClassDeclaration) && depth >= 1 {
            let id = match tree.node(node).kind {
                AstKind::Function(function) => function.id.as_ref().map(|id| id.name.as_str()),
                AstKind::Class(class) => class.id.as_ref().map(|id| id.name.as_str()),
                _ => None,
            };
            if let Some(name) = id
                && let Some(&known) = names.get(name)
            {
                redeclared.insert(known);
            }
        }
        if ty == Ty::CatchClause
            && let AstKind::CatchClause(clause) = tree.node(node).kind
            && clause.param.is_some()
        {
            collect_binding_names(tree, node + 1, names, &mut redeclared);
        }
        if matches!(ty, Ty::Identifier | Ty::JSXIdentifier)
            && let Some(parent) = parent
        {
            // `<ui.Button />` reads `ui`; a bare `<ui>` is an element and `ui=` an attribute name.
            let read = if ty == Ty::JSXIdentifier {
                tree.ty(parent) == Ty::JSXMemberExpression
                    && tree.children(parent).next() == Some(node)
            } else {
                is_reference(tree, node, parent)
            };
            if let Some(name) = tree.name(node)
                && let Some(&known) = names.get(name)
                && read
            {
                let callee = matches!(tree.node(parent).kind, AstKind::CallExpression(call)
                    if ix_of_expression(&call.callee) == node);
                refs.entry(known).or_default().push(Reference {
                    node,
                    parent,
                    callee,
                    in_closure: closure,
                    // A tag is part of the JSX, whatever encloses it.
                    in_jsx: jsx || ty == Ty::JSXIdentifier,
                });
            }
            continue;
        }
        if ty.is_ts_transparent() {
            let expression = match tree.node(node).kind {
                AstKind::TSAsExpression(it) => Some(ix_of_expression(&it.expression)),
                AstKind::TSSatisfiesExpression(it) => Some(ix_of_expression(&it.expression)),
                AstKind::TSNonNullExpression(it) => Some(ix_of_expression(&it.expression)),
                AstKind::TSTypeAssertion(it) => Some(ix_of_expression(&it.expression)),
                AstKind::TSInstantiationExpression(it) => Some(ix_of_expression(&it.expression)),
                _ => None,
            };
            if let Some(expression) = expression {
                stack.push(Frame {
                    node: expression,
                    parent: Some(node),
                    closure: child_closure,
                    jsx: child_jsx,
                    depth: depth + 1,
                });
            }
            continue;
        }
        // The stack pops the last child first, like the reference; the order does not matter.
        for child in tree.children(node) {
            stack.push(Frame {
                node: child,
                parent: Some(node),
                closure: child_closure,
                jsx: child_jsx,
                depth: depth + 1,
            });
        }
    }
    Found { refs, redeclared }
}

/// Top-level `return` arguments of a component (or its concise body), parentheses removed.
fn returned_expressions(tree: &Tree<'_>, body: NodeIx) -> Vec<NodeIx> {
    if tree.ty(body) != Ty::BlockStatement {
        return vec![unwrap_parens(tree, body)];
    }
    let mut out = Vec::new();
    for statement in tree.children(body) {
        if tree.ty(statement) != Ty::ReturnStatement {
            continue;
        }
        if let Some(argument) = tree.children(statement).next() {
            out.push(unwrap_parens(tree, argument));
        }
    }
    out
}

/// A component that returns `cond() ? <A /> : <B />` (or `x && <A />`) is made live: the returned
/// expression becomes an accessor, so the branch follows the condition.
fn live_return_edits(
    tree: &Tree<'_>,
    body: NodeIx,
    source: &str,
    derived_names: &FxHashSet<&str>,
) -> Vec<Edit> {
    let mut edits = Vec::new();
    for expression in returned_expressions(tree, body) {
        let (condition, branches): (NodeIx, Vec<NodeIx>) = match tree.node(expression).kind {
            AstKind::ConditionalExpression(it) => (
                ix_of_expression(&it.test),
                vec![
                    ix_of_expression(&it.consequent),
                    ix_of_expression(&it.alternate),
                ],
            ),
            AstKind::LogicalExpression(it) => (
                ix_of_expression(&it.left),
                vec![ix_of_expression(&it.right)],
            ),
            _ => continue,
        };
        if !branches
            .iter()
            .any(|&branch| contains_jsx_deep(tree, branch))
        {
            continue;
        }
        let reactive = is_dynamic(tree, condition, source)
            || (!derived_names.is_empty()
                && !references(tree, condition, derived_names).refs.is_empty());
        if !reactive {
            continue;
        }
        let (start, end) = (
            tree.start(expression) as usize,
            tree.end(expression) as usize,
        );
        edits.push(Edit::text(start, start, "() => ("));
        edits.push(Edit::text(end, end, ")"));
    }
    edits
}

struct PatternEntry<'a> {
    name: &'a str,
    key: String,
    fallback: Option<NodeIx>,
}

/// Simple `{ a, b: c, d = 1 }` patterns only; anything else (rest, nesting, computed) is left alone.
fn pattern_entries<'a>(tree: &Tree<'a>, pattern: NodeIx) -> Result<Option<Vec<PatternEntry<'a>>>> {
    let AstKind::ObjectPattern(object) = tree.node(pattern).kind else {
        return Ok(None);
    };
    if object.rest.is_some() {
        return Ok(None);
    }
    let mut out = Vec::with_capacity(object.properties.len());
    for property in &object.properties {
        if property.computed {
            return Ok(None);
        }
        let key = match &property.key {
            PropertyKey::StaticIdentifier(it) => it.name.as_str().to_string(),
            PropertyKey::StringLiteral(it) => {
                if it.lone_surrogates {
                    return unsupported("a string with a lone surrogate cannot be reproduced");
                }
                it.value.as_str().to_string()
            }
            PropertyKey::NumericLiteral(it) => number_to_string(it.value),
            PropertyKey::BigIntLiteral(_) => {
                return unsupported("a BigInt property key in a props pattern");
            }
            _ => return Ok(None),
        };
        match &property.value {
            BindingPattern::BindingIdentifier(id) => {
                out.push(PatternEntry {
                    name: id.name.as_str(),
                    key,
                    fallback: None,
                });
            }
            BindingPattern::AssignmentPattern(assignment) => {
                let BindingPattern::BindingIdentifier(id) = &assignment.left else {
                    return Ok(None);
                };
                out.push(PatternEntry {
                    name: id.name.as_str(),
                    key,
                    fallback: Some(ix_of_expression(&assignment.right)),
                });
            }
            _ => return Ok(None),
        }
    }
    Ok(Some(out))
}

/// Rewrites derived constants inside components. `import_from` is the module that exports `derived`.
/// Returns the rewritten text with where each part of it comes from, or `None` when nothing changed.
///
/// # Errors
/// Fails only with the hand-over to the reference compiler (`Unsupported`).
pub fn derive_locals<'a>(
    source: &str,
    tree: &Tree<'a>,
    program: &oxc_ast::ast::Program<'a>,
    import_from: &str,
) -> Result<Option<Rope>> {
    let mut structural: Vec<Edit> = Vec::new();
    let mut reference_edits: Vec<Edit> = Vec::new();
    let mut used = false;
    let mut changed_returns = false;

    for component in components(tree) {
        let function = component.node;
        if !contains_jsx_deep(tree, function) {
            continue;
        }
        let Some(body) = tree.last_child(function) else {
            continue;
        };
        let params = params_of(tree, function);
        let param = params.first().copied();

        // 1. Candidate declarations.
        let mut candidates: Vec<Candidate<'a>> = Vec::new();
        let mut props_name: Option<String> = None;
        // The destructured parameter that becomes `_$props`: its node and the replacement text.
        let mut param_pattern: Option<(NodeIx, Rope)> = None;
        if let Some(param) = param {
            if tree.ty(param) == Ty::Identifier {
                props_name = tree.name(param).map(str::to_string);
            }
            if tree.ty(param) == Ty::ObjectPattern
                && let Some(entries) = pattern_entries(tree, param)?
            {
                props_name = Some("_$props".to_string());
                let annotation = tree
                    .last_child(param)
                    .filter(|&child| tree.ty(child) == Ty::TSTypeAnnotation);
                let mut text = Rope::new(tree.start(param) as usize).write("_$props");
                if let Some(annotation) = annotation {
                    text = text.copy(
                        source,
                        tree.start(annotation) as usize,
                        tree.end(annotation) as usize,
                    );
                }
                for entry in entries {
                    candidates.push(Candidate {
                        name: entry.name,
                        declarator: param,
                        init: None,
                        from_props: Some(FromProps {
                            props_name: "_$props".to_string(),
                            key: entry.key,
                            fallback: entry.fallback,
                        }),
                        wrapped: true,
                        used: true,
                    });
                }
                param_pattern = Some((param, text));
            }
        }

        let statements: Vec<NodeIx> = if tree.ty(body) == Ty::BlockStatement {
            tree.children(body).collect()
        } else {
            Vec::new()
        };
        for statement in statements {
            let AstKind::VariableDeclaration(declaration) = tree.node(statement).kind else {
                continue;
            };
            if declaration.kind != VariableDeclarationKind::Const {
                continue;
            }
            for declarator_ix in tree.children(statement) {
                let AstKind::VariableDeclarator(declarator) = tree.node(declarator_ix).kind else {
                    continue;
                };
                let Some(init_expression) = &declarator.init else {
                    continue;
                };
                let init = ix_of_expression(init_expression);
                match &declarator.id {
                    BindingPattern::BindingIdentifier(id) => {
                        let target = unwrap_parens(tree, init);
                        if tree.ty(target).is_function()
                            || tree.ty(target).is_jsx()
                            || tree.ty(target) == Ty::ClassExpression
                        {
                            continue;
                        }
                        if is_hook_init(tree, init) {
                            continue;
                        }
                        candidates.push(Candidate {
                            name: id.name.as_str(),
                            declarator: declarator_ix,
                            init: Some(init),
                            from_props: None,
                            wrapped: false,
                            used: false,
                        });
                    }
                    BindingPattern::ObjectPattern(_) => {
                        let Some(props_name) = props_name.as_deref() else {
                            continue;
                        };
                        let rooted = unwrap_parens(tree, init);
                        if tree.ty(rooted) != Ty::Identifier
                            || tree.name(rooted) != Some(props_name)
                        {
                            continue;
                        }
                        let Some(entries) = pattern_entries(tree, declarator_ix + 1)? else {
                            continue;
                        };
                        for entry in entries {
                            candidates.push(Candidate {
                                name: entry.name,
                                declarator: declarator_ix,
                                init: None,
                                from_props: Some(FromProps {
                                    props_name: props_name.to_string(),
                                    key: entry.key,
                                    fallback: entry.fallback,
                                }),
                                wrapped: true,
                                used: true,
                            });
                        }
                    }
                    _ => {}
                }
            }
        }
        if candidates.is_empty() {
            let edits = live_return_edits(tree, body, source, &FxHashSet::default());
            if !edits.is_empty() {
                changed_returns = true;
            }
            structural.extend(edits);
            continue;
        }

        // 2. Which ones are read later (in JSX or in closures)? Fixpoint over dependent constants.
        let names: FxHashSet<&'a str> = candidates.iter().map(|candidate| candidate.name).collect();
        let found = references(tree, body, &names);
        // The candidates that stay, in declaration order.
        let mut by_name: Vec<usize> = Vec::new();
        let mut seen: FxHashSet<&str> = FxHashSet::default();
        for (index, candidate) in candidates.iter_mut().enumerate() {
            if found.redeclared.contains(candidate.name) || seen.contains(candidate.name) {
                candidate.wrapped = false;
                candidate.used = false;
                continue;
            }
            seen.insert(candidate.name);
            by_name.push(index);
        }
        let kept: FxHashSet<&'a str> = by_name
            .iter()
            .map(|&index| candidates[index].name)
            .collect();
        // Reactive: reads signals/props directly, or reads another reactive constant (to a fixpoint).
        let mut reactive: FxHashSet<&str> = FxHashSet::default();
        for &index in &by_name {
            let candidate = &candidates[index];
            if candidate.from_props.is_some() {
                reactive.insert(candidate.name);
            } else if let Some(init) = candidate.init
                && is_dynamic(tree, init, source)
            {
                reactive.insert(candidate.name);
            }
        }
        let mut reads_of: Vec<(&str, FxHashSet<&str>)> = Vec::new();
        for &index in &by_name {
            let candidate = &candidates[index];
            let Some(init) = candidate.init else {
                continue;
            };
            let reads: FxHashSet<&str> =
                references(tree, init, &kept).refs.keys().copied().collect();
            reads_of.push((candidate.name, reads));
        }
        loop {
            let mut grew = false;
            for (name, reads) in &reads_of {
                if reactive.contains(name) {
                    continue;
                }
                if reads.iter().any(|read| reactive.contains(read)) {
                    reactive.insert(name);
                    grew = true;
                }
            }
            if !grew {
                break;
            }
        }
        // Used: read later in JSX or a closure, or read by the initializer of a used constant.
        let mut used_names: FxHashSet<&str> = FxHashSet::default();
        for &index in &by_name {
            let candidate = &candidates[index];
            let refs_of = found.refs.get(candidate.name);
            if candidate.from_props.is_some()
                || refs_of.is_some_and(|refs| refs.iter().any(|r| r.in_jsx || r.in_closure))
            {
                used_names.insert(candidate.name);
            }
        }
        loop {
            let mut grew = false;
            let snapshot: Vec<&str> = used_names.iter().copied().collect();
            for name in snapshot {
                if let Some((_, reads)) = reads_of.iter().find(|(n, _)| *n == name) {
                    for read in reads {
                        if used_names.insert(read) {
                            grew = true;
                        }
                    }
                }
            }
            if !grew {
                break;
            }
        }
        for &index in &by_name {
            let candidate = &mut candidates[index];
            candidate.used = used_names.contains(candidate.name);
            candidate.wrapped = candidate.from_props.is_some()
                || (reactive.contains(candidate.name) && candidate.used);
        }
        let wrapped: FxHashSet<&str> = by_name
            .iter()
            .map(|&i| &candidates[i])
            .filter(|c| c.wrapped)
            .map(|c| c.name)
            .collect();
        let return_edits = live_return_edits(tree, body, source, &wrapped);
        if !return_edits.is_empty() {
            changed_returns = true;
        }
        structural.extend(return_edits);
        if wrapped.is_empty() {
            continue;
        }
        used = true;

        // 3. Reference rewrites (not inside the declaration identifiers themselves).
        for &name in &wrapped_in_order(&by_name, &candidates, &wrapped) {
            for reference in found.refs.get(name).map(Vec::as_slice).unwrap_or(&[]) {
                let parent_shorthand = match tree.node(reference.parent).kind {
                    AstKind::ObjectProperty(it) => it.shorthand,
                    AstKind::BindingProperty(it) => it.shorthand,
                    AstKind::AssignmentTargetPropertyIdentifier(_) => true,
                    _ => false,
                };
                if tree.ty(reference.parent) == Ty::Property && parent_shorthand {
                    reference_edits.push(Edit::text(
                        tree.start(reference.parent) as usize,
                        tree.end(reference.parent) as usize,
                        format!("{name}: {name}.value"),
                    ));
                } else if !reference.callee {
                    // A called reference (`double()`) is left alone: the derived value is callable itself.
                    reference_edits.push(Edit::text(
                        tree.start(reference.node) as usize,
                        tree.end(reference.node) as usize,
                        format!("{name}.value"),
                    ));
                }
            }
        }

        // 4. Declaration rewrites.
        let render = |reference_edits: &[Edit], start: usize, end: usize| -> Rope {
            splice(
                source,
                start,
                end,
                reference_edits
                    .iter()
                    .filter(|edit| edit.start >= start && edit.end <= end),
            )
        };
        let emit_derived = |candidate: &Candidate<'a>, reference_edits: &[Edit]| -> Option<Rope> {
            let out = Rope::new(tree.start(candidate.declarator) as usize);
            if !wrapped.contains(candidate.name) {
                let props = candidate.from_props.as_ref()?;
                // A shadowed name keeps plain destructuring semantics (read once).
                let access = format!("{}[{}]", props.props_name, json_string(&props.key));
                return Some(match props.fallback {
                    None => out.write(&format!("{} = {access}", candidate.name)),
                    Some(fallback) => {
                        let text = render(
                            reference_edits,
                            tree.start(fallback) as usize,
                            tree.end(fallback) as usize,
                        );
                        out.write(&format!("{} = {access} === undefined ? (", candidate.name))
                            .append(&text)
                            .write(&format!(") : {access}"))
                    }
                });
            }
            if let Some(props) = &candidate.from_props {
                let access = format!("{}[{}]", props.props_name, json_string(&props.key));
                return Some(match props.fallback {
                    None => out.write(&format!("{} = _$derived(() => {access})", candidate.name)),
                    Some(fallback) => {
                        let default = render(
                            reference_edits,
                            tree.start(fallback) as usize,
                            tree.end(fallback) as usize,
                        );
                        out.write(&format!(
                            "{} = _$derived(() => {{ const _$v = {access}; return _$v === undefined ? (",
                            candidate.name
                        ))
                        .append(&default)
                        .write(") : _$v; })")
                    }
                });
            }
            let init = candidate.init?;
            let text = render(
                reference_edits,
                tree.start(init) as usize,
                tree.end(init) as usize,
            );
            Some(
                out.write(&format!("{} = _$derived(() => (", candidate.name))
                    .append(&text)
                    .write("))"),
            )
        };
        let mut handled: FxHashSet<NodeIx> = FxHashSet::default();
        for &index in &by_name {
            let candidate = &candidates[index];
            if Some(candidate.declarator) == param {
                continue;
            }
            if handled.contains(&candidate.declarator) {
                continue;
            }
            let siblings: Vec<&Candidate<'a>> = by_name
                .iter()
                .map(|&i| &candidates[i])
                .filter(|c| c.declarator == candidate.declarator)
                .collect();
            let parts: Vec<Option<Rope>> = siblings
                .iter()
                .map(|c| emit_derived(c, &reference_edits))
                .collect();
            if parts.iter().all(Option::is_none) {
                continue;
            }
            if candidate.from_props.is_some() {
                let declarations: Vec<Rope> = parts.into_iter().flatten().collect();
                let start = tree.start(candidate.declarator) as usize;
                structural.push(Edit::rope(
                    start,
                    tree.end(candidate.declarator) as usize,
                    Rope::join(&declarations, ", ", start),
                ));
            } else if let (Some(Some(part)), Some(_init)) = (parts.first(), candidate.init) {
                structural.push(Edit::rope(
                    tree.start(candidate.declarator) as usize,
                    tree.end(candidate.declarator) as usize,
                    part.clone(),
                ));
            }
            handled.insert(candidate.declarator);
        }

        // 5. Destructured parameter: becomes `_$props`, declarations are inserted at the body start.
        if let Some((pattern, text)) = param_pattern {
            let declarations: Vec<Rope> = by_name
                .iter()
                .map(|&i| &candidates[i])
                .filter(|c| c.declarator == pattern)
                .filter_map(|c| emit_derived(c, &reference_edits))
                .collect();
            structural.push(Edit::rope(
                tree.start(pattern) as usize,
                tree.end(pattern) as usize,
                text,
            ));
            if !declarations.is_empty() {
                let body_start = tree.start(body) as usize;
                let declaration = Rope::new(body_start)
                    .write("const ")
                    .append(&Rope::join(&declarations, ", ", body_start))
                    .write(";");
                if tree.ty(body) == Ty::BlockStatement {
                    structural.push(Edit::rope(
                        body_start + 1,
                        body_start + 1,
                        Rope::new(body_start + 1)
                            .write("\n")
                            .append(&declaration)
                            .write("\n"),
                    ));
                } else {
                    structural.push(Edit::rope(
                        body_start,
                        body_start,
                        Rope::new(body_start)
                            .write("{\n")
                            .append(&declaration)
                            .write("\nreturn "),
                    ));
                    let body_end = tree.end(body) as usize;
                    structural.push(Edit::text(body_end, body_end, ";\n}"));
                }
            }
        }
    }

    if !used {
        if !changed_returns {
            return Ok(None);
        }
        return Ok(Some(splice(source, 0, source.len(), &structural)));
    }

    // Reference edits that sit inside a structural edit were already rendered into it.
    let outside: Vec<&Edit> = reference_edits
        .iter()
        .filter(|edit| {
            !structural
                .iter()
                .any(|s| edit.start >= s.start && edit.end <= s.end && s.start != s.end)
        })
        .collect();
    let import_line = format!(
        "import {{ derived as _$derived }} from {};\n",
        json_string(import_from)
    );
    let insert_at = leading_end(source, program);
    // Every edit lies after the leading directives. The import is the first edit, so where another
    // edit starts at the same offset, the import precedes it.
    let import_edit = Edit::text(
        insert_at,
        insert_at,
        if insert_at == 0 {
            import_line
        } else {
            format!("\n{import_line}")
        },
    );
    Ok(Some(splice(
        source,
        0,
        source.len(),
        std::iter::once(&import_edit)
            .chain(structural.iter())
            .chain(outside),
    )))
}

/// The wrapped names in the order of the candidates (the order the reference iterates a set built
/// from the candidates).
fn wrapped_in_order<'a>(
    by_name: &[usize],
    candidates: &[Candidate<'a>],
    wrapped: &FxHashSet<&str>,
) -> Vec<&'a str> {
    by_name
        .iter()
        .map(|&index| candidates[index].name)
        .filter(|name| wrapped.contains(name))
        .collect()
}

#[allow(dead_code)]
fn statement_is_variable(statement: &Statement<'_>) -> bool {
    matches!(statement, Statement::VariableDeclaration(_))
}

#[allow(dead_code)]
const _: u32 = NO_PARENT;
