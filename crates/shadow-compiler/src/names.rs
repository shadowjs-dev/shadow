//! React spellings of attributes and events, resolved at build time so the runtime pays nothing.

/// SVG presentation attributes whose camelCase React spelling has a hyphenated SVG name.
const SVG_HYPHENATED: &[&str] = &[
    "alignment-baseline",
    "baseline-shift",
    "clip",
    "clip-path",
    "clip-rule",
    "color",
    "color-interpolation",
    "color-interpolation-filters",
    "color-profile",
    "color-rendering",
    "cursor",
    "direction",
    "display",
    "dominant-baseline",
    "enable-background",
    "fill",
    "fill-opacity",
    "fill-rule",
    "filter",
    "flood-color",
    "flood-opacity",
    "font-family",
    "font-size",
    "font-size-adjust",
    "font-stretch",
    "font-style",
    "font-variant",
    "font-weight",
    "glyph-orientation-horizontal",
    "glyph-orientation-vertical",
    "image-rendering",
    "isolation",
    "kerning",
    "letter-spacing",
    "lighting-color",
    "marker-end",
    "marker-mid",
    "marker-start",
    "mask",
    "mask-type",
    "mix-blend-mode",
    "opacity",
    "overflow",
    "paint-order",
    "pointer-events",
    "shape-rendering",
    "stop-color",
    "stop-opacity",
    "stroke",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-width",
    "text-anchor",
    "text-decoration",
    "text-overflow",
    "text-rendering",
    "transform",
    "transform-origin",
    "unicode-bidi",
    "vector-effect",
    "visibility",
    "white-space",
    "word-spacing",
    "writing-mode",
];

/// The attribute name written for a React-style JSX attribute on an element.
///
/// HTML elements get the lower-case name; SVG elements get `xlink:href`, `xml:lang` and hyphenated
/// presentation names, and keep other names as written.
///
/// # Examples
///
/// ```
/// use shadow_compiler::names::attribute_name;
/// assert_eq!(attribute_name("className", false), "class");
/// assert_eq!(attribute_name("colSpan", false), "colspan");
/// assert_eq!(attribute_name("strokeWidth", true), "stroke-width");
/// assert_eq!(attribute_name("viewBox", true), "viewBox");
/// assert_eq!(attribute_name("xlinkHref", true), "xlink:href");
/// ```
#[must_use]
pub fn attribute_name(name: &str, svg: bool) -> String {
    match name {
        "className" => return "class".to_string(),
        "htmlFor" => return "for".to_string(),
        "httpEquiv" => return "http-equiv".to_string(),
        "acceptCharset" => return "accept-charset".to_string(),
        _ => {}
    }
    if !svg {
        return name.to_lowercase();
    }
    if name.contains(':') {
        return name.to_string();
    }
    for prefix in ["xlink", "xml"] {
        if let Some(rest) = name.strip_prefix(prefix)
            && rest.starts_with(|c: char| c.is_ascii_uppercase())
        {
            return format!("{prefix}:{}", lower_first(rest));
        }
    }
    let mut hyphenated = String::with_capacity(name.len() + 4);
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            hyphenated.push('-');
            hyphenated.push(c.to_ascii_lowercase());
        } else {
            hyphenated.push(c);
        }
    }
    if SVG_HYPHENATED.binary_search(&hyphenated.as_str()).is_ok() {
        hyphenated
    } else {
        name.to_string()
    }
}

fn lower_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) if first.is_ascii_uppercase() => {
            let mut out = String::with_capacity(text.len());
            out.push(first.to_ascii_lowercase());
            out.push_str(chars.as_str());
            out
        }
        _ => text.to_string(),
    }
}

/// Attributes React accepts that have no DOM form: hydration-warning flags.
///
/// # Examples
///
/// ```
/// assert!(shadow_compiler::names::is_ignored_attribute("suppressHydrationWarning"));
/// assert!(!shadow_compiler::names::is_ignored_attribute("key"));
/// ```
#[must_use]
pub fn is_ignored_attribute(name: &str) -> bool {
    matches!(
        name,
        "suppressHydrationWarning" | "suppressContentEditableWarning"
    )
}

/// The event names (without `on`) of the HTML event handler content attributes, plus the spellings
/// React adds, sorted for a binary search.
const HANDLER_EVENTS: &[&str] = &[
    "abort",
    "afterprint",
    "animationcancel",
    "animationend",
    "animationiteration",
    "animationstart",
    "auxclick",
    "beforeinput",
    "beforematch",
    "beforeprint",
    "beforetoggle",
    "beforeunload",
    "blur",
    "cancel",
    "canplay",
    "canplaythrough",
    "change",
    "click",
    "close",
    "command",
    "contextlost",
    "contextmenu",
    "contextrestored",
    "copy",
    "cuechange",
    "cut",
    "dblclick",
    "doubleclick",
    "drag",
    "dragend",
    "dragenter",
    "dragexit",
    "dragleave",
    "dragover",
    "dragstart",
    "drop",
    "durationchange",
    "emptied",
    "ended",
    "error",
    "focus",
    "focusin",
    "focusout",
    "formdata",
    "gotpointercapture",
    "hashchange",
    "input",
    "invalid",
    "keydown",
    "keypress",
    "keyup",
    "languagechange",
    "load",
    "loadeddata",
    "loadedmetadata",
    "loadend",
    "loadstart",
    "lostpointercapture",
    "message",
    "messageerror",
    "mousedown",
    "mouseenter",
    "mouseleave",
    "mousemove",
    "mouseout",
    "mouseover",
    "mouseup",
    "offline",
    "online",
    "pagehide",
    "pageshow",
    "paste",
    "pause",
    "play",
    "playing",
    "pointercancel",
    "pointerdown",
    "pointerenter",
    "pointerleave",
    "pointermove",
    "pointerout",
    "pointerover",
    "pointerup",
    "popstate",
    "progress",
    "ratechange",
    "rejectionhandled",
    "reset",
    "resize",
    "scroll",
    "scrollend",
    "securitypolicyviolation",
    "seeked",
    "seeking",
    "select",
    "selectionchange",
    "slotchange",
    "stalled",
    "storage",
    "submit",
    "suspend",
    "timeupdate",
    "toggle",
    "touchcancel",
    "touchend",
    "touchmove",
    "touchstart",
    "transitioncancel",
    "transitionend",
    "transitionrun",
    "transitionstart",
    "unhandledrejection",
    "unload",
    "volumechange",
    "waiting",
    "wheel",
];

/// True for an attribute name that is an event handler content attribute under any capitalization
/// (`onclick`, `ONCLICK`, `onClick`, and React's `onClickCapture`). A name that only starts with `on`
/// (`online`, `onboarding`) is not one.
///
/// # Examples
///
/// ```
/// use shadow_compiler::names::is_event_handler_attribute;
/// assert!(is_event_handler_attribute("ONCLICK"));
/// assert!(is_event_handler_attribute("onClickCapture"));
/// assert!(!is_event_handler_attribute("online"));
/// ```
#[must_use]
pub fn is_event_handler_attribute(name: &str) -> bool {
    let lower = name.to_lowercase();
    let Some(event) = lower.strip_prefix("on") else {
        return false;
    };
    if HANDLER_EVENTS.binary_search(&event).is_ok() {
        return true;
    }
    event
        .strip_suffix("capture")
        .is_some_and(|base| HANDLER_EVENTS.binary_search(&base).is_ok())
}

/// The DOM event name of an event attribute and how it is bound.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventPlan {
    /// The DOM event type, lower case.
    pub event: String,
    /// Bound in the capture phase (`onXCapture`).
    pub capture: bool,
    /// Bound with `{ passive: true }`.
    pub passive: bool,
}

/// True for `/^on[A-Z]/` (the React spelling of an event attribute).
fn is_react_event_spelling(attribute: &str) -> bool {
    attribute
        .strip_prefix("on")
        .is_some_and(|rest| rest.starts_with(|c: char| c.is_ascii_uppercase()))
}

/// Plans the DOM event for an event attribute. React spellings (`onClick`, `onChange`) follow
/// React's semantics where they differ from the DOM: `onChange` on a text input or a textarea is
/// the `input` event, `onFocus` and `onBlur` are `focusin` and `focusout`, `onDoubleClick` is
/// `dblclick`, `onWheel` is passive, and a `Capture` suffix binds the capture phase.
///
/// # Examples
///
/// ```
/// use shadow_compiler::names::event_plan;
/// assert_eq!(event_plan("onClick", "button", None).event, "click");
/// assert_eq!(event_plan("onChange", "input", None).event, "input");
/// assert_eq!(event_plan("onChange", "input", Some("checkbox")).event, "change");
/// assert!(event_plan("onWheel", "div", None).passive);
/// ```
#[must_use]
pub fn event_plan(attribute: &str, tag: &str, input_type: Option<&str>) -> EventPlan {
    let react = is_react_event_spelling(attribute);
    let capture = react && attribute.ends_with("Capture");
    let after_on = attribute.get(2..).unwrap_or("");
    let base = if capture {
        after_on.strip_suffix("Capture").unwrap_or(after_on)
    } else {
        after_on
    };
    if !react {
        return EventPlan {
            event: base.to_lowercase(),
            capture: false,
            passive: false,
        };
    }
    let lower = base.to_lowercase();
    let plan = |event: &str, passive: bool| EventPlan {
        event: event.to_string(),
        capture,
        passive,
    };
    match lower.as_str() {
        "change" => {
            let per_edit = tag == "textarea"
                || (tag == "input" && !matches!(input_type, Some("checkbox" | "radio" | "file")));
            plan(if per_edit { "input" } else { "change" }, false)
        }
        "focus" => plan("focusin", false),
        "blur" => plan("focusout", false),
        "doubleclick" => plan("dblclick", false),
        "wheel" => plan("wheel", !capture),
        _ => EventPlan {
            event: lower,
            capture,
            passive: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyphenated_table_is_sorted() {
        let mut sorted = SVG_HYPHENATED.to_vec();
        sorted.sort_unstable();
        assert_eq!(sorted, SVG_HYPHENATED);
    }

    #[test]
    fn handler_events_are_sorted() {
        let mut sorted = HANDLER_EVENTS.to_vec();
        sorted.sort_unstable();
        assert_eq!(sorted, HANDLER_EVENTS);
    }

    #[test]
    fn attribute_names() {
        assert_eq!(attribute_name("xmlLang", true), "xml:lang");
        assert_eq!(attribute_name("xlinkHrefX", true), "xlink:hrefX");
        assert_eq!(attribute_name("xlink", true), "xlink");
        assert_eq!(attribute_name("fooBar", true), "fooBar");
        assert_eq!(attribute_name("DATA", false), "data");
        assert_eq!(attribute_name("onClickCapture", false), "onclickcapture");
    }

    #[test]
    fn events() {
        assert_eq!(event_plan("onclick", "div", None).event, "click");
        let capture = event_plan("onClickCapture", "div", None);
        assert!(capture.capture);
        assert_eq!(capture.event, "click");
        assert!(!event_plan("onWheelCapture", "div", None).passive);
        assert_eq!(event_plan("onCapture", "div", None).event, "");
        assert_eq!(event_plan("onFocus", "div", None).event, "focusin");
    }
}
