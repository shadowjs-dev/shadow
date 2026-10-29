import { containsJsx } from "./classify";
import { CompileError, codeFrame, makeDiagnostic } from "./diagnostics";
import { type DomContext, isConstantRef, refStatement, wrapObjectLiteral } from "./dom";
import type { AttrIR, ChildIR, ComponentIR, ElementIR, ExprIR, RootIR } from "./ir";
import { escapeHtmlAttribute, escapeHtmlText, propertyKey } from "./jsx-text";
import { attributeName, isEventHandlerAttribute } from "./react-names";

/** Properties written as plain attributes on the server (the client sets them as DOM properties). */
const BOOLEAN_PROPERTIES = new Set([
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
]);
const VALUE_PROPERTIES = new Set(["value", "defaultValue"]);
const SKIPPED_PROPERTIES = new Set(["indeterminate", "textContent", "innerText"]);
/** The HTML attributes that a React default-value prop names on the server (`defaultValue` is `value`). */
const DEFAULT_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["defaultChecked", "checked"],
  ["defaultValue", "value"],
]);

/** The attribute a JSX name is written as in the markup. */
function markupName(name: string, svg: boolean): string {
  return DEFAULT_ATTRIBUTES.get(name) ?? attributeName(name, svg);
}
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

function fail(d: DomContext, code: string, message: string, start: number): never {
  const diagnostic = makeDiagnostic(d.source, code, message, start, start + 1);
  throw new CompileError(diagnostic, codeFrame(d.source, start), d.id);
}

/** Collects alternating static strings and runtime holes. */
class Parts {
  readonly statics: string[] = [];
  readonly holes: string[] = [];
  private current = "";

  text(value: string): void {
    this.current += value;
  }

  hole(code: string): void {
    this.statics.push(this.current);
    this.holes.push(code);
    this.current = "";
  }

  finish(): { statics: string[]; holes: string[] } {
    return { statics: [...this.statics, this.current], holes: this.holes };
  }
}

function isEventName(name: string): boolean {
  return /^on[A-Za-z]/.test(name);
}

function ssrCall(d: DomContext, parts: Parts): string {
  const { statics, holes } = parts.finish();
  if (holes.length === 1 && statics.every((s) => s === "")) return holes[0] as string;
  const ssr = d.reg.helper("ssr");
  if (holes.length === 0) return `${ssr}([${JSON.stringify(statics[0] ?? "")}])`;
  const list = d.reg.hoistParts(statics);
  return `${ssr}(${list}, ${holes.join(", ")})`;
}

function escaped(d: DomContext, code: string): string {
  return `${d.reg.helper("escape")}(${code})`;
}

/**
 * How the HTML parser reads the content of an element: `raw` for `script` and `style` (no tags, no entities),
 * `escapable` for `title` and `textarea` (entities only). Neither can hold a comment, so the markers
 * that delimit a dynamic child elsewhere would show up as text. SVG parses these names as ordinary elements.
 */
function textKind(el: ElementIR): "raw" | "escapable" | null {
  if (el.ns !== "html") return null;
  if (el.tag === "script" || el.tag === "style") return "raw";
  return el.tag === "title" || el.tag === "textarea" ? "escapable" : null;
}

/** A dynamic child of a text-only element: written without markers, as the element's text requires. */
function textHole(d: DomContext, el: ElementIR, kind: "raw" | "escapable", code: string): string {
  return kind === "raw"
    ? `${d.reg.helper("ssrRawText")}(${JSON.stringify(el.tag)}, ${code})`
    : escaped(d, code);
}

function classSources(el: ElementIR): { statics: string[]; dynamic: string[] } {
  const statics: string[] = [];
  const dynamic: string[] = [];
  for (const attr of el.attrs) {
    if (
      attr.kind === "static" &&
      (attr.name === "class" || attr.name === "className") &&
      typeof attr.value === "string"
    ) {
      statics.push(attr.value);
    } else if (
      attr.kind === "expr" &&
      (attr.name === "class" || attr.name === "className" || attr.name === "classList")
    ) {
      dynamic.push(attr.expr.text);
    } else if (attr.kind === "expr" && attr.name.startsWith("class:")) {
      dynamic.push(`{ ${JSON.stringify(attr.name.slice(6))}: ${attr.expr.text} }`);
    }
  }
  return { statics, dynamic };
}

/** One piece of a props object: a spread, or the entries between spreads. */
type PropsPiece = { spread: string } | { entries: string[] };

/** True for a name the server never writes on an element: handlers, `ref` and the directives for the client. */
function clientOnly(name: string): boolean {
  return (
    name === "ref" ||
    isEventName(name) ||
    name.startsWith("on:") ||
    name.startsWith("use:") ||
    name.startsWith("prop:")
  );
}

/**
 * Runtime props for a component, or for an element with a spread (`component` false), that need
 * `mergeProps`/`ssrElement` semantics. A component gets every prop the client gives it, handlers and
 * `ref` included. An element gets none of those (the server writes no handler), and its `class:` and
 * `style:` directives become the last `classList` and `style` entries, because they apply after the
 * spread. The plain `classList` and `style` props of that element move into those entries so that no
 * source is lost; a `style` or `classList` that a spread supplies is replaced by them.
 */
function propsObject(d: DomContext, attrs: AttrIR[], component: boolean): string {
  const pieces: PropsPiece[] = [];
  const entries = (): string[] => {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && "entries" in last) return last.entries;
    const fresh: string[] = [];
    pieces.push({ entries: fresh });
    return fresh;
  };
  const hasStyleDirective =
    !component && attrs.some((a) => a.kind === "expr" && a.name.startsWith("style:"));
  const hasClassDirective =
    !component && attrs.some((a) => a.kind === "expr" && a.name.startsWith("class:"));
  const styleSources: string[] = [];
  const classMembers: string[] = [];
  let classListSource: string | null = null;
  let dynamicDirectives = false;
  const noteDynamic = (expr: ExprIR): void => {
    dynamicDirectives ||= expr.dynamic || containsJsx(expr.node);
  };
  for (const attr of attrs) {
    if (attr.kind === "spread") {
      pieces.push({
        spread: attr.expr.dynamic
          ? `() => ${wrapObjectLiteral(attr.expr.text, attr.expr.node)}`
          : attr.expr.text,
      });
    } else if (attr.kind === "static") {
      if (hasStyleDirective && attr.name === "style" && typeof attr.value === "string") {
        styleSources.push(JSON.stringify(attr.value));
        continue;
      }
      entries().push(
        `${propertyKey(attr.name)}: ${attr.value === true ? "true" : (attr.js ?? JSON.stringify(attr.value))}`,
      );
    } else if (!component && clientOnly(attr.name)) {
      // Nothing of it reaches the markup.
    } else if (!component && attr.name.startsWith("class:")) {
      classMembers.push(`${JSON.stringify(attr.name.slice(6))}: ${attr.expr.text}`);
      noteDynamic(attr.expr);
    } else if (!component && attr.name.startsWith("style:")) {
      styleSources.push(`{ ${JSON.stringify(attr.name.slice(6))}: ${attr.expr.text} }`);
      noteDynamic(attr.expr);
    } else if (hasStyleDirective && attr.name === "style") {
      styleSources.push(attr.expr.text);
      noteDynamic(attr.expr);
    } else if (hasClassDirective && attr.name === "classList") {
      classListSource = attr.expr.text;
      noteDynamic(attr.expr);
    } else if (attr.name === "ref") {
      entries().push(
        refStatement(d, attr.expr.text, attr.expr.node, isConstantRef(d, attr.expr.node)),
      );
    } else if (attr.expr.dynamic || containsJsx(attr.expr.node)) {
      entries().push(`get ${propertyKey(attr.name)}() {\nreturn ${attr.expr.text};\n}`);
    } else {
      entries().push(`${propertyKey(attr.name)}: ${attr.expr.text}`);
    }
  }
  const folded = (key: string, value: string): string =>
    dynamicDirectives ? `get ${key}() {\nreturn ${value};\n}` : `${key}: ${value}`;
  if (hasClassDirective) {
    const spreadOld = classListSource === null ? "" : `...(${classListSource}), `;
    pieces.push({ entries: [folded("classList", `{ ${spreadOld}${classMembers.join(", ")} }`)] });
  }
  if (hasStyleDirective) {
    const last = pieces[pieces.length - 1];
    const entry = folded("style", `[${styleSources.join(", ")}]`);
    if (hasClassDirective && last !== undefined && "entries" in last) last.entries.push(entry);
    else pieces.push({ entries: [entry] });
  }
  const texts = pieces
    .filter((piece) => "spread" in piece || piece.entries.length > 0)
    .map((piece) => ("spread" in piece ? piece.spread : `{\n${piece.entries.join(",\n")}\n}`));
  if (texts.length === 0) return "{}";
  // A lone dynamic spread is an accessor of the props: mergeProps turns it into a props object.
  if (texts.length === 1 && !(texts[0] as string).startsWith("() =>")) return texts[0] as string;
  return `${d.reg.helper("mergeProps")}(${texts.join(", ")})`;
}

/** The `style` sources of an element: its static string first, then each `style` and `style:` in order. */
function styleSources(el: ElementIR): { statics: string[]; dynamic: string[] } {
  const statics: string[] = [];
  const dynamic: string[] = [];
  for (const attr of el.attrs) {
    if (attr.kind === "static" && attr.name === "style" && typeof attr.value === "string") {
      statics.push(attr.value);
    } else if (attr.kind === "expr" && attr.name === "style") {
      dynamic.push(attr.expr.text);
    } else if (attr.kind === "expr" && attr.name.startsWith("style:")) {
      dynamic.push(`{ ${JSON.stringify(attr.name.slice(6))}: ${attr.expr.text} }`);
    }
  }
  return { statics, dynamic };
}

function serializeAttrs(d: DomContext, el: ElementIR, parts: Parts): void {
  const svg = el.ns === "svg";
  const classes = classSources(el);
  const styles = styleSources(el);
  let classDone = false;
  let styleDone = false;
  const emitClass = (): void => {
    if (classDone) return;
    classDone = true;
    if (classes.dynamic.length === 0) {
      if (classes.statics.length > 0) {
        parts.text(` class="${escapeHtmlAttribute(classes.statics.join(" "))}"`);
      }
      return;
    }
    const items = [...classes.statics.map((s) => JSON.stringify(s)), ...classes.dynamic];
    parts.hole(`${d.reg.helper("ssrClass")}([${items.join(", ")}])`);
  };
  // A static style with no dynamic one stays markup; otherwise every source is one `ssrStyle`, so the
  // element never has two `style` attributes (the static string comes first, later declarations win).
  const emitStyle = (): void => {
    if (styleDone) return;
    styleDone = true;
    if (styles.dynamic.length === 0) {
      if (styles.statics.length > 0) {
        parts.text(` style="${escapeHtmlAttribute(styles.statics.join(";"))}"`);
      }
      return;
    }
    const items = [...styles.statics.map((s) => JSON.stringify(s)), ...styles.dynamic];
    parts.hole(`${d.reg.helper("ssrStyle")}([${items.join(", ")}])`);
  };
  for (const attr of el.attrs) {
    if (attr.kind === "static") {
      if (attr.name === "class" || attr.name === "className") {
        emitClass();
        continue;
      }
      if (attr.name === "style" && typeof attr.value === "string") {
        emitStyle();
        continue;
      }
      if (isEventHandlerAttribute(attr.name) && typeof attr.value === "string") {
        fail(
          d,
          "STRING_EVENT_HANDLER",
          `"${attr.name}" received a string. Pass a function instead.`,
          attr.start,
        );
      }
      const name = markupName(attr.name, svg);
      parts.text(
        attr.value === true ? ` ${name}` : ` ${name}="${escapeHtmlAttribute(attr.value)}"`,
      );
      continue;
    }
    if (attr.kind === "spread") continue;
    const { name, expr } = attr;
    if (
      name === "ref" ||
      isEventName(name) ||
      name.startsWith("on:") ||
      name.startsWith("oncapture:")
    )
      continue;
    if (name.startsWith("use:") || name.startsWith("prop:")) continue;
    if (
      name === "class" ||
      name === "className" ||
      name === "classList" ||
      name.startsWith("class:")
    ) {
      emitClass();
      continue;
    }
    if (name === "style" || name.startsWith("style:")) {
      emitStyle();
      continue;
    }
    if (name === "innerHTML" || SKIPPED_PROPERTIES.has(name)) continue;
    // Registered when used, so a control whose value is written as content imports nothing extra.
    const ssrAttribute = (): string => d.reg.helper("ssrAttribute");
    if (name.startsWith("attr:")) {
      parts.hole(`${ssrAttribute()}(${JSON.stringify(name.slice(5))}, ${expr.text})`);
    } else if (name.startsWith("bool:")) {
      parts.hole(`${ssrAttribute()}(${JSON.stringify(name.slice(5))}, ${expr.text}, true)`);
    } else if (BOOLEAN_PROPERTIES.has(name)) {
      parts.hole(`${ssrAttribute()}(${JSON.stringify(markupName(name, svg))}, ${expr.text}, true)`);
    } else if (VALUE_PROPERTIES.has(name)) {
      // A textarea's value is its content and a select's value marks its options (written with the
      // children, see `serializeElement`); a `value` attribute is ignored on both.
      if (el.tag !== "textarea" && el.tag !== "select")
        parts.hole(`${ssrAttribute()}("value", ${expr.text})`);
    } else {
      parts.hole(`${ssrAttribute()}(${JSON.stringify(markupName(name, svg))}, ${expr.text})`);
    }
  }
  emitClass();
}

function innerHtmlOf(el: ElementIR): ExprIR | null {
  for (const attr of el.attrs) {
    if (attr.kind === "expr" && attr.name === "innerHTML") return attr.expr;
  }
  return null;
}

/** The `value` expression of a textarea or select (`defaultValue` when there is no `value`). */
function controlValueOf(el: ElementIR): ExprIR | null {
  let fallback: ExprIR | null = null;
  for (const attr of el.attrs) {
    if (attr.kind !== "expr") continue;
    if (attr.name === "value") return attr.expr;
    if (attr.name === "defaultValue") fallback = attr.expr;
  }
  return fallback;
}

/** The `textContent` / `innerText` expression of an element, written as its escaped text. */
function textContentOf(el: ElementIR): ExprIR | null {
  for (const attr of el.attrs) {
    if (attr.kind === "expr" && (attr.name === "textContent" || attr.name === "innerText")) {
      return attr.expr;
    }
  }
  return null;
}

function serializeChildren(d: DomContext, el: ElementIR, parts: Parts): void {
  const raw = RAW_TEXT_ELEMENTS.has(el.tag);
  const kind = textKind(el);
  for (const child of el.children) {
    switch (child.kind) {
      case "text":
        if (raw) {
          if (child.value.toLowerCase().includes(`</${el.tag}`)) {
            fail(
              d,
              "RAW_TEXT_CLOSE",
              `Text inside <${el.tag}> must not contain "</${el.tag}".`,
              el.start,
            );
          }
          parts.text(child.value);
        } else {
          parts.text(escapeHtmlText(child.value));
        }
        break;
      case "element":
        serializeElement(d, child, parts, false);
        break;
      case "component":
        if (kind !== null) {
          parts.hole(textHole(d, el, kind, genComponent(d, child)));
          break;
        }
        parts.text("<!--[-->");
        parts.hole(escaped(d, genComponent(d, child)));
        parts.text("<!--]-->");
        break;
      case "slot":
        if (kind !== null) {
          parts.hole(textHole(d, el, kind, child.expr.text));
          break;
        }
        parts.text("<!--[-->");
        parts.hole(escaped(d, child.expr.text));
        parts.text("<!--]-->");
        break;
      case "fragment":
        fail(d, "INTERNAL", "Fragment survived lowering.", el.start);
    }
  }
}

function serializeElement(d: DomContext, el: ElementIR, parts: Parts, root: boolean): void {
  const hydratable = d.hydratable;
  if (el.attrs.some((a) => a.kind === "spread")) {
    const children = new Parts();
    serializeChildren(d, el, children);
    const inner = children.finish();
    const childCode =
      inner.statics.length === 1 && inner.holes.length === 0 && inner.statics[0] === ""
        ? "undefined"
        : // A thunk, so the element's hydration key is drawn before its children's keys.
          `() => ${ssrCall(d, children)}`;
    // The SVG flag is passed only for SVG elements, so HTML output stays as it was.
    const svgFlag = el.ns === "svg" ? ", true" : "";
    parts.hole(
      `${d.reg.helper("ssrElement")}(${JSON.stringify(el.tag)}, ${propsObject(d, el.attrs, false)}, ${childCode}, ${hydratable && root}${svgFlag})`,
    );
    return;
  }
  parts.text(`<${el.tag}`);
  if (hydratable && root) parts.hole(`${d.reg.helper("ssrHydrationKey")}()`);
  serializeAttrs(d, el, parts);
  parts.text(">");
  if (VOID_ELEMENTS.has(el.tag)) {
    if (el.children.length > 0)
      fail(d, "VOID_CHILDREN", `<${el.tag}> cannot have children.`, el.start);
    return;
  }
  const html = innerHtmlOf(el);
  const selectValue = el.tag === "select" ? controlValueOf(el) : null;
  if (html !== null) {
    if (el.children.length > 0)
      fail(d, "INNER_HTML_CHILDREN", "innerHTML cannot be combined with children.", el.start);
    parts.hole(`${d.reg.helper("ssrRaw")}(${html.text})`);
  } else if (selectValue !== null) {
    // A select's value is not an attribute: the options it matches are written `selected`.
    const inner = new Parts();
    serializeChildren(d, el, inner);
    parts.hole(`${d.reg.helper("ssrSelectValue")}(${selectValue.text}, ${ssrCall(d, inner)})`);
  } else {
    // A textarea shows its value as its content.
    const text = textContentOf(el) ?? (el.tag === "textarea" ? controlValueOf(el) : null);
    if (text !== null) {
      if (el.children.length > 0) {
        fail(d, "TEXT_CONTENT_CHILDREN", "textContent cannot be combined with children.", el.start);
      }
      const helper = el.tag === "textarea" ? "ssrTextArea" : "escape";
      parts.hole(`${d.reg.helper(helper)}(${text.text})`);
    } else {
      serializeChildren(d, el, parts);
    }
  }
  parts.text(`</${el.tag}>`);
}

function genComponent(d: DomContext, c: ComponentIR): string {
  const create = d.reg.helper("createComponent");
  const props = componentProps(d, c);
  return `${create}(${c.callee}, ${props})`;
}

function componentProps(d: DomContext, c: ComponentIR): string {
  const base = propsObject(d, c.attrs, true);
  if (c.children.length === 0) return base;
  const only = c.children.length === 1 ? c.children[0] : undefined;
  let value: string;
  if (only !== undefined && only.kind === "text") value = JSON.stringify(only.value);
  else if (only !== undefined && only.kind === "slot") value = only.expr.text;
  else if (only !== undefined) value = childValue(d, only);
  else value = `[${c.children.map((child) => childValue(d, child)).join(", ")}]`;
  const getter = `get children() {\nreturn ${value};\n}`;
  if (base === "{}") return `{\n${getter}\n}`;
  return `${d.reg.helper("mergeProps")}(${base}, {\n${getter}\n})`;
}

function childValue(d: DomContext, child: ChildIR): string {
  switch (child.kind) {
    case "text":
      return JSON.stringify(child.value);
    case "element": {
      const parts = new Parts();
      serializeElement(d, child, parts, true);
      return ssrCall(d, parts);
    }
    case "component":
      return genComponent(d, child);
    case "slot":
      return child.expr.text;
    case "fragment":
      return `[${child.children.map((c) => childValue(d, c)).join(", ")}]`;
  }
}

/** Generates the replacement expression for one JSX root in `ssr` mode. */
export function generateSsr(d: DomContext, root: RootIR): string {
  if (root.kind === "component") return genComponent(d, root);
  if (root.kind === "fragment") return `[${root.children.map((c) => childValue(d, c)).join(", ")}]`;
  const parts = new Parts();
  serializeElement(d, root, parts, true);
  return ssrCall(d, parts);
}
