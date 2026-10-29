//! Code generation for the `ssr` target: server strings with hydration keys.

use crate::classify::contains_jsx;
use crate::ctx::Ctx;
use crate::dom::{RAW_TEXT_ELEMENTS, VOID_ELEMENTS, is_event_attribute};
use crate::error::{Result, fail_at, unsupported};
use crate::ir::{Attr, ChildIR, ComponentIR, ElementIR, ExprIR, Namespace, RootIR, StaticValue};
use crate::jsutil::json_string;
use crate::names::{attribute_name, is_event_handler_attribute};
use crate::text::{escape_html_attribute, escape_html_text, property_key};

/// Properties written as plain attributes on the server (the client sets them as DOM properties).
const BOOLEAN_PROPERTIES: &[&str] = &[
    "checked",
    "selected",
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
    "muted",
    "noValidate",
    "formNoValidate",
    "inert",
    "playsInline",
    "reversed",
    "defaultChecked",
];
const VALUE_PROPERTIES: &[&str] = &["value", "defaultValue"];
const SKIPPED_PROPERTIES: &[&str] = &["indeterminate", "textContent", "innerText"];

/// The names of the members every JavaScript object has. The reference compiler looks a few
/// attribute names up in a plain object, so an attribute with one of these names comes out as the
/// source text of a function; the Rust compiler leaves such a module to the reference.
const OBJECT_MEMBER_NAMES: &[&str] = &[
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
];

/// The attribute a JSX name is written as in the markup.
fn markup_name(name: &str, svg: bool) -> String {
    match name {
        "defaultChecked" => "checked".to_string(),
        "defaultValue" => "value".to_string(),
        _ => attribute_name(name, svg),
    }
}

/// How the HTML parser reads the content of an element.
#[derive(Clone, Copy)]
enum TextKind {
    /// `script` and `style`: no tags, no entities.
    Raw,
    /// `title` and `textarea`: entities only.
    Escapable,
}

/// The kind of text-only content an element has. Neither kind can hold a comment, so the markers that
/// delimit a dynamic child elsewhere would show up as text. SVG parses these names as ordinary elements.
fn text_kind(element: &ElementIR) -> Option<TextKind> {
    if element.ns != Namespace::Html {
        return None;
    }
    match element.tag.as_str() {
        "script" | "style" => Some(TextKind::Raw),
        "title" | "textarea" => Some(TextKind::Escapable),
        _ => None,
    }
}

/// Collects alternating static strings and runtime holes.
#[derive(Default)]
struct Parts {
    statics: Vec<String>,
    holes: Vec<String>,
    current: String,
}

impl Parts {
    fn text(&mut self, value: &str) {
        self.current.push_str(value);
    }

    fn hole(&mut self, code: String) {
        self.statics.push(std::mem::take(&mut self.current));
        self.holes.push(code);
    }

    fn finish(&self) -> (Vec<String>, &[String]) {
        let mut statics = self.statics.clone();
        statics.push(self.current.clone());
        (statics, &self.holes)
    }
}

fn is_event_name(name: &str) -> bool {
    is_event_attribute(name)
}

struct ClassSources {
    statics: Vec<String>,
    dynamic: Vec<String>,
}

fn class_sources(element: &ElementIR) -> ClassSources {
    let mut statics = Vec::new();
    let mut dynamic = Vec::new();
    for attr in &element.attrs {
        match attr {
            Attr::Static {
                name,
                value: StaticValue::Text(text),
                ..
            } if name == "class" || name == "className" => {
                statics.push(text.clone());
            }
            Attr::Expr { name, expr, .. } => {
                if name == "class" || name == "className" || name == "classList" {
                    dynamic.push(expr.text.to_string());
                } else if let Some(rest) = name.strip_prefix("class:") {
                    dynamic.push(format!("{{ {}: {} }}", json_string(rest), expr.text));
                }
            }
            _ => {}
        }
    }
    ClassSources { statics, dynamic }
}

/// The `style` sources of an element: its static string first, then each `style` and `style:` in order.
struct StyleSources {
    statics: Vec<String>,
    dynamic: Vec<String>,
}

fn style_sources(element: &ElementIR) -> StyleSources {
    let mut statics = Vec::new();
    let mut dynamic = Vec::new();
    for attr in &element.attrs {
        match attr {
            Attr::Static {
                name,
                value: StaticValue::Text(text),
                ..
            } if name == "style" => statics.push(text.clone()),
            Attr::Expr { name, expr, .. } => {
                if name == "style" {
                    dynamic.push(expr.text.to_string());
                } else if let Some(rest) = name.strip_prefix("style:") {
                    dynamic.push(format!("{{ {}: {} }}", json_string(rest), expr.text));
                }
            }
            _ => {}
        }
    }
    StyleSources { statics, dynamic }
}

/// One piece of a props object: a spread, or the entries between spreads.
enum Piece {
    Plain(Vec<String>),
    Spread(String),
}

fn push_entry(pieces: &mut Vec<Piece>, entry: String) {
    if let Some(Piece::Plain(entries)) = pieces.last_mut() {
        entries.push(entry);
        return;
    }
    pieces.push(Piece::Plain(vec![entry]));
}

/// True for a name the server never writes on an element: handlers, `ref` and the directives for the client.
fn client_only(name: &str) -> bool {
    name == "ref"
        || is_event_name(name)
        || name.starts_with("on:")
        || name.starts_with("use:")
        || name.starts_with("prop:")
}

fn inner_html_of<'e, 'a>(element: &'e ElementIR<'a>) -> Option<&'e ExprIR<'a>> {
    element.attrs.iter().find_map(|attr| match attr {
        Attr::Expr { name, expr, .. } if name == "innerHTML" => Some(expr),
        _ => None,
    })
}

/// The `value` expression of a textarea or select (`defaultValue` when there is no `value`).
fn control_value_of<'e, 'a>(element: &'e ElementIR<'a>) -> Option<&'e ExprIR<'a>> {
    let mut fallback = None;
    for attr in &element.attrs {
        if let Attr::Expr { name, expr, .. } = attr {
            if name == "value" {
                return Some(expr);
            }
            if name == "defaultValue" {
                fallback = Some(expr);
            }
        }
    }
    fallback
}

/// The `textContent` / `innerText` expression of an element, written as its escaped text.
fn text_content_of<'e, 'a>(element: &'e ElementIR<'a>) -> Option<&'e ExprIR<'a>> {
    element.attrs.iter().find_map(|attr| match attr {
        Attr::Expr { name, expr, .. } if name == "textContent" || name == "innerText" => Some(expr),
        _ => None,
    })
}

impl<'t, 'a> Ctx<'t, 'a> {
    fn ssr_call(&mut self, parts: &Parts) -> String {
        let (statics, holes) = parts.finish();
        if holes.len() == 1 && statics.iter().all(String::is_empty) {
            return holes.first().cloned().unwrap_or_default();
        }
        let ssr = self.reg.helper("ssr");
        if holes.is_empty() {
            return format!(
                "{ssr}([{}])",
                json_string(statics.first().map_or("", String::as_str))
            );
        }
        let list = self.reg.hoist_parts(&statics);
        format!("{ssr}({list}, {})", holes.join(", "))
    }

    fn escaped(&mut self, code: &str) -> String {
        format!("{}({code})", self.reg.helper("escape"))
    }

    /// A dynamic child of a text-only element: written without markers, as the element's text requires.
    fn text_hole(&mut self, element: &ElementIR, kind: TextKind, code: &str) -> String {
        match kind {
            TextKind::Raw => format!(
                "{}({}, {code})",
                self.reg.helper("ssrRawText"),
                json_string(&element.tag)
            ),
            TextKind::Escapable => self.escaped(code),
        }
    }

    /// Runtime props for a component, or for an element with a spread (`component` false), that need
    /// `mergeProps`/`ssrElement` semantics. A component gets every prop the client gives it, handlers and
    /// `ref` included. An element gets none of those (the server writes no handler), and its `class:` and
    /// `style:` directives become the last `classList` and `style` entries, because they apply after the
    /// spread. The plain `classList` and `style` props of that element move into those entries so that no
    /// source is lost; a `style` or `classList` that a spread supplies is replaced by them.
    fn props_object(&mut self, attrs: &[Attr], component: bool) -> String {
        let mut pieces: Vec<Piece> = Vec::new();
        let has_style_directive = !component
            && attrs
                .iter()
                .any(|attr| matches!(attr, Attr::Expr { name, .. } if name.starts_with("style:")));
        let has_class_directive = !component
            && attrs
                .iter()
                .any(|attr| matches!(attr, Attr::Expr { name, .. } if name.starts_with("class:")));
        let mut style_list: Vec<String> = Vec::new();
        let mut class_members: Vec<String> = Vec::new();
        let mut class_list_source: Option<String> = None;
        let mut dynamic_directives = false;
        for attr in attrs {
            match attr {
                Attr::Spread { expr, .. } => {
                    let text = if expr.dynamic {
                        format!("() => {}", self.wrap_object_literal(&expr.text, expr.node))
                    } else {
                        expr.text.to_string()
                    };
                    pieces.push(Piece::Spread(text));
                }
                Attr::Static {
                    name, value, js, ..
                } => {
                    if has_style_directive
                        && name == "style"
                        && let StaticValue::Text(text) = value
                    {
                        style_list.push(json_string(text));
                        continue;
                    }
                    let rendered = match value {
                        StaticValue::True => "true".to_string(),
                        StaticValue::Text(text) => js.clone().unwrap_or_else(|| json_string(text)),
                    };
                    push_entry(&mut pieces, format!("{}: {rendered}", property_key(name)));
                }
                Attr::Expr { name, expr, .. } => {
                    let dynamic = expr.dynamic || contains_jsx(self.tree, expr.node);
                    if !component && client_only(name) {
                        // Nothing of it reaches the markup.
                    } else if !component && let Some(rest) = name.strip_prefix("class:") {
                        class_members.push(format!("{}: {}", json_string(rest), expr.text));
                        dynamic_directives |= dynamic;
                    } else if !component && let Some(rest) = name.strip_prefix("style:") {
                        style_list.push(format!("{{ {}: {} }}", json_string(rest), expr.text));
                        dynamic_directives |= dynamic;
                    } else if has_style_directive && name == "style" {
                        style_list.push(expr.text.to_string());
                        dynamic_directives |= dynamic;
                    } else if has_class_directive && name == "classList" {
                        class_list_source = Some(expr.text.to_string());
                        dynamic_directives |= dynamic;
                    } else if name == "ref" {
                        let constant = self.is_constant_ref(expr.node);
                        let entry = self.ref_statement(&expr.text, expr.node, constant);
                        push_entry(&mut pieces, entry);
                    } else if dynamic {
                        push_entry(
                            &mut pieces,
                            format!("get {}() {{\nreturn {};\n}}", property_key(name), expr.text),
                        );
                    } else {
                        push_entry(
                            &mut pieces,
                            format!("{}: {}", property_key(name), expr.text),
                        );
                    }
                }
            }
        }
        let folded = |key: &str, value: String| {
            if dynamic_directives {
                format!("get {key}() {{\nreturn {value};\n}}")
            } else {
                format!("{key}: {value}")
            }
        };
        if has_class_directive {
            let spread_old = class_list_source
                .map(|source| format!("...({source}), "))
                .unwrap_or_default();
            let entry = folded(
                "classList",
                format!("{{ {spread_old}{} }}", class_members.join(", ")),
            );
            pieces.push(Piece::Plain(vec![entry]));
        }
        if has_style_directive {
            let entry = folded("style", format!("[{}]", style_list.join(", ")));
            match pieces.last_mut() {
                Some(Piece::Plain(entries)) if has_class_directive => entries.push(entry),
                _ => pieces.push(Piece::Plain(vec![entry])),
            }
        }
        let mut texts: Vec<String> = Vec::new();
        for piece in &pieces {
            match piece {
                Piece::Plain(entries) if entries.is_empty() => {}
                Piece::Plain(entries) => texts.push(format!("{{\n{}\n}}", entries.join(",\n"))),
                Piece::Spread(text) => texts.push(text.clone()),
            }
        }
        if texts.is_empty() {
            return "{}".to_string();
        }
        // A lone dynamic spread is an accessor of the props: mergeProps turns it into a props object.
        if texts.len() == 1 && !texts[0].starts_with("() =>") {
            return texts[0].clone();
        }
        format!("{}({})", self.reg.helper("mergeProps"), texts.join(", "))
    }

    fn serialize_attrs(&mut self, element: &ElementIR, parts: &mut Parts) -> Result<()> {
        if element.attrs.iter().any(|attr| match attr {
            Attr::Static { name, .. } | Attr::Expr { name, .. } => {
                OBJECT_MEMBER_NAMES.contains(&name.as_str())
            }
            Attr::Spread { .. } => false,
        }) {
            return unsupported("an attribute named like a member of every object");
        }
        let svg = element.ns == Namespace::Svg;
        let classes = class_sources(element);
        let styles = style_sources(element);
        let mut class_done = false;
        let mut style_done = false;
        let emit_class = |this: &mut Self, parts: &mut Parts, class_done: &mut bool| {
            if *class_done {
                return;
            }
            *class_done = true;
            if classes.dynamic.is_empty() {
                if !classes.statics.is_empty() {
                    parts.text(&format!(
                        " class=\"{}\"",
                        escape_html_attribute(&classes.statics.join(" "))
                    ));
                }
                return;
            }
            let mut items: Vec<String> = classes.statics.iter().map(|s| json_string(s)).collect();
            items.extend(classes.dynamic.iter().cloned());
            let call = this.reg.helper("ssrClass");
            parts.hole(format!("{call}([{}])", items.join(", ")));
        };
        // A static style with no dynamic one stays markup; otherwise every source is one `ssrStyle`, so
        // the element never has two `style` attributes (the static string comes first).
        let emit_style = |this: &mut Self, parts: &mut Parts, style_done: &mut bool| {
            if *style_done {
                return;
            }
            *style_done = true;
            if styles.dynamic.is_empty() {
                if !styles.statics.is_empty() {
                    parts.text(&format!(
                        " style=\"{}\"",
                        escape_html_attribute(&styles.statics.join(";"))
                    ));
                }
                return;
            }
            let mut items: Vec<String> = styles.statics.iter().map(|s| json_string(s)).collect();
            items.extend(styles.dynamic.iter().cloned());
            let call = this.reg.helper("ssrStyle");
            parts.hole(format!("{call}([{}])", items.join(", ")));
        };
        for attr in &element.attrs {
            match attr {
                Attr::Static {
                    name, value, start, ..
                } => {
                    if name == "class" || name == "className" {
                        emit_class(self, parts, &mut class_done);
                        continue;
                    }
                    if name == "style" && matches!(value, StaticValue::Text(_)) {
                        emit_style(self, parts, &mut style_done);
                        continue;
                    }
                    if is_event_handler_attribute(name) && matches!(value, StaticValue::Text(_)) {
                        return fail_at(
                            "STRING_EVENT_HANDLER",
                            format!("\"{name}\" received a string. Pass a function instead."),
                            *start,
                        );
                    }
                    let markup = markup_name(name, svg);
                    match value {
                        StaticValue::True => parts.text(&format!(" {markup}")),
                        StaticValue::Text(text) => {
                            parts.text(&format!(" {markup}=\"{}\"", escape_html_attribute(text)));
                        }
                    }
                }
                Attr::Spread { .. } => {}
                Attr::Expr { name, expr, .. } => {
                    if name == "ref"
                        || is_event_name(name)
                        || name.starts_with("on:")
                        || name.starts_with("oncapture:")
                        || name.starts_with("use:")
                        || name.starts_with("prop:")
                    {
                        continue;
                    }
                    if name == "class"
                        || name == "className"
                        || name == "classList"
                        || name.starts_with("class:")
                    {
                        emit_class(self, parts, &mut class_done);
                        continue;
                    }
                    if name == "style" || name.starts_with("style:") {
                        emit_style(self, parts, &mut style_done);
                        continue;
                    }
                    if name == "innerHTML" || SKIPPED_PROPERTIES.contains(&name.as_str()) {
                        continue;
                    }
                    if let Some(rest) = name.strip_prefix("attr:") {
                        let call = self.reg.helper("ssrAttribute");
                        parts.hole(format!("{call}({}, {})", json_string(rest), expr.text));
                    } else if let Some(rest) = name.strip_prefix("bool:") {
                        let call = self.reg.helper("ssrAttribute");
                        parts.hole(format!(
                            "{call}({}, {}, true)",
                            json_string(rest),
                            expr.text
                        ));
                    } else if BOOLEAN_PROPERTIES.contains(&name.as_str()) {
                        let call = self.reg.helper("ssrAttribute");
                        parts.hole(format!(
                            "{call}({}, {}, true)",
                            json_string(&markup_name(name, svg)),
                            expr.text
                        ));
                    } else if VALUE_PROPERTIES.contains(&name.as_str()) {
                        // A textarea's value is its content and a select's value marks its options
                        // (written with the children); a `value` attribute is ignored on both.
                        if element.tag != "textarea" && element.tag != "select" {
                            let call = self.reg.helper("ssrAttribute");
                            parts.hole(format!("{call}(\"value\", {})", expr.text));
                        }
                    } else {
                        let call = self.reg.helper("ssrAttribute");
                        parts.hole(format!(
                            "{call}({}, {})",
                            json_string(&markup_name(name, svg)),
                            expr.text
                        ));
                    }
                }
            }
        }
        emit_class(self, parts, &mut class_done);
        Ok(())
    }

    fn serialize_children(&mut self, element: &ElementIR, parts: &mut Parts) -> Result<()> {
        let raw = RAW_TEXT_ELEMENTS.contains(&element.tag.as_str());
        let kind = text_kind(element);
        for child in &element.children {
            match child {
                ChildIR::Text(value) => {
                    if raw {
                        if value.to_lowercase().contains(&format!("</{}", element.tag)) {
                            return fail_at(
                                "RAW_TEXT_CLOSE",
                                format!(
                                    "Text inside <{0}> must not contain \"</{0}\".",
                                    element.tag
                                ),
                                element.start,
                            );
                        }
                        parts.text(value);
                    } else {
                        parts.text(&escape_html_text(value));
                    }
                }
                ChildIR::Element(inner) => self.serialize_element(inner, parts, false)?,
                ChildIR::Component(component) => {
                    if let Some(kind) = kind {
                        let generated = self.gen_component_ssr(component)?;
                        let hole = self.text_hole(element, kind, &generated);
                        parts.hole(hole);
                        continue;
                    }
                    parts.text("<!--[-->");
                    let generated = self.gen_component_ssr(component)?;
                    let hole = self.escaped(&generated);
                    parts.hole(hole);
                    parts.text("<!--]-->");
                }
                ChildIR::Slot(expr) => {
                    if let Some(kind) = kind {
                        let hole = self.text_hole(element, kind, &expr.text);
                        parts.hole(hole);
                        continue;
                    }
                    parts.text("<!--[-->");
                    let hole = self.escaped(&expr.text);
                    parts.hole(hole);
                    parts.text("<!--]-->");
                }
                ChildIR::Fragment(_) => {
                    return fail_at("INTERNAL", "Fragment survived lowering.", element.start);
                }
            }
        }
        Ok(())
    }

    fn serialize_element(
        &mut self,
        element: &ElementIR,
        parts: &mut Parts,
        root: bool,
    ) -> Result<()> {
        let hydratable = self.hydratable;
        if element
            .attrs
            .iter()
            .any(|attr| matches!(attr, Attr::Spread { .. }))
        {
            let mut children = Parts::default();
            self.serialize_children(element, &mut children)?;
            let child_code = {
                let (statics, holes) = children.finish();
                if statics.len() == 1
                    && holes.is_empty()
                    && statics.first().is_some_and(String::is_empty)
                {
                    "undefined".to_string()
                } else {
                    // A thunk, so the element's hydration key is drawn before its children's keys.
                    format!("() => {}", self.ssr_call(&children))
                }
            };
            // The SVG flag is passed only for SVG elements, so HTML output stays as it was.
            let svg_flag = if element.ns == Namespace::Svg {
                ", true"
            } else {
                ""
            };
            let call = self.reg.helper("ssrElement");
            let props = self.props_object(&element.attrs, false);
            parts.hole(format!(
                "{call}({}, {props}, {child_code}, {}{svg_flag})",
                json_string(&element.tag),
                hydratable && root
            ));
            return Ok(());
        }
        parts.text(&format!("<{}", element.tag));
        if hydratable && root {
            let call = self.reg.helper("ssrHydrationKey");
            parts.hole(format!("{call}()"));
        }
        self.serialize_attrs(element, parts)?;
        parts.text(">");
        if VOID_ELEMENTS.contains(&element.tag.as_str()) {
            if !element.children.is_empty() {
                return fail_at(
                    "VOID_CHILDREN",
                    format!("<{}> cannot have children.", element.tag),
                    element.start,
                );
            }
            return Ok(());
        }
        let html = inner_html_of(element);
        let select_value = if element.tag == "select" {
            control_value_of(element)
        } else {
            None
        };
        if let Some(html) = html {
            if !element.children.is_empty() {
                return fail_at(
                    "INNER_HTML_CHILDREN",
                    "innerHTML cannot be combined with children.",
                    element.start,
                );
            }
            let call = self.reg.helper("ssrRaw");
            parts.hole(format!("{call}({})", html.text));
        } else if let Some(select_value) = select_value {
            // A select's value is not an attribute: the options it matches are written `selected`.
            let mut inner = Parts::default();
            self.serialize_children(element, &mut inner)?;
            let call = self.reg.helper("ssrSelectValue");
            let rendered = self.ssr_call(&inner);
            parts.hole(format!("{call}({}, {rendered})", select_value.text));
        } else {
            // A textarea shows its value as its content.
            let text = text_content_of(element).or_else(|| {
                if element.tag == "textarea" {
                    control_value_of(element)
                } else {
                    None
                }
            });
            if let Some(text) = text {
                if !element.children.is_empty() {
                    return fail_at(
                        "TEXT_CONTENT_CHILDREN",
                        "textContent cannot be combined with children.",
                        element.start,
                    );
                }
                let helper = if element.tag == "textarea" {
                    "ssrTextArea"
                } else {
                    "escape"
                };
                let call = self.reg.helper(helper);
                parts.hole(format!("{call}({})", text.text));
            } else {
                self.serialize_children(element, parts)?;
            }
        }
        parts.text(&format!("</{}>", element.tag));
        Ok(())
    }

    pub(crate) fn gen_component_ssr(&mut self, component: &ComponentIR) -> Result<String> {
        let create = self.reg.helper("createComponent");
        let props = self.component_props(component)?;
        Ok(format!("{create}({}, {props})", component.callee))
    }

    fn component_props(&mut self, component: &ComponentIR) -> Result<String> {
        let base = self.props_object(&component.attrs, true);
        if component.children.is_empty() {
            return Ok(base);
        }
        let only = if component.children.len() == 1 {
            component.children.first()
        } else {
            None
        };
        let value = match only {
            Some(ChildIR::Text(text)) => json_string(text),
            Some(ChildIR::Slot(expr)) => expr.text.to_string(),
            Some(child) => self.child_value_ssr(child)?,
            None => {
                let mut items = Vec::with_capacity(component.children.len());
                for child in &component.children {
                    items.push(self.child_value_ssr(child)?);
                }
                format!("[{}]", items.join(", "))
            }
        };
        let getter = format!("get children() {{\nreturn {value};\n}}");
        if base == "{}" {
            return Ok(format!("{{\n{getter}\n}}"));
        }
        Ok(format!(
            "{}({base}, {{\n{getter}\n}})",
            self.reg.helper("mergeProps")
        ))
    }

    fn child_value_ssr(&mut self, child: &ChildIR) -> Result<String> {
        match child {
            ChildIR::Text(text) => Ok(json_string(text)),
            ChildIR::Element(element) => {
                let mut parts = Parts::default();
                self.serialize_element(element, &mut parts, true)?;
                Ok(self.ssr_call(&parts))
            }
            ChildIR::Component(component) => self.gen_component_ssr(component),
            ChildIR::Slot(expr) => Ok(expr.text.to_string()),
            ChildIR::Fragment(children) => {
                let mut items = Vec::with_capacity(children.len());
                for inner in children {
                    items.push(self.child_value_ssr(inner)?);
                }
                Ok(format!("[{}]", items.join(", ")))
            }
        }
    }

    /// Generates the replacement expression for one JSX root in `ssr` mode.
    ///
    /// # Errors
    /// Fails with the compile error codes of the reference compiler.
    pub fn generate_ssr(&mut self, root: &RootIR) -> Result<String> {
        match root {
            RootIR::Component(component) => self.gen_component_ssr(component),
            RootIR::Fragment(children) => {
                let mut items = Vec::with_capacity(children.len());
                for child in children {
                    items.push(self.child_value_ssr(child)?);
                }
                Ok(format!("[{}]", items.join(", ")))
            }
            RootIR::Element(element) => {
                let mut parts = Parts::default();
                self.serialize_element(element, &mut parts, true)?;
                Ok(self.ssr_call(&parts))
            }
        }
    }
}
