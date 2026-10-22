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
    "details",
    "dialog",
    "div",
    "dl",
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
    "main",
    "menu",
    "nav",
    "ol",
    "p",
    "pre",
    "search",
    "section",
    "table",
    "ul",
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
