import { invalidAttributeName, SRCDOC_DYNAMIC_DETAIL, warnOnce } from "./internal/diagnostics";

/** Names that can appear in markup: an XML-name subset without `@` or whitespace. */
const ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;

/**
 * Attributes whose value is a URL and therefore checked for script schemes. The SVG animation values
 * (`animate`, `set`) are checked too: with `attributeName="href"` they write an `href` by animation.
 */
const URL_ATTRIBUTES = /^(?:href|src|action|formaction|xlink:href|poster|data|values|from|to|by)$/;

/**
 * `aria-*`, `data-*` and the enumerated attributes: their boolean values are the strings "true" and "false"
 * rather than a present or absent attribute.
 */
const STRING_VALUED = /^(?:aria-|data-|draggable$|spellcheck$|contenteditable$)/;

/** URL prefixes (after normalization) that are never written. */
const UNSAFE_URL_PREFIXES = /^(?:javascript:|data:text\/html|vbscript:)/;

/**
 * Throws a TypeError unless `name` is a valid attribute name. Runs for every name, including the
 * ones that come from spread, so no unvalidated name reaches `setAttribute`.
 * @internal
 */
export function assertAttributeName(name: string): void {
  if (!ATTRIBUTE_NAME.test(name)) throw invalidAttributeName(name);
}

/** Removes C0 and C1 control characters (`\p{Cc}`), which browsers ignore inside a URL scheme. */
function stripControls(text: string): string {
  return text.replace(/\p{Cc}/gu, "");
}

/** True when the URL would run script: browsers ignore the controls and case that hide the scheme. */
function isUnsafeUrl(value: string): boolean {
  return UNSAFE_URL_PREFIXES.test(stripControls(value).trim().toLowerCase());
}

/**
 * Reports whether writing `value` to the attribute `name` would run script: the URL check that
 * {@link setAttribute}, the head registry and the server renderer share. Use it in a custom renderer
 * before writing a URL that came from user data. URL attributes (`href`, `src`, `action`,
 * `formaction`, `xlink:href`, `poster`, `data`) are unsafe when, after removing control
 * characters, trimming and lowercasing, they start with `javascript:`, `data:text/html` or
 * `vbscript:`. The SVG animation attributes `values`, `from`, `to` and `by` are checked the same way,
 * each `;`-separated entry of `values` on its own. `srcdoc` is not a URL but an HTML document, with the
 * trust of `innerHTML`: no scheme check applies to it, so this returns `false` for it (see {@link setAttribute}).
 *
 * @param name Attribute name, in any case.
 * @param value The text that would be written.
 * @returns `true` when the value must not be written; `false` for every other attribute or value.
 * @example
 * import { isUnsafeUrlAttribute } from "@shadow-js/web/extend";
 *
 * isUnsafeUrlAttribute("href", " JavaScript:alert(1)"); // true
 * isUnsafeUrlAttribute("href", "https://example.com"); // false
 * isUnsafeUrlAttribute("title", "javascript:alert(1)"); // false: not a URL attribute
 * @see setAttribute
 * @since 1.0.0
 */
export function isUnsafeUrlAttribute(name: string, value: string): boolean {
  const lowerName = name.toLowerCase();
  if (!URL_ATTRIBUTES.test(lowerName)) return false;
  // `values` is a `;` list: every entry is a URL of its own.
  return lowerName === "values" ? value.split(";").some(isUnsafeUrl) : isUnsafeUrl(value);
}

/** Text to write for `value`, or null when the attribute must be removed. */
function attributeText(lowerName: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value === false) return STRING_VALUED.test(lowerName) ? "false" : null;
  if (value === true) return STRING_VALUED.test(lowerName) ? "true" : "";
  return String(value);
}

/** The part of a qualified name after the prefix (`xlink:href` gives `href`). */
function localPart(qualified: string): string {
  const colon = qualified.indexOf(":");
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

/** Writes or removes one attribute, applying the value rules and the URL check. */
function commit(el: Element, namespace: string | null, qualified: string, value: unknown): void {
  const lowerName = qualified.toLowerCase();
  const text = attributeText(lowerName, value);
  if (text === null) {
    if (namespace === null) el.removeAttribute(qualified);
    else el.removeAttributeNS(namespace, localPart(qualified));
    return;
  }
  // Event handlers are bound as functions, never written as attributes: a string there is script the
  // page would run. The server drops the same names, so both renders agree.
  if (/^on./.test(lowerName)) return;
  if (__DEV__ && lowerName === "srcdoc") warnOnce("SRCDOC_DYNAMIC", SRCDOC_DYNAMIC_DETAIL);
  if (isUnsafeUrlAttribute(lowerName, text)) {
    if (__DEV__)
      warnOnce("UNSAFE_URL_BLOCKED", `Blocked a script URL in the "${qualified}" attribute.`);
    return;
  }
  if (namespace === null) {
    if (el.getAttribute(qualified) !== text) el.setAttribute(qualified, text);
  } else if (el.getAttributeNS(namespace, localPart(qualified)) !== text) {
    el.setAttributeNS(namespace, qualified, text);
  }
}

/**
 * Sets or removes one attribute with the JSX value rules: the helper compiled templates call for a
 * dynamic attribute, also usable on elements you create yourself. The DOM is touched only when the
 * text changes. A URL attribute whose value would run script (see {@link isUnsafeUrlAttribute}) is
 * left unchanged, and development builds warn once with `UNSAFE_URL_BLOCKED`. Names that start with
 * `on` (`onclick`, ...) are never written, only removed: handlers are bound with `addEventListener`.
 *
 * `srcdoc` is an HTML sink: the value is a document the frame runs, written as it is and trusted like
 * `innerHTML`. Sanitize it, and give the frame a `sandbox` attribute. Compiled templates call this for a
 * computed value only (a literal `srcdoc` is part of the template), so development builds warn once with
 * `SRCDOC_DYNAMIC` for every value written here.
 *
 * @param el Target element.
 * @param name Attribute name. It must match `[A-Za-z_:][A-Za-z0-9_:.-]*`.
 * @param value `null`, `undefined` and `false` remove the attribute, except that `false` writes
 * `"false"` for `aria-*`, `data-*`, `draggable`, `spellcheck` and `contenteditable`. `true` writes
 * `""` (or `"true"` for those same names). Any other value is written as `String(value)`.
 * @throws TypeError `INVALID_ATTRIBUTE_NAME` when `name` is not a valid attribute name.
 * @example
 * import { setAttribute } from "@shadow-js/web";
 *
 * const link = document.createElement("a");
 * setAttribute(link, "href", "https://example.com");
 * setAttribute(link, "aria-hidden", false); // aria-hidden="false"
 * setAttribute(link, "title", null); // removes title
 * @see setBoolAttribute
 * @see setAttributeNS
 * @since 1.0.0
 */
export function setAttribute(el: Element, name: string, value: unknown): void {
  assertAttributeName(name);
  commit(el, null, name, value);
}

/**
 * Sets or removes a namespaced attribute such as `xlink:href` or `xml:lang`, with the value rules
 * and the URL check of {@link setAttribute}. Removal uses the local part of the name (`href` for
 * `xlink:href`).
 *
 * @param el Target element.
 * @param namespace Namespace URI. `""` means no namespace, which behaves exactly like
 * {@link setAttribute}.
 * @param name Qualified name (`prefix:local`). It must match `[A-Za-z_:][A-Za-z0-9_:.-]*`.
 * @param value The value, with the same rules as {@link setAttribute}.
 * @throws TypeError `INVALID_ATTRIBUTE_NAME` when `name` is not a valid attribute name.
 * @example
 * import { setAttributeNS } from "@shadow-js/web";
 *
 * const XLINK = "http://www.w3.org/1999/xlink";
 * const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
 * setAttributeNS(use, XLINK, "xlink:href", "#icon-star");
 * setAttributeNS(use, XLINK, "xlink:href", null); // removes it
 * @see setAttribute
 * @since 1.0.0
 */
export function setAttributeNS(el: Element, namespace: string, name: string, value: unknown): void {
  assertAttributeName(name);
  commit(el, namespace === "" ? null : namespace, name, value);
}

/**
 * Sets or removes a presence (boolean) attribute such as `disabled` or `hidden`: the helper compiled
 * templates call for the `bool:` prefix. A truthy value sets the attribute to `""`, a falsy value
 * removes it; the DOM is touched only when presence changes. No URL check applies.
 *
 * @param el Target element.
 * @param name Attribute name, such as `disabled`. It must match `[A-Za-z_:][A-Za-z0-9_:.-]*`.
 * @param value Any value: only its truthiness is read.
 * @throws TypeError `INVALID_ATTRIBUTE_NAME` when `name` is not a valid attribute name.
 * @example
 * import { setBoolAttribute } from "@shadow-js/web";
 *
 * const button = document.createElement("button");
 * setBoolAttribute(button, "disabled", true); // disabled=""
 * setBoolAttribute(button, "disabled", 0); // removed
 * @see setAttribute
 * @since 1.0.0
 */
export function setBoolAttribute(el: Element, name: string, value: unknown): void {
  assertAttributeName(name);
  el.toggleAttribute(name, Boolean(value));
}
