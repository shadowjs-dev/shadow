import { decodeHTMLStrict } from "entities";
import { type AstNode, isJsx, isNode, unwrapParens } from "./ast";
import { constantValue, containsJsx, isDynamic } from "./classify";
import { CompileError, codeFrame, makeDiagnostic } from "./diagnostics";
import type {
  AttrIR,
  ChildIR,
  ComponentIR,
  ElementIR,
  ExprIR,
  FragmentIR,
  Namespace,
  RootIR,
  SlotIR,
} from "./ir";
import { cleanJsxText } from "./jsx-text";
import { ancestorProblem, nestingProblem, selfNestingProblem } from "./nesting";
import { attributeName, IGNORED_ATTRIBUTES } from "./react-names";

/** JSX nesting deeper than this is rejected (R-CODE-12): it is never legitimate source. */
export const MAX_JSX_DEPTH = 400;

export interface LowerContext {
  source: string;
  id: string;
  /**
   * Final text of an expression node with nested JSX compiled. `ns` is the namespace of the element the
   * expression sits in: JSX inside it is built in that namespace (`html` when omitted).
   */
  text(node: AstNode, ns?: Namespace): string;
  /**
   * Called for an expression that the generated code puts in a getter or a method of a props object
   * (`get title() { ... }`), where `this` and `arguments` would be the object's: the subtree's uses of
   * them are read from locals that the root's code defines, and `super` is refused.
   */
  capture(node: AstNode): void;
}

function fail(ctx: LowerContext, code: string, message: string, node: AstNode): never {
  const diagnostic = makeDiagnostic(ctx.source, code, message, node.start, node.end);
  throw new CompileError(diagnostic, codeFrame(ctx.source, node.start), ctx.id);
}

function str(node: AstNode, key: string): string {
  const value = node[key];
  return typeof value === "string" ? value : "";
}

function nodeAt(node: AstNode, key: string): AstNode | null {
  const value = node[key];
  return isNode(value) ? value : null;
}

function listAt(node: AstNode, key: string): AstNode[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
}

const SVG_ROOT_EXCEPTIONS = new Set(["foreignObject"]);

/** Tags that exist only in SVG, so a standalone `<circle/>` root (e.g. inside `.map`) is built in the SVG namespace. */
const SVG_ONLY_TAGS = new Set([
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
]);

function expr(ctx: LowerContext, node: AstNode, ns: Namespace): ExprIR {
  return { text: ctx.text(node, ns), node, dynamic: isDynamic(node, ctx.source) };
}

interface TagInfo {
  kind: "element" | "component";
  name: string;
  custom: boolean;
}

function tagInfo(ctx: LowerContext, name: AstNode): TagInfo {
  if (name.type === "JSXIdentifier") {
    const value = str(name, "name");
    if (value === "this") return { kind: "component", name: value, custom: false };
    const first = value.charAt(0);
    const isComponent = first !== first.toLowerCase() || first === "_" || first === "$";
    // `Foo-Bar` would be the subtraction `Foo - Bar` in the generated call: a component is a variable.
    if (isComponent && value.includes("-")) {
      fail(
        ctx,
        "BAD_TAG",
        `"${value}" is not a valid component name: a component is a variable, and a name with "-" cannot be one. Write a custom element in lower case.`,
        name,
      );
    }
    return {
      kind: isComponent ? "component" : "element",
      name: value,
      custom: !isComponent && value.includes("-"),
    };
  }
  if (name.type === "JSXMemberExpression") {
    const object = nodeAt(name, "object");
    const property = nodeAt(name, "property");
    if (object === null || property === null) fail(ctx, "BAD_TAG", "Malformed tag name.", name);
    const left = tagInfo(ctx, object);
    return { kind: "component", name: `${left.name}.${str(property, "name")}`, custom: false };
  }
  return fail(ctx, "NAMESPACED_TAG", "Namespaced tag names are not supported.", name);
}

function attrName(ctx: LowerContext, name: AstNode): string {
  if (name.type === "JSXIdentifier") return str(name, "name");
  if (name.type === "JSXNamespacedName") {
    const ns = nodeAt(name, "namespace");
    const local = nodeAt(name, "name");
    if (ns === null || local === null)
      fail(ctx, "BAD_ATTRIBUTE", "Malformed attribute name.", name);
    return `${str(ns, "name")}:${str(local, "name")}`;
  }
  return fail(ctx, "BAD_ATTRIBUTE", "Unsupported attribute name.", name);
}

/** Namespaces whose value is always code, never an HTML attribute value. */
const CODE_NAMESPACES = new Set([
  "use",
  "on",
  "oncapture",
  "prop",
  "attr",
  "bool",
  "class",
  "style",
]);

const ENUMERATED_ATTRIBUTES = new Set(["draggable", "spellcheck", "contenteditable"]);

/** True for names whose boolean value is the text "true"/"false", not presence/absence. */
function writesBooleanAsText(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("aria-") || lower.startsWith("data-") || ENUMERATED_ATTRIBUTES.has(lower);
}

/** Attributes whose value is a URL; the runtime refuses script URLs in these (same list as `@shadow-js/web`). */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "srcdoc",
  "poster",
  "data",
]);

/** True when a literal URL would run script: browsers ignore the controls and case that hide the scheme. */
function isScriptUrl(value: string): boolean {
  let kept = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code > 0x1f && (code < 0x7f || code > 0x9f)) kept += char;
  }
  const normalized = kept.trim().toLowerCase();
  return ["javascript:", "data:text/html", "vbscript:"].some((prefix) =>
    normalized.startsWith(prefix),
  );
}

/** True for an attribute that holds a URL, under its HTML name or its React name (`xlinkHref`). */
function isUrlAttribute(name: string): boolean {
  return URL_ATTRIBUTES.has(name.toLowerCase()) || URL_ATTRIBUTES.has(attributeName(name, true));
}

/** Properties that have no HTML attribute form: a literal is applied as a property, once. */
const PROPERTY_ONLY = new Set(["innerHTML", "textContent", "innerText"]);

/**
 * Static attribute on an intrinsic element, adjusted to what the browser does with its markup. An
 * attribute `defaultValue` or `defaultChecked` does not exist in HTML: on an input it is the
 * `value` / `checked` attribute (which is the default value), on a select or textarea a property
 * set once. `innerHTML` and `textContent` are properties, never attributes. A `value` on a select or
 * textarea is a property too: the attribute would be ignored.
 */
function staticAttribute(
  tag: string | null,
  name: string,
  value: string | true,
  attribute: AstNode,
  js?: string,
): AttrIR {
  const start = attribute.start;
  const property = (propertyName: string, text: string): AttrIR => ({
    kind: "expr",
    name: propertyName,
    expr: { text, node: attribute, dynamic: false },
    start,
  });
  if (tag === null)
    return js === undefined
      ? { kind: "static", name, value, start }
      : { kind: "static", name, value, js, start };
  if (PROPERTY_ONLY.has(name) && typeof value === "string")
    return property(name, JSON.stringify(value));
  // A literal script URL is not written into the template: it goes through the checked attribute
  // writer, which refuses it (and warns in development), exactly like a dynamic value.
  // The React spelling is checked as well: `xlinkHref` is the attribute `xlink:href` in SVG.
  if (typeof value === "string" && isUrlAttribute(name) && isScriptUrl(value))
    return property(name, JSON.stringify(value));

  if (name === "defaultChecked") return { kind: "static", name: "checked", value: true, start };
  if (name === "defaultValue" || name === "value") {
    if (tag === "select" || tag === "textarea") {
      return property("value", JSON.stringify(typeof value === "string" ? value : ""));
    }
    // The template parser would rewrite the value (CR becomes LF, NUL becomes U+FFFD): like a literal
    // child with such text, it is not written into the markup but set at run time.
    if (typeof value === "string" && UNSAFE_TEMPLATE_TEXT.test(value))
      return property("value", JSON.stringify(value));
    if (name === "defaultValue") return { kind: "static", name: "value", value, start };
  }
  if (typeof value === "string" && UNSAFE_TEMPLATE_TEXT.test(value))
    return property(name, JSON.stringify(value));
  return js === undefined
    ? { kind: "static", name, value, start }
    : { kind: "static", name, value, js, start };
}

/**
 * `dangerouslySetInnerHTML={{ __html }}` is `innerHTML`: a property write of the markup, with the
 * same trust rule (the application's own HTML only). A value that is not an object literal is read
 * as `value?.__html` at runtime.
 */
function innerHtmlAttr(
  ctx: LowerContext,
  value: AstNode | null,
  tag: string,
  attribute: AstNode,
  ns: Namespace,
  risk: boolean,
): AttrIR {
  const inner =
    value === null
      ? null
      : value.type === "JSXExpressionContainer"
        ? nodeAt(value, "expression")
        : value;
  if (inner === null || inner.type === "JSXEmptyExpression") {
    fail(ctx, "BAD_ATTRIBUTE", "dangerouslySetInnerHTML needs an object with __html.", attribute);
  }
  if (risk) ctx.capture(inner);
  const bare = unwrapParens(inner);
  if (bare.type === "ObjectExpression") {
    const properties = listAt(bare, "properties");
    for (const property of properties) {
      const key = nodeAt(property, "key");
      const keyName =
        key === null ? null : key.type === "Identifier" ? str(key, "name") : String(key["value"]);
      if (keyName !== "__html" || property.type !== "Property") continue;
      const html = nodeAt(property, "value");
      if (html === null) break;
      const constant = constantValue(html);
      if (typeof constant === "string") {
        return staticAttribute(tag, "innerHTML", constant, attribute);
      }
      return { kind: "expr", name: "innerHTML", expr: expr(ctx, html, ns), start: attribute.start };
    }
    fail(ctx, "BAD_ATTRIBUTE", "dangerouslySetInnerHTML needs a __html key.", attribute);
  }
  return {
    kind: "expr",
    name: "innerHTML",
    expr: { text: `(${ctx.text(inner, ns)})?.__html`, node: inner, dynamic: true },
    start: attribute.start,
  };
}

/** The names of the plain attributes of an element (`value`, `checked`, ...), as written. */
function explicitNames(attributes: AstNode[]): Set<string> {
  const names = new Set<string>();
  for (const attribute of attributes) {
    if (attribute.type === "JSXSpreadAttribute") continue;
    const nameNode = nodeAt(attribute, "name");
    if (nameNode !== null && nameNode.type === "JSXIdentifier") names.add(str(nameNode, "name"));
  }
  return names;
}

/**
 * Lowers the attributes of one element or component. `tag` is the lower-case element name, or `null`
 * for a component. An intrinsic element drops the React-only props that have no DOM form (`key`,
 * the hydration-warning flags). A component receives `key` as a prop: `For` and the head components
 * (`Style`, `Meta`, ...) read it, as their own identity.
 */
function lowerAttrs(
  ctx: LowerContext,
  attributes: AstNode[],
  tag: string | null,
  ns: Namespace,
): AttrIR[] {
  const out: AttrIR[] = [];
  // A component's props, and every prop of an element with a spread, are the entries of a props object,
  // where a dynamic value is a getter and a `ref` is a method: `this` there is the object.
  const risk = tag === null || attributes.some((a) => a.type === "JSXSpreadAttribute");
  const mark = (inner: AstNode, name: string): void => {
    if (risk && (name === "ref" || isDynamic(inner, ctx.source) || containsJsx(inner))) {
      ctx.capture(inner);
    }
  };
  // An explicit `value` (or `checked`) wins over its default: one write, whichever comes first.
  const explicit = tag === null ? new Set<string>() : explicitNames(attributes);
  for (const attribute of attributes) {
    if (attribute.type === "JSXSpreadAttribute") {
      const argument = nodeAt(attribute, "argument");
      if (argument === null) continue;
      out.push({ kind: "spread", expr: expr(ctx, argument, ns), start: attribute.start });
      continue;
    }
    const nameNode = nodeAt(attribute, "name");
    if (nameNode === null) continue;
    const name = attrName(ctx, nameNode);
    if (tag !== null && (name === "key" || IGNORED_ATTRIBUTES.has(name))) continue;
    if (
      (name === "defaultValue" && explicit.has("value")) ||
      (name === "defaultChecked" && explicit.has("checked"))
    )
      continue;
    const value = nodeAt(attribute, "value");
    if (tag !== null && name === "dangerouslySetInnerHTML") {
      out.push(innerHtmlAttr(ctx, value, tag, attribute, ns, risk));
      continue;
    }
    const colon = name.indexOf(":");
    const codeOnly = colon !== -1 && CODE_NAMESPACES.has(name.slice(0, colon));
    if (codeOnly && value !== null) {
      const inner = value.type === "JSXExpressionContainer" ? nodeAt(value, "expression") : value;
      if (inner === null || inner.type === "JSXEmptyExpression") {
        fail(
          ctx,
          "EMPTY_ATTRIBUTE_EXPRESSION",
          `Attribute "${name}" has an empty expression.`,
          value,
        );
      }
      mark(inner, name);
      out.push({ kind: "expr", name, expr: expr(ctx, inner, ns), start: attribute.start });
    } else if (codeOnly) {
      out.push({
        kind: "expr",
        name,
        expr: { text: "true", node: attribute, dynamic: false },
        start: attribute.start,
      });
    } else if (value === null) {
      out.push(staticAttribute(tag, name, true, attribute));
    } else if (value.type === "Literal") {
      const raw = value["value"];
      out.push(
        staticAttribute(
          tag,
          name,
          typeof raw === "string" ? decodeHTMLStrict(raw) : String(raw),
          attribute,
        ),
      );
    } else if (value.type === "JSXExpressionContainer") {
      const inner = nodeAt(value, "expression");
      if (inner === null || inner.type === "JSXEmptyExpression") {
        fail(
          ctx,
          "EMPTY_ATTRIBUTE_EXPRESSION",
          `Attribute "${name}" has an empty expression.`,
          value,
        );
      }
      const constant = constantValue(inner);
      if (typeof constant === "string") {
        out.push(staticAttribute(tag, name, constant, attribute));
      } else if (typeof constant === "number") {
        out.push(staticAttribute(tag, name, String(constant), attribute, String(constant)));
      } else if (constant === true) {
        // `aria-*`, `data-*` and the enumerated attributes carry "true" as text (same rule as the runtime).
        out.push(staticAttribute(tag, name, writesBooleanAsText(name) ? "true" : true, attribute));
      } else {
        mark(inner, name);
        out.push({ kind: "expr", name, expr: expr(ctx, inner, ns), start: attribute.start });
      }
    } else if (isJsx(value)) {
      mark(value, name);
      out.push({ kind: "expr", name, expr: expr(ctx, value, ns), start: attribute.start });
    } else {
      fail(ctx, "BAD_ATTRIBUTE", `Unsupported value for attribute "${name}".`, value);
    }
  }
  return out;
}

function pushChild(out: ChildIR[], child: ChildIR): void {
  if (child.kind === "fragment") {
    for (const inner of child.children) pushChild(out, inner);
    return;
  }
  const last = out[out.length - 1];
  if (child.kind === "text" && last !== undefined && last.kind === "text") {
    out[out.length - 1] = { kind: "text", value: last.value + child.value };
    return;
  }
  out.push(child);
}

/**
 * Parents whose text the HTML parser reads differently from a text node that is inserted: table
 * parts and `select` repair or drop text, `pre`, `textarea` and `listing` drop a first newline, and
 * the raw text elements do not decode entities. A literal child of one of them stays an insert.
 */
const NO_TEXT_FOLD = new Set([
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
]);

/** Characters the HTML parser rewrites or drops (CR, NUL, other controls), plus surrogates and U+FFFD. */
const UNSAFE_TEMPLATE_TEXT =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: these are exactly the characters to find
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff\ufdd0-\ufdef\ufffd\ufffe\uffff]/u;

/**
 * The text a literal child renders as, `""` for a value that renders nothing (`null`, a boolean),
 * and `undefined` for anything else, including text the template parser would not keep as written.
 */
function literalChildText(node: AstNode): string | undefined {
  const value = constantValue(node);
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return "";
  if (typeof value === "number") return String(value);
  return UNSAFE_TEMPLATE_TEXT.test(value) ? undefined : value;
}

function lowerChildren(
  ctx: LowerContext,
  nodes: AstNode[],
  ns: Namespace,
  depth: number,
  ancestors: readonly string[] = [],
  fold = false,
): ChildIR[] {
  const out: ChildIR[] = [];
  for (const child of nodes) {
    switch (child.type) {
      case "JSXText": {
        const text = cleanJsxText(str(child, "raw") || str(child, "value"));
        if (text.length > 0) pushChild(out, { kind: "text", value: text });
        break;
      }
      case "JSXElement":
      case "JSXFragment":
        pushChild(out, lowerJsx(ctx, child, ns, depth + 1, ancestors, fold));
        break;
      case "JSXExpressionContainer": {
        const inner = nodeAt(child, "expression");
        if (inner === null || inner.type === "JSXEmptyExpression") break;
        const bare = unwrapParens(inner);
        if (isJsx(bare)) {
          pushChild(out, lowerJsx(ctx, bare, ns, depth + 1, ancestors, fold));
          break;
        }
        const text = fold ? literalChildText(bare) : undefined;
        if (text === undefined) pushChild(out, { kind: "slot", expr: expr(ctx, inner, ns) });
        else if (text.length > 0) pushChild(out, { kind: "text", value: text });
        break;
      }
      case "JSXSpreadChild":
        fail(ctx, "SPREAD_CHILD", "Spread children are not supported.", child);
        break;
      default:
        fail(ctx, "BAD_CHILD", `Unsupported JSX child ${child.type}.`, child);
    }
  }
  return out;
}

/**
 * Lowers a JSX element or fragment into the target-agnostic IR. `fold` says whether the children of
 * a fragment may merge literal expressions into static text: it is true only for fragments inside an
 * element that allows it (an element decides for its own children; a component never folds, because
 * it sees its children as written, and a root fragment is a list of values).
 */
export function lowerJsx(
  ctx: LowerContext,
  node: AstNode,
  ns: Namespace,
  depth = 0,
  ancestors: readonly string[] = [],
  fold = false,
): RootIR {
  if (depth > MAX_JSX_DEPTH)
    fail(ctx, "JSX_TOO_DEEP", `JSX is nested more than ${MAX_JSX_DEPTH} levels deep.`, node);
  if (node.type === "JSXFragment") {
    const children = lowerChildren(ctx, listAt(node, "children"), ns, depth, ancestors, fold);
    const fragment: FragmentIR = { kind: "fragment", children };
    return fragment;
  }
  const opening = nodeAt(node, "openingElement");
  const nameNode = opening === null ? null : nodeAt(opening, "name");
  if (opening === null || nameNode === null) fail(ctx, "BAD_TAG", "Malformed element.", node);
  const info = tagInfo(ctx, nameNode);
  const attrs = lowerAttrs(
    ctx,
    listAt(opening, "attributes"),
    info.kind === "component" ? null : info.name.toLowerCase(),
    ns,
  );
  if (info.kind === "component") {
    // The children of a component are templates of their own: `""` stops the chain of open elements that
    // the parser would repair (`<p><Card><div/></Card></p>` is fine).
    const written = listAt(node, "children");
    for (const child of written) if (child.type !== "JSXText") ctx.capture(child);
    const children = lowerChildren(ctx, written, ns, depth, [...ancestors, ""]);
    const component: ComponentIR = {
      kind: "component",
      callee: info.name,
      attrs,
      children,
      start: node.start,
    };
    return component;
  }
  let childNs: Namespace = ns;
  let own: Namespace = ns;
  if (ns === "html" && SVG_ONLY_TAGS.has(info.name)) {
    own = "svg";
    childNs = "svg";
  }
  if (info.name === "svg") {
    own = "svg";
    childNs = "svg";
  } else if (info.name === "math") {
    own = "math";
    childNs = "math";
  }
  if (own === "svg" && SVG_ROOT_EXCEPTIONS.has(info.name)) childNs = "html";
  const children = lowerChildren(
    ctx,
    listAt(node, "children"),
    childNs,
    depth,
    [...ancestors, info.name],
    !NO_TEXT_FOLD.has(info.name),
  );
  if (own === "html") validateChildren(ctx, info.name, children, node, ancestors);
  if (info.name === "textarea" && own === "html") {
    const folded = textareaValue(children, attrs);
    if (folded !== null) {
      return {
        kind: "element",
        tag: info.name,
        ns: own,
        custom: info.custom,
        attrs: [...attrs, folded],
        children: [],
        start: node.start,
      };
    }
  }
  const element: ElementIR = {
    kind: "element",
    tag: info.name,
    ns: own,
    custom: info.custom,
    attrs,
    children:
      own === "html" && TEXT_ONLY_PARENTS.has(info.name) ? joinTextChildren(children) : children,
    start: node.start,
  };
  return element;
}

/**
 * Elements whose content is text and nothing else (the parser reads it without tags or comments):
 * the server cannot mark where a child of one begins and ends, so its children are one value.
 */
const TEXT_ONLY_PARENTS = new Set(["script", "style", "title"]);

/**
 * The text and slots of a text-only element as one slot, the way {@link textareaValue} does it for a
 * textarea: the server writes them as a single run of text, so the browser output holds a single
 * region for it to adopt. A lone child is left as it is.
 */
function joinTextChildren(children: ChildIR[]): ChildIR[] {
  if (children.length < 2) return children;
  if (children.some((child) => child.kind !== "slot" && child.kind !== "text")) return children;
  const slots = children.filter((child): child is SlotIR => child.kind === "slot");
  const first = slots[0];
  if (first === undefined) return children;
  // Joined as an array so a child that is `null`, `undefined` or a boolean writes nothing (as it does for any
  // other child, and for a lone one): `join` takes the first two as empty, the filter the booleans.
  const text = `[${children
    .map((child) =>
      child.kind === "text" ? JSON.stringify(child.value) : `(${(child as SlotIR).expr.text})`,
    )
    .join(", ")}].filter((part) => typeof part !== "boolean").join("")`;
  return [
    {
      kind: "slot",
      expr: { text, node: first.expr.node, dynamic: slots.some((slot) => slot.expr.dynamic) },
    },
  ];
}

/**
 * A textarea's dynamic children are its value: `<textarea>{text()}</textarea>` binds the `value`
 * property like `value={text()}`, so the live text follows the data and the server writes the same
 * content with no comment markers inside it. Static text and a value or spread already on the
 * element keep their own meaning.
 */
function textareaValue(children: ChildIR[], attrs: AttrIR[]): AttrIR | null {
  if (!children.some((child) => child.kind === "slot")) return null;
  if (children.some((child) => child.kind !== "slot" && child.kind !== "text")) return null;
  if (attrs.some((a) => a.kind === "spread" || a.name === "value" || a.name === "defaultValue")) {
    return null;
  }
  const slots = children.filter((child): child is SlotIR => child.kind === "slot");
  const first = slots[0];
  if (first === undefined) return null;
  const only = children.length === 1;
  const text = only
    ? first.expr.text
    : children
        .map((child) =>
          child.kind === "text"
            ? JSON.stringify(child.value)
            : `String((${(child as SlotIR).expr.text}) ?? "")`,
        )
        .join(" + ");
  return {
    kind: "expr",
    name: "value",
    expr: { text, node: first.expr.node, dynamic: slots.some((slot) => slot.expr.dynamic) },
    start: first.expr.node.start,
  };
}

const WHITESPACE_ONLY = /^[ \t\r\n]*$/;

/** Rejects markup the browser parser would repair, which would desynchronize compiled node paths. */
function validateChildren(
  ctx: LowerContext,
  parent: string,
  children: ChildIR[],
  node: AstNode,
  ancestors: readonly string[],
): void {
  const self = selfNestingProblem(parent, ancestors);
  if (self !== undefined) fail(ctx, "INVALID_HTML_NESTING", self, node);
  const strictParent =
    parent === "table" ||
    parent === "tbody" ||
    parent === "thead" ||
    parent === "tfoot" ||
    parent === "tr";
  const chain = [...ancestors, parent];
  for (const child of children) {
    if (child.kind === "element") {
      const problem =
        nestingProblem(parent, child.tag) ??
        (child.ns === "html" ? ancestorProblem(child.tag, chain) : undefined);
      if (problem !== undefined) fail(ctx, "INVALID_HTML_NESTING", problem, node);
    } else if (child.kind === "text" && strictParent && !WHITESPACE_ONLY.test(child.value)) {
      fail(ctx, "INVALID_HTML_NESTING", `Text cannot be a direct child of <${parent}>.`, node);
    }
  }
}
