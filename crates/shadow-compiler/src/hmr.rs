//! Hot module replacement: wraps top-level component definitions in stable proxies and appends the
//! refresh registration, so editing a component swaps it in place instead of reloading the page.
//! Modules that export anything other than components are left to the bundler's normal propagation
//! (their importers reload).

use oxc_ast::ast::{
    BindingPattern, Declaration, ExportDefaultDeclarationKind, Expression, Function, FunctionType,
    ImportOrExportKind, ModuleExportName, Program, Statement, VariableDeclaration,
};

use crate::classify::ix_of_expression;
use crate::error::{Result, unsupported};
use crate::jsutil::json_string;
use crate::magic::MagicString;
use crate::registry::Registry;
use crate::tree::{NodeIx, Tree};

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
                    let before = components.len();
                    collect_function(
                        function,
                        &mut components,
                        &mut others,
                        function.span.end as usize,
                    );
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
