import { nextKey } from "../internal/hydration-scope";
import { attributeName, IGNORED_KEYS, isFlagAttribute } from "../internal/react-names";
import { isEventName, ssrAttribute } from "./attributes";
import { classText, ssrStyle, styleText } from "./class-style";
import { invalid } from "./errors";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
import { escape, escapeHtml, resolveValue } from "./escape";
import { keepLeadingNewline, markSelectedOptions, textareaContent } from "./form-controls";
import { isSsrNode, SsrNode } from "./node";
import { rawElementContent } from "./raw-text";

/** A tag name: letters, digits and dashes, starting with a letter. Anything else could break out. */
const TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Elements that never have children or a closing tag. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "command",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Keys that never become attributes: they are handled elsewhere or would reach a prototype. */
const SKIPPED_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "children",
  "ref",
]);

/** The HTML of a `dangerouslySetInnerHTML` value (`{ __html }`): null and undefined are empty. */
function innerHtmlOfValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return Reflect.get(value, "__html");
}

/**
 * Joins the static parts of a server template with its dynamic holes into trusted markup: the
 * function compiled server output calls for each element tree. Holes are inserted unchanged, so each
 * must already be escaped (the output of `escape`, `ssrAttribute`, `ssrClass`, ...) or an `SsrNode`;
 * any other value throws, so a raw user value cannot reach the markup.
 *
 * @param parts The static markup, one more entry than there are holes.
 * @param holes The dynamic parts: strings produced by the escaping helpers, or `SsrNode` values.
 * @returns The markup as a trusted `SsrNode`, which `escape` writes without encoding.
 * @throws TypeError when `parts` is not an array of `holes.length + 1` entries, or when a hole is not
 * a string or an `SsrNode`.
 * @example
 * import { escape, renderToString, ssr } from "@shadow-js/web/server";
 *
 * const name = "<Ada>";
 * const html = renderToString(() => ssr(["<p>Hello, ", "</p>"], escape(name)));
 * // "<p>Hello, &lt;Ada&gt;</p>"
 * @see ssrRaw
 * @since 1.0.0
 */
export function ssr(parts: readonly string[], ...holes: unknown[]): SsrNode {
  if (!Array.isArray(parts) || parts.length !== holes.length + 1) {
    throw new TypeError("ssr(): parts must have one more entry than there are holes.");
  }
  let html = parts[0] ?? "";
  for (let index = 0; index < holes.length; index += 1) {
    const hole = holes[index];
    if (typeof hole === "string") html += hole;
    else if (isSsrNode(hole)) html += hole.t;
    else throw new TypeError("ssr(): a hole must be an escaped string or an SsrNode.");
    html += parts[index + 1] ?? "";
  }
  return new SsrNode(html);
}

/**
 * Marks a string as trusted markup that `escape` and `ssr` insert unchanged. Only use it for markup
 * the application wrote itself, never for user input.
 *
 * @param html The markup, inserted unchanged.
 * @returns The markup as a trusted `SsrNode`.
 * @throws TypeError when `html` is not a string.
 * @example
 * import { renderToString, ssrRaw } from "@shadow-js/web/server";
 *
 * const html = renderToString(() => ["<b>escaped</b>", ssrRaw("<!-- build 42 -->")]);
 * // "&lt;b&gt;escaped&lt;/b&gt;<!-- build 42 -->"
 * @see ssr
 * @since 1.0.0
 */
export function ssrRaw(html: string): SsrNode {
  if (typeof html !== "string") throw new TypeError("ssrRaw(): the markup must be a string.");
  return new SsrNode(html);
}

/**
 * Draws the next hydration key of the current scope and returns it as a `data-hk` attribute, such as
 * `' data-hk="0-0"'`: compiled server output calls it for the root element of each template, and
 * the client's `hydrate()` claims the element by that key. Calls must happen in the same order as on
 * the client, so call it only where the compiler would.
 *
 * @returns Markup for the `data-hk` attribute, or `""` outside a server render (no key is drawn).
 * @example
 * import { renderToString, ssr, ssrHydrationKey } from "@shadow-js/web/server";
 *
 * const html = renderToString(() => ssr(["<div", ">x</div>"], ssrHydrationKey()));
 * // '<div data-hk="0-0">x</div>'
 * @since 1.0.0
 */
export function ssrHydrationKey(): string {
  const key = nextKey();
  return key === undefined ? "" : ` data-hk="${escapeHtml(key)}"`;
}

/**
 * Renders an element from a props object: what compiled server output calls for an element with a
 * spread (`<div {...props} />`), and the server half of `Dynamic` and `element`. It writes the same
 * markup the client's `spread` produces.
 *
 * `class`, `className`, `classList` and `style` are combined into one `class` and one `style`
 * attribute; other keys are attributes, with React names mapped (`htmlFor` is `for`) and HTML boolean
 * attributes (`disabled`, `checked`, ...) written as bare names. `ref`, `children`, `on*` keys and the
 * `on:`, `use:` and `prop:` prefixes are skipped; `attr:` and `bool:` select the attribute and presence
 * forms. `innerHTML` and `dangerouslySetInnerHTML` are written unescaped as the content. On a
 * `textarea` the `value` (or `defaultValue`) is the content; on a `select` it marks the matching
 * `<option selected>` (an array for `multiple`); on other elements `defaultValue` and `defaultChecked`
 * are the `value` and `checked` attributes. Void elements (`img`, `input`, ...) get no content.
 *
 * @param tag Element name: letters, digits and dashes, starting with a letter.
 * @param props The props object (each getter is read once), or `null`.
 * @param children The content, escaped unless it is an `SsrNode`. Undefined (the default) uses the
 * `children` prop.
 * @param needsKey `true` writes the hydration key of this template root first. Default: `false`.
 * @param svg `true` for an SVG element: SVG presentation names are hyphenated (`strokeWidth` is
 * `stroke-width`), other names keep their case. Default: `false`.
 * @returns The element as a trusted `SsrNode`.
 * @throws TypeError `INVALID_TAG_NAME` for an invalid tag, `INVALID_ATTRIBUTE_NAME` for an invalid
 * attribute name, and the errors of {@link ssrAttribute}, `ssrClass` and `ssrStyle` for invalid values.
 * @example
 * import { renderToString, ssrElement } from "@shadow-js/web/server";
 *
 * const props = { id: "save", disabled: true, class: ["btn", { primary: true }], children: "Save" };
 * const html = renderToString(() => ssrElement("button", props));
 * // '<button id="save" disabled class="btn primary">Save</button>'
 * @since 1.0.0
 */
export function ssrElement(
  tag: string,
  props: unknown,
  children: unknown = undefined,
  needsKey = false,
  svg = false,
): SsrNode {
  if (typeof tag !== "string" || !TAG_NAME.test(tag)) {
    throw invalid("INVALID_TAG_NAME", `"${String(tag)}" is not a valid tag name.`);
  }
  const lowerTag = tag.toLowerCase();
  // A browser ignores `value` on these: a textarea's value is its content, a select's value is the
  // `selected` flag of its options. The props are read once and applied to the content below.
  const isSelect = lowerTag === "select";
  const isTextarea = lowerTag === "textarea";
  const control: { value?: unknown; fallback?: unknown } = {};
  let hasValue = false;
  let hasFallback = false;
  let attributes = needsKey ? ssrHydrationKey() : "";
  const classes: string[] = [];
  let style = "";
  let innerHtml: string | undefined;
  if (props !== null && typeof props === "object") {
    for (const key of Object.keys(props)) {
      if (SKIPPED_KEYS.has(key) || IGNORED_KEYS.test(key)) continue;
      if (
        key === "ref" ||
        key.startsWith("on:") ||
        key.startsWith("use:") ||
        key.startsWith("prop:")
      )
        continue;
      if (isEventName(key)) continue;
      if (needsKey && key === "data-hk") continue;
      const value = resolveValue(Reflect.get(props, key));
      if (key === "class" || key === "className") {
        const text = classText(value);
        if (text !== "") classes.push(text);
      } else if (key === "classList") {
        collectTruthyKeys(value, classes);
      } else if (key === "style") {
        style = styleText(value);
      } else if (key === "innerHTML") {
        innerHtml = plainHtml(value);
      } else if (key === "dangerouslySetInnerHTML") {
        innerHtml = plainHtml(resolveValue(innerHtmlOfValue(value)));
      } else if ((isSelect || isTextarea) && key === "value") {
        control.value = value;
        hasValue = true;
      } else if ((isSelect || isTextarea) && key === "defaultValue") {
        control.fallback = value;
        hasFallback = true;
      } else if (key.startsWith("attr:")) {
        attributes += ssrAttribute(key.slice(5), value);
      } else if (key.startsWith("bool:")) {
        attributes += ssrAttribute(key.slice(5), value, true);
      } else if (key === "defaultValue" || key === "defaultChecked") {
        // The attributes of the same name in HTML are the defaults: `value` and `checked`.
        const name = key === "defaultValue" ? "value" : "checked";
        if (!Object.hasOwn(props, name))
          attributes += ssrAttribute(name, value, name === "checked");
      } else {
        const name = attributeName(key, svg);
        attributes += ssrAttribute(name, value, isFlagAttribute(name, value));
      }
    }
  }
  if (classes.length > 0) attributes += ` class="${escapeHtml(classes.join(" "))}"`;
  if (style !== "") attributes += ssrStyle(style);
  if (VOID_ELEMENTS.has(lowerTag)) return new SsrNode(`<${tag}${attributes}>`);
  // Like the DOM `spread`: a `children` prop supplies the content unless the element wrote its own.
  // The text of a script or a style is raw (no entities), so it is written as it is and checked instead.
  const raw = !svg && (lowerTag === "script" || lowerTag === "style");
  const given = children === undefined ? propsChildren(props) : children;
  let content =
    innerHtml !== undefined ? innerHtml : raw ? rawElementContent(lowerTag, given) : escape(given);
  if (innerHtml === undefined && (hasValue || hasFallback)) {
    const value = hasValue ? control.value : control.fallback;
    content = isTextarea ? textareaContent(value) : markSelectedOptions(value, content);
  } else if (
    (isTextarea || lowerTag === "pre" || lowerTag === "listing") &&
    innerHtml === undefined
  ) {
    // The parser drops one line break right after these start tags (a textarea's children are its
    // value, as on the client): write one more so the content is read as it was given.
    content = keepLeadingNewline(content);
  }
  return new SsrNode(`<${tag}${attributes}>${content}</${tag}>`);
}

/** The `children` of a spread props object (read once, so a getter runs once), or undefined. */
function propsChildren(props: unknown): unknown {
  if (props === null || typeof props !== "object") return undefined;
  return Reflect.get(props, "children");
}

/** Class names whose key is truthy, from a `classList` object. */
function collectTruthyKeys(value: unknown, out: string[]): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (key !== "" && resolveValue(Reflect.get(value, key))) out.push(key);
  }
}

/** Raw HTML text for `innerHTML`: null and undefined become "", an SsrNode its markup. */
function plainHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isSsrNode(value)) return value.t;
  if (typeof value === "symbol")
    throw invalid("UNRECOGNIZED_INSERT_VALUE", "A symbol cannot be innerHTML.");
  return String(value);
}
