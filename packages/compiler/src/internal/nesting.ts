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
]);

/**
 * Elements the parser stops at when it looks for an open `<p>` ("button scope"): a block inside one of
 * these does not close a paragraph outside it. `""` is a component, whose children are separate templates.
 */
const P_BOUNDARIES = new Set([
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
]);

/** The boundaries of "scope" (the same list without `button`): `<nobr>` looks for an open `<nobr>` up to one. */
const SCOPE_BOUNDARIES = new Set([...P_BOUNDARIES].filter((tag) => tag !== "button"));

/**
 * The "special" elements: when the parser looks for an open `<li>`, `<dd>` or `<dt>` to close, it gives up
 * at the first of these. `address`, `div` and `p` are special too, but the parser looks through them, so
 * they are left out.
 */
const SPECIAL = new Set([
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
]);

/**
 * Elements whose content the parser always reads as text: a tag inside one is not an element. (`noscript` is
 * left out: it is text only where scripting is on.)
 */
const TEXT_PARENTS = new Set([
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
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
  if (parent === "optgroup" && child !== "option") {
    return `<${child}> cannot be inside <optgroup>; use <option>.`;
  }
  if (TEXT_PARENTS.has(parent)) {
    return `<${child}> cannot be inside <${parent}>: the HTML parser reads its content as text, not markup.`;
  }
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

/**
 * Returns a message when `tag`, placed under the chain of open elements `chain` (outermost first, the parent
 * last, `""` for a component), makes the HTML parser close an element above its parent or open a different tree
 * than the one written. The parent alone is checked by {@link nestingProblem}; these are the cases that look
 * further up.
 */
export function ancestorProblem(tag: string, chain: readonly string[]): string | undefined {
  if (CLOSES_P.has(tag)) {
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const open = chain[index] as string;
      if (open === "p") {
        return `<${tag}> cannot be inside <p>: the HTML parser would close the paragraph first.`;
      }
      // A block between them is the one the paragraph is refused for (reported where it is written).
      if (P_BOUNDARIES.has(open) || CLOSES_P.has(open)) break;
    }
  }
  if (tag === "li" || tag === "dd" || tag === "dt") {
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const open = chain[index] as string;
      const closes = tag === "li" ? open === "li" : open === "dd" || open === "dt";
      if (closes) {
        return `<${tag}> cannot be inside <${open}>: the HTML parser would close <${open}> first.`;
      }
      if (SPECIAL.has(open)) break;
    }
  }
  if (tag === "nobr") {
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const open = chain[index] as string;
      if (open === "nobr") {
        return "<nobr> cannot be inside <nobr>: the HTML parser would close the first one.";
      }
      if (SCOPE_BOUNDARIES.has(open)) break;
    }
  }
  return undefined;
}
