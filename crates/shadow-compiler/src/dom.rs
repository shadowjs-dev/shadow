//! Code generation for the `dom` target: a cloned static template with reactive bindings.

use std::borrow::Cow;

use oxc_ast::ast::{ArrayExpressionElement, Expression};
use oxc_ast::ast_kind::AstKind;

use crate::classify::{contains_jsx, is_dynamic, ix_of_expression, node_ix, unwrap_parens};
use crate::ctx::Ctx;
use crate::error::{Result, fail_at};
use crate::ir::{Attr, ChildIR, ComponentIR, ElementIR, ExprIR, Namespace, RootIR, StaticValue};
use crate::jsutil::{json_string, utf16_len};
use crate::names::{attribute_name, event_plan, is_event_handler_attribute};
use crate::registry::Registry;
use crate::text::{escape_html_attribute, escape_html_text, property_key};
use crate::tree::{NodeIx, Ty};

/// Events whose handlers are attached once per document through event delegation.
const DELEGATED_EVENTS: &[&str] = &[
    "click",
    "dblclick",
    "input",
    "keydown",
    "keyup",
    "keypress",
    "pointerdown",
    "pointerup",
    "pointermove",
    "mousedown",
    "mouseup",
    "mousemove",
    "focusin",
    "focusout",
    "beforeinput",
    "touchstart",
    "touchend",
    "touchmove",
    "contextmenu",
    "mouseover",
    "mouseout",
    "pointerover",
    "pointerout",
];

/// Elements that have no closing tag and no children.
pub(crate) const VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

/// Elements whose text is not decoded or escaped.
pub(crate) const RAW_TEXT_ELEMENTS: &[&str] = &["script", "style"];

/// JSX names that are assigned as DOM properties (not attributes) on HTML elements.
const PROPERTIES: &[&str] = &[
    "value",
    "checked",
    "selected",
    "muted",
    "indeterminate",
    "disabled",
    "readOnly",
    "required",
    "multiple",
    "open",
    "autofocus",
    "autoplay",
    "controls",
    "loop",
    "hidden",
    "defaultChecked",
    "defaultValue",
    "noValidate",
    "formNoValidate",
    "inert",
    "playsInline",
    "reversed",
    "innerHTML",
    "textContent",
    "innerText",
];

/// The HTML elements that have a DOM property of [`PROPERTIES`]. A name that is not here is on every
/// HTML element (`hidden`, `inert`, `autofocus`, `innerHTML`, ...). On any other element the name is an
/// attribute: assigning the property would only set an expando the markup never shows, and `value` on
/// `li` is a number property that would turn `undefined` into `0`.
const PROPERTY_TAGS: &[(&str, &[&str])] = &[
    (
        "value",
        &[
            "button", "data", "input", "meter", "option", "output", "param", "progress", "select",
            "textarea",
        ],
    ),
    ("defaultValue", &["input", "output", "select", "textarea"]),
    ("checked", &["input"]),
    ("defaultChecked", &["input"]),
    ("indeterminate", &["input"]),
    ("selected", &["option"]),
    ("muted", &["audio", "video"]),
    ("autoplay", &["audio", "video"]),
    ("controls", &["audio", "video"]),
    ("loop", &["audio", "video"]),
    ("playsInline", &["video"]),
    (
        "disabled",
        &[
            "button", "fieldset", "input", "link", "optgroup", "option", "select", "style",
            "textarea",
        ],
    ),
    ("readOnly", &["input", "textarea"]),
    ("required", &["input", "select", "textarea"]),
    ("multiple", &["input", "select"]),
    ("open", &["details", "dialog"]),
    ("noValidate", &["form"]),
    ("formNoValidate", &["button", "input"]),
    ("reversed", &["ol"]),
];

/// Properties that must be applied after children exist (`<select value>`), and read back safely.
const POST_PROPERTIES: &[&str] = &[
    "value",
    "checked",
    "selected",
    "defaultValue",
    "defaultChecked",
];

const XLINK: &str = "http://www.w3.org/1999/xlink";

/// Variable naming and statement buffers for one generated block.
struct Block {
    decls: Vec<String>,
    ops: Vec<String>,
    counter: u32,
}

impl Block {
    fn new() -> Self {
        Block {
            decls: Vec::new(),
            ops: Vec::new(),
            counter: 0,
        }
    }

    /// The next element variable. The block's expressions are the user's own text, so a name the
    /// module already uses (`_el$` in code that was compiled before) is skipped instead of shadowed.
    fn id(&mut self, reg: &Registry) -> String {
        loop {
            self.counter += 1;
            let name = if self.counter == 1 {
                "_el$".to_string()
            } else {
                format!("_el${}", self.counter)
            };
            if !reg.is_taken(&name) {
                return name;
            }
        }
    }
}

/// `/^on[A-Za-z]/`.
pub(crate) fn is_event_attribute(name: &str) -> bool {
    name.strip_prefix("on")
        .is_some_and(|rest| rest.starts_with(|c: char| c.is_ascii_alphabetic()))
}

/// The React `autoFocus` attribute: a focus request, not markup.
fn is_auto_focus(name: &str, svg: bool) -> bool {
    name == "autoFocus" && !svg
}

fn element_flags(element: &ElementIR) -> u32 {
    let mut flags = match element.ns {
        Namespace::Svg => 1,
        Namespace::Math => 2,
        Namespace::Html => 0,
    };
    let mut stack = vec![element];
    while let Some(current) = stack.pop() {
        if current.custom {
            flags |= 4;
        }
        for child in &current.children {
            if let ChildIR::Element(inner) = child {
                stack.push(inner);
            }
        }
    }
    flags
}

/// One segment of the entries of a props object: plain entries, or one spread.
enum Segment {
    Plain(Vec<String>),
    Spread(String),
}

/// The `type` of an input when it is a static string; `None` when absent or dynamic.
fn static_type(element: &ElementIR) -> Option<String> {
    element.attrs.iter().find_map(|attr| match attr {
        Attr::Static {
            name,
            value: StaticValue::Text(text),
            ..
        } if name == "type" => Some(text.to_lowercase()),
        _ => None,
    })
}

/// Joins the segments of a props object the way every caller does: each plain segment is an object
/// literal, each spread is its expression.
fn segment_parts(segments: &[Segment]) -> Vec<String> {
    let mut parts = Vec::new();
    for segment in segments {
        match segment {
            Segment::Plain(entries) if entries.is_empty() => {}
            Segment::Plain(entries) => parts.push(format!("{{\n{}\n}}", entries.join(",\n"))),
            Segment::Spread(text) => parts.push(text.clone()),
        }
    }
    parts
}

impl<'t, 'a> Ctx<'t, 'a> {
    /// The statements that return `expression`: the body of an element root's wrapping function when
    /// `expression` is exactly one, else a plain `return`.
    pub(crate) fn return_statement(&self, expression: &str) -> String {
        match self.block_body(expression) {
            Some(body) => body.to_string(),
            None => format!("return {expression};"),
        }
    }

    /// Wraps text that an arrow function body or a statement would read as a block or a comma list in
    /// parentheses: an object literal, a sequence, and anything else that starts with a brace
    /// (`{ a: 1 }[key]`).
    pub(crate) fn wrap_object_literal<'s>(&self, text: &'s str, node: NodeIx) -> Cow<'s, str> {
        let inner = unwrap_parens(self.tree, node);
        match self.tree.ty(inner) {
            Ty::ObjectExpression | Ty::SequenceExpression => Cow::Owned(format!("({text})")),
            _ if text.starts_with('{') => Cow::Owned(format!("({text})")),
            _ => Cow::Borrowed(text),
        }
    }

    /// Reactive accessor text for a dynamic expression (or the value itself when static).
    fn accessor(&mut self, expr: &ExprIR) -> Result<String> {
        if !expr.dynamic {
            return Ok(expr.text.clone().into_owned());
        }
        let inner = unwrap_parens(self.tree, expr.node);
        if let AstKind::CallExpression(call) = self.tree.node(inner).kind
            && matches!(call.callee, Expression::Identifier(_))
            && call.arguments.is_empty()
        {
            return self
                .text(ix_of_expression(&call.callee))
                .map(Cow::into_owned);
        }
        Ok(format!(
            "() => {}",
            self.wrap_object_literal(&expr.text, expr.node)
        ))
    }

    /// Wraps dynamic conditional tests in memos so a branch is only rebuilt when truthiness changes. A
    /// chain `a ? x : b ? y : c ? z : w` is followed along its alternates with a loop, not recursion: its
    /// length is the user's. The texts are generated in the order the recursive form had (every test,
    /// then the end of the chain, then the branches from the last to the first), which fixes the order
    /// helpers and templates are registered in.
    fn plan_conditional(
        &mut self,
        node: NodeIx,
        memos: &mut Vec<String>,
    ) -> Result<Option<String>> {
        let tree = self.tree;
        let mut links: Vec<(String, NodeIx)> = Vec::new();
        let mut tail: Option<String> = None;
        let mut current = node;
        loop {
            let inner = unwrap_parens(tree, current);
            match tree.node(inner).kind {
                AstKind::ConditionalExpression(conditional) => {
                    let test = ix_of_expression(&conditional.test);
                    let consequent = ix_of_expression(&conditional.consequent);
                    let alternate = ix_of_expression(&conditional.alternate);
                    if is_dynamic(tree, test, self.source)
                        && (contains_jsx(tree, consequent) || contains_jsx(tree, alternate))
                    {
                        let name = self.reg.memo_name(memos.len()).to_string();
                        let memo = self.reg.helper("memo");
                        let test_text = self.text(test)?;
                        memos.push(format!("const {name} = {memo}(() => !!({test_text}));"));
                        links.push((name, consequent));
                        current = alternate;
                        continue;
                    }
                }
                AstKind::LogicalExpression(logical)
                    if logical.operator == oxc_ast::ast::LogicalOperator::And =>
                {
                    let left = ix_of_expression(&logical.left);
                    let right = ix_of_expression(&logical.right);
                    if is_dynamic(tree, left, self.source) && contains_jsx(tree, right) {
                        let name = self.reg.memo_name(memos.len()).to_string();
                        let memo = self.reg.helper("memo");
                        let left_text = self.text(left)?;
                        memos.push(format!("const {name} = {memo}(() => !!({left_text}));"));
                        let right_text = self.text(right)?;
                        tail = Some(format!("{name}() && {right_text}"));
                    }
                }
                _ => {}
            }
            break;
        }
        if links.is_empty() {
            return Ok(tail);
        }
        // What ends the chain is not planned: its text is the source as written.
        let tail = match tail {
            Some(text) => text,
            None => self.text(current)?.into_owned(),
        };
        // The branches are generated from the last to the first, but the text reads from the first to
        // the last: the pieces are joined once, so a long chain is not copied once per link.
        let mut pieces: Vec<String> = Vec::with_capacity(links.len() + 1);
        for (name, consequent) in links.iter().rev() {
            let consequent_text = self.text(*consequent)?;
            pieces.push(format!("{name}() ? {consequent_text} : "));
        }
        pieces.reverse();
        pieces.push(tail);
        Ok(Some(pieces.concat()))
    }

    /// Value passed to `insert` for an expression child.
    fn slot_value(&mut self, expr: &ExprIR) -> Result<String> {
        if !expr.dynamic {
            return Ok(expr.text.clone().into_owned());
        }
        let mut memos = Vec::new();
        if let Some(body) = self.plan_conditional(expr.node, &mut memos)? {
            return Ok(format!(
                "(() => {{\n{}\nreturn () => {body};\n}})()",
                memos.join("\n")
            ));
        }
        self.accessor(expr)
    }

    /// True when a `ref` target is a name that cannot be assigned.
    pub(crate) fn is_constant_ref(&self, node: NodeIx) -> bool {
        let target = unwrap_parens(self.tree, node);
        match self.tree.node(target).kind {
            AstKind::IdentifierReference(identifier) => {
                self.immutable().contains(identifier.name.as_str())
            }
            _ => false,
        }
    }

    pub(crate) fn ref_statement(&mut self, text: &str, node: NodeIx, constant: bool) -> String {
        let target = unwrap_parens(self.tree, node);
        let assignable =
            !constant && matches!(self.tree.ty(target), Ty::Identifier | Ty::MemberExpression);
        // `text` is the user's expression and is read inside this method: its local must not be a
        // name the module uses.
        let local = self.reg.local("_ref$");
        if assignable {
            format!(
                "ref(r$) {{\nconst {local} = {text};\ntypeof {local} === \"function\" ? {local}(r$) : {text} = r$;\n}}"
            )
        } else {
            format!(
                "ref(r$) {{\nconst {local} = {text};\ntypeof {local} === \"function\" && {local}(r$);\n}}"
            )
        }
    }

    fn prop_entries(
        &mut self,
        attrs: &[Attr],
        children: &[ChildIR],
        start: u32,
    ) -> Result<Vec<Segment>> {
        let mut segments: Vec<Segment> = vec![Segment::Plain(Vec::new())];
        for attr in attrs {
            match attr {
                Attr::Spread { expr, .. } => {
                    let text = if expr.dynamic {
                        format!("() => {}", self.wrap_object_literal(&expr.text, expr.node))
                    } else {
                        expr.text.clone().into_owned()
                    };
                    segments.push(Segment::Spread(text));
                    segments.push(Segment::Plain(Vec::new()));
                }
                Attr::Static {
                    name, value, js, ..
                } => {
                    let rendered = match value {
                        StaticValue::True => "true".to_string(),
                        StaticValue::Text(text) => js.clone().unwrap_or_else(|| json_string(text)),
                    };
                    push_plain(&mut segments, format!("{}: {rendered}", property_key(name)));
                }
                Attr::Expr { name, expr, .. } => {
                    if name == "ref" {
                        let constant = self.is_constant_ref(expr.node);
                        let entry = self.ref_statement(&expr.text, expr.node, constant);
                        push_plain(&mut segments, entry);
                    } else if expr.dynamic || contains_jsx(self.tree, expr.node) {
                        let body = self.return_statement(&expr.text);
                        push_plain(
                            &mut segments,
                            format!("get {}() {{\n{body}\n}}", property_key(name)),
                        );
                    } else {
                        push_plain(
                            &mut segments,
                            format!("{}: {}", property_key(name), expr.text),
                        );
                    }
                }
            }
        }
        if !children.is_empty() {
            if attrs.iter().any(|attr| match attr {
                Attr::Spread { .. } => false,
                Attr::Static { name, .. } | Attr::Expr { name, .. } => name == "children",
            }) {
                return fail_at(
                    "CHILDREN_CONFLICT",
                    "A component cannot have both a \"children\" prop and JSX children.",
                    start,
                );
            }
            let only = if children.len() == 1 {
                children.first()
            } else {
                None
            };
            match only {
                Some(ChildIR::Text(text)) => {
                    push_plain(&mut segments, format!("children: {}", json_string(text)));
                }
                Some(ChildIR::Slot(expr)) if !expr.dynamic => {
                    push_plain(&mut segments, format!("children: {}", expr.text));
                }
                _ => {
                    let value = match only {
                        None => {
                            let mut items = Vec::with_capacity(children.len());
                            for child in children {
                                items.push(self.child_value(child, false)?);
                            }
                            format!("[{}]", items.join(", "))
                        }
                        Some(child) => self.child_value(child, true)?,
                    };
                    let body = self.return_statement(&value);
                    push_plain(&mut segments, format!("get children() {{\n{body}\n}}"));
                }
            }
        }
        Ok(segments)
    }

    pub(crate) fn gen_component(&mut self, component: &ComponentIR) -> Result<String> {
        let segments = self.prop_entries(&component.attrs, &component.children, component.start)?;
        let create = self.reg.helper("createComponent");
        let parts = segment_parts(&segments);
        let props = if parts.is_empty() {
            "{}".to_string()
        } else if parts.len() == 1 && !parts[0].starts_with("() =>") {
            parts[0].clone()
        } else {
            // A lone dynamic spread is an accessor of the props: mergeProps turns it into a props object.
            format!("{}({})", self.reg.helper("mergeProps"), parts.join(", "))
        };
        let name = if self.dev {
            format!(", {}", json_string(&component.callee))
        } else {
            String::new()
        };
        Ok(format!("{create}({}, {props}{name})", component.callee))
    }

    /// Code for a child used as a value (component children, fragment items).
    fn child_value(&mut self, child: &ChildIR, reactive_single: bool) -> Result<String> {
        match child {
            ChildIR::Text(text) => Ok(json_string(text)),
            ChildIR::Element(element) => self.gen_element_root(element),
            ChildIR::Component(component) => self.gen_component(component),
            ChildIR::Fragment(children) => {
                let mut items = Vec::with_capacity(children.len());
                for inner in children {
                    items.push(self.child_value(inner, false)?);
                }
                Ok(format!("[{}]", items.join(", ")))
            }
            ChildIR::Slot(expr) => {
                if !expr.dynamic {
                    return Ok(expr.text.clone().into_owned());
                }
                if reactive_single {
                    return Ok(expr.text.clone().into_owned());
                }
                let memo = self.reg.helper("memo");
                Ok(format!(
                    "{memo}(() => {})",
                    self.wrap_object_literal(&expr.text, expr.node)
                ))
            }
        }
    }

    /// Single-function render effect. The braces matter: a returned function would become a cleanup.
    fn effect(&mut self, body: &str) -> String {
        format!("{}(() => {{\n{body};\n}});", self.reg.helper("effect"))
    }

    /// Wraps a statement in an effect when the expression is dynamic.
    fn run(&mut self, dynamic: bool, statement: String) -> String {
        if dynamic {
            let trimmed = statement
                .strip_suffix(';')
                .unwrap_or(&statement)
                .to_string();
            self.effect(&trimmed)
        } else {
            statement
        }
    }

    /// One handler as a function value: a `[fn, data]` tuple becomes `(event) => fn(data, event)`.
    fn handler_value(&mut self, expr: &ExprIR) -> Result<String> {
        let target = unwrap_parens(self.tree, expr.node);
        if let Some((handler, data)) = self.tuple_elements(target) {
            let handler_text = self.text(handler)?;
            let data_text = self.text(data)?;
            return Ok(format!(
                "((f, x) => (event) => f(x, event))({handler_text}, {data_text})"
            ));
        }
        Ok(expr.text.clone().into_owned())
    }

    /// The two elements of an array expression of exactly two non-hole elements.
    fn tuple_elements(&self, target: NodeIx) -> Option<(NodeIx, NodeIx)> {
        let AstKind::ArrayExpression(array) = self.tree.node(target).kind else {
            return None;
        };
        if array.elements.len() != 2 {
            return None;
        }
        let element_ix = |element: &ArrayExpressionElement<'_>| -> Option<NodeIx> {
            match element {
                ArrayExpressionElement::Elision(_) => None,
                ArrayExpressionElement::SpreadElement(spread) => Some(node_ix(spread.node_id())),
                other => Some(node_ix(other.node_id())),
            }
        };
        Some((
            element_ix(array.elements.first()?)?,
            element_ix(array.elements.get(1)?)?,
        ))
    }

    /// Delegated events that more than one attribute of one element binds (`onInput` and a text
    /// input's `onChange` are both `input`): the group is combined into one function.
    fn delegated_groups(element: &ElementIR, plain_count: usize) -> Vec<(String, Vec<usize>)> {
        let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
        let input_type = static_type(element);
        for index in 0..plain_count {
            let Some(Attr::Expr { name, .. }) = element.attrs.get(index) else {
                continue;
            };
            if !is_event_attribute(name) {
                continue;
            }
            let plan = event_plan(name, &element.tag, input_type.as_deref());
            if plan.capture || plan.passive || !DELEGATED_EVENTS.contains(&plan.event.as_str()) {
                continue;
            }
            match groups.iter_mut().find(|group| group.0 == plan.event) {
                Some(group) => group.1.push(index),
                None => groups.push((plan.event, vec![index])),
            }
        }
        groups.retain(|group| group.1.len() >= 2);
        groups
    }

    fn gen_attrs(
        &mut self,
        element: &ElementIR,
        var: Option<&str>,
        block: &mut Block,
    ) -> Result<(String, Vec<String>)> {
        let mut html = String::new();
        let mut post: Vec<String> = Vec::new();
        let spread_at = element
            .attrs
            .iter()
            .position(|attr| matches!(attr, Attr::Spread { .. }));
        let plain_count = spread_at.unwrap_or(element.attrs.len());
        let is_svg = element.ns == Namespace::Svg;
        let groups = Self::delegated_groups(element, plain_count);
        let grouped: Vec<usize> = groups
            .iter()
            .flat_map(|group| group.1.iter().copied())
            .collect();
        for index in 0..plain_count {
            let Some(attr) = element.attrs.get(index) else {
                continue;
            };
            if matches!(attr, Attr::Spread { .. }) {
                continue;
            }
            if grouped.contains(&index) {
                // The group is emitted once, at its first member; the others are part of that handler.
                let group = groups.iter().find(|group| group.1.first() == Some(&index));
                if let (Some((event, indexes)), Some(var)) = (group, var) {
                    let mut parts = Vec::with_capacity(indexes.len());
                    for &member_index in indexes {
                        match element.attrs.get(member_index) {
                            Some(Attr::Expr { .. }) => {
                                if let Some(Attr::Expr { expr, .. }) =
                                    element.attrs.get(member_index)
                                {
                                    parts.push(self.handler_value(expr)?);
                                }
                            }
                            _ => parts.push("undefined".to_string()),
                        }
                    }
                    self.reg.delegated.insert(event.clone());
                    let chain = self.reg.helper("chainEvents");
                    block
                        .ops
                        .push(format!("{var}.$${event} = {chain}({});", parts.join(", ")));
                }
                continue;
            }
            match attr {
                Attr::Static {
                    name, value, start, ..
                } => {
                    if is_event_handler_attribute(name) && matches!(value, StaticValue::Text(_)) {
                        return fail_at(
                            "STRING_EVENT_HANDLER",
                            format!("\"{name}\" received a string. Pass a function instead."),
                            *start,
                        );
                    }
                    if name == "children" {
                        return fail_at(
                            "CHILDREN_ATTRIBUTE",
                            "Use JSX children, not a children attribute.",
                            *start,
                        );
                    }
                    if is_auto_focus(name, is_svg) {
                        let Some(var) = var else {
                            return fail_at(
                                "INTERNAL",
                                "autoFocus without an element reference.",
                                *start,
                            );
                        };
                        let rendered = match value {
                            StaticValue::True => "true".to_string(),
                            StaticValue::Text(text) => json_string(text),
                        };
                        let call = self.reg.helper("autoFocus");
                        block.ops.push(format!("{call}({var}, {rendered});"));
                        continue;
                    }
                    html.push_str(&attribute_html(name, value, is_svg));
                }
                Attr::Expr { start, .. } => {
                    let Some(var) = var else {
                        return fail_at(
                            "INTERNAL",
                            "Dynamic attribute without an element reference.",
                            *start,
                        );
                    };
                    self.gen_expr_attr(element, attr, var, block, &mut post, is_svg)?;
                }
                Attr::Spread { .. } => {}
            }
        }
        if let Some(spread_at) = spread_at {
            let Some(var) = var else {
                return fail_at(
                    "INTERNAL",
                    "Spread without an element reference.",
                    element.start,
                );
            };
            let rest = element.attrs.get(spread_at..).unwrap_or(&[]);
            // The spread's runtime does not know `on:`, `use:`, `class:` and `style:`: those are
            // compiled as directives, after the spread, as they are when written before it.
            let plain: Vec<Attr> = rest
                .iter()
                .filter(|attr| !is_spread_directive(attr))
                .cloned()
                .collect();
            let segments = self.prop_entries(&plain, &[], element.start)?;
            let parts = segment_parts(&segments);
            let props = if parts.len() == 1 {
                parts[0].clone()
            } else {
                format!("{}({})", self.reg.helper("mergeProps"), parts.join(", "))
            };
            let has_children = !element.children.is_empty();
            let spread = self.reg.helper("spread");
            block.ops.push(format!(
                "{spread}({var}, {props}, {is_svg}, {has_children});"
            ));
            for directive in rest.iter().filter(|attr| is_spread_directive(attr)) {
                self.gen_expr_attr(element, directive, var, block, &mut post, is_svg)?;
            }
        }
        Ok((html, post))
    }

    fn gen_expr_attr(
        &mut self,
        element: &ElementIR,
        attr: &Attr,
        var: &str,
        block: &mut Block,
        post: &mut Vec<String>,
        is_svg: bool,
    ) -> Result<()> {
        let Attr::Expr {
            name: raw_name,
            expr: raw_expr,
            start,
        } = attr
        else {
            return Ok(());
        };
        // `xlinkHref` is the namespaced `xlink:href` in SVG; every other name is spelled as written here.
        let name: String = if is_svg && is_xlink_camel(raw_name) {
            attribute_name(raw_name, true)
        } else {
            raw_name.clone()
        };
        // Forgiving: a bare identifier may hold a signal accessor (`value={count}`). It is read through
        // a small unwrap inside a binding, so it works whether it holds a value or an accessor.
        let identifier = unwrap_parens(self.tree, raw_expr.node);
        let identifier_name = match self.tree.node(identifier).kind {
            AstKind::IdentifierReference(it) if self.tree.ty(identifier) == Ty::Identifier => {
                Some(it.name.as_str())
            }
            _ => None,
        };
        let maybe_accessor = !raw_expr.dynamic
            && identifier_name.is_some_and(|n| !matches!(n, "undefined" | "NaN" | "Infinity"))
            && name != "ref"
            && name != "children"
            && !is_event_attribute(&name)
            // A function given to a property or an attribute directive is the value, not an accessor.
            && !has_code_prefix(&name)
            && !is_custom_property(element, &name, is_svg);
        let replaced: Option<ExprIR> = maybe_accessor.then(|| ExprIR {
            text: Cow::Owned(format!(
                "(typeof {t} === \"function\" ? {t}() : {t})",
                t = raw_expr.text
            )),
            node: raw_expr.node,
            dynamic: true,
        });
        let expr: &ExprIR = replaced.as_ref().unwrap_or(raw_expr);
        let text = self.wrap_object_literal(&expr.text, expr.node);
        let dynamic = expr.dynamic;

        if name == "ref" {
            // A ref is a callback, a `{ current }` object (`useRef`-style, filled and cleared by refTo), or a
            // variable that receives the element. A `let` or member variable holding neither takes the element.
            let target = unwrap_parens(self.tree, expr.node);
            let ref_to = self.reg.helper("refTo");
            if self.is_constant_ref(target)
                || !matches!(self.tree.ty(target), Ty::Identifier | Ty::MemberExpression)
            {
                block.ops.push(format!("{ref_to}({}, {var});", expr.text));
            } else {
                let t = &expr.text;
                block.ops.push(format!(
                    "typeof {t} === \"function\" || ({t} !== null && typeof {t} === \"object\" && \"current\" in {t}) ? {ref_to}({t}, {var}) : ({t} = {var});"
                ));
            }
            return Ok(());
        }
        if let Some((namespace, local)) = name.split_once(':') {
            match namespace {
                "on" | "oncapture" => {
                    let add = self.reg.helper("addEventListener");
                    let capture = if namespace == "oncapture" {
                        ", false, true"
                    } else {
                        ""
                    };
                    block.ops.push(format!(
                        "{add}({var}, {}, {text}{capture});",
                        json_string(local)
                    ));
                }
                "use" => {
                    let call = self.reg.helper("use");
                    block
                        .ops
                        .push(format!("{call}({local}, {var}, () => {text});"));
                }
                "prop" => {
                    let statement =
                        self.run(dynamic, format!("{var}[{}] = {text};", json_string(local)));
                    block.ops.push(statement);
                }
                "attr" => {
                    let call = self.reg.helper("setAttribute");
                    let statement = self.run(
                        dynamic,
                        format!("{call}({var}, {}, {text});", json_string(local)),
                    );
                    block.ops.push(statement);
                }
                "bool" => {
                    let call = self.reg.helper("setBoolAttribute");
                    let statement = self.run(
                        dynamic,
                        format!("{call}({var}, {}, {text});", json_string(local)),
                    );
                    block.ops.push(statement);
                }
                "class" => {
                    let statement = self.run(
                        dynamic,
                        format!(
                            "{var}.classList.toggle({}, !!({text}));",
                            json_string(local)
                        ),
                    );
                    block.ops.push(statement);
                }
                "style" => {
                    let call = self.reg.helper("setStyleProperty");
                    let statement = self.run(
                        dynamic,
                        format!("{call}({var}, {}, {text});", json_string(local)),
                    );
                    block.ops.push(statement);
                }
                "xlink" => {
                    let call = self.reg.helper("setAttributeNS");
                    let statement = self.run(
                        dynamic,
                        format!(
                            "{call}({var}, {}, {}, {text});",
                            json_string(XLINK),
                            json_string(&name)
                        ),
                    );
                    block.ops.push(statement);
                }
                _ => {
                    return fail_at(
                        "UNKNOWN_NAMESPACE",
                        format!("Unknown attribute namespace \"{namespace}:\"."),
                        *start,
                    );
                }
            }
            return Ok(());
        }
        if is_event_attribute(&name) {
            return self.gen_event(element, &name, expr, var, block);
        }
        if name == "class" || name == "className" {
            let call = self.reg.helper("className");
            let statement = self.run(dynamic, format!("{call}({var}, {text});"));
            block.ops.push(statement);
            return Ok(());
        }
        if name == "classList" || name == "style" {
            let helper_name = if name == "classList" {
                "classList"
            } else {
                "style"
            };
            let call = self.reg.helper(helper_name);
            if dynamic {
                let effect = self.reg.helper("effect");
                block.ops.push(format!(
                    "{effect}(() => {text}, (_v$, _p$) => {{\n{call}({var}, _v$, _p$);\n}});"
                ));
            } else {
                block.ops.push(format!("{call}({var}, {text});"));
            }
            return Ok(());
        }
        if name == "children" {
            return fail_at(
                "CHILDREN_ATTRIBUTE",
                "Use JSX children, not a children attribute.",
                *start,
            );
        }
        if is_auto_focus(&name, is_svg) {
            // Read once, when the element is created: React applies autoFocus at commit, not on updates.
            let call = self.reg.helper("autoFocus");
            block.ops.push(format!("{call}({var}, {text});"));
            return Ok(());
        }
        if assigns_property(element, &name) {
            // A select's value may be an array (`multiple`): a helper selects the options it lists.
            let assignment =
                if (name == "value" || name == "defaultValue") && element.tag == "select" {
                    format!("{}({var}, {text});", self.reg.helper("setSelectValue"))
                } else if name == "value" {
                    format!("{var}.value = ({text}) ?? \"\";")
                } else {
                    format!("{var}.{name} = {text};")
                };
            let statement = self.run(dynamic, assignment);
            if POST_PROPERTIES.contains(&name.as_str()) {
                post.push(statement);
            } else {
                block.ops.push(statement);
            }
            return Ok(());
        }
        if element.custom && !name.contains('-') {
            let statement = self.run(dynamic, format!("{var}[{}] = {text};", json_string(&name)));
            block.ops.push(statement);
            return Ok(());
        }
        let call = self.reg.helper("setAttribute");
        let statement = self.run(
            dynamic,
            format!(
                "{call}({var}, {}, {text});",
                json_string(&attribute_name(&name, is_svg))
            ),
        );
        block.ops.push(statement);
        Ok(())
    }

    /// Binds one event handler. The React spelling picks the DOM event (see `event_plan`). Delegated
    /// events are stored on the element; capture and passive bindings are native listeners.
    fn gen_event(
        &mut self,
        element: &ElementIR,
        attr_name: &str,
        expr: &ExprIR,
        var: &str,
        block: &mut Block,
    ) -> Result<()> {
        let plan = event_plan(attr_name, &element.tag, static_type(element).as_deref());
        let name = plan.event.as_str();
        let target = unwrap_parens(self.tree, expr.node);
        if DELEGATED_EVENTS.contains(&name) && !plan.capture {
            self.reg.delegated.insert(name.to_string());
            if let Some((handler, data)) = self.tuple_elements(target) {
                let handler_text = self.text(handler)?;
                block.ops.push(format!("{var}.$${name} = {handler_text};"));
                let data_text = self.text(data)?;
                block.ops.push(format!("{var}.$${name}Data = {data_text};"));
            } else {
                block.ops.push(format!("{var}.$${name} = {};", expr.text));
            }
            return Ok(());
        }
        let add = self.reg.helper("addEventListener");
        if plan.passive && self.tree.ty(target) != Ty::ArrayExpression {
            // React binds wheel passive, so a handler cannot cancel scrolling. A `[fn, data]` tuple keeps
            // the default listener options.
            block.ops.push(format!(
                "{add}({var}, {}, {{ handleEvent: {}, passive: true }});",
                json_string(name),
                expr.text
            ));
            return Ok(());
        }
        let capture = if plan.capture { ", false, true" } else { "" };
        block.ops.push(format!(
            "{add}({var}, {}, {}{capture});",
            json_string(name),
            expr.text
        ));
        Ok(())
    }

    /// Emits the children of `element`: the template text, and the declarations and operations that
    /// reach and fill the dynamic parts. Returns the template html of the children.
    fn walk_children(
        &mut self,
        element: &ElementIR,
        var: Option<&str>,
        block: &mut Block,
    ) -> Result<String> {
        let items = &element.children;
        let raw = RAW_TEXT_ELEMENTS.contains(&element.tag.as_str());
        let mut nodes: Vec<NodePlan> = Vec::new();
        let mut slots: Vec<SlotPlan> = Vec::new();
        // For each item: the node index it belongs to, or `None` for a slot, and the slot index.
        let mut node_of_item: Vec<Option<usize>> = Vec::with_capacity(items.len());
        let mut slot_of_item: Vec<Option<usize>> = Vec::with_capacity(items.len());
        let mut pending: Vec<usize> = Vec::new();

        let resolve =
            |slots: &mut Vec<SlotPlan>, pending: &mut Vec<usize>, node: usize, piece: usize| {
                let count = pending.len();
                for (index, &slot) in pending.iter().enumerate() {
                    if let Some(plan) = slots.get_mut(slot) {
                        plan.before = Some((node, piece));
                        plan.fresh = index + 1 < count;
                    }
                }
                pending.clear();
            };

        for (position, item) in items.iter().enumerate() {
            match item {
                ChildIR::Fragment(_) => {
                    return fail_at("INTERNAL", "Fragment survived lowering.", element.start);
                }
                ChildIR::Text(value) => {
                    let merge =
                        !pending.is_empty() && matches!(nodes.last(), Some(NodePlan::Text { .. }));
                    if merge {
                        let index = nodes.len() - 1;
                        let mut piece = 0;
                        if let Some(NodePlan::Text {
                            value: text, cuts, ..
                        }) = nodes.last_mut()
                        {
                            cuts.push(utf16_len(text));
                            text.push_str(value);
                            piece = cuts.len();
                        }
                        resolve(&mut slots, &mut pending, index, piece);
                        node_of_item.push(Some(index));
                    } else {
                        nodes.push(NodePlan::Text {
                            value: value.clone(),
                            cuts: Vec::new(),
                            names: Vec::new(),
                        });
                        resolve(&mut slots, &mut pending, nodes.len() - 1, 0);
                        node_of_item.push(Some(nodes.len() - 1));
                    }
                    slot_of_item.push(None);
                }
                ChildIR::Element(_) => {
                    nodes.push(NodePlan::Element {
                        item: position,
                        name: None,
                    });
                    resolve(&mut slots, &mut pending, nodes.len() - 1, 0);
                    node_of_item.push(Some(nodes.len() - 1));
                    slot_of_item.push(None);
                }
                ChildIR::Slot(_) | ChildIR::Component(_) => {
                    slots.push(SlotPlan {
                        item: position,
                        before: None,
                        fresh: false,
                        anchor_name: None,
                    });
                    pending.push(slots.len() - 1);
                    node_of_item.push(None);
                    slot_of_item.push(Some(slots.len() - 1));
                }
            }
        }
        let pending_count = pending.len();
        for (index, &slot) in pending.iter().enumerate() {
            if let Some(plan) = slots.get_mut(slot) {
                plan.before = None;
                plan.fresh = index + 1 < pending_count;
            }
        }

        if !slots.is_empty() && var.is_none() {
            return fail_at(
                "INTERNAL",
                "Dynamic child without a parent reference.",
                element.start,
            );
        }

        // Which template nodes need variables?
        let mut needs_var = vec![false; nodes.len()];
        for (index, node) in nodes.iter().enumerate() {
            let needed = match node {
                NodePlan::Element { item, .. } => matches!(
                    items.get(*item),
                    Some(ChildIR::Element(inner)) if inner.dynamic_parts
                ),
                NodePlan::Text { cuts, .. } => !cuts.is_empty(),
            };
            if needed && let Some(flag) = needs_var.get_mut(index) {
                *flag = true;
            }
        }
        for slot in &slots {
            if let Some((node, _)) = slot.before
                && let Some(flag) = needs_var.get_mut(node)
            {
                *flag = true;
            }
        }

        // Name allocation (parents before children keeps numbering readable).
        for (index, node) in nodes.iter_mut().enumerate() {
            if !needs_var.get(index).copied().unwrap_or(false) {
                continue;
            }
            let name = block.id(&self.reg);
            match node {
                NodePlan::Element { name: slot, .. } => *slot = Some(name),
                NodePlan::Text { names, cuts, .. } => {
                    names.push(name);
                    for _ in 0..cuts.len() {
                        names.push(block.id(&self.reg));
                    }
                }
            }
        }
        for slot in &mut slots {
            if slot.fresh {
                slot.anchor_name = Some(block.id(&self.reg));
            }
        }

        // Emission in item order.
        let mut html = String::new();
        let mut last_var: Option<String> = None;
        let mut since: usize = 0;
        let mut processed: Option<usize> = None;
        for (position, _item) in items.iter().enumerate() {
            if let Some(node_index) = node_of_item.get(position).copied().flatten() {
                if processed != Some(node_index) {
                    processed = Some(node_index);
                    self.declare_node(
                        element,
                        node_index,
                        &nodes,
                        &slots,
                        &needs_var,
                        var,
                        block,
                        raw,
                        &mut html,
                        &mut last_var,
                        &mut since,
                    )?;
                }
                continue;
            }
            let Some(slot_index) = slot_of_item.get(position).copied().flatten() else {
                continue;
            };
            let Some(slot) = slots.get(slot_index) else {
                continue;
            };
            let value = match items.get(slot.item) {
                Some(ChildIR::Component(component)) => self.gen_component(component)?,
                Some(ChildIR::Slot(expr)) => self.slot_value(expr)?,
                _ => String::new(),
            };
            let insert = self.reg.helper("insert");
            let anchor = anchor_expr(slot, &nodes);
            let parent = var.unwrap_or("");
            let tail = match anchor {
                Some(name) => format!(", {name}"),
                None => String::new(),
            };
            block
                .ops
                .push(format!("{insert}({parent}, {value}{tail});"));
        }

        // Fresh anchors with no following static node are appended at the end.
        for slot in &slots {
            if slot.fresh
                && slot.before.is_none()
                && let Some(name) = &slot.anchor_name
            {
                let anchor = self.reg.helper("anchor");
                block
                    .decls
                    .push(format!("{name} = {anchor}({}, null)", var.unwrap_or("")));
            }
        }
        Ok(html)
    }

    #[allow(clippy::too_many_arguments)]
    fn declare_node(
        &mut self,
        element: &ElementIR,
        index: usize,
        nodes: &[NodePlan],
        slots: &[SlotPlan],
        needs_var: &[bool],
        var: Option<&str>,
        block: &mut Block,
        raw: bool,
        html: &mut String,
        last_var: &mut Option<String>,
        since: &mut usize,
    ) -> Result<()> {
        let Some(node) = nodes.get(index) else {
            return Ok(());
        };
        let parent = var.unwrap_or("");
        let mut node_var: Option<String> = None;
        if needs_var.get(index).copied().unwrap_or(false) {
            node_var = match node {
                NodePlan::Element { name, .. } => name.clone(),
                NodePlan::Text { names, .. } => names.first().cloned(),
            };
            let path = match last_var.as_deref() {
                None => format!("{parent}.firstChild{}", ".nextSibling".repeat(*since)),
                Some(previous) => format!("{previous}{}", ".nextSibling".repeat(*since + 1)),
            };
            if let Some(name) = &node_var {
                block.decls.push(format!("{name} = {path}"));
                *last_var = Some(name.clone());
            }
            *since = 0;
        } else {
            *since += 1;
        }
        match node {
            NodePlan::Text { value, cuts, names } => {
                for position in 0..cuts.len() {
                    let previous = names.get(position).cloned().unwrap_or_default();
                    let piece = names.get(position + 1).cloned().unwrap_or_default();
                    let before = if position == 0 {
                        0
                    } else {
                        cuts.get(position - 1).copied().unwrap_or(0)
                    };
                    let offset = cuts.get(position).copied().unwrap_or(0) - before;
                    block
                        .decls
                        .push(format!("{piece} = {previous}.splitText({offset})"));
                    *last_var = Some(piece);
                }
                if !cuts.is_empty() {
                    *since = 0;
                }
                if raw {
                    html.push_str(value);
                } else {
                    html.push_str(&escape_html_text(value));
                }
                if raw && value.to_lowercase().contains(&format!("</{}", element.tag)) {
                    return fail_at(
                        "RAW_TEXT_CLOSE",
                        format!("Text inside <{0}> must not contain \"</{0}\".", element.tag),
                        element.start,
                    );
                }
            }
            NodePlan::Element { item, name } => {
                if let Some(ChildIR::Element(inner)) = element.children.get(*item) {
                    let walked = self.walk_element(inner, name.as_deref(), block)?;
                    html.push_str(&walked);
                }
            }
        }
        // Fresh anchors waiting for this node.
        for slot in slots {
            if let (true, Some((node_index, piece)), Some(anchor_name)) =
                (slot.fresh, slot.before, slot.anchor_name.as_ref())
                && node_index == index
            {
                let target: Option<String> = if piece == 0 {
                    node_var.clone()
                } else {
                    match node {
                        NodePlan::Text { names, .. } => names.get(piece).cloned(),
                        NodePlan::Element { .. } => None,
                    }
                };
                if let Some(target) = target {
                    let anchor = self.reg.helper("anchor");
                    block
                        .decls
                        .push(format!("{anchor_name} = {anchor}({parent}, {target})"));
                }
            }
        }
        Ok(())
    }

    fn walk_element(
        &mut self,
        element: &ElementIR,
        var: Option<&str>,
        block: &mut Block,
    ) -> Result<String> {
        let (attr_html, post) = self.gen_attrs(element, var, block)?;
        let mut html = format!("<{}{attr_html}>", element.tag);
        if VOID_ELEMENTS.contains(&element.tag.as_str()) {
            if !element.children.is_empty() {
                return fail_at(
                    "VOID_CHILDREN",
                    format!("<{}> cannot have children.", element.tag),
                    element.start,
                );
            }
            block.ops.extend(post);
            return Ok(html);
        }
        html.push_str(&self.walk_children(element, var, block)?);
        block.ops.extend(post);
        html.push_str(&format!("</{}>", element.tag));
        Ok(html)
    }

    fn gen_element_root(&mut self, element: &ElementIR) -> Result<String> {
        let mut block = Block::new();
        let root_var = if element.dynamic_parts {
            Some(block.id(&self.reg))
        } else {
            None
        };
        let html = self.walk_element(element, root_var.as_deref(), &mut block)?;
        let template = self.reg.template(&html, element_flags(element));
        let Some(root_var) = root_var else {
            return Ok(format!("{template}()"));
        };
        let mut decls = vec![format!("{root_var} = {template}()")];
        decls.extend(block.decls);
        let mut lines = vec![format!("const {};", decls.join(",\n"))];
        lines.extend(block.ops);
        lines.push(format!("return {root_var};"));
        let body = lines.join("\n");
        let call = format!("(() => {{\n{body}\n}})()");
        self.blocks.insert(body);
        Ok(call)
    }

    /// Generates the replacement expression for one JSX root in `dom` mode.
    ///
    /// # Errors
    /// Fails with the compile error codes of the reference compiler.
    pub fn generate_dom(&mut self, root: &RootIR) -> Result<String> {
        match root {
            RootIR::Element(element) => self.gen_element_root(element),
            RootIR::Component(component) => self.gen_component(component),
            RootIR::Fragment(children) => {
                let mut items = Vec::with_capacity(children.len());
                for child in children {
                    items.push(self.child_value(child, false)?);
                }
                Ok(format!("[{}]", items.join(", ")))
            }
        }
    }
}

enum NodePlan {
    Text {
        value: String,
        cuts: Vec<usize>,
        names: Vec<String>,
    },
    Element {
        item: usize,
        name: Option<String>,
    },
}

struct SlotPlan {
    /// Index of the slot or component among the children of the element.
    item: usize,
    /// Static node (index, piece) the slot inserts before; `None` appends.
    before: Option<(usize, usize)>,
    /// True when the slot needs its own empty Text anchor (another dynamic slot follows).
    fresh: bool,
    anchor_name: Option<String>,
}

fn anchor_expr(slot: &SlotPlan, nodes: &[NodePlan]) -> Option<String> {
    if slot.fresh {
        return slot.anchor_name.clone();
    }
    let (node, piece) = slot.before?;
    match nodes.get(node)? {
        NodePlan::Element { name, .. } => name.clone(),
        NodePlan::Text { names, .. } => names.get(piece).cloned(),
    }
}

fn push_plain(segments: &mut Vec<Segment>, entry: String) {
    if let Some(Segment::Plain(entries)) = segments.last_mut() {
        entries.push(entry);
    } else {
        segments.push(Segment::Plain(vec![entry]));
    }
}

fn attribute_html(name: &str, value: &StaticValue, svg: bool) -> String {
    let attr = attribute_name(name, svg);
    match value {
        StaticValue::True => format!(" {attr}"),
        StaticValue::Text(text) => format!(" {attr}=\"{}\"", escape_html_attribute(text)),
    }
}

/// `/^xlink[A-Z]/`.
fn is_xlink_camel(name: &str) -> bool {
    name.strip_prefix("xlink")
        .is_some_and(|rest| rest.starts_with(|c: char| c.is_ascii_uppercase()))
}

/// `/^(?:use|on|oncapture|prop|attr):/`.
fn has_code_prefix(name: &str) -> bool {
    name.starts_with("use:")
        || name.starts_with("on:")
        || name.starts_with("oncapture:")
        || name.starts_with("prop:")
        || name.starts_with("attr:")
}

/// True for `on:x`, `oncapture:x`, `use:x`, `class:x` and `style:x`: the attribute namespaces the
/// runtime spread cannot apply, so the compiler binds them itself.
pub(crate) fn is_spread_directive(attr: &Attr) -> bool {
    match attr {
        Attr::Expr { name, .. } => name.split_once(':').is_some_and(|(namespace, _)| {
            matches!(namespace, "on" | "oncapture" | "use" | "class" | "style")
        }),
        _ => false,
    }
}

/// True when a custom element gets this attribute as a property (`el.items = value`): every name that
/// has no markup meaning of its own. A hyphenated name (`data-x`, `aria-label`) is an attribute.
fn is_custom_property(element: &ElementIR, name: &str, svg: bool) -> bool {
    element.custom
        && !svg
        && !name.contains('-')
        && !name.contains(':')
        && !PROPERTIES.contains(&name)
        && !matches!(
            name,
            "class" | "className" | "classList" | "style" | "autoFocus"
        )
        && !is_event_attribute(name)
}

/// True when `name` is assigned as a DOM property on this element (see [`PROPERTY_TAGS`]).
fn assigns_property(element: &ElementIR, name: &str) -> bool {
    if !PROPERTIES.contains(&name) || element.ns == Namespace::Svg {
        return false;
    }
    // A custom element declares its own properties: the names are assigned as they are.
    if element.custom {
        return true;
    }
    if element.ns != Namespace::Html {
        return false;
    }
    match PROPERTY_TAGS.iter().find(|(property, _)| *property == name) {
        Some((_, tags)) => tags.contains(&element.tag.as_str()),
        None => true,
    }
}
