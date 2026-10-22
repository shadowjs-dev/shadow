import { cssValueText } from "../internal/css-units";
import { invalid } from "./errors";
import { escapeHtml, resolveValue } from "./escape";
import { isSsrNode } from "./node";

/** A CSS property name: a custom property, or a lower-case name with an optional vendor dash. */
const CSS_PROPERTY = /^(--[A-Za-z0-9_-]+|-?[a-z][a-z0-9-]*)$/;

/**
 * Appends the class names found in `root` to `parts`, clsx-style. Iterative: array nesting depth
 * is controlled by the caller, so it must not reach the call stack.
 * @internal
 */
export function collectClasses(root: unknown, parts: string[]): void {
  const frames: unknown[][] = [[root]];
  const cursors: number[] = [0];
  const open = new Set<unknown[]>();
  while (frames.length > 0) {
    const top = frames.length - 1;
    const frame = frames[top];
    const cursor = cursors[top] ?? 0;
    if (frame === undefined || cursor >= frame.length) {
      const done = frames.pop();
      if (done !== undefined) open.delete(done);
      cursors.pop();
      continue;
    }
    cursors[top] = cursor + 1;
    const item = resolveValue(frame[cursor]);
    if (Array.isArray(item)) {
      if (open.has(item)) throw new TypeError("A class array contains itself.");
      open.add(item);
      frames.push(item);
      cursors.push(0);
    } else if (typeof item === "string") {
      if (item !== "") parts.push(item);
    } else if (typeof item === "number") {
      if (item !== 0 && !Number.isNaN(item)) parts.push(String(item));
    } else if (typeof item === "symbol") {
      throw invalid("UNRECOGNIZED_INSERT_VALUE", "A symbol cannot be a class name.");
    } else if (item !== null && typeof item === "object") {
      const record = item as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key !== "" && resolveValue(record[key])) parts.push(key);
      }
    }
  }
}

/**
 * The class text for a class value, or "" when there is none. A string is used as it is.
 * @internal
 */
export function classText(value: unknown): string {
  const resolved = resolveValue(value);
  if (typeof resolved === "string") return resolved;
  if (resolved === null || resolved === undefined || resolved === false) return "";
  const parts: string[] = [];
  collectClasses(resolved, parts);
  return parts.join(" ");
}

/**
 * Renders a `class` attribute from a class value: the helper the compiler's server output calls for
 * `class`, `className` and `classList`, with the same clsx rules as the client's `className`.
 *
 * @param value A string (used as is), or an array or object: non-empty strings, numbers other than
 * `0` and `NaN`, nested arrays, and the keys of objects whose value is truthy. Accessors, also
 * inside arrays and as object values, are called. `null`, `undefined` and `false` give no class.
 * @returns Markup such as `' class="a b"'` (HTML-escaped), or `""` when there are no classes.
 * @throws TypeError when an array contains itself, and `UNRECOGNIZED_INSERT_VALUE` for a symbol.
 * @example
 * import { ssrClass } from "@shadow-js/web/server";
 *
 * ssrClass(["card", { "card--active": true, hidden: false }]); // ' class="card card--active"'
 * ssrClass(null); // ""
 * @see ssrStyle
 * @since 1.0.0
 */
export function ssrClass(value: unknown): string {
  const text = classText(value);
  return text === "" ? "" : ` class="${escapeHtml(text)}"`;
}

/** Converts a camelCase style name to CSS, keeping custom properties; `ms` gets its dash. @internal */
export function toCssProperty(name: string): string {
  if (name.startsWith("--")) return name;
  const kebab = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return kebab.startsWith("ms-") ? `-${kebab}` : kebab;
}

/**
 * True when a value cannot end its own declaration. A `;`, `{` or `}` outside quotes and
 * parentheses would start another declaration or rule, so such a value is dropped. Unbalanced
 * quotes or parentheses are dropped too, because they would swallow the declarations after them.
 * @internal
 */
export function isSafeCssValue(text: string): boolean {
  let quote = "";
  let depth = 0;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (quote !== "") {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if ((char === ";" || char === "{" || char === "}") && depth === 0) {
      return false;
    }
  }
  return quote === "" && depth === 0 && !escaped;
}

/** Declarations for one style source, appended to `out` as raw (unescaped) CSS text. */
function collectDeclarations(source: unknown, out: string[]): void {
  const value = resolveValue(source);
  if (value === null || value === undefined || value === false) return;
  if (typeof value === "string") {
    if (value !== "") out.push(value);
    return;
  }
  if (typeof value !== "object" || isSsrNode(value)) {
    throw invalid(
      "UNRECOGNIZED_INSERT_VALUE",
      "A style must be a string, an object or an array of them.",
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = resolveValue(item);
      if (Array.isArray(resolved)) {
        throw new TypeError("ssrStyle(): a style array may not contain another array.");
      }
      collectDeclarations(resolved, out);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    const property = toCssProperty(key);
    if (!CSS_PROPERTY.test(property)) {
      throw invalid("INVALID_STYLE_PROPERTY", `"${key}" is not a valid CSS property name.`);
    }
    const resolved = resolveValue(Reflect.get(value, key));
    if (resolved === null || resolved === undefined || resolved === false) continue;
    if (typeof resolved === "symbol") {
      throw invalid("UNRECOGNIZED_INSERT_VALUE", "A symbol cannot be a style value.");
    }
    const text = cssValueText(property, resolved);
    if (!isSafeCssValue(text)) continue;
    out.push(`${property}:${text}`);
  }
}

/**
 * The declarations of a style value, joined with `;`, or "" when there are none. Later
 * declarations win in CSS, so earlier and later sources can be combined in order.
 * @internal
 */
export function styleText(value: unknown): string {
  const declarations: string[] = [];
  collectDeclarations(value, declarations);
  return declarations.join(";");
}

/**
 * Renders a `style` attribute from a style value: the helper the compiler's server output calls for
 * `style` and `style:` attributes. Sources in an array are written in order, so a later declaration
 * wins in CSS.
 *
 * @param value A string (written as is), an object of properties, or an array of strings and
 * objects (not nested). Object keys are camelCase (converted to kebab-case, `msTransform` gives
 * `-ms-transform`), kebab-case, or custom properties (`--gap`, kept). `null`, `undefined` and `false`
 * values are skipped; a number is in pixels unless it is `0`, the property is unitless (`opacity`,
 * `zIndex`, ...) or a custom property, as in React. A value that could end its own declaration (a
 * `;`, `{` or `}` outside quotes and parentheses, or an unbalanced quote or parenthesis) is dropped.
 * @returns Markup such as `' style="color:red"'` (HTML-escaped), or `""` when there is nothing to
 * write.
 * @throws TypeError `INVALID_STYLE_PROPERTY` for an invalid property name, `UNRECOGNIZED_INSERT_VALUE`
 * for a symbol or a value that is not a string, object or array, and a TypeError for a nested array.
 * @example
 * import { ssrStyle } from "@shadow-js/web/server";
 *
 * ssrStyle({ backgroundColor: "red", width: 10, "--gap": "4px" });
 * // ' style="background-color:red;width:10px;--gap:4px"'
 * ssrStyle([{ color: "red" }, "color: blue"]); // the later declaration wins
 * @see ssrClass
 * @since 1.0.0
 */
export function ssrStyle(value: unknown): string {
  const text = styleText(value);
  return text === "" ? "" : ` style="${escapeHtml(text)}"`;
}
