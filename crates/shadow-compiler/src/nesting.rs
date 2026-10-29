//! Static HTML nesting rules.
//!
//! The browser's parser repairs invalid markup (it closes `<p>` before a `<div>`, inserts `<tbody>`
//! under `<table>`), which silently changes the tree a compiled template was written against and
//! breaks every node path computed from it. These cases are therefore compile errors.

/// Tags that close an open `<p>` element.
const CLOSES_P: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "center",
    "details",
    "dialog",
    "dir",
    "div",
    "dd",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hgroup",
    "hr",
    "li",
    "listing",
    "main",
    "menu",
    "nav",
    "ol",
    "p",
    "plaintext",
    "pre",
    "search",
    "section",
    "summary",
    "table",
    "ul",
    "xmp",
];

/// Elements the parser stops at when it looks for an open `<p>` ("button scope"): a block inside one of
/// these does not close a paragraph outside it. `""` is a component, whose children are separate templates.
const P_BOUNDARIES: &[&str] = &[
    "",
    "applet",
    "caption",
    "html",
    "table",
    "td",
    "th",
    "marquee",
    "object",
    "template",
    "button",
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext",
    "annotation-xml",
    "foreignObject",
    "desc",
    "title",
];

/// The "special" elements: when the parser looks for an open `<li>`, `<dd>` or `<dt>` to close, it gives
/// up at the first of these. `address`, `div` and `p` are special too, but the parser looks through them,
/// so they are left out.
const SPECIAL: &[&str] = &[
    "",
    "applet",
    "area",
    "article",
    "aside",
    "base",
    "basefont",
    "bgsound",
    "blockquote",
    "body",
    "br",
    "button",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dir",
    "dl",
    "dt",
    "embed",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hgroup",
    "hr",
    "html",
    "iframe",
    "img",
    "input",
    "keygen",
    "li",
    "link",
    "listing",
    "main",
    "marquee",
    "menu",
    "meta",
    "nav",
    "noembed",
    "noframes",
    "noscript",
    "object",
    "ol",
    "param",
    "plaintext",
    "pre",
    "script",
    "search",
    "section",
    "select",
    "source",
    "style",
    "summary",
    "table",
    "tbody",
    "td",
    "template",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
    "wbr",
    "xmp",
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext",
    "annotation-xml",
    "foreignObject",
    "desc",
];

/// Elements whose content the parser always reads as text: a tag inside one is not an element.
/// (`noscript` is left out: it is text only where scripting is on.)
const TEXT_PARENTS: &[&str] = &[
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
];

const TABLE_CHILDREN: &[&str] = &["caption", "colgroup", "thead", "tbody", "tfoot"];
const HEADINGS: &[&str] = &["h1", "h2", "h3", "h4", "h5", "h6"];

/// Tags that may not appear anywhere below themselves (the parser would close or hoist them).
const NO_SELF_NESTING: &[&str] = &["a", "button", "form", "label"];

/// Returns a message when `child` may not be a direct child of `parent`.
///
/// # Examples
///
/// ```
/// use shadow_compiler::nesting::nesting_problem;
/// assert!(nesting_problem("p", "div").is_some());
/// assert!(nesting_problem("div", "p").is_none());
/// ```
#[must_use]
pub fn nesting_problem(parent: &str, child: &str) -> Option<String> {
    if parent == "p" && CLOSES_P.contains(&child) {
        return Some(format!(
            "<{child}> cannot be inside <p>: the HTML parser would close the paragraph first."
        ));
    }
    if parent == "table" && !TABLE_CHILDREN.contains(&child) {
        return Some(if child == "tr" {
            "<tr> must be inside <tbody>, <thead> or <tfoot>: the HTML parser inserts a <tbody> that the compiled template would not know about.".to_string()
        } else {
            format!("<{child}> cannot be a direct child of <table>.")
        });
    }
    if matches!(parent, "tbody" | "thead" | "tfoot") && child != "tr" {
        return Some(format!(
            "<{child}> cannot be a direct child of <{parent}>; use <tr>."
        ));
    }
    if parent == "tr" && !matches!(child, "td" | "th") {
        return Some(format!(
            "<{child}> cannot be a direct child of <tr>; use <td> or <th>."
        ));
    }
    if matches!(child, "td" | "th") && parent != "tr" {
        return Some(format!("<{child}> must be inside <tr>."));
    }
    if child == "tr" && !matches!(parent, "tbody" | "thead" | "tfoot" | "table") {
        return Some("<tr> must be inside <tbody>, <thead> or <tfoot>.".to_string());
    }
    if parent == "select" && child != "option" && child != "optgroup" {
        return Some(format!(
            "<{child}> cannot be inside <select>; use <option> or <optgroup>."
        ));
    }
    if parent == "option" {
        return Some(format!("<{child}> cannot be inside <option>."));
    }
    if parent == "optgroup" && child != "option" {
        return Some(format!(
            "<{child}> cannot be inside <optgroup>; use <option>."
        ));
    }
    if TEXT_PARENTS.contains(&parent) {
        return Some(format!(
            "<{child}> cannot be inside <{parent}>: the HTML parser reads its content as text, not markup."
        ));
    }
    if HEADINGS.contains(&parent) && HEADINGS.contains(&child) {
        return Some(format!("<{child}> cannot be inside <{parent}>."));
    }
    None
}

/// Returns a message when `tag` appears inside an ancestor of the same kind.
///
/// # Examples
///
/// ```
/// use shadow_compiler::nesting::self_nesting_problem;
/// assert!(self_nesting_problem("a", &["div", "a"]).is_some());
/// assert!(self_nesting_problem("a", &["div"]).is_none());
/// ```
#[must_use]
pub fn self_nesting_problem(tag: &str, ancestors: &[&str]) -> Option<String> {
    if NO_SELF_NESTING.contains(&tag) && ancestors.contains(&tag) {
        return Some(format!("<{tag}> cannot be nested inside another <{tag}>."));
    }
    None
}

/// Returns a message when `tag`, placed under the chain of open elements `chain` (outermost first, the
/// parent last, `""` for a component), makes the HTML parser close an element above its parent. The
/// parent alone is checked by [`nesting_problem`]; these are the cases that look further up.
///
/// # Examples
///
/// ```
/// use shadow_compiler::nesting::ancestor_problem;
/// assert!(ancestor_problem("div", &["p", "span"]).is_some());
/// assert!(ancestor_problem("div", &["p", "button"]).is_none());
/// ```
#[must_use]
pub fn ancestor_problem(tag: &str, chain: &[&str]) -> Option<String> {
    if CLOSES_P.contains(&tag) {
        for open in chain.iter().rev() {
            if *open == "p" {
                return Some(format!(
                    "<{tag}> cannot be inside <p>: the HTML parser would close the paragraph first."
                ));
            }
            // A block between them is the one the paragraph is refused for (reported where it is written).
            if P_BOUNDARIES.contains(open) || CLOSES_P.contains(open) {
                break;
            }
        }
    }
    if matches!(tag, "li" | "dd" | "dt") {
        for open in chain.iter().rev() {
            let closes = if tag == "li" {
                *open == "li"
            } else {
                matches!(*open, "dd" | "dt")
            };
            if closes {
                return Some(format!(
                    "<{tag}> cannot be inside <{open}>: the HTML parser would close <{open}> first."
                ));
            }
            if SPECIAL.contains(open) {
                break;
            }
        }
    }
    if tag == "nobr" {
        for open in chain.iter().rev() {
            if *open == "nobr" {
                return Some(
                    "<nobr> cannot be inside <nobr>: the HTML parser would close the first one."
                        .to_string(),
                );
            }
            if *open != "button" && P_BOUNDARIES.contains(open) {
                break;
            }
        }
    }
    None
}
