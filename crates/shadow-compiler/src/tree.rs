//! A flat, ESTree-shaped view of an oxc syntax tree.
//!
//! The reference compiler reads the ESTree that `oxc-parser` returns to JavaScript. Its generic
//! passes (is this expression dynamic, which names does a pattern bind, where is JSX) walk every
//! node of that tree and look at the node `type` and its position in the tree. The oxc Rust AST is
//! shaped differently in a few places (parameters are not nodes, a type annotation sits next to its
//! pattern, `export const` is its own struct), so [`Tree`] rebuilds the ESTree view: one entry per
//! ESTree node, in source order, with the ESTree type, the ESTree span, the parent and the size of
//! the subtree. Walks over a subtree are linear scans over a contiguous slice.
//!
//! Positions are UTF-8 byte offsets into the source text. Each entry keeps the [`AstKind`] of the
//! oxc node it comes from, for typed access to the properties a pass reads.

use oxc_ast::ast::{
    AssignmentTargetPropertyIdentifier, BindingPattern, CatchParameter, ClassType, Decorator,
    FormalParameter, FormalParameterRest, FunctionType, JSXElementName, JSXMemberExpressionObject,
    MethodDefinitionType, PropertyDefinitionType, TSTemplateLiteralType, TSThisParameter,
    TSTypeAnnotation, TemplateLiteral, VariableDeclarator,
};
use oxc_ast::ast::{Declaration, ExportDefaultDeclarationKind, Program, Statement};
use oxc_ast::ast_kind::{AstKind, AstType};
use oxc_ast_visit::{Visit, walk};
use oxc_span::GetSpan;
use oxc_syntax::node::NodeId;

use crate::kinds::set_node_id;

/// The ESTree node types the compiler distinguishes. Every other type is [`Ty::Other`], or
/// [`Ty::Ts`] for the TypeScript-only nodes (a type that starts with `TS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[allow(missing_docs)]
pub enum Ty {
    Program,
    Identifier,
    JSXIdentifier,
    ThisExpression,
    Literal,
    TemplateLiteral,
    TemplateElement,
    TaggedTemplateExpression,
    MemberExpression,
    CallExpression,
    NewExpression,
    ChainExpression,
    ParenthesizedExpression,
    BinaryExpression,
    LogicalExpression,
    UnaryExpression,
    UpdateExpression,
    ConditionalExpression,
    AssignmentExpression,
    SequenceExpression,
    AwaitExpression,
    YieldExpression,
    ArrowFunctionExpression,
    FunctionExpression,
    FunctionDeclaration,
    ClassDeclaration,
    ClassExpression,
    ClassBody,
    MethodDefinition,
    PropertyDefinition,
    ObjectExpression,
    ArrayExpression,
    Property,
    SpreadElement,
    VariableDeclaration,
    VariableDeclarator,
    ExpressionStatement,
    BlockStatement,
    ReturnStatement,
    ObjectPattern,
    ArrayPattern,
    AssignmentPattern,
    RestElement,
    CatchClause,
    LabeledStatement,
    BreakStatement,
    ContinueStatement,
    ImportDeclaration,
    ImportSpecifier,
    ExportSpecifier,
    ExportNamedDeclaration,
    ExportDefaultDeclaration,
    ExportAllDeclaration,
    JSXElement,
    JSXFragment,
    JSXOpeningElement,
    JSXAttribute,
    JSXSpreadAttribute,
    JSXExpressionContainer,
    JSXEmptyExpression,
    JSXText,
    JSXSpreadChild,
    JSXNamespacedName,
    JSXMemberExpression,
    TSAsExpression,
    TSSatisfiesExpression,
    TSNonNullExpression,
    TSTypeAssertion,
    TSInstantiationExpression,
    TSNumberKeyword,
    TSStringKeyword,
    TSBooleanKeyword,
    TSBigIntKeyword,
    TSSymbolKeyword,
    TSNullKeyword,
    TSUndefinedKeyword,
    TSTypeAnnotation,
    TSParameterProperty,
    /// Any other TypeScript node.
    Ts,
    /// Any other node.
    Other,
}

impl Ty {
    /// True for the types the JS compiler's `isFunctionNode` accepts.
    #[must_use]
    pub fn is_function(self) -> bool {
        matches!(
            self,
            Ty::ArrowFunctionExpression | Ty::FunctionExpression | Ty::FunctionDeclaration
        )
    }

    /// True for `JSXElement` and `JSXFragment`.
    #[must_use]
    pub fn is_jsx(self) -> bool {
        matches!(self, Ty::JSXElement | Ty::JSXFragment)
    }

    /// True for a type whose ESTree name starts with `TS`.
    #[must_use]
    pub fn is_ts(self) -> bool {
        matches!(
            self,
            Ty::TSAsExpression
                | Ty::TSSatisfiesExpression
                | Ty::TSNonNullExpression
                | Ty::TSTypeAssertion
                | Ty::TSInstantiationExpression
                | Ty::TSNumberKeyword
                | Ty::TSStringKeyword
                | Ty::TSBooleanKeyword
                | Ty::TSBigIntKeyword
                | Ty::TSSymbolKeyword
                | Ty::TSNullKeyword
                | Ty::TSUndefinedKeyword
                | Ty::TSTypeAnnotation
                | Ty::TSParameterProperty
                | Ty::Ts
        )
    }

    /// True for the TypeScript wrappers whose `expression` child is real code.
    #[must_use]
    pub fn is_ts_transparent(self) -> bool {
        matches!(
            self,
            Ty::TSAsExpression
                | Ty::TSSatisfiesExpression
                | Ty::TSNonNullExpression
                | Ty::TSTypeAssertion
                | Ty::TSInstantiationExpression
        )
    }
}

/// Index of a node in a [`Tree`].
pub type NodeIx = u32;

/// The parent of the root.
pub const NO_PARENT: NodeIx = u32::MAX;

/// One ESTree node.
#[derive(Clone, Copy)]
pub struct Node<'a> {
    /// The oxc node this entry comes from.
    pub kind: AstKind<'a>,
    /// ESTree type.
    pub ty: Ty,
    /// ESTree start (byte offset).
    pub start: u32,
    /// ESTree end (byte offset, exclusive).
    pub end: u32,
    /// Index of the parent, [`NO_PARENT`] for the root.
    pub parent: NodeIx,
    /// Number of nodes in the subtree, this node included.
    pub size: u32,
    /// Flag bits, see [`FLAG_PARAM`].
    pub flags: u8,
}

/// The node is a parameter of the function it sits in.
pub const FLAG_PARAM: u8 = 1;

/// The subtree of the node holds a JSX element or fragment (the node itself included).
pub const FLAG_HAS_JSX: u8 = 2;

/// The ESTree view of one program.
pub struct Tree<'a> {
    nodes: Vec<Node<'a>>,
}

/// The oxc node types that are not ESTree nodes (they have no entry).
fn ty_of(kind: AstKind<'_>) -> Option<Ty> {
    use AstKind as K;
    Some(match kind {
        K::Elision(_)
        | K::FormalParameters(_)
        | K::FormalParameter(_)
        | K::FormalParameterRest(_)
        | K::CatchParameter(_)
        | K::WithClause(_) => return None,
        K::Program(_) => Ty::Program,
        K::IdentifierName(_)
        | K::IdentifierReference(_)
        | K::BindingIdentifier(_)
        | K::LabelIdentifier(_)
        | K::TSThisParameter(_)
        | K::TSIndexSignatureName(_) => Ty::Identifier,
        K::ThisExpression(_) => Ty::ThisExpression,
        K::BooleanLiteral(_)
        | K::NullLiteral(_)
        | K::NumericLiteral(_)
        | K::StringLiteral(_)
        | K::BigIntLiteral(_)
        | K::RegExpLiteral(_) => Ty::Literal,
        K::TemplateLiteral(_) => Ty::TemplateLiteral,
        K::TemplateElement(_) => Ty::TemplateElement,
        K::TaggedTemplateExpression(_) => Ty::TaggedTemplateExpression,
        K::ComputedMemberExpression(_)
        | K::StaticMemberExpression(_)
        | K::PrivateFieldExpression(_) => Ty::MemberExpression,
        K::CallExpression(_) => Ty::CallExpression,
        K::NewExpression(_) => Ty::NewExpression,
        K::ChainExpression(_) => Ty::ChainExpression,
        K::ParenthesizedExpression(_) => Ty::ParenthesizedExpression,
        K::BinaryExpression(_) | K::PrivateInExpression(_) => Ty::BinaryExpression,
        K::LogicalExpression(_) => Ty::LogicalExpression,
        K::UnaryExpression(_) => Ty::UnaryExpression,
        K::UpdateExpression(_) => Ty::UpdateExpression,
        K::ConditionalExpression(_) => Ty::ConditionalExpression,
        K::AssignmentExpression(_) => Ty::AssignmentExpression,
        K::SequenceExpression(_) => Ty::SequenceExpression,
        K::AwaitExpression(_) => Ty::AwaitExpression,
        K::YieldExpression(_) => Ty::YieldExpression,
        K::ArrowFunctionExpression(_) => Ty::ArrowFunctionExpression,
        K::Function(function) => match function.r#type {
            FunctionType::FunctionDeclaration => Ty::FunctionDeclaration,
            FunctionType::FunctionExpression => Ty::FunctionExpression,
            FunctionType::TSDeclareFunction | FunctionType::TSEmptyBodyFunctionExpression => Ty::Ts,
        },
        K::Class(class) => match class.r#type {
            ClassType::ClassDeclaration => Ty::ClassDeclaration,
            ClassType::ClassExpression => Ty::ClassExpression,
        },
        K::ClassBody(_) => Ty::ClassBody,
        K::MethodDefinition(method) => match method.r#type {
            MethodDefinitionType::MethodDefinition => Ty::MethodDefinition,
            MethodDefinitionType::TSAbstractMethodDefinition => Ty::Ts,
        },
        K::PropertyDefinition(property) => match property.r#type {
            PropertyDefinitionType::PropertyDefinition => Ty::PropertyDefinition,
            PropertyDefinitionType::TSAbstractPropertyDefinition => Ty::Ts,
        },
        K::ObjectExpression(_) => Ty::ObjectExpression,
        K::ArrayExpression(_) => Ty::ArrayExpression,
        K::ObjectProperty(_)
        | K::BindingProperty(_)
        | K::AssignmentTargetPropertyIdentifier(_)
        | K::AssignmentTargetPropertyProperty(_) => Ty::Property,
        K::SpreadElement(_) => Ty::SpreadElement,
        K::VariableDeclaration(_) => Ty::VariableDeclaration,
        K::VariableDeclarator(_) => Ty::VariableDeclarator,
        K::ExpressionStatement(_) | K::Directive(_) => Ty::ExpressionStatement,
        K::BlockStatement(_) | K::FunctionBody(_) => Ty::BlockStatement,
        K::ReturnStatement(_) => Ty::ReturnStatement,
        K::ObjectPattern(_) | K::ObjectAssignmentTarget(_) => Ty::ObjectPattern,
        K::ArrayPattern(_) | K::ArrayAssignmentTarget(_) => Ty::ArrayPattern,
        K::AssignmentPattern(_) | K::AssignmentTargetWithDefault(_) => Ty::AssignmentPattern,
        K::BindingRestElement(_) | K::AssignmentTargetRest(_) => Ty::RestElement,
        K::CatchClause(_) => Ty::CatchClause,
        K::LabeledStatement(_) => Ty::LabeledStatement,
        K::BreakStatement(_) => Ty::BreakStatement,
        K::ContinueStatement(_) => Ty::ContinueStatement,
        K::ImportDeclaration(_) => Ty::ImportDeclaration,
        K::ImportSpecifier(_) => Ty::ImportSpecifier,
        K::ExportSpecifier(_) => Ty::ExportSpecifier,
        K::ExportDeclaration(_) | K::ExportNamedDeclaration(_) | K::ExportFromDeclaration(_) => {
            Ty::ExportNamedDeclaration
        }
        K::ExportDefaultDeclaration(_) => Ty::ExportDefaultDeclaration,
        K::ExportAllDeclaration(_) => Ty::ExportAllDeclaration,
        K::JSXElement(_) => Ty::JSXElement,
        K::JSXFragment(_) => Ty::JSXFragment,
        K::JSXOpeningElement(_) => Ty::JSXOpeningElement,
        K::JSXAttribute(_) => Ty::JSXAttribute,
        K::JSXSpreadAttribute(_) => Ty::JSXSpreadAttribute,
        K::JSXExpressionContainer(_) => Ty::JSXExpressionContainer,
        K::JSXEmptyExpression(_) => Ty::JSXEmptyExpression,
        K::JSXText(_) => Ty::JSXText,
        K::JSXSpreadChild(_) => Ty::JSXSpreadChild,
        K::JSXNamespacedName(_) => Ty::JSXNamespacedName,
        K::JSXMemberExpression(_) => Ty::JSXMemberExpression,
        K::JSXIdentifier(_) => Ty::JSXIdentifier,
        K::TSAsExpression(_) => Ty::TSAsExpression,
        K::TSSatisfiesExpression(_) => Ty::TSSatisfiesExpression,
        K::TSNonNullExpression(_) => Ty::TSNonNullExpression,
        K::TSTypeAssertion(_) => Ty::TSTypeAssertion,
        K::TSInstantiationExpression(_) => Ty::TSInstantiationExpression,
        K::TSNumberKeyword(_) => Ty::TSNumberKeyword,
        K::TSStringKeyword(_) => Ty::TSStringKeyword,
        K::TSBooleanKeyword(_) => Ty::TSBooleanKeyword,
        K::TSBigIntKeyword(_) => Ty::TSBigIntKeyword,
        K::TSSymbolKeyword(_) => Ty::TSSymbolKeyword,
        K::TSNullKeyword(_) => Ty::TSNullKeyword,
        K::TSUndefinedKeyword(_) => Ty::TSUndefinedKeyword,
        K::TSTypeAnnotation(_) => Ty::TSTypeAnnotation,
        other => {
            let id = other.ty() as u8;
            let is_ts = id >= AstType::TSThisParameter as u8
                && id <= AstType::TSInstantiationExpression as u8
                && id != AstType::Decorator as u8;
            if is_ts { Ty::Ts } else { Ty::Other }
        }
    })
}

/// Collects the nodes.
struct Builder<'a> {
    nodes: Vec<Node<'a>>,
    /// Indexes of the open nodes.
    open: Vec<NodeIx>,
    /// True for a TypeScript file: the ESTree of TypeScript files has a few different spans.
    ts: bool,
    /// Depth counter: greater than zero while inside a JSX element or member name.
    jsx_name: u32,
    /// Decorators, a type annotation and an end offset that belong to the pattern entered next.
    pending: Option<Adoption<'a>>,
    /// Open patterns that adopt a type annotation when they close.
    annotated: Vec<(NodeIx, &'a TSTypeAnnotation<'a>, Option<u32>)>,
}

/// What a pattern takes from the declarator or parameter around it: ESTree puts the decorators and
/// the type annotation of a binding inside the pattern node, and widens its span to cover them.
struct Adoption<'a> {
    decorators: &'a [Decorator<'a>],
    annotation: Option<&'a TSTypeAnnotation<'a>>,
    /// The pattern ends here at least (an optional parameter spans its `?`).
    end: Option<u32>,
}

impl<'a> Builder<'a> {
    fn push(&mut self, kind: AstKind<'a>, ty: Ty, start: u32, end: u32) -> NodeIx {
        let index = u32::try_from(self.nodes.len()).unwrap_or(u32::MAX);
        let parent = self.open.last().copied().unwrap_or(NO_PARENT);
        self.nodes.push(Node {
            kind,
            ty,
            start,
            end,
            parent,
            size: 1,
            flags: if ty.is_jsx() { FLAG_HAS_JSX } else { 0 },
        });
        set_node_id(kind, NodeId::new(index as usize));
        index
    }

    fn open_node(&mut self, kind: AstKind<'a>, ty: Ty, start: u32, end: u32) -> NodeIx {
        let index = self.push(kind, ty, start, end);
        self.open.push(index);
        index
    }

    fn close_node(&mut self) {
        if let Some(index) = self.open.pop() {
            let length = u32::try_from(self.nodes.len()).unwrap_or(u32::MAX);
            let mut has_jsx = false;
            let mut parent = NO_PARENT;
            if let Some(node) = self.nodes.get_mut(index as usize) {
                node.size = length - index;
                has_jsx = node.flags & FLAG_HAS_JSX != 0;
                parent = node.parent;
            }
            if has_jsx && let Some(node) = self.nodes.get_mut(parent as usize) {
                node.flags |= FLAG_HAS_JSX;
            }
        }
    }

    /// Closes the open node `index` after the annotation that belongs to it is in.
    fn finish_annotation(&mut self, index: NodeIx) {
        if self.annotated.last().is_none_or(|entry| entry.0 != index) {
            return;
        }
        let Some((_, annotation, end)) = self.annotated.pop() else {
            return;
        };
        self.visit_ts_type_annotation(annotation);
        let merged = end.unwrap_or(annotation.span.end).max(annotation.span.end);
        if let Some(node) = self.nodes.get_mut(index as usize) {
            node.end = node.end.max(merged);
        }
    }

    fn expect(
        &mut self,
        decorators: &'a [Decorator<'a>],
        annotation: Option<&'a TSTypeAnnotation<'a>>,
        end: Option<u32>,
    ) {
        self.pending = Some(Adoption {
            decorators,
            annotation,
            end,
        });
    }

    fn visit_pattern_with(&mut self, pattern: &BindingPattern<'a>) {
        self.visit_binding_pattern(pattern);
        self.pending = None;
    }

    /// Marks the node at `first` as a parameter when the visit created one.
    fn mark_param(&mut self, first: usize) {
        if self.nodes.len() > first
            && let Some(node) = self.nodes.get_mut(first)
        {
            node.flags |= FLAG_PARAM;
        }
    }
}

impl<'a> Visit<'a> for Builder<'a> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        let Some(mut ty) = ty_of(kind) else {
            return;
        };
        if self.jsx_name > 0 {
            match kind {
                AstKind::IdentifierReference(_) | AstKind::ThisExpression(_) => {
                    ty = Ty::JSXIdentifier
                }
                _ => {}
            }
        }
        let mut span = kind.span();
        if self.ts {
            match kind {
                AstKind::TemplateElement(element) => {
                    span.start = span.start.saturating_sub(1);
                    span.end += if element.tail { 1 } else { 2 };
                }
                AstKind::Program(program) => span.start = program_start(program),
                _ => {}
            }
        }
        let index = self.open_node(kind, ty, span.start, span.end);
        if let Some(adoption) = self.pending.take() {
            for decorator in adoption.decorators {
                self.visit_decorator(decorator);
            }
            if let Some(end) = adoption.end
                && let Some(node) = self.nodes.get_mut(index as usize)
            {
                node.end = node.end.max(end);
            }
            if let Some(annotation) = adoption.annotation {
                self.annotated.push((index, annotation, adoption.end));
            }
        }
    }

    fn leave_node(&mut self, kind: AstKind<'a>) {
        if ty_of(kind).is_none() {
            return;
        }
        if let Some(&index) = self.open.last() {
            self.finish_annotation(index);
        }
        self.close_node();
    }

    fn visit_template_literal(&mut self, it: &TemplateLiteral<'a>) {
        let kind = AstKind::TemplateLiteral(self.alloc(it));
        self.enter_node(kind);
        for (position, quasi) in it.quasis.iter().enumerate() {
            self.visit_template_element(quasi);
            if let Some(expression) = it.expressions.get(position) {
                self.visit_expression(expression);
            }
        }
        self.leave_node(kind);
    }

    fn visit_ts_template_literal_type(&mut self, it: &TSTemplateLiteralType<'a>) {
        let kind = AstKind::TSTemplateLiteralType(self.alloc(it));
        self.enter_node(kind);
        for (position, quasi) in it.quasis.iter().enumerate() {
            self.visit_template_element(quasi);
            if let Some(ty) = it.types.get(position) {
                self.visit_ts_type(ty);
            }
        }
        self.leave_node(kind);
    }

    fn visit_jsx_element_name(&mut self, it: &JSXElementName<'a>) {
        self.jsx_name += 1;
        walk::walk_jsx_element_name(self, it);
        self.jsx_name -= 1;
    }

    fn visit_jsx_member_expression_object(&mut self, it: &JSXMemberExpressionObject<'a>) {
        self.jsx_name += 1;
        walk::walk_jsx_member_expression_object(self, it);
        self.jsx_name -= 1;
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        let kind = AstKind::VariableDeclarator(self.alloc(it));
        self.enter_node(kind);
        let annotation = it.type_annotation.as_deref().map(|a| self.alloc(a));
        self.expect(&[], annotation, None);
        self.visit_pattern_with(&it.id);
        if let Some(init) = &it.init {
            self.visit_expression(init);
        }
        self.leave_node(kind);
    }

    fn visit_catch_parameter(&mut self, it: &CatchParameter<'a>) {
        let annotation = it.type_annotation.as_deref().map(|a| self.alloc(a));
        self.expect(&[], annotation, None);
        self.visit_pattern_with(&it.pattern);
    }

    fn visit_ts_this_parameter(&mut self, it: &TSThisParameter<'a>) {
        let first = self.nodes.len();
        walk::walk_ts_this_parameter(self, it);
        self.mark_param(first);
    }

    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
        let first = self.nodes.len();
        let kind = AstKind::FormalParameter(self.alloc(it));
        let annotation = it.type_annotation.as_deref().map(|a| self.alloc(a));
        let decorators: &'a [Decorator<'a>] = self.alloc(&it.decorators).as_slice();
        let has_modifier = it.accessibility.is_some() || it.readonly || it.r#override;
        if has_modifier {
            self.open_node(kind, Ty::TSParameterProperty, it.span.start, it.span.end);
            for decorator in decorators {
                self.visit_decorator(decorator);
            }
        }
        if let Some(initializer) = &it.initializer {
            if has_modifier {
                // `constructor(private a = 1)`: the assignment pattern spans the pattern and the value.
                let start = it.pattern.span().start;
                self.open_node(kind, Ty::AssignmentPattern, start, initializer.span().end);
            } else {
                self.open_node(kind, Ty::AssignmentPattern, it.span.start, it.span.end);
                for decorator in decorators {
                    self.visit_decorator(decorator);
                }
            }
            self.expect(&[], annotation, None);
            self.visit_pattern_with(&it.pattern);
            self.visit_expression(initializer);
            self.close_node();
        } else {
            let end = if it.optional { Some(it.span.end) } else { None };
            self.expect(if has_modifier { &[] } else { decorators }, annotation, end);
            self.visit_pattern_with(&it.pattern);
        }
        if has_modifier {
            self.close_node();
        }
        self.mark_param(first);
    }

    fn visit_formal_parameter_rest(&mut self, it: &FormalParameterRest<'a>) {
        let first = self.nodes.len();
        let annotation = it.type_annotation.as_deref().map(|a| self.alloc(a));
        let decorators: &'a [Decorator<'a>] = self.alloc(&it.decorators).as_slice();
        self.expect(decorators, annotation, None);
        self.visit_binding_rest_element(&it.rest);
        self.pending = None;
        self.mark_param(first);
    }

    fn visit_assignment_target_property_identifier(
        &mut self,
        it: &AssignmentTargetPropertyIdentifier<'a>,
    ) {
        let kind = AstKind::AssignmentTargetPropertyIdentifier(self.alloc(it));
        self.enter_node(kind);
        let binding = AstKind::IdentifierReference(self.alloc(&it.binding));
        let span = it.binding.span;
        // ESTree writes the shorthand `{ a }` with a key and a value that are both `a`.
        self.push(binding, Ty::Identifier, span.start, span.end);
        if let Some(init) = &it.init {
            let pattern = self.open_node(kind, Ty::AssignmentPattern, it.span.start, it.span.end);
            let _ = pattern;
            self.push(binding, Ty::Identifier, span.start, span.end);
            self.visit_expression(init);
            self.close_node();
        } else {
            self.push(binding, Ty::Identifier, span.start, span.end);
        }
        self.leave_node(kind);
    }
}

/// The start of the `Program` node of a TypeScript file: the first directive or statement (the
/// first decorator when it sits before an exported class).
fn program_start(program: &Program<'_>) -> u32 {
    if let Some(directive) = program.directives.first() {
        return directive.span.start;
    }
    let Some(first) = program.body.first() else {
        return program.span.end;
    };
    let start = first.span().start;
    let decorated = match first {
        Statement::ExportDeclaration(declaration) => match &declaration.declaration {
            Declaration::ClassDeclaration(class) => class.decorators.first(),
            _ => None,
        },
        Statement::ExportDefaultDeclaration(declaration) => match &declaration.declaration {
            ExportDefaultDeclarationKind::ClassDeclaration(class) => class.decorators.first(),
            _ => None,
        },
        _ => None,
    };
    decorated.map_or(start, |decorator| start.min(decorator.span.start))
}

impl<'a> Tree<'a> {
    /// Builds the ESTree view of `program`. Stores each node's index in the `node_id` cell of the
    /// oxc node, so [`Tree::index_of_expression`] and its relatives are constant time.
    #[must_use]
    pub fn build(program: &'a Program<'a>) -> Tree<'a> {
        let mut builder = Builder {
            nodes: Vec::with_capacity(program.source_text.len() / 6 + 16),
            open: Vec::with_capacity(64),
            ts: program.source_type.is_typescript(),
            jsx_name: 0,
            pending: None,
            annotated: Vec::new(),
        };
        builder.visit_program(program);
        Tree {
            nodes: builder.nodes,
        }
    }

    /// Number of nodes.
    #[must_use]
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// True when the tree has no nodes.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// The node at `index`. Indexes come from this tree, so a miss is a programming error and
    /// reads as the root.
    #[must_use]
    pub fn node(&self, index: NodeIx) -> &Node<'a> {
        match self.nodes.get(index as usize) {
            Some(node) => node,
            None => &self.nodes[0],
        }
    }

    /// ESTree type of a node.
    #[must_use]
    pub fn ty(&self, index: NodeIx) -> Ty {
        self.nodes
            .get(index as usize)
            .map_or(Ty::Other, |node| node.ty)
    }

    /// ESTree start of a node.
    #[must_use]
    pub fn start(&self, index: NodeIx) -> u32 {
        self.nodes.get(index as usize).map_or(0, |node| node.start)
    }

    /// ESTree end of a node.
    #[must_use]
    pub fn end(&self, index: NodeIx) -> u32 {
        self.nodes.get(index as usize).map_or(0, |node| node.end)
    }

    /// Parent of a node, [`NO_PARENT`] for the root.
    #[must_use]
    pub fn parent(&self, index: NodeIx) -> NodeIx {
        self.nodes
            .get(index as usize)
            .map_or(NO_PARENT, |node| node.parent)
    }

    /// Index one past the last node of the subtree of `index`.
    #[must_use]
    pub fn subtree_end(&self, index: NodeIx) -> NodeIx {
        index + self.nodes.get(index as usize).map_or(1, |node| node.size)
    }

    /// Direct children of `index`, in source order.
    pub fn children(&self, index: NodeIx) -> impl Iterator<Item = NodeIx> + '_ {
        let end = self.subtree_end(index);
        let mut next = index + 1;
        std::iter::from_fn(move || {
            if next >= end {
                return None;
            }
            let current = next;
            next = self.subtree_end(current);
            Some(current)
        })
    }

    /// Depth-first walk of the subtree at `root` in source order. `enter(index, parent)` returns
    /// `false` to skip the children of the node (the node itself was visited).
    pub fn walk(&self, root: NodeIx, mut enter: impl FnMut(NodeIx, NodeIx) -> bool) {
        let end = self
            .subtree_end(root)
            .min(u32::try_from(self.nodes.len()).unwrap_or(u32::MAX));
        let mut index = root;
        while index < end {
            let node = self.node(index);
            let parent = if index == root {
                NO_PARENT
            } else {
                node.parent
            };
            if enter(index, parent) {
                index += 1;
            } else {
                index += node.size.max(1);
            }
        }
    }

    /// True when the node is a parameter of the function it sits in.
    #[must_use]
    pub fn is_param(&self, index: NodeIx) -> bool {
        self.nodes
            .get(index as usize)
            .is_some_and(|node| node.flags & FLAG_PARAM != 0)
    }

    /// True when the subtree of the node holds a JSX element or fragment.
    #[must_use]
    pub fn has_jsx(&self, index: NodeIx) -> bool {
        self.nodes
            .get(index as usize)
            .is_some_and(|node| node.flags & FLAG_HAS_JSX != 0)
    }

    /// The last child of a node, if it has one.
    #[must_use]
    pub fn last_child(&self, index: NodeIx) -> Option<NodeIx> {
        self.children(index).last()
    }

    /// The name of an identifier-like node (`Identifier`, `JSXIdentifier`), else `None`.
    #[must_use]
    pub fn name(&self, index: NodeIx) -> Option<&'a str> {
        let node = self.nodes.get(index as usize)?;
        Some(match node.kind {
            AstKind::IdentifierName(it) => it.name.as_str(),
            AstKind::IdentifierReference(it) => it.name.as_str(),
            AstKind::BindingIdentifier(it) => it.name.as_str(),
            AstKind::LabelIdentifier(it) => it.name.as_str(),
            AstKind::JSXIdentifier(it) => it.name.as_str(),
            AstKind::ThisExpression(_) if node.ty == Ty::JSXIdentifier => "this",
            AstKind::TSThisParameter(_) => "this",
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    fn types(source: &str) -> Vec<(Ty, u32, u32)> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx().with_module(true)).parse();
        assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
        let tree = Tree::build(&parsed.program);
        (0..tree.len())
            .map(|i| (tree.ty(i as u32), tree.start(i as u32), tree.end(i as u32)))
            .collect()
    }

    #[test]
    fn parameters_with_annotations_span_their_annotation() {
        let all = types("function F({a}: Props, d?: number) {}");
        let patterns: Vec<_> = all.iter().filter(|n| n.0 == Ty::ObjectPattern).collect();
        assert_eq!(patterns.len(), 1);
        assert_eq!((patterns[0].1, patterns[0].2), (11, 21));
        let d = all
            .iter()
            .find(|n| n.0 == Ty::Identifier && n.1 == 23)
            .map(|n| n.2);
        assert_eq!(d, Some(33));
    }

    #[test]
    fn jsx_component_names_are_jsx_identifiers() {
        let all = types("const a = <Foo.Bar x={y} />;");
        assert!(all.iter().filter(|n| n.0 == Ty::JSXIdentifier).count() >= 3);
    }
}
