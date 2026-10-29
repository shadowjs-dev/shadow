//! Lowers a JSX tree to the target-agnostic IR.
//!
//! This is the only place that decides what is static text. Literal children are folded here (never
//! in the generators), so both targets lay out the same text nodes and hydration matches.

use std::borrow::Cow;

use oxc_ast::ast::{
    JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement,
    JSXElementName, JSXExpression, JSXMemberExpressionObject, ObjectPropertyKind, PropertyKey,
};
use oxc_ast::ast_kind::AstKind;

use crate::classify::{
    Constant, ConstantResult, attribute_value_ix, constant_value, contains_jsx, is_dynamic,
    ix_of_expression, jsx_expression_ix, node_ix, unwrap_parens, value_span,
};
use crate::ctx::Ctx;
use crate::entities::decode_html_strict;
use crate::error::{Result, fail_span, unsupported};
use crate::ir::{Attr, ChildIR, ComponentIR, ElementIR, ExprIR, Namespace, RootIR, StaticValue};
use crate::jsutil::{first_is_upper_like, js_trim, json_string, number_to_string};
use crate::names::{attribute_name, is_ignored_attribute};
use crate::nesting::{ancestor_problem, nesting_problem, self_nesting_problem};
use crate::text::clean_jsx_text;
use crate::tree::{NodeIx, Tree};

/// JSX nesting deeper than this is rejected: it is never legitimate source.
pub const MAX_JSX_DEPTH: u32 = 400;

/// Tags that exist only in SVG, so a standalone `<circle/>` root (e.g. inside `.map`) is built in the
/// SVG namespace.
const SVG_ONLY_TAGS: &[&str] = &[
    "animate",
    "animateMotion",
    "animateTransform",
    "circle",
    "clipPath",
    "defs",
    "desc",
    "ellipse",
    "feBlend",
    "feColorMatrix",
    "feComponentTransfer",
    "feComposite",
    "feConvolveMatrix",
    "feDiffuseLighting",
    "feDisplacementMap",
    "feDistantLight",
    "feDropShadow",
    "feFlood",
    "feFuncA",
    "feFuncB",
    "feFuncG",
    "feFuncR",
    "feGaussianBlur",
    "feImage",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
    "fePointLight",
    "feSpecularLighting",
    "feSpotLight",
    "feTile",
    "feTurbulence",
    "filter",
    "foreignObject",
    "g",
    "image",
    "line",
    "linearGradient",
    "marker",
    "mask",
    "metadata",
    "mpath",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "radialGradient",
    "rect",
    "set",
    "stop",
    "svg",
    "switch",
    "symbol",
    "text",
    "textPath",
    "tspan",
    "use",
    "view",
];

/// Namespaces whose value is always code, never an HTML attribute value.
const CODE_NAMESPACES: &[&str] = &[
    "use",
    "on",
    "oncapture",
    "prop",
    "attr",
    "bool",
    "class",
    "style",
];

/// Parents whose text the HTML parser reads differently from a text node that is inserted.
const NO_TEXT_FOLD: &[&str] = &[
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "colgroup",
    "select",
    "optgroup",
    "pre",
    "listing",
    "textarea",
    "script",
    "style",
    "plaintext",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "noscript",
    "template",
];

/// Attributes whose value is a URL; the runtime refuses script URLs in these.
const URL_ATTRIBUTES: &[&str] = &[
    "href",
    "src",
    "action",
    "formaction",
    "xlink:href",
    "srcdoc",
    "poster",
    "data",
];

/// Properties that have no HTML attribute form: a literal is applied as a property, once.
const PROPERTY_ONLY: &[&str] = &["innerHTML", "textContent", "innerText"];

const ENUMERATED_ATTRIBUTES: &[&str] = &["draggable", "spellcheck", "contenteditable"];

/// True for names whose boolean value is the text "true"/"false", not presence/absence.
fn writes_boolean_as_text(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with("aria-")
        || lower.starts_with("data-")
        || ENUMERATED_ATTRIBUTES.contains(&lower.as_str())
}

/// True when a literal URL would run script: browsers ignore the controls and case that hide the scheme.
fn is_script_url(value: &str) -> bool {
    let kept: String = value
        .chars()
        .filter(|&c| {
            // `charCodeAt(0)` of a code point: astral characters are surrogates (above U+009F).
            let code = if c.len_utf16() == 2 { 0xd800 } else { c as u32 };
            code > 0x1f && !(0x7f..=0x9f).contains(&code)
        })
        .collect();
    let normalized = js_trim(&kept).to_lowercase();
    ["javascript:", "data:text/html", "vbscript:"]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

/// True for characters the HTML parser rewrites or drops (CR, NUL, other controls), plus the
/// non-characters and U+FFFD.
fn is_unsafe_template_char(c: char) -> bool {
    matches!(
        c,
        '\u{0}'..='\u{8}'
            | '\u{b}'..='\u{1f}'
            | '\u{7f}'..='\u{9f}'
            | '\u{fdd0}'..='\u{fdef}'
            | '\u{fffd}'
            | '\u{fffe}'
            | '\u{ffff}'
    )
}

/// True for an attribute that holds a URL, under its HTML name or its React name (`xlinkHref`).
fn is_url_attribute(name: &str) -> bool {
    URL_ATTRIBUTES.contains(&name.to_lowercase().as_str())
        || URL_ATTRIBUTES.contains(&attribute_name(name, true).as_str())
}

/// The names of the plain attributes of an element (`value`, `checked`, ...), as written.
fn explicit_names<'e>(attributes: &'e [JSXAttributeItem<'_>]) -> Vec<&'e str> {
    attributes
        .iter()
        .filter_map(|item| match item {
            JSXAttributeItem::Attribute(attribute) => match &attribute.name {
                JSXAttributeName::Identifier(it) => Some(it.name.as_str()),
                JSXAttributeName::NamespacedName(_) => None,
            },
            JSXAttributeItem::SpreadAttribute(_) => None,
        })
        .collect()
}

struct TagInfo {
    component: bool,
    name: String,
    custom: bool,
}

impl<'t, 'a> Ctx<'t, 'a> {
    fn expr(&mut self, node: NodeIx, ns: Namespace) -> Result<ExprIR<'a>> {
        let text = self.text_in(node, ns)?;
        Ok(ExprIR {
            text,
            node,
            dynamic: is_dynamic(self.tree, node, self.source),
        })
    }

    /// Reads a constant, handing inputs with unrepresentable strings to the reference compiler.
    fn constant(&self, node: NodeIx) -> Result<Option<Constant>> {
        match constant_value(self.tree, node) {
            ConstantResult::NotConstant => Ok(None),
            ConstantResult::Value(value) => Ok(Some(value)),
            ConstantResult::Unrepresentable => {
                unsupported("a string with a lone surrogate cannot be reproduced")
            }
        }
    }

    fn tag_name_of_object(&self, object: &JSXMemberExpressionObject<'a>) -> String {
        match object {
            JSXMemberExpressionObject::IdentifierReference(it) => it.name.as_str().to_string(),
            JSXMemberExpressionObject::ThisExpression(_) => "this".to_string(),
            JSXMemberExpressionObject::MemberExpression(member) => {
                format!(
                    "{}.{}",
                    self.tag_name_of_object(&member.object),
                    member.property.name.as_str()
                )
            }
        }
    }

    fn tag_info(&self, name: &JSXElementName<'a>) -> Result<TagInfo> {
        let simple = |value: &str, start: u32, end: u32| {
            if value == "this" {
                return Ok(TagInfo {
                    component: true,
                    name: value.to_string(),
                    custom: false,
                });
            }
            let component = first_is_upper_like(value) || value.starts_with(['_', '$']);
            // `Foo-Bar` would be the subtraction `Foo - Bar` in the generated call: a component is a variable.
            if component && value.contains('-') {
                return fail_span(
                    "BAD_TAG",
                    format!(
                        "\"{value}\" is not a valid component name: a component is a variable, and a name with \"-\" cannot be one. Write a custom element in lower case."
                    ),
                    start,
                    end,
                );
            }
            Ok(TagInfo {
                component,
                name: value.to_string(),
                custom: !component && value.contains('-'),
            })
        };
        match name {
            JSXElementName::Identifier(it) => simple(it.name.as_str(), it.span.start, it.span.end),
            JSXElementName::IdentifierReference(it) => {
                simple(it.name.as_str(), it.span.start, it.span.end)
            }
            JSXElementName::ThisExpression(it) => simple("this", it.span.start, it.span.end),
            JSXElementName::MemberExpression(member) => Ok(TagInfo {
                component: true,
                name: format!(
                    "{}.{}",
                    self.tag_name_of_object(&member.object),
                    member.property.name.as_str()
                ),
                custom: false,
            }),
            JSXElementName::NamespacedName(it) => fail_span(
                "NAMESPACED_TAG",
                "Namespaced tag names are not supported.",
                it.span.start,
                it.span.end,
            ),
        }
    }

    fn attr_name(name: &JSXAttributeName<'a>) -> String {
        match name {
            JSXAttributeName::Identifier(it) => it.name.as_str().to_string(),
            JSXAttributeName::NamespacedName(it) => {
                format!("{}:{}", it.namespace.name.as_str(), it.name.name.as_str())
            }
        }
    }

    /// A static attribute on an intrinsic element (`tag` is `Some`) or a component (`None`),
    /// adjusted to what the browser does with its markup.
    fn static_attribute(
        tag: Option<&str>,
        name: &str,
        value: StaticValue,
        attribute: &JSXAttribute<'a>,
        attribute_ix: NodeIx,
        js: Option<String>,
    ) -> Attr<'a> {
        let start = attribute.span.start;
        let property = |property_name: &str, text: String| Attr::Expr {
            name: property_name.to_string(),
            expr: ExprIR {
                text: Cow::Owned(text),
                node: attribute_ix,
                dynamic: false,
            },
            start,
        };
        let plain = |name: &str, value: StaticValue, js: Option<String>| Attr::Static {
            name: name.to_string(),
            value,
            js,
            start,
        };
        let Some(tag) = tag else {
            return plain(name, value, js);
        };
        if let StaticValue::Text(text) = &value {
            if PROPERTY_ONLY.contains(&name) {
                return property(name, json_string(text));
            }
            // A literal script URL is not written into the template: it goes through the checked
            // attribute writer, which refuses it (and warns in development).
            // The React spelling is checked as well: `xlinkHref` is the attribute `xlink:href` in SVG.
            if is_url_attribute(name) && is_script_url(text) {
                return property(name, json_string(text));
            }
        }
        if name == "defaultChecked" {
            return plain("checked", StaticValue::True, None);
        }
        // The template parser would rewrite the value (CR becomes LF, NUL becomes U+FFFD): like a
        // literal child with such text, it is not written into the markup but set at run time.
        let unsafe_text =
            matches!(&value, StaticValue::Text(text) if text.chars().any(is_unsafe_template_char));
        if name == "defaultValue" || name == "value" {
            if tag == "select" || tag == "textarea" {
                let text = match &value {
                    StaticValue::Text(text) => text.as_str(),
                    StaticValue::True => "",
                };
                return property("value", json_string(text));
            }
            if unsafe_text && let StaticValue::Text(text) = &value {
                return property("value", json_string(text));
            }
            if name == "defaultValue" {
                return plain("value", value, None);
            }
        }
        if unsafe_text && let StaticValue::Text(text) = &value {
            return property(name, json_string(text));
        }
        plain(name, value, js)
    }

    /// `dangerouslySetInnerHTML={{ __html }}` is `innerHTML`: a property write of the markup.
    fn inner_html_attr(
        &mut self,
        value: Option<&JSXAttributeValue<'a>>,
        tag: &str,
        attribute: &JSXAttribute<'a>,
        attribute_ix: NodeIx,
        ns: Namespace,
        risk: bool,
    ) -> Result<Attr<'a>> {
        let inner = match value {
            None => None,
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                match &container.expression {
                    JSXExpression::EmptyExpression(_) => None,
                    other => Some(jsx_expression_ix(other)),
                }
            }
            Some(other) => Some(attribute_value_ix(other)),
        };
        let Some(inner) = inner else {
            return fail_span(
                "BAD_ATTRIBUTE",
                "dangerouslySetInnerHTML needs an object with __html.",
                attribute.span.start,
                attribute.span.end,
            );
        };
        if risk {
            self.capture(inner)?;
        }
        let tree = self.tree;
        let bare = unwrap_parens(tree, inner);
        if let AstKind::ObjectExpression(object) = tree.node(bare).kind {
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    continue;
                };
                let key_name = match &property.key {
                    PropertyKey::StaticIdentifier(it) => Some(it.name.as_str()),
                    PropertyKey::StringLiteral(it) => Some(it.value.as_str()),
                    PropertyKey::Identifier(it) => Some(it.name.as_str()),
                    _ => None,
                };
                if key_name != Some("__html") {
                    continue;
                }
                let html = ix_of_expression(&property.value);
                if let Some(Constant::Str(text)) = self.constant(html)? {
                    return Ok(Self::static_attribute(
                        Some(tag),
                        "innerHTML",
                        StaticValue::Text(text),
                        attribute,
                        attribute_ix,
                        None,
                    ));
                }
                return Ok(Attr::Expr {
                    name: "innerHTML".to_string(),
                    expr: self.expr(html, ns)?,
                    start: attribute.span.start,
                });
            }
            return fail_span(
                "BAD_ATTRIBUTE",
                "dangerouslySetInnerHTML needs a __html key.",
                attribute.span.start,
                attribute.span.end,
            );
        }
        let text = format!("({})?.__html", self.text_in(inner, ns)?);
        Ok(Attr::Expr {
            name: "innerHTML".to_string(),
            expr: ExprIR {
                text: Cow::Owned(text),
                node: inner,
                dynamic: true,
            },
            start: attribute.span.start,
        })
    }

    /// Lowers the attributes of one element or component. `tag` is the lower-case element name, or
    /// `None` for a component.
    fn lower_attrs(
        &mut self,
        attributes: &[JSXAttributeItem<'a>],
        tag: Option<&str>,
        ns: Namespace,
    ) -> Result<Vec<Attr<'a>>> {
        let mut out = Vec::with_capacity(attributes.len());
        // A component's props, and every prop of an element with a spread, are the entries of a props
        // object, where a dynamic value is a getter and a `ref` is a method: `this` there is the object.
        let risk = tag.is_none()
            || attributes
                .iter()
                .any(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)));
        // An explicit `value` (or `checked`) wins over its default: one write, whichever comes first.
        let explicit = if tag.is_some() {
            explicit_names(attributes)
        } else {
            Vec::new()
        };
        for item in attributes {
            let attribute = match item {
                JSXAttributeItem::SpreadAttribute(spread) => {
                    let argument = ix_of_expression(&spread.argument);
                    let expr = self.expr(argument, ns)?;
                    out.push(Attr::Spread {
                        expr,
                        start: spread.span.start,
                    });
                    continue;
                }
                JSXAttributeItem::Attribute(attribute) => attribute,
            };
            let attribute_ix = crate::classify::node_ix(attribute.node_id());
            let name = Self::attr_name(&attribute.name);
            if tag.is_some() && (name == "key" || is_ignored_attribute(&name)) {
                continue;
            }
            if (name == "defaultValue" && explicit.contains(&"value"))
                || (name == "defaultChecked" && explicit.contains(&"checked"))
            {
                continue;
            }
            let value = attribute.value.as_ref();
            if let Some(tag) = tag
                && name == "dangerouslySetInnerHTML"
            {
                out.push(self.inner_html_attr(value, tag, attribute, attribute_ix, ns, risk)?);
                continue;
            }
            let code_only = name
                .split_once(':')
                .is_some_and(|(namespace, _)| CODE_NAMESPACES.contains(&namespace));
            let start = attribute.span.start;
            if code_only {
                match value {
                    None => out.push(Attr::Expr {
                        name,
                        expr: ExprIR {
                            text: Cow::Borrowed("true"),
                            node: attribute_ix,
                            dynamic: false,
                        },
                        start,
                    }),
                    Some(value) => {
                        let inner = match value {
                            JSXAttributeValue::ExpressionContainer(container) => {
                                match &container.expression {
                                    JSXExpression::EmptyExpression(_) => None,
                                    other => Some(jsx_expression_ix(other)),
                                }
                            }
                            other => Some(attribute_value_ix(other)),
                        };
                        let Some(inner) = inner else {
                            return fail_span(
                                "EMPTY_ATTRIBUTE_EXPRESSION",
                                format!("Attribute \"{name}\" has an empty expression."),
                                value_span(value).0,
                                value_span(value).1,
                            );
                        };
                        self.mark(inner, &name, risk)?;
                        let expr = self.expr(inner, ns)?;
                        out.push(Attr::Expr { name, expr, start });
                    }
                }
                continue;
            }
            match value {
                None => out.push(Self::static_attribute(
                    tag,
                    &name,
                    StaticValue::True,
                    attribute,
                    attribute_ix,
                    None,
                )),
                Some(JSXAttributeValue::StringLiteral(literal)) => {
                    let decoded = decode_html_strict(literal.value.as_str()).into_owned();
                    out.push(Self::static_attribute(
                        tag,
                        &name,
                        StaticValue::Text(decoded),
                        attribute,
                        attribute_ix,
                        None,
                    ));
                }
                Some(JSXAttributeValue::ExpressionContainer(container)) => {
                    let inner = match &container.expression {
                        JSXExpression::EmptyExpression(_) => {
                            return fail_span(
                                "EMPTY_ATTRIBUTE_EXPRESSION",
                                format!("Attribute \"{name}\" has an empty expression."),
                                container.span.start,
                                container.span.end,
                            );
                        }
                        other => jsx_expression_ix(other),
                    };
                    match self.constant(inner)? {
                        Some(Constant::Str(text)) => out.push(Self::static_attribute(
                            tag,
                            &name,
                            StaticValue::Text(text),
                            attribute,
                            attribute_ix,
                            None,
                        )),
                        Some(Constant::Num(number)) => {
                            let text = number_to_string(number);
                            out.push(Self::static_attribute(
                                tag,
                                &name,
                                StaticValue::Text(text.clone()),
                                attribute,
                                attribute_ix,
                                Some(text),
                            ));
                        }
                        Some(Constant::Bool(true)) => {
                            // `aria-*`, `data-*` and the enumerated attributes carry "true" as text.
                            let value = if writes_boolean_as_text(&name) {
                                StaticValue::Text("true".to_string())
                            } else {
                                StaticValue::True
                            };
                            out.push(Self::static_attribute(
                                tag,
                                &name,
                                value,
                                attribute,
                                attribute_ix,
                                None,
                            ));
                        }
                        _ => {
                            self.mark(inner, &name, risk)?;
                            let expr = self.expr(inner, ns)?;
                            out.push(Attr::Expr { name, expr, start });
                        }
                    }
                }
                Some(JSXAttributeValue::Element(element)) => {
                    let inner = node_ix(element.node_id());
                    self.mark(inner, &name, risk)?;
                    let expr = self.expr(inner, ns)?;
                    out.push(Attr::Expr { name, expr, start });
                }
                Some(JSXAttributeValue::Fragment(fragment)) => {
                    let inner = node_ix(fragment.node_id());
                    self.mark(inner, &name, risk)?;
                    let expr = self.expr(inner, ns)?;
                    out.push(Attr::Expr { name, expr, start });
                }
            }
        }
        Ok(out)
    }

    /// Captures the `this` and `arguments` of a prop of a props object when the generated code puts it in
    /// a getter or a method (see [`Ctx::capture`]).
    fn mark(&mut self, inner: NodeIx, name: &str, risk: bool) -> Result<()> {
        if risk
            && (name == "ref"
                || is_dynamic(self.tree, inner, self.source)
                || contains_jsx(self.tree, inner))
        {
            self.capture(inner)?;
        }
        Ok(())
    }

    /// Appends a child, merging neighboring text and flattening fragments.
    fn push_child(out: &mut Vec<ChildIR<'a>>, child: ChildIR<'a>) {
        match child {
            ChildIR::Fragment(children) => {
                for inner in children {
                    Self::push_child(out, inner);
                }
            }
            ChildIR::Text(text) => {
                if let Some(ChildIR::Text(last)) = out.last_mut() {
                    last.push_str(&text);
                } else {
                    out.push(ChildIR::Text(text));
                }
            }
            other => out.push(other),
        }
    }

    /// The text a literal child renders as, `""` for a value that renders nothing (`null`, a
    /// boolean), and `None` for anything else, including text the template parser would not keep.
    fn literal_child_text(&self, node: NodeIx) -> Result<Option<String>> {
        // A string with a lone surrogate is text the template parser would not keep: not folded.
        if constant_value(self.tree, node) == ConstantResult::Unrepresentable {
            return Ok(None);
        }
        Ok(match self.constant(node)? {
            None => None,
            Some(Constant::Null | Constant::Bool(_)) => Some(String::new()),
            Some(Constant::Num(number)) => Some(number_to_string(number)),
            Some(Constant::Str(text)) => {
                if text.chars().any(is_unsafe_template_char) {
                    None
                } else {
                    Some(text)
                }
            }
        })
    }

    fn lower_children(
        &mut self,
        children: &[JSXChild<'a>],
        ns: Namespace,
        depth: u32,
        ancestors: &mut Vec<&'a str>,
        fold: bool,
    ) -> Result<Vec<ChildIR<'a>>> {
        let mut out: Vec<ChildIR> = Vec::with_capacity(children.len());
        for child in children {
            match child {
                JSXChild::Text(text) => {
                    let raw = text.raw.as_ref().map_or("", |raw| raw.as_str());
                    let source = if raw.is_empty() {
                        text.value.as_str()
                    } else {
                        raw
                    };
                    let cleaned = clean_jsx_text(source);
                    if !cleaned.is_empty() {
                        Self::push_child(&mut out, ChildIR::Text(cleaned));
                    }
                }
                JSXChild::Element(element) => {
                    let lowered =
                        self.lower_jsx(node_ix(element.node_id()), ns, depth + 1, ancestors, fold)?;
                    Self::push_child(&mut out, root_to_child(lowered));
                }
                JSXChild::Fragment(fragment) => {
                    let lowered = self.lower_jsx(
                        node_ix(fragment.node_id()),
                        ns,
                        depth + 1,
                        ancestors,
                        fold,
                    )?;
                    Self::push_child(&mut out, root_to_child(lowered));
                }
                JSXChild::ExpressionContainer(container) => {
                    if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                        continue;
                    }
                    let inner = jsx_expression_ix(&container.expression);
                    let bare = unwrap_parens(self.tree, inner);
                    if self.tree.ty(bare).is_jsx() {
                        let lowered = self.lower_jsx(bare, ns, depth + 1, ancestors, fold)?;
                        Self::push_child(&mut out, root_to_child(lowered));
                        continue;
                    }
                    let folded = if fold {
                        self.literal_child_text(bare)?
                    } else {
                        None
                    };
                    match folded {
                        None => {
                            let expr = self.expr(inner, ns)?;
                            Self::push_child(&mut out, ChildIR::Slot(expr));
                        }
                        Some(text) => {
                            if !text.is_empty() {
                                Self::push_child(&mut out, ChildIR::Text(text));
                            }
                        }
                    }
                }
                JSXChild::Spread(spread) => {
                    return fail_span(
                        "SPREAD_CHILD",
                        "Spread children are not supported.",
                        spread.span.start,
                        spread.span.end,
                    );
                }
            }
        }
        Ok(out)
    }

    /// Lowers a JSX element or fragment into the target-agnostic IR. `fold` says whether the
    /// children of a fragment may merge literal expressions into static text: it is true only for
    /// fragments inside an element that allows it.
    ///
    /// # Errors
    /// Fails with the compile error codes of the reference compiler.
    pub fn lower_jsx(
        &mut self,
        node: NodeIx,
        ns: Namespace,
        depth: u32,
        ancestors: &mut Vec<&'a str>,
        fold: bool,
    ) -> Result<RootIR<'a>> {
        let tree = self.tree;
        let (start, end) = (tree.start(node), tree.end(node));
        if depth > MAX_JSX_DEPTH {
            return fail_span(
                "JSX_TOO_DEEP",
                format!("JSX is nested more than {MAX_JSX_DEPTH} levels deep."),
                start,
                end,
            );
        }
        let element: &JSXElement<'a> = match tree.node(node).kind {
            AstKind::JSXFragment(fragment) => {
                let children =
                    self.lower_children(&fragment.children, ns, depth, ancestors, fold)?;
                return Ok(RootIR::Fragment(children));
            }
            AstKind::JSXElement(element) => element,
            _ => return fail_span("BAD_TAG", "Malformed element.", start, end),
        };
        let info = self.tag_info(&element.opening_element.name)?;
        let lower_tag = info.name.to_lowercase();
        let attrs = self.lower_attrs(
            &element.opening_element.attributes,
            if info.component {
                None
            } else {
                Some(lower_tag.as_str())
            },
            ns,
        )?;
        if info.component {
            for child in &element.children {
                let captured = match child {
                    JSXChild::Text(_) => None,
                    JSXChild::Element(it) => Some(node_ix(it.node_id())),
                    JSXChild::Fragment(it) => Some(node_ix(it.node_id())),
                    JSXChild::ExpressionContainer(it) => Some(node_ix(it.node_id())),
                    JSXChild::Spread(it) => Some(node_ix(it.node_id())),
                };
                if let Some(captured) = captured {
                    self.capture(captured)?;
                }
            }
            // The children of a component are templates of their own: `""` stops the chain of open
            // elements that the parser would repair (`<p><Card><div/></Card></p>` is fine).
            ancestors.push("");
            let children = self.lower_children(&element.children, ns, depth, ancestors, false);
            ancestors.pop();
            let children = children?;
            return Ok(RootIR::Component(ComponentIR {
                callee: info.name,
                attrs,
                children,
                start,
            }));
        }
        let mut child_ns = ns;
        let mut own = ns;
        if ns == Namespace::Html && SVG_ONLY_TAGS.contains(&info.name.as_str()) {
            own = Namespace::Svg;
            child_ns = Namespace::Svg;
        }
        if info.name == "svg" {
            own = Namespace::Svg;
            child_ns = Namespace::Svg;
        } else if info.name == "math" {
            own = Namespace::Math;
            child_ns = Namespace::Math;
        }
        if own == Namespace::Svg && info.name == "foreignObject" {
            child_ns = Namespace::Html;
        }
        let name_in_source: &'a str = element_tag_name(&element.opening_element.name);
        ancestors.push(name_in_source);
        let children = self.lower_children(
            &element.children,
            child_ns,
            depth,
            ancestors,
            !NO_TEXT_FOLD.contains(&info.name.as_str()),
        );
        ancestors.pop();
        let children = children?;
        if own == Namespace::Html {
            self.validate_children(&info.name, &children, node, ancestors)?;
        }
        if info.name == "textarea"
            && own == Namespace::Html
            && let Some(folded) = textarea_value(self.tree, &children, &attrs)
        {
            let mut attrs = attrs;
            attrs.push(folded);
            return Ok(RootIR::Element(ElementIR::new(
                info.name,
                own,
                info.custom,
                attrs,
                Vec::new(),
                start,
            )));
        }
        let children = if own == Namespace::Html
            && matches!(info.name.as_str(), "script" | "style" | "title")
        {
            join_text_children(children)
        } else {
            children
        };
        Ok(RootIR::Element(ElementIR::new(
            info.name,
            own,
            info.custom,
            attrs,
            children,
            start,
        )))
    }

    /// Rejects markup the browser parser would repair, which would desynchronize compiled node paths.
    fn validate_children(
        &self,
        parent: &str,
        children: &[ChildIR],
        node: NodeIx,
        ancestors: &[&str],
    ) -> Result<()> {
        let (start, end) = (self.tree.start(node), self.tree.end(node));
        if let Some(problem) = self_nesting_problem(parent, ancestors) {
            return fail_span("INVALID_HTML_NESTING", problem, start, end);
        }
        let mut chain: Vec<&str> = ancestors.to_vec();
        chain.push(parent);
        let strict_parent = matches!(parent, "table" | "tbody" | "thead" | "tfoot" | "tr");
        for child in children {
            match child {
                ChildIR::Element(element) => {
                    let problem = nesting_problem(parent, &element.tag).or_else(|| {
                        if element.ns == Namespace::Html {
                            ancestor_problem(&element.tag, &chain)
                        } else {
                            None
                        }
                    });
                    if let Some(problem) = problem {
                        return fail_span("INVALID_HTML_NESTING", problem, start, end);
                    }
                }
                ChildIR::Text(text)
                    if strict_parent
                        && !text.chars().all(|c| matches!(c, ' ' | '\t' | '\r' | '\n')) =>
                {
                    return fail_span(
                        "INVALID_HTML_NESTING",
                        format!("Text cannot be a direct child of <{parent}>."),
                        start,
                        end,
                    );
                }
                _ => {}
            }
        }
        Ok(())
    }
}

fn root_to_child(root: RootIR) -> ChildIR {
    match root {
        RootIR::Element(element) => ChildIR::Element(element),
        RootIR::Component(component) => ChildIR::Component(component),
        RootIR::Fragment(children) => ChildIR::Fragment(children),
    }
}

/// The tag of an element as written (an identifier; member and namespaced names are not elements).
fn element_tag_name<'a>(name: &JSXElementName<'a>) -> &'a str {
    match name {
        JSXElementName::Identifier(it) => it.name.as_str(),
        JSXElementName::IdentifierReference(it) => it.name.as_str(),
        _ => "",
    }
}

/// The text and slots of a text-only element (`script`, `style`, `title`) as one slot, the way
/// [`textarea_value`] does it for a textarea: the server writes them as a single run of text, so the
/// browser output holds a single region for it to adopt. A lone child is left as it is.
fn join_text_children<'a>(children: Vec<ChildIR<'a>>) -> Vec<ChildIR<'a>> {
    if children.len() < 2
        || children
            .iter()
            .any(|child| !matches!(child, ChildIR::Slot(_) | ChildIR::Text(_)))
    {
        return children;
    }
    let Some(first) = children.iter().find_map(|child| match child {
        ChildIR::Slot(expr) => Some(expr.node),
        _ => None,
    }) else {
        return children;
    };
    let mut parts = Vec::with_capacity(children.len());
    let mut dynamic = false;
    for child in &children {
        match child {
            ChildIR::Text(text) => parts.push(json_string(text)),
            ChildIR::Slot(expr) => {
                dynamic |= expr.dynamic;
                parts.push(format!("({})", expr.text));
            }
            _ => {}
        }
    }
    // Joined as an array so a child that is `null`, `undefined` or a boolean writes nothing (as it does for
    // any other child, and for a lone one): `join` takes the first two as empty, the filter the booleans.
    vec![ChildIR::Slot(ExprIR {
        text: Cow::Owned(format!(
            "[{}].filter((part) => typeof part !== \"boolean\").join(\"\")",
            parts.join(", ")
        )),
        node: first,
        dynamic,
    })]
}

/// A textarea's dynamic children are its value: `<textarea>{text()}</textarea>` binds the `value`
/// property like `value={text()}`, so the live text follows the data and the server writes the same
/// content with no comment markers inside it.
fn textarea_value<'a>(
    tree: &Tree<'_>,
    children: &[ChildIR<'a>],
    attrs: &[Attr<'a>],
) -> Option<Attr<'a>> {
    if !children
        .iter()
        .any(|child| matches!(child, ChildIR::Slot(_)))
    {
        return None;
    }
    if children
        .iter()
        .any(|child| !matches!(child, ChildIR::Slot(_) | ChildIR::Text(_)))
    {
        return None;
    }
    if attrs.iter().any(|attr| match attr {
        Attr::Spread { .. } => true,
        Attr::Static { name, .. } | Attr::Expr { name, .. } => {
            name == "value" || name == "defaultValue"
        }
    }) {
        return None;
    }
    let first = children.iter().find_map(|child| match child {
        ChildIR::Slot(expr) => Some(expr),
        _ => None,
    })?;
    let text: Cow<'a, str> = if children.len() == 1 {
        first.text.clone()
    } else {
        let mut parts = Vec::with_capacity(children.len());
        for child in children {
            match child {
                ChildIR::Text(text) => parts.push(json_string(text)),
                ChildIR::Slot(expr) => parts.push(format!("String(({}) ?? \"\")", expr.text)),
                _ => {}
            }
        }
        Cow::Owned(parts.join(" + "))
    };
    let dynamic = children
        .iter()
        .any(|child| matches!(child, ChildIR::Slot(expr) if expr.dynamic));
    Some(Attr::Expr {
        name: "value".to_string(),
        expr: ExprIR {
            text,
            node: first.node,
            dynamic,
        },
        start: tree.start(first.node),
    })
}
