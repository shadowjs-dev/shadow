import { invalid } from "./errors";
import { escapeHtml, resolveValue } from "./escape";

/** Names that can appear in markup: an XML-name subset without `@` or whitespace. Same as the client. */
const ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;

/** Attributes whose value is a URL and is therefore checked for script schemes. Same as the client. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "srcdoc",
  "poster",
  "data",
]);

/**
 * SVG animation attributes (`animate`, `set`): with `attributeName="href"` they write an `href` by animation, so their value
 * is checked like one. `values` is a `;` list and every entry is checked. Same as the client.
 */
const ANIMATION_VALUE_ATTRIBUTES: ReadonlySet<string> = new Set(["values", "from", "to", "by"]);

/** Enumerated attributes where `false` is a real value ("false") rather than an absence. */
const ENUMERATED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "draggable",
  "spellcheck",
  "contenteditable",
]);

/**
 * Boolean attributes that a props object writes as presence flags (`disabled: true` gives a bare
 * `disabled`). Lower-case names only.
 * @internal
 */
export const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

/** URL prefixes (after normalization) that are never written. Same as the client. */
const UNSAFE_URL_PREFIXES: readonly string[] = ["javascript:", "data:text/html", "vbscript:"];

/** Throws a TypeError unless `name` can be written as an attribute name. @internal */
export function assertAttributeName(name: string): void {
  if (!ATTRIBUTE_NAME.test(name)) {
    throw invalid("INVALID_ATTRIBUTE_NAME", `"${name}" is not a valid attribute name.`);
  }
}

/** True for `on*` names, which never reach markup. Length matches the client's event test. @internal */
export function isEventName(lowerName: string): boolean {
  return lowerName.length > 2 && lowerName.startsWith("on");
}

/** True for `aria-*`, `data-*` and the enumerated attributes: their booleans are strings. */
function isStringValued(lowerName: string): boolean {
  return (
    lowerName.startsWith("aria-") ||
    lowerName.startsWith("data-") ||
    ENUMERATED_ATTRIBUTES.has(lowerName)
  );
}

/** Removes C0 and C1 control characters, which browsers ignore inside a URL scheme. */
function stripControls(text: string): string {
  let kept = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 0x1f && (code < 0x7f || code > 0x9f)) kept += char;
  }
  return kept;
}

/** True when the URL would run script, after the normalization browsers apply. @internal */
export function isUnsafeUrl(value: string): boolean {
  const normalized = stripControls(value).trim().toLowerCase();
  return UNSAFE_URL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** True when `lowerName` carries a URL (or an animated one) and `value` would run script. */
function isUnsafeAttributeValue(lowerName: string, value: string): boolean {
  if (URL_ATTRIBUTES.has(lowerName)) return isUnsafeUrl(value);
  return ANIMATION_VALUE_ATTRIBUTES.has(lowerName) && value.split(";").some(isUnsafeUrl);
}

/** Text to write for `value`, or null when the attribute is removed. Same rules as the client. @internal */
export function attributeText(lowerName: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value === false) return isStringValued(lowerName) ? "false" : null;
  if (value === true) return isStringValued(lowerName) ? "true" : "";
  return String(value);
}

/** Refuses symbols, which have no markup form and would otherwise be coerced silently. */
function assertNotSymbol(value: unknown): void {
  if (typeof value === "symbol") {
    throw invalid("UNRECOGNIZED_INSERT_VALUE", "A symbol cannot be an attribute value.");
  }
}

/**
 * Renders one attribute as markup with a leading space, or `""` when the attribute is absent: the
 * helper the compiler's server output calls for a dynamic attribute. It applies the client's value
 * rules and URL check, so server and client agree on what is written.
 *
 * - `null`, `undefined` and `false` give `""` (except `false` on `aria-*`, `data-*`, `draggable`,
 *   `spellcheck` and `contenteditable`, which is written as `"false"`); `true` writes `=""` (or
 *   `"true"` for those same names). Other values are written as `String(value)`, HTML-escaped.
 * - URL attributes whose value would run script are dropped, with the check of
 *   `isUnsafeUrlAttribute` (including the SVG animation attributes `values`, `from`, `to`, `by`).
 * - `on*` names are dropped: event handlers never reach markup.
 * - Accessors are called (untracked) until a plain value remains.
 *
 * @param name Attribute name, matching `[A-Za-z_:][A-Za-z0-9_:.-]*`. It is validated before
 * anything else, so an invalid name always throws.
 * @param value The value, or an accessor of it.
 * @param isBoolean `true` for a presence attribute such as `disabled`: a truthy value writes the bare
 * name, a falsy one writes nothing. Default: `false`.
 * @returns Markup such as `' title="a&amp;b"'`, or `""`.
 * @throws TypeError `INVALID_ATTRIBUTE_NAME` for an invalid name, and `UNRECOGNIZED_INSERT_VALUE`
 * when the value is a symbol.
 * @example
 * import { ssrAttribute } from "@shadow-js/web/server";
 *
 * ssrAttribute("title", "Tom & Jerry"); // ' title="Tom &amp; Jerry"'
 * ssrAttribute("disabled", true, true); // " disabled"
 * ssrAttribute("href", "javascript:alert(1)"); // ""
 * @since 1.0.0
 */
export function ssrAttribute(name: string, value: unknown, isBoolean = false): string {
  assertAttributeName(name);
  const lowerName = name.toLowerCase();
  if (isEventName(lowerName)) return "";
  const resolved = resolveValue(value);
  assertNotSymbol(resolved);
  if (isBoolean) return resolved ? ` ${name}` : "";
  const text = attributeText(lowerName, resolved);
  if (text === null) return "";
  if (isUnsafeAttributeValue(lowerName, text)) return "";
  return ` ${name}="${escapeHtml(text)}"`;
}
