//! Hot module replacement: wraps top-level component definitions in stable proxies and appends the
//! refresh registration, so editing a component swaps it in place instead of reloading the page.
//! Modules that export anything other than components are left to the bundler's normal propagation
//! (their importers reload).

use std::collections::HashSet;

use oxc_ast::ast::{
    BindingPattern, Declaration, ExportDefaultDeclarationKind, Expression, Function, FunctionType,
    ImportOrExportKind, ModuleExportName, Program, Statement, VariableDeclaration,
};

use crate::classify::{ix_of_expression, node_ix};
use crate::error::{Result, unsupported};
use crate::jsutil::json_string;
use crate::magic::MagicString;
use crate::registry::Registry;
use crate::tree::{NodeIx, Tree, Ty};

/// `/^[A-Z][A-Za-z0-9_$]*$/`.
fn is_component_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z'))
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$')
}

/// What `apply_hmr` found.
#[derive(Debug, Clone, Copy)]
pub struct HmrResult {
    /// True when the module exports only components (and types) and can accept its own update.
    pub self_accepting: bool,
    /// Number of components wrapped.
    pub components: usize,
}

enum Placement {
    /// Wrap the initializer in place: its byte range.
    Init(usize, usize),
    /// Append `Name = wrap(Name)` after the statement that ends here.
    After(usize),
}

struct Declared {
    name: String,
    /// The function itself, which the component test reads.
    function: NodeIx,
    /// True when an `export` declares it, which a function that is left unwrapped must still report.
    exported: bool,
    placement: Placement,
}

/// A function a framework can treat as a component: at most one parameter, plain function.
fn is_component_function(function: &Expression<'_>) -> bool {
    match function {
        Expression::ArrowFunctionExpression(it) => {
            !it.r#async && it.params.items.len() + usize::from(it.params.rest.is_some()) <= 1
        }
        Expression::FunctionExpression(it) => is_plain_function(it),
        _ => false,
    }
}

fn is_plain_function(function: &Function<'_>) -> bool {
    !function.r#async
        && !function.generator
        && function.params.items.len()
            + usize::from(function.params.rest.is_some())
            + usize::from(function.this_param.is_some())
            <= 1
}

fn collect_function(
    function: &Function<'_>,
    out: &mut Vec<Declared>,
    others: &mut Vec<String>,
    end: usize,
) {
    let name = function.id.as_ref().map(|id| id.name.as_str());
    if function.r#type != FunctionType::FunctionDeclaration {
        return;
    }
    match name {
        Some(name) if is_component_name(name) && is_plain_function(function) => {
            out.push(Declared {
                name: name.to_string(),
                function: node_ix(function.node_id()),
                exported: false,
                placement: Placement::After(end),
            });
        }
        Some(name) => others.push(name.to_string()),
        None => {}
    }
}

fn collect_variables(
    tree: &Tree<'_>,
    declaration: &VariableDeclaration<'_>,
    out: &mut Vec<Declared>,
    others: &mut Vec<String>,
) {
    for declarator in &declaration.declarations {
        let name = match &declarator.id {
            BindingPattern::BindingIdentifier(id) => Some(id.name.as_str()),
            _ => None,
        };
        match (name, &declarator.init) {
            (None, _) => others.push("<pattern>".to_string()),
            (Some(name), Some(init)) if is_component_name(name) && is_component_function(init) => {
                let init_ix: NodeIx = ix_of_expression(init);
                out.push(Declared {
                    name: name.to_string(),
                    function: init_ix,
                    exported: false,
                    placement: Placement::Init(
                        tree.start(init_ix) as usize,
                        tree.end(init_ix) as usize,
                    ),
                });
            }
            (Some(name), _) => others.push(name.to_string()),
        }
    }
}

fn collect_declaration(
    tree: &Tree<'_>,
    declaration: &Declaration<'_>,
    end: usize,
    out: &mut Vec<Declared>,
    others: &mut Vec<String>,
) {
    match declaration {
        Declaration::FunctionDeclaration(function) => collect_function(function, out, others, end),
        Declaration::VariableDeclaration(variables) => {
            collect_variables(tree, variables, out, others)
        }
        _ => {}
    }
}

fn declaration_names(declaration: &Declaration<'_>) -> Vec<String> {
    match declaration {
        Declaration::FunctionDeclaration(function) => function
            .id
            .as_ref()
            .map(|id| id.name.as_str().to_string())
            .into_iter()
            .collect(),
        Declaration::ClassDeclaration(class) => class
            .id
            .as_ref()
            .map(|id| id.name.as_str().to_string())
            .into_iter()
            .collect(),
        Declaration::VariableDeclaration(variables) => variables
            .declarations
            .iter()
            .map(|declarator| match &declarator.id {
                BindingPattern::BindingIdentifier(id) => id.name.as_str().to_string(),
                _ => "<pattern>".to_string(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn is_type_only(declaration: &Declaration<'_>) -> bool {
    matches!(
        declaration,
        Declaration::TSInterfaceDeclaration(_)
            | Declaration::TSTypeAliasDeclaration(_)
            | Declaration::TSEnumDeclaration(_)
            | Declaration::TSExternalModuleDeclaration(_)
            | Declaration::TSNamespaceDeclaration(_)
            | Declaration::TSGlobalDeclaration(_)
    )
}

/// An `enum` or `namespace` that exists at run time (`declare` ones are types only).
fn is_runtime_namespace(declaration: &Declaration<'_>) -> bool {
    match declaration {
        Declaration::TSEnumDeclaration(it) => !it.declare,
        Declaration::TSExternalModuleDeclaration(it) => !it.declare,
        Declaration::TSNamespaceDeclaration(it) => !it.declare,
        Declaration::TSGlobalDeclaration(it) => !it.declare,
        _ => false,
    }
}

/// The expression a parenthesis or a TypeScript wrapper (`as`, `satisfies`, `!`) holds, repeatedly.
fn bare(tree: &Tree<'_>, node: NodeIx) -> NodeIx {
    let mut current = node;
    while matches!(
        tree.ty(current),
        Ty::ParenthesizedExpression
            | Ty::TSAsExpression
            | Ty::TSSatisfiesExpression
            | Ty::TSNonNullExpression
    ) {
        match tree.children(current).next() {
            Some(inner) => current = inner,
            None => break,
        }
    }
    current
}

/// The name of an identifier node, else `None`.
fn identifier_name<'a>(tree: &Tree<'a>, node: NodeIx) -> Option<&'a str> {
    if tree.ty(node) == Ty::Identifier {
        tree.name(node)
    } else {
        None
    }
}

/// True when `function` reads `this` (its own, or the one it closes over, through arrows). A regular
/// function or a class body has a `this` of its own.
fn uses_this(tree: &Tree<'_>, function: NodeIx) -> bool {
    let mut found = false;
    tree.walk(function, |node, _| {
        if found {
            return false;
        }
        let ty = tree.ty(node);
        if ty == Ty::ThisExpression {
            found = true;
            return false;
        }
        node == function
            || !matches!(
                ty,
                Ty::FunctionExpression | Ty::FunctionDeclaration | Ty::ClassBody
            )
    });
    found
}

/// The expressions `function` returns: an arrow's expression body, and the argument of each
/// `return` that belongs to `function`.
fn returned(tree: &Tree<'_>, function: NodeIx) -> Vec<NodeIx> {
    let Some(body) = tree.last_child(function) else {
        return Vec::new();
    };
    if tree.ty(body) != Ty::BlockStatement {
        return vec![body];
    }
    let mut out = Vec::new();
    tree.walk(body, |node, _| {
        let ty = tree.ty(node);
        if ty == Ty::ReturnStatement {
            if let Some(argument) = tree.last_child(node) {
                out.push(argument);
            }
            return false;
        }
        !ty.is_function() && ty != Ty::ClassBody
    });
    out
}

/// The names of the functions `expression` can evaluate to the call of (`cond ? A({}) : B({})`).
fn called_components(tree: &Tree<'_>, expression: NodeIx, names: &mut HashSet<String>) {
    let mut pending = vec![expression];
    while let Some(next) = pending.pop() {
        let node = bare(tree, next);
        match tree.ty(node) {
            Ty::ConditionalExpression => {
                // Children are the test, the consequent and the alternate.
                pending.extend(tree.children(node).skip(1));
            }
            Ty::LogicalExpression => pending.extend(tree.children(node)),
            Ty::SequenceExpression => pending.extend(tree.last_child(node)),
            Ty::CallExpression => {
                if let Some(callee) = tree.children(node).next()
                    && let Some(name) = identifier_name(tree, bare(tree, callee))
                {
                    names.insert(name.to_string());
                }
            }
            _ => {}
        }
    }
}

/// The root name of a tag: `Foo` for `<Foo>` and for `<Foo.Bar.Baz>`.
fn tag_root<'a>(tree: &Tree<'a>, name: NodeIx) -> Option<&'a str> {
    let mut current = name;
    while tree.ty(current) == Ty::JSXMemberExpression {
        current = tree.children(current).next()?;
    }
    if tree.ty(current) == Ty::JSXIdentifier {
        tree.name(current)
    } else {
        None
    }
}

/// The names of the functions declared at the top level of the module (exported or not) that hold JSX.
fn rendering_functions(program: &Program<'_>, tree: &Tree<'_>) -> Vec<String> {
    fn from_variables(
        tree: &Tree<'_>,
        variables: &VariableDeclaration<'_>,
        names: &mut Vec<String>,
    ) {
        for declarator in &variables.declarations {
            if let BindingPattern::BindingIdentifier(id) = &declarator.id
                && let Some(init) = &declarator.init
                && matches!(
                    init,
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
                && tree.has_jsx(ix_of_expression(init))
            {
                names.push(id.name.as_str().to_string());
            }
        }
    }
    fn from_function(tree: &Tree<'_>, function: &Function<'_>, names: &mut Vec<String>) {
        if function.r#type == FunctionType::FunctionDeclaration
            && let Some(id) = &function.id
            && tree.has_jsx(node_ix(function.node_id()))
        {
            names.push(id.name.as_str().to_string());
        }
    }
    let mut names = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::FunctionDeclaration(function) => from_function(tree, function, &mut names),
            Statement::VariableDeclaration(variables) => {
                from_variables(tree, variables, &mut names)
            }
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::FunctionDeclaration(function) => {
                    from_function(tree, function, &mut names);
                }
                Declaration::VariableDeclaration(variables) => {
                    from_variables(tree, variables, &mut names);
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export) => {
                if let ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                    &export.declaration
                {
                    from_function(tree, function, &mut names);
                }
            }
            _ => {}
        }
    }
    names
}

/// Which of the declared functions are components. A function that is called with `new` or reads
/// `this` is a constructor or a method, and one that neither holds JSX nor is a tag of this module nor
/// returns the call of a component cannot be told from a helper (`const Total = (n) => n * 2`):
/// wrapping it would make `Total(2)` return a function. Those stay as written, so they behave in
/// development as in a build. What the pass loses is the hot update of a component that hides all
/// three (one that only returns `props.children` and is used as a tag by another module).
fn keep_components(program: &Program<'_>, tree: &Tree<'_>, declared: &[Declared]) -> Vec<bool> {
    let mut constructed: HashSet<&str> = HashSet::new();
    let mut tags: HashSet<&str> = HashSet::new();
    tree.walk(0, |node, _| {
        match tree.ty(node) {
            Ty::NewExpression => {
                if let Some(callee) = tree.children(node).next()
                    && let Some(name) = identifier_name(tree, bare(tree, callee))
                {
                    constructed.insert(name);
                }
            }
            Ty::JSXOpeningElement => {
                if let Some(name) = tree.children(node).next()
                    && let Some(root) = tag_root(tree, name)
                {
                    tags.insert(root);
                }
            }
            _ => {}
        }
        true
    });
    // A function of the module that renders (holds JSX) is what a component returns the call of,
    // whatever its name or parameters are.
    let mut known: HashSet<String> = rendering_functions(program, tree).into_iter().collect();
    let mut kept = vec![false; declared.len()];
    let mut calls: Vec<(usize, HashSet<String>)> = Vec::new();
    for (position, component) in declared.iter().enumerate() {
        if constructed.contains(component.name.as_str()) || uses_this(tree, component.function) {
            continue;
        }
        if tree.has_jsx(component.function) || tags.contains(component.name.as_str()) {
            kept[position] = true;
            known.insert(component.name.clone());
            continue;
        }
        let mut names = HashSet::new();
        for expression in returned(tree, component.function) {
            called_components(tree, expression, &mut names);
        }
        calls.push((position, names));
    }
    // A returned call makes a component of its caller; a chain of them settles in at most one pass per link.
    let mut changed = true;
    while changed {
        changed = false;
        for (position, names) in &calls {
            if kept[*position] {
                continue;
            }
            if names.iter().any(|name| known.contains(name)) {
                kept[*position] = true;
                known.insert(declared[*position].name.clone());
                changed = true;
            }
        }
    }
    kept
}

/// Variable holding this module's registry, declared by [`hmr_prelude`].
pub fn hot_reg(registry: &mut Registry) -> String {
    registry.local("_$$reg")
}

/// Prelude statement creating the module registry.
pub fn hmr_prelude(registry: &mut Registry, runtime_module: &str, filename: &str) -> String {
    let local = hot_reg(registry);
    let helper = registry.helper_from("registry", Some(runtime_module));
    format!(
        "const {local} = {helper}(import.meta.hot, {});\n",
        json_string(filename)
    )
}

/// Epilogue registering the update handler. The literal `import.meta.hot?.accept()` is what the
/// bundler reads to know the module accepts its own updates; a call made only through the helper is
/// invisible to it, and every edit would then reload the page. The helper still checks the registry
/// and commits the replaced components.
pub fn hmr_epilogue(registry: &mut Registry, runtime_module: &str) -> String {
    let helper = registry.helper_from("accept", Some(runtime_module));
    let local = hot_reg(registry);
    format!("\nimport.meta.hot?.accept();\n{helper}(import.meta.hot, {local});\n")
}

/// Wraps top-level component definitions in stable proxies and records the edits in `magic`.
///
/// # Errors
/// Fails when the edits cannot be applied (a hand-over to the reference compiler).
pub fn apply_hmr(
    program: &Program<'_>,
    tree: &Tree<'_>,
    magic: &mut MagicString,
    registry: &mut Registry,
    runtime_module: &str,
) -> Result<HmrResult> {
    let mut components: Vec<Declared> = Vec::new();
    let mut others: Vec<String> = Vec::new();
    let mut exported_values: Vec<String> = Vec::new();
    let mut unknown_export = false;

    for statement in &program.body {
        match statement {
            Statement::ExportDeclaration(export) => {
                if export.export_kind() == ImportOrExportKind::Type {
                    continue;
                }
                // An overload signature (`export function f(): void;`) is a type: the implementation is
                // the export.
                if matches!(&export.declaration, Declaration::FunctionDeclaration(function)
                    if function.r#type == FunctionType::TSDeclareFunction)
                {
                    continue;
                }
                let before = components.len();
                let end = export.span.end as usize;
                // The reference collects the declaration with the end of the declaration itself.
                let declaration_end = declaration_end(&export.declaration, end);
                collect_declaration(
                    tree,
                    &export.declaration,
                    declaration_end,
                    &mut components,
                    &mut others,
                );
                for component in components.iter_mut().skip(before) {
                    component.exported = true;
                }
                let added: Vec<&str> = components
                    .iter()
                    .skip(before)
                    .map(|c| c.name.as_str())
                    .collect();
                let declared = declaration_names(&export.declaration);
                for name in &declared {
                    if !added.contains(&name.as_str())
                        && !matches!(export.declaration, Declaration::TSTypeAliasDeclaration(_))
                    {
                        exported_values.push(name.clone());
                    }
                }
                if declared.is_empty() && !is_type_only(&export.declaration) {
                    unknown_export = true;
                }
                // An enum or a namespace is a value that importers hold, but it is not a component.
                if declared.is_empty() && is_runtime_namespace(&export.declaration) {
                    unknown_export = true;
                }
            }
            Statement::ExportNamedDeclaration(export) => {
                if export.export_kind == ImportOrExportKind::Type {
                    continue;
                }
                for specifier in &export.specifiers {
                    if specifier.export_kind == ImportOrExportKind::Type {
                        continue;
                    }
                    match module_export_name(&specifier.local) {
                        Some(name) => exported_values.push(name.to_string()),
                        None => unknown_export = true,
                    }
                }
            }
            Statement::ExportFromDeclaration(export) => {
                if export.export_kind == ImportOrExportKind::Type {
                    continue;
                }
                for specifier in &export.specifiers {
                    if specifier.export_kind == ImportOrExportKind::Type {
                        continue;
                    }
                    match module_export_name(&specifier.local) {
                        Some(name) => exported_values.push(name.to_string()),
                        None => unknown_export = true,
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                    if function.r#type == FunctionType::TSDeclareFunction {
                        continue;
                    }
                    let before = components.len();
                    collect_function(
                        function,
                        &mut components,
                        &mut others,
                        function.span.end as usize,
                    );
                    for component in components.iter_mut().skip(before) {
                        component.exported = true;
                    }
                    if components.len() == before {
                        unknown_export = true;
                    }
                }
                ExportDefaultDeclarationKind::Identifier(identifier) => {
                    exported_values.push(identifier.name.as_str().to_string());
                }
                _ => unknown_export = true,
            },
            Statement::ExportAllDeclaration(_) => unknown_export = true,
            Statement::FunctionDeclaration(function) => {
                collect_function(
                    function,
                    &mut components,
                    &mut others,
                    function.span.end as usize,
                );
            }
            Statement::VariableDeclaration(variables) => {
                collect_variables(tree, variables, &mut components, &mut others);
            }
            _ => {}
        }
    }

    let kept = keep_components(program, tree, &components);
    let mut wrapped: Vec<Declared> = Vec::new();
    for (component, keep) in components.into_iter().zip(kept) {
        if keep {
            wrapped.push(component);
        } else if component.exported {
            // An exported function that stays as written is an export that is not a component.
            exported_values.push(component.name);
        }
    }
    let components = wrapped;
    if components.is_empty() {
        return Ok(HmrResult {
            self_accepting: false,
            components: 0,
        });
    }

    let names: Vec<&str> = components.iter().map(|c| c.name.as_str()).collect();
    let non_component_export = unknown_export
        || exported_values
            .iter()
            .any(|name| !names.contains(&name.as_str()));
    let wrap = registry.helper_from("component", Some(runtime_module));
    for component in &components {
        let local = hot_reg(registry);
        let call = format!("{wrap}({local}, {}, ", json_string(&component.name));
        let applied = match component.placement {
            Placement::Init(start, end) => magic
                .append_left(start, &call)
                .and_then(|()| magic.append_right(end, ")")),
            Placement::After(end) => magic.append_left(
                end,
                &format!("\n{} = {call}{});", component.name, component.name),
            ),
        };
        if let Err(error) = applied {
            return unsupported(format!(
                "hot module replacement edit failed: {}",
                error.message()
            ));
        }
    }
    Ok(HmrResult {
        self_accepting: !non_component_export,
        components: components.len(),
    })
}

/// End offset of a declaration, as the reference reads `statement.end` of the declaration node.
fn declaration_end(declaration: &Declaration<'_>, fallback: usize) -> usize {
    match declaration {
        Declaration::FunctionDeclaration(function) => function.span.end as usize,
        _ => fallback,
    }
}

fn module_export_name<'a>(name: &'a ModuleExportName<'_>) -> Option<&'a str> {
    match name {
        ModuleExportName::IdentifierName(it) => Some(it.name.as_str()),
        ModuleExportName::IdentifierReference(it) => Some(it.name.as_str()),
        ModuleExportName::StringLiteral(_) => None,
    }
}
