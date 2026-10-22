import { type AstNode, isNode, unwrapParens } from "./ast";
import { containsJsx, isDynamic } from "./classify";
import { CompileError, codeFrame, makeDiagnostic } from "./diagnostics";
import type {
  AttrIR,
  ChildIR,
  ComponentIR,
  ElementIR,
  ExprIR,
  FragmentIR,
  RootIR,
  SlotIR,
} from "./ir";
import { escapeHtmlAttribute, escapeHtmlText, propertyKey } from "./jsx-text";
import type { LowerContext } from "./lower";
import { attributeName, eventPlan } from "./react-names";
import type { Registry } from "./registry";

/** Events whose handlers are attached once per document through event delegation. */
export const DELEGATED_EVENTS: ReadonlySet<string> = new Set([
  // Composed events only: `change` is not composed and must be bound on its element.
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
]);

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

/** JSX names that are assigned as DOM properties (not attributes) on HTML elements. */
const PROPERTIES = new Set([
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
]);

/** Properties that must be applied after children exist (`<select value>`), and read back safely. */
const POST_PROPERTIES = new Set(["value", "checked", "selected", "defaultValue", "defaultChecked"]);

const XLINK = "http://www.w3.org/1999/xlink";

export interface DomContext extends LowerContext {
  reg: Registry;
  /** Names of the module that are never assignable (`const`, imports): see `unassignableNames`. */
  immutable: ReadonlySet<string>;
  /** Emit extra attributes and metadata for development builds. */
  dev: boolean;
  /** SSR only: stamp hydration keys on template roots. */
  hydratable: boolean;
  /**
   * Element roots that are a function call, `(() => {\n<body>\n})()`, by their text, with the
   * statements of `<body>` (ending in `return`). A place that is a function body already (a
   * `return` statement, an arrow with an expression body, a getter) uses the statements and skips
   * the function. The `dom` target fills it; the `ssr` target leaves it empty.
   */
  blocks: Map<string, string>;
}

/**
 * The statements that return `expression`: the body of an element root's wrapping function when
 * `expression` is exactly one, else a plain `return`. Use it where the text becomes the whole body of a function.
 */
export function returnStatement(d: DomContext, expression: string): string {
  return d.blocks.get(expression) ?? `return ${expression};`;
}

function fail(d: DomContext, code: string, message: string, start: number): never {
  const diagnostic = makeDiagnostic(d.source, code, message, start, start + 1);
  throw new CompileError(diagnostic, codeFrame(d.source, start), d.id);
}

/** Variable naming and statement buffers for one generated block. */
class Block {
  decls: string[] = [];
  ops: string[] = [];
  private counter = 0;

  id(): string {
    this.counter += 1;
    return this.counter === 1 ? "_el$" : `_el$${this.counter}`;
  }
}

function isEventAttribute(name: string): boolean {
  return /^on[A-Za-z]/.test(name);
}

/** The React `autoFocus` attribute: a focus request, not markup (see `autoFocus` in the web runtime). */
function isAutoFocus(name: string, svg: boolean): boolean {
  return name === "autoFocus" && !svg;
}

function hasDynamicParts(el: ElementIR): boolean {
  if (el.attrs.some((a) => a.kind !== "static" || isAutoFocus(a.name, false))) return true;
  return el.children.some(
    (c) =>
      c.kind === "slot" || c.kind === "component" || (c.kind === "element" && hasDynamicParts(c)),
  );
}

/** Iterative version of the "does this subtree need a variable" query. */
function needsRef(el: ElementIR, memo: Map<ElementIR, boolean>): boolean {
  const cached = memo.get(el);
  if (cached !== undefined) return cached;
  const result = hasDynamicParts(el);
  memo.set(el, result);
  return result;
}

function elementFlags(el: ElementIR): number {
  let flags = 0;
  if (el.ns === "svg") flags |= 1;
  else if (el.ns === "math") flags |= 2;
  const stack: ElementIR[] = [el];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.custom) flags |= 4;
    for (const child of current.children) if (child.kind === "element") stack.push(child);
  }
  return flags;
}

// ---------- expressions ----------

export function wrapObjectLiteral(text: string, node: AstNode): string {
  const inner = unwrapParens(node);
  return inner.type === "ObjectExpression" || inner.type === "SequenceExpression"
    ? `(${text})`
    : text;
}

/** Reactive accessor text for a dynamic expression (or the value itself when static). */
function accessor(d: DomContext, e: ExprIR): string {
  if (!e.dynamic) return e.text;
  const inner = unwrapParens(e.node);
  if (inner.type === "CallExpression") {
    const callee = inner["callee"];
    const args = inner["arguments"];
    if (
      isNode(callee) &&
      callee.type === "Identifier" &&
      Array.isArray(args) &&
      args.length === 0
    ) {
      return d.text(callee);
    }
  }
  return `() => ${wrapObjectLiteral(e.text, e.node)}`;
}

/** Wraps dynamic conditional tests in memos so a branch is only rebuilt when truthiness changes. */
function planConditional(d: DomContext, node: AstNode, memoNames: string[]): string | null {
  const inner = unwrapParens(node);
  if (inner.type === "ConditionalExpression") {
    const test = inner["test"];
    const consequent = inner["consequent"];
    const alternate = inner["alternate"];
    if (!isNode(test) || !isNode(consequent) || !isNode(alternate)) return null;
    if (!isDynamic(test, d.source) || !(containsJsx(consequent) || containsJsx(alternate)))
      return null;
    const name = conditionalName(memoNames.length);
    memoNames.push(`const ${name} = ${d.reg.helper("memo")}(() => !!(${d.text(test)}));`);
    const nested = planConditional(d, alternate, memoNames);
    const alt = nested ?? d.text(alternate);
    return `${name}() ? ${d.text(consequent)} : ${alt}`;
  }
  if (inner.type === "LogicalExpression" && inner["operator"] === "&&") {
    const left = inner["left"];
    const right = inner["right"];
    if (!isNode(left) || !isNode(right)) return null;
    if (!isDynamic(left, d.source) || !containsJsx(right)) return null;
    const name = conditionalName(memoNames.length);
    memoNames.push(`const ${name} = ${d.reg.helper("memo")}(() => !!(${d.text(left)}));`);
    return `${name}() && ${d.text(right)}`;
  }
  return null;
}

function conditionalName(index: number): string {
  return index === 0 ? "_c$" : `_c$${index + 1}`;
}

/** Value passed to `insert` for an expression child. */
function slotValue(d: DomContext, e: ExprIR): string {
  if (!e.dynamic) return e.text;
  const memos: string[] = [];
  const body = planConditional(d, e.node, memos);
  if (body !== null) {
    return `(() => {\n${memos.join("\n")}\nreturn () => ${body};\n})()`;
  }
  return accessor(d, e);
}

// ---------- components ----------

/**
 * True when a `ref` target is a name that cannot be assigned. A ref may be a function or, for a
 * `let` binding, a variable to store the element in; the assignment is only emitted for the latter,
 * because assigning a `const` fails the bundle even in a branch that never runs.
 */
function isConstantRef(d: DomContext, node: AstNode): boolean {
  const target = unwrapParens(node);
  return target.type === "Identifier" && d.immutable.has(String(target["name"]));
}

function refStatement(text: string, node: AstNode, constant: boolean): string {
  const target = unwrapParens(node);
  const assignable =
    !constant && (target.type === "Identifier" || target.type === "MemberExpression");
  return assignable
    ? `ref(r$) {\nconst _ref$ = ${text};\ntypeof _ref$ === "function" ? _ref$(r$) : ${text} = r$;\n}`
    : `ref(r$) {\nconst _ref$ = ${text};\ntypeof _ref$ === "function" && _ref$(r$);\n}`;
}

function propEntries(
  d: DomContext,
  attrs: AttrIR[],
  children: ChildIR[],
  start: number,
): string[][] {
  // Segments of plain props separated by spreads; spread segments are single-element arrays marked by `...`.
  const segments: string[][] = [[]];
  const current = (): string[] => segments[segments.length - 1] as string[];
  for (const attr of attrs) {
    if (attr.kind === "spread") {
      const text = attr.expr.dynamic
        ? `() => ${wrapObjectLiteral(attr.expr.text, attr.expr.node)}`
        : attr.expr.text;
      segments.push([`...${text}`]);
      segments.push([]);
      continue;
    }
    if (attr.kind === "static") {
      current().push(
        `${propertyKey(attr.name)}: ${attr.value === true ? "true" : (attr.js ?? JSON.stringify(attr.value))}`,
      );
      continue;
    }
    if (attr.name === "ref") {
      current().push(
        refStatement(attr.expr.text, attr.expr.node, isConstantRef(d, attr.expr.node)),
      );
    } else if (attr.expr.dynamic || containsJsx(attr.expr.node)) {
      current().push(`get ${propertyKey(attr.name)}() {\n${returnStatement(d, attr.expr.text)}\n}`);
    } else {
      current().push(`${propertyKey(attr.name)}: ${attr.expr.text}`);
    }
  }
  if (children.length > 0) {
    if (attrs.some((a) => a.kind !== "spread" && a.name === "children")) {
      fail(
        d,
        "CHILDREN_CONFLICT",
        'A component cannot have both a "children" prop and JSX children.',
        start,
      );
    }
    const only = children.length === 1 ? children[0] : undefined;
    if (only !== undefined && only.kind === "text") {
      current().push(`children: ${JSON.stringify(only.value)}`);
    } else if (only !== undefined && only.kind === "slot" && !only.expr.dynamic) {
      current().push(`children: ${only.expr.text}`);
    } else {
      const value =
        only === undefined
          ? `[${children.map((c) => childValue(d, c)).join(", ")}]`
          : childValue(d, only, true);
      current().push(`get children() {\n${returnStatement(d, value)}\n}`);
    }
  }
  return segments;
}

function genComponent(d: DomContext, c: ComponentIR): string {
  const segments = propEntries(d, c.attrs, c.children, c.start);
  const create = d.reg.helper("createComponent");
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (segment.length === 1 && (segment[0] as string).startsWith("...")) {
      parts.push((segment[0] as string).slice(3));
    } else {
      parts.push(`{\n${segment.join(",\n")}\n}`);
    }
  }
  let props: string;
  if (parts.length === 0) props = "{}";
  else if (parts.length === 1 && !(parts[0] as string).startsWith("() =>"))
    props = parts[0] as string;
  // A lone dynamic spread is an accessor of the props: mergeProps turns it into a props object.
  else props = `${d.reg.helper("mergeProps")}(${parts.join(", ")})`;
  const name = d.dev ? `, ${JSON.stringify(c.callee)}` : "";
  return `${create}(${c.callee}, ${props}${name})`;
}

/** Code for a child used as a value (component children, fragment items). */
function childValue(d: DomContext, child: ChildIR, reactiveSingle = false): string {
  switch (child.kind) {
    case "text":
      return JSON.stringify(child.value);
    case "element":
      return genElementRoot(d, child);
    case "component":
      return genComponent(d, child);
    case "fragment":
      return `[${child.children.map((c) => childValue(d, c)).join(", ")}]`;
    case "slot":
      if (!child.expr.dynamic) return child.expr.text;
      return reactiveSingle
        ? child.expr.text
        : `${d.reg.helper("memo")}(() => ${wrapObjectLiteral(child.expr.text, child.expr.node)})`;
  }
}

// ---------- elements ----------

function attributeHtml(name: string, value: string | true, svg: boolean): string {
  const attr = attributeName(name, svg);
  if (value === true) return ` ${attr}`;
  return ` ${attr}="${escapeHtmlAttribute(value)}"`;
}

interface AttrResult {
  html: string;
  post: string[];
}

/** Single-function render effect. The braces matter: a returned function would become a cleanup. */
function effect(d: DomContext, body: string): string {
  return `${d.reg.helper("effect")}(() => {\n${body};\n});`;
}

/**
 * Delegated events that more than one attribute of one element binds (`onInput` and a text input's
 * `onChange` are both `input`). The delegated slot holds one handler, so such a group is combined into
 * one function that calls the handlers in source order. Maps the event type to the attribute indexes.
 */
function delegatedGroups(el: ElementIR, plainCount: number): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < plainCount; i += 1) {
    const attr = el.attrs[i];
    if (attr === undefined || attr.kind !== "expr" || !isEventAttribute(attr.name)) continue;
    const plan = eventPlan(attr.name, el.tag, staticType(el));
    if (plan.capture || plan.passive || !DELEGATED_EVENTS.has(plan.type)) continue;
    groups.set(plan.type, [...(groups.get(plan.type) ?? []), i]);
  }
  for (const [type, indexes] of groups) if (indexes.length < 2) groups.delete(type);
  return groups;
}

/** One handler as a function value: a `[fn, data]` tuple becomes `(event) => fn(data, event)`. */
function handlerValue(d: DomContext, attr: Extract<AttrIR, { kind: "expr" }>): string {
  const target = unwrapParens(attr.expr.node);
  const elements =
    target.type === "ArrayExpression" && Array.isArray(target["elements"])
      ? target["elements"]
      : null;
  if (elements !== null && elements.length === 2 && elements.every(isNode)) {
    const [handler, data] = elements as AstNode[];
    return `((f, x) => (event) => f(x, event))(${d.text(handler as AstNode)}, ${d.text(data as AstNode)})`;
  }
  return attr.expr.text;
}

function genAttrs(d: DomContext, el: ElementIR, v: string | null, block: Block): AttrResult {
  const out: AttrResult = { html: "", post: [] };
  const spreadAt = el.attrs.findIndex((a) => a.kind === "spread");
  const plainCount = spreadAt === -1 ? el.attrs.length : spreadAt;
  const isSvg = el.ns === "svg";
  const groups = delegatedGroups(el, plainCount);
  const grouped = new Set<number>();
  for (const indexes of groups.values()) for (const index of indexes) grouped.add(index);
  for (let i = 0; i < plainCount; i += 1) {
    const attr = el.attrs[i];
    if (attr === undefined || attr.kind === "spread") continue;
    if (grouped.has(i)) {
      // The group is emitted once, at its first member; the others are part of that handler.
      const group = [...groups.entries()].find(([, indexes]) => indexes[0] === i);
      if (group !== undefined && v !== null) {
        const [type, indexes] = group;
        const parts = indexes.map((index) => {
          const member = el.attrs[index];
          return member !== undefined && member.kind === "expr"
            ? handlerValue(d, member)
            : "undefined";
        });
        d.reg.delegated.add(type);
        block.ops.push(`${v}.$$${type} = ${d.reg.helper("chainEvents")}(${parts.join(", ")});`);
      }
      continue;
    }
    if (attr.kind === "static") {
      if (isEventAttribute(attr.name) && typeof attr.value === "string") {
        fail(
          d,
          "STRING_EVENT_HANDLER",
          `"${attr.name}" received a string. Pass a function instead.`,
          attr.start,
        );
      }
      if (attr.name === "children")
        fail(d, "CHILDREN_ATTRIBUTE", "Use JSX children, not a children attribute.", attr.start);
      if (isAutoFocus(attr.name, isSvg)) {
        if (v === null) fail(d, "INTERNAL", "autoFocus without an element reference.", attr.start);
        block.ops.push(
          `${d.reg.helper("autoFocus")}(${v}, ${attr.value === true ? "true" : JSON.stringify(attr.value)});`,
        );
        continue;
      }
      out.html += attributeHtml(attr.name, attr.value, isSvg);
      continue;
    }
    if (v === null)
      fail(d, "INTERNAL", "Dynamic attribute without an element reference.", attr.start);
    genExprAttr(d, el, attr, v, block, out, isSvg);
  }
  if (spreadAt !== -1) {
    if (v === null) fail(d, "INTERNAL", "Spread without an element reference.", el.start);
    const rest = el.attrs.slice(spreadAt);
    const segments = propEntries(d, rest, [], el.start);
    const parts: string[] = [];
    for (const segment of segments) {
      if (segment.length === 0) continue;
      if (segment.length === 1 && (segment[0] as string).startsWith("..."))
        parts.push((segment[0] as string).slice(3));
      else parts.push(`{\n${segment.join(",\n")}\n}`);
    }
    const props =
      parts.length === 1
        ? (parts[0] as string)
        : `${d.reg.helper("mergeProps")}(${parts.join(", ")})`;
    const hasChildren = el.children.length > 0;
    block.ops.push(`${d.reg.helper("spread")}(${v}, ${props}, ${isSvg}, ${hasChildren});`);
  }
  return out;
}

function genExprAttr(
  d: DomContext,
  el: ElementIR,
  attr: Extract<AttrIR, { kind: "expr" }>,
  v: string,
  block: Block,
  out: AttrResult,
  isSvg: boolean,
): void {
  // `xlinkHref` is the namespaced `xlink:href` in SVG; every other name is spelled as written here.
  const name = isSvg && /^xlink[A-Z]/.test(attr.name) ? attributeName(attr.name, true) : attr.name;
  // Forgiving: a bare identifier may hold a signal accessor (`value={count}`). It is read through
  // a small unwrap inside a binding, so it works whether it holds a value or an accessor.
  const identifier = unwrapParens(attr.expr.node);
  const maybeAccessor =
    !attr.expr.dynamic &&
    identifier.type === "Identifier" &&
    !["undefined", "NaN", "Infinity"].includes(String(identifier["name"])) &&
    name !== "ref" &&
    name !== "children" &&
    !isEventAttribute(name) &&
    !/^(?:use|on|oncapture):/.test(name);
  const expr: ExprIR = maybeAccessor
    ? {
        ...attr.expr,
        dynamic: true,
        text: `(typeof ${attr.expr.text} === "function" ? ${attr.expr.text}() : ${attr.expr.text})`,
      }
    : attr.expr;
  const reg = d.reg;
  const text = wrapObjectLiteral(expr.text, expr.node);
  const run = (statement: string): string =>
    expr.dynamic ? effect(d, statement.replace(/;$/, "")) : statement;

  if (name === "ref") {
    // A ref is a callback, a `{ current }` object (`useRef`-style, filled and cleared by refTo), or a
    // variable that receives the element. A `let` or member variable holding neither takes the element.
    const target = unwrapParens(expr.node);
    const refTo = reg.helper("refTo");
    if (
      isConstantRef(d, target) ||
      (target.type !== "Identifier" && target.type !== "MemberExpression")
    ) {
      block.ops.push(`${refTo}(${expr.text}, ${v});`);
    } else {
      const t = expr.text;
      block.ops.push(
        `typeof ${t} === "function" || (${t} !== null && typeof ${t} === "object" && "current" in ${t}) ? ${refTo}(${t}, ${v}) : (${t} = ${v});`,
      );
    }
    return;
  }
  const colon = name.indexOf(":");
  if (colon !== -1) {
    const ns = name.slice(0, colon);
    const local = name.slice(colon + 1);
    switch (ns) {
      case "on":
      case "oncapture": {
        const add = reg.helper("addEventListener");
        block.ops.push(
          `${add}(${v}, ${JSON.stringify(local)}, ${text}${ns === "oncapture" ? ", false, true" : ""});`,
        );
        return;
      }
      case "use":
        block.ops.push(`${reg.helper("use")}(${local}, ${v}, () => ${text});`);
        return;
      case "prop":
        block.ops.push(run(`${v}[${JSON.stringify(local)}] = ${text};`));
        return;
      case "attr":
        block.ops.push(
          run(`${reg.helper("setAttribute")}(${v}, ${JSON.stringify(local)}, ${text});`),
        );
        return;
      case "bool":
        block.ops.push(
          run(`${reg.helper("setBoolAttribute")}(${v}, ${JSON.stringify(local)}, ${text});`),
        );
        return;
      case "class":
        block.ops.push(run(`${v}.classList.toggle(${JSON.stringify(local)}, !!(${text}));`));
        return;
      case "style":
        block.ops.push(
          run(`${reg.helper("setStyleProperty")}(${v}, ${JSON.stringify(local)}, ${text});`),
        );
        return;
      case "xlink":
        block.ops.push(
          run(
            `${reg.helper("setAttributeNS")}(${v}, ${JSON.stringify(XLINK)}, ${JSON.stringify(name)}, ${text});`,
          ),
        );
        return;
      default:
        fail(d, "UNKNOWN_NAMESPACE", `Unknown attribute namespace "${ns}:".`, attr.start);
    }
  }
  if (isEventAttribute(name)) {
    genEvent(d, el, name, expr, v, block);
    return;
  }
  if (name === "class" || name === "className") {
    block.ops.push(run(`${reg.helper("className")}(${v}, ${text});`));
    return;
  }
  if (name === "classList") {
    const classList = reg.helper("classList");
    if (expr.dynamic) {
      block.ops.push(
        `${reg.helper("effect")}(() => ${text}, (_v$, _p$) => {\n${classList}(${v}, _v$, _p$);\n});`,
      );
    } else {
      block.ops.push(`${classList}(${v}, ${text});`);
    }
    return;
  }
  if (name === "style") {
    const style = reg.helper("style");
    if (expr.dynamic) {
      block.ops.push(
        `${reg.helper("effect")}(() => ${text}, (_v$, _p$) => {\n${style}(${v}, _v$, _p$);\n});`,
      );
    } else {
      block.ops.push(`${style}(${v}, ${text});`);
    }
    return;
  }
  if (name === "children")
    fail(d, "CHILDREN_ATTRIBUTE", "Use JSX children, not a children attribute.", attr.start);
  if (isAutoFocus(name, isSvg)) {
    // Read once, when the element is created: React applies autoFocus at commit, not on updates.
    block.ops.push(`${reg.helper("autoFocus")}(${v}, ${text});`);
    return;
  }
  if (PROPERTIES.has(name) && !isSvg && el.tag !== "svg") {
    // A select's value may be an array (`multiple`): a helper selects the options it lists.
    const assignment =
      (name === "value" || name === "defaultValue") && el.tag === "select"
        ? `${reg.helper("setSelectValue")}(${v}, ${text});`
        : name === "value"
          ? `${v}.value = (${text}) ?? "";`
          : `${v}.${name} = ${text};`;
    const statement = run(assignment);
    if (POST_PROPERTIES.has(name)) out.post.push(statement);
    else block.ops.push(statement);
    return;
  }
  if (el.custom) {
    block.ops.push(run(`${v}[${JSON.stringify(name)}] = ${text};`));
    return;
  }
  block.ops.push(
    run(
      `${reg.helper("setAttribute")}(${v}, ${JSON.stringify(attributeName(name, isSvg))}, ${text});`,
    ),
  );
}

/** The `type` of an input when it is a static string; `null` when absent or dynamic. */
function staticType(el: ElementIR): string | null {
  for (const attr of el.attrs) {
    if (attr.kind === "static" && attr.name === "type" && typeof attr.value === "string") {
      return attr.value.toLowerCase();
    }
  }
  return null;
}

/**
 * Binds one event handler. The React spelling picks the DOM event (see `eventPlan`). Delegated events
 * are stored on the element; capture and passive bindings are native listeners.
 */
function genEvent(
  d: DomContext,
  el: ElementIR,
  attrName: string,
  expr: ExprIR,
  v: string,
  block: Block,
): void {
  const plan = eventPlan(attrName, el.tag, staticType(el));
  const name = plan.type;
  const target = unwrapParens(expr.node);
  if (DELEGATED_EVENTS.has(name) && !plan.capture) {
    d.reg.delegated.add(name);
    const elements =
      target.type === "ArrayExpression" && Array.isArray(target["elements"])
        ? target["elements"]
        : null;
    if (elements !== null && elements.length === 2 && elements.every(isNode)) {
      const [handler, data] = elements as AstNode[];
      block.ops.push(`${v}.$$${name} = ${d.text(handler as AstNode)};`);
      block.ops.push(`${v}.$$${name}Data = ${d.text(data as AstNode)};`);
    } else {
      block.ops.push(`${v}.$$${name} = ${expr.text};`);
    }
    return;
  }
  const add = d.reg.helper("addEventListener");
  if (plan.passive && target.type !== "ArrayExpression") {
    // React binds wheel passive, so a handler cannot cancel scrolling. A `[fn, data]` tuple keeps
    // the default listener options.
    block.ops.push(
      `${add}(${v}, ${JSON.stringify(name)}, { handleEvent: ${expr.text}, passive: true });`,
    );
    return;
  }
  const capture = plan.capture ? ", false, true" : "";
  block.ops.push(`${add}(${v}, ${JSON.stringify(name)}, ${expr.text}${capture});`);
}

interface TextNodePlan {
  kind: "text";
  value: string;
  cuts: number[];
  names: string[];
}
interface ElementNodePlan {
  kind: "element";
  ir: ElementIR;
  name: string | null;
}
type NodePlan = TextNodePlan | ElementNodePlan;

interface SlotPlan {
  item: SlotIR | ComponentIR;
  /** Static node (index, piece) the slot inserts before; null appends. */
  before: { node: number; piece: number } | null;
  /** True when the slot needs its own empty Text anchor (another dynamic slot follows). */
  fresh: boolean;
  anchorName: string | null;
}

function walkChildren(
  d: DomContext,
  el: ElementIR,
  v: string | null,
  block: Block,
  refs: Map<ElementIR, boolean>,
): string {
  const items = el.children;
  const raw = RAW_TEXT_ELEMENTS.has(el.tag);
  const nodes: NodePlan[] = [];
  const slots: SlotPlan[] = [];
  const nodeOfItem: number[] = [];
  const slotOfItem: Array<SlotPlan | null> = [];
  let pending: SlotPlan[] = [];

  const resolve = (node: number, piece: number): void => {
    pending.forEach((slot, index) => {
      slot.before = { node, piece };
      slot.fresh = index < pending.length - 1;
    });
    pending = [];
  };

  for (const item of items) {
    if (item.kind === "fragment") fail(d, "INTERNAL", "Fragment survived lowering.", el.start);
    if (item.kind === "text") {
      const last = nodes[nodes.length - 1];
      if (pending.length > 0 && last !== undefined && last.kind === "text") {
        last.cuts.push(last.value.length);
        last.value += item.value;
        resolve(nodes.length - 1, last.cuts.length);
        nodeOfItem.push(nodes.length - 1);
      } else {
        nodes.push({ kind: "text", value: item.value, cuts: [], names: [] });
        resolve(nodes.length - 1, 0);
        nodeOfItem.push(nodes.length - 1);
      }
      slotOfItem.push(null);
    } else if (item.kind === "element") {
      nodes.push({ kind: "element", ir: item, name: null });
      resolve(nodes.length - 1, 0);
      nodeOfItem.push(nodes.length - 1);
      slotOfItem.push(null);
    } else {
      const plan: SlotPlan = { item, before: null, fresh: false, anchorName: null };
      slots.push(plan);
      pending.push(plan);
      nodeOfItem.push(-1);
      slotOfItem.push(plan);
    }
  }
  for (const [index, slot] of pending.entries()) {
    slot.before = null;
    slot.fresh = index < pending.length - 1;
  }

  if (slots.length > 0 && v === null)
    fail(d, "INTERNAL", "Dynamic child without a parent reference.", el.start);

  // Which template nodes need variables?
  const needsVar = new Set<number>();
  nodes.forEach((node, index) => {
    if (node.kind === "element" && needsRef(node.ir, refs)) needsVar.add(index);
    if (node.kind === "text" && node.cuts.length > 0) needsVar.add(index);
  });
  for (const slot of slots) if (slot.before !== null) needsVar.add(slot.before.node);

  // Name allocation (parents before children keeps numbering readable).
  nodes.forEach((node, index) => {
    if (!needsVar.has(index)) return;
    const name = block.id();
    if (node.kind === "element") node.name = name;
    else {
      node.names.push(name);
      for (let i = 0; i < node.cuts.length; i += 1) node.names.push(block.id());
    }
  });
  for (const slot of slots) if (slot.fresh) slot.anchorName = block.id();

  const anchorExpr = (slot: SlotPlan): string | null => {
    if (slot.fresh) return slot.anchorName;
    if (slot.before === null) return null;
    const node = nodes[slot.before.node];
    if (node === undefined) return null;
    if (node.kind === "element") return node.name;
    return node.names[slot.before.piece] ?? null;
  };

  // Emission in item order.
  let html = "";
  let lastVar: string | null = null;
  let since = 0;
  let processed = -1;
  const declareNode = (index: number): void => {
    const node = nodes[index];
    if (node === undefined) return;
    let nodeVar: string | null = null;
    if (needsVar.has(index)) {
      nodeVar = node.kind === "element" ? node.name : (node.names[0] ?? null);
      const path: string =
        lastVar === null
          ? `${v}.firstChild${".nextSibling".repeat(since)}`
          : `${lastVar}${".nextSibling".repeat(since + 1)}`;
      block.decls.push(`${nodeVar} = ${path}`);
      lastVar = nodeVar;
      since = 0;
    } else {
      since += 1;
    }
    if (node.kind === "text") {
      for (let i = 0; i < node.cuts.length; i += 1) {
        const previous = node.names[i] as string;
        const piece = node.names[i + 1] as string;
        const offset = (node.cuts[i] as number) - (i === 0 ? 0 : (node.cuts[i - 1] as number));
        block.decls.push(`${piece} = ${previous}.splitText(${offset})`);
        lastVar = piece;
      }
      if (node.cuts.length > 0) since = 0;
      html += raw ? node.value : escapeHtmlText(node.value);
      if (raw && node.value.toLowerCase().includes(`</${el.tag}`)) {
        fail(
          d,
          "RAW_TEXT_CLOSE",
          `Text inside <${el.tag}> must not contain "</${el.tag}".`,
          el.start,
        );
      }
    } else {
      html += walkElement(d, node.ir, node.name, block, refs);
    }
    // Fresh anchors waiting for this node.
    for (const slot of slots) {
      if (slot.fresh && slot.before !== null && slot.before.node === index) {
        const target =
          slot.before.piece === 0
            ? nodeVar
            : node.kind === "text"
              ? node.names[slot.before.piece]
              : null;
        if (slot.anchorName !== null && target !== null && target !== undefined) {
          block.decls.push(`${slot.anchorName} = ${d.reg.helper("anchor")}(${v}, ${target})`);
        }
      }
    }
  };

  items.forEach((_item, position) => {
    const nodeIndex = nodeOfItem[position] as number;
    if (nodeIndex !== -1) {
      if (nodeIndex !== processed) {
        processed = nodeIndex;
        declareNode(nodeIndex);
      }
      return;
    }
    const slot = slotOfItem[position] as SlotPlan;
    const target = slot.item;
    const value = target.kind === "component" ? genComponent(d, target) : slotValue(d, target.expr);
    const insert = d.reg.helper("insert");
    const anchorNode = anchorExpr(slot);
    block.ops.push(`${insert}(${v}, ${value}${anchorNode === null ? "" : `, ${anchorNode}`});`);
  });

  // Fresh anchors with no following static node are appended at the end.
  for (const slot of slots) {
    if (slot.fresh && slot.before === null && slot.anchorName !== null) {
      block.decls.push(`${slot.anchorName} = ${d.reg.helper("anchor")}(${v}, null)`);
    }
  }
  return html;
}

function walkElement(
  d: DomContext,
  el: ElementIR,
  v: string | null,
  block: Block,
  refs: Map<ElementIR, boolean>,
): string {
  const attrs = genAttrs(d, el, v, block);
  let html = `<${el.tag}${attrs.html}>`;
  if (VOID_ELEMENTS.has(el.tag)) {
    if (el.children.length > 0)
      fail(d, "VOID_CHILDREN", `<${el.tag}> cannot have children.`, el.start);
    block.ops.push(...attrs.post);
    return html;
  }
  html += walkChildren(d, el, v, block, refs);
  block.ops.push(...attrs.post);
  html += `</${el.tag}>`;
  return html;
}

function genElementRoot(d: DomContext, el: ElementIR): string {
  const block = new Block();
  const refs = new Map<ElementIR, boolean>();
  const rootVar = needsRef(el, refs) ? block.id() : null;
  const html = walkElement(d, el, rootVar, block, refs);
  const template = d.reg.template(html, elementFlags(el));
  if (rootVar === null) return `${template}()`;
  const decls = [`${rootVar} = ${template}()`, ...block.decls];
  const body = [`const ${decls.join(",\n")};`, ...block.ops, `return ${rootVar};`].join("\n");
  const call = `(() => {\n${body}\n})()`;
  d.blocks.set(call, body);
  return call;
}

/** Generates the replacement expression for one JSX root in `dom` mode. */
export function generateDom(d: DomContext, root: RootIR): string {
  switch (root.kind) {
    case "element":
      return genElementRoot(d, root);
    case "component":
      return genComponent(d, root);
    case "fragment":
      return genFragment(d, root);
  }
}

function genFragment(d: DomContext, root: FragmentIR): string {
  return `[${root.children.map((c) => childValue(d, c)).join(", ")}]`;
}
