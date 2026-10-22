//! The target-independent form of a JSX tree.

use std::borrow::Cow;

use crate::tree::NodeIx;

/// An expression of the user's program, already rewritten (nested JSX compiled).
#[derive(Debug, Clone)]
pub struct ExprIR<'a> {
    /// The final text: a slice of the source unless nested JSX was compiled into it.
    pub text: Cow<'a, str>,
    /// The tree node the expression comes from (the attribute node for synthesized text).
    pub node: NodeIx,
    /// Whether it must be re-evaluated reactively.
    pub dynamic: bool,
}

/// Where an element lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Namespace {
    /// HTML.
    Html,
    /// SVG.
    Svg,
    /// MathML.
    Math,
}

/// The value of a static attribute.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StaticValue {
    /// A boolean attribute written without a value.
    True,
    /// Text.
    Text(String),
}

/// An attribute or prop.
#[derive(Debug, Clone)]
pub enum Attr<'a> {
    /// A value known at build time.
    Static {
        /// Attribute name as written.
        name: String,
        /// The value.
        value: StaticValue,
        /// JavaScript source of the value when it is not a string (numbers), used for component props.
        js: Option<String>,
        /// Start of the attribute in the source.
        start: u32,
    },
    /// An expression.
    Expr {
        /// Attribute name as written.
        name: String,
        /// The expression.
        expr: ExprIR<'a>,
        /// Start of the attribute in the source.
        start: u32,
    },
    /// `{...expr}`.
    Spread {
        /// The spread expression.
        expr: ExprIR<'a>,
        /// Start of the attribute in the source.
        start: u32,
    },
}

/// An intrinsic element.
#[derive(Debug, Clone)]
pub struct ElementIR<'a> {
    /// Tag name.
    pub tag: String,
    /// Namespace of the element itself.
    pub ns: Namespace,
    /// A custom element (a tag with a hyphen).
    pub custom: bool,
    /// Attributes in source order.
    pub attrs: Vec<Attr<'a>>,
    /// Children.
    pub children: Vec<ChildIR<'a>>,
    /// Start of the element in the source.
    pub start: u32,
    /// Whether the element or something below it needs a variable in the generated code: a
    /// non-static attribute, an `autoFocus` attribute, a slot, a component or such an element.
    pub dynamic_parts: bool,
}

impl<'a> ElementIR<'a> {
    /// Creates an element and works out [`ElementIR::dynamic_parts`].
    #[must_use]
    pub fn new(
        tag: String,
        ns: Namespace,
        custom: bool,
        attrs: Vec<Attr<'a>>,
        children: Vec<ChildIR<'a>>,
        start: u32,
    ) -> Self {
        let dynamic_parts = attrs.iter().any(|attr| match attr {
            Attr::Static { name, .. } => name == "autoFocus",
            _ => true,
        }) || children.iter().any(|child| match child {
            ChildIR::Slot(_) | ChildIR::Component(_) => true,
            ChildIR::Element(element) => element.dynamic_parts,
            ChildIR::Text(_) | ChildIR::Fragment(_) => false,
        });
        ElementIR {
            tag,
            ns,
            custom,
            attrs,
            children,
            start,
            dynamic_parts,
        }
    }
}

/// A component call.
#[derive(Debug, Clone)]
pub struct ComponentIR<'a> {
    /// The callee as written (`Foo`, `Foo.Bar`, `this`).
    pub callee: String,
    /// Props in source order.
    pub attrs: Vec<Attr<'a>>,
    /// Children.
    pub children: Vec<ChildIR<'a>>,
    /// Start in the source.
    pub start: u32,
}

/// A child of an element, component or fragment.
#[derive(Debug, Clone)]
pub enum ChildIR<'a> {
    /// An element.
    Element(ElementIR<'a>),
    /// A component.
    Component(ComponentIR<'a>),
    /// Static text.
    Text(String),
    /// A dynamic or opaque expression.
    Slot(ExprIR<'a>),
    /// A fragment (flattened away by lowering, except at a root).
    Fragment(Vec<ChildIR<'a>>),
}

/// A JSX root.
#[derive(Debug, Clone)]
pub enum RootIR<'a> {
    /// An element.
    Element(ElementIR<'a>),
    /// A component.
    Component(ComponentIR<'a>),
    /// A fragment: a list of values.
    Fragment(Vec<ChildIR<'a>>),
}
