/**
 * Static HTML nesting rules. The browser's parser repairs invalid markup (it closes `<p>` before a
 * `<div>`, inserts `<tbody>` under `<table>`), which silently changes the tree the compiled
 * template was written against and breaks every node path computed from it. These cases are
 * therefore compile errors, not warnings.
 */

const CLOSES_P = new Set([
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
]);

const TABLE_CHILDREN = new Set(["caption", "colgroup", "thead", "tbody", "tfoot"]);
const SECTION_CHILDREN = new Set(["tr"]);
const ROW_CHILDREN = new Set(["td", "th"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Tags that may not appear anywhere below themselves (the parser would close/hoist them). */
const NO_SELF_NESTING = new Set(["a", "button", "form", "label"]);

/** Returns a message when `child` may not be a direct child of `parent`, else undefined. */
export function nestingProblem(parent: string, child: string): string | undefined {
  if (parent === "p" && CLOSES_P.has(child)) {
    return `<${child}> cannot be inside <p>: the HTML parser would close the paragraph first.`;
  }
  if (parent === "table" && !TABLE_CHILDREN.has(child)) {
    return child === "tr"
      ? "<tr> must be inside <tbody>, <thead> or <tfoot>: the HTML parser inserts a <tbody> that the compiled template would not know about."
      : `<${child}> cannot be a direct child of <table>.`;
  }
  if (
    (parent === "tbody" || parent === "thead" || parent === "tfoot") &&
    !SECTION_CHILDREN.has(child)
  ) {
    return `<${child}> cannot be a direct child of <${parent}>; use <tr>.`;
  }
  if (parent === "tr" && !ROW_CHILDREN.has(child)) {
    return `<${child}> cannot be a direct child of <tr>; use <td> or <th>.`;
  }
  if ((child === "td" || child === "th") && parent !== "tr") {
    return `<${child}> must be inside <tr>.`;
  }
  if (
    child === "tr" &&
    !(parent === "tbody" || parent === "thead" || parent === "tfoot" || parent === "table")
  ) {
    return "<tr> must be inside <tbody>, <thead> or <tfoot>.";
  }
  if (parent === "select" && child !== "option" && child !== "optgroup") {
    return `<${child}> cannot be inside <select>; use <option> or <optgroup>.`;
  }
  if (parent === "option") return `<${child}> cannot be inside <option>.`;
  if (HEADINGS.has(parent) && HEADINGS.has(child)) {
    return `<${child}> cannot be inside <${parent}>.`;
  }
  return undefined;
}

/** Returns a message when `tag` appears inside an ancestor of the same kind. */
export function selfNestingProblem(tag: string, ancestors: readonly string[]): string | undefined {
  if (NO_SELF_NESTING.has(tag) && ancestors.includes(tag)) {
    return `<${tag}> cannot be nested inside another <${tag}>.`;
  }
  return undefined;
}
