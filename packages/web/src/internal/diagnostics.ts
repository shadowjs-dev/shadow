/**
 * The diagnostic codes of the DOM runtime: `UNSAFE_URL_BLOCKED` (a URL attribute that would run
 * script was not written), `INVALID_ATTRIBUTE_NAME` (a name that cannot appear in markup) and
 * `DUPLICATE_CLASS_ATTRIBUTE` (one element carries `class` and `className`, so the parser drops one)
 * `SRCDOC_DYNAMIC` (a value computed at run time was written to `srcdoc`, an HTML sink) and
 * `DYNAMIC_SVG_CASE` (`Dynamic` was given an SVG element name in a case SVG does not spell it in).
 * @since 1.0.0
 */
export type WebWarningCode =
  | "UNSAFE_URL_BLOCKED"
  | "INVALID_ATTRIBUTE_NAME"
  | "DUPLICATE_CLASS_ATTRIBUTE"
  | "SRCDOC_DYNAMIC"
  | "DYNAMIC_SVG_CASE";

/** The codes reported, and the `code:key` pairs of the warnings that pass a key. */
const seen = new Set<string>();

/**
 * Prints a development warning as `[shadow CODE] detail`, at most once per code for the life of the
 * page or process (the same pattern as core's `warn`): for a custom renderer that refuses a value the
 * way the built-in ones do. Production builds print nothing.
 *
 * @param code The diagnostic code. A code that was already reported is ignored, whatever the detail.
 * @param detail The text after the code.
 * @param key Optional. With a key the warning is once per `code` and `key` instead of once per code, for a
 *   warning about a name where each name deserves a report. Pass a bounded set of keys: each is remembered.
 * @example
 * import { isUnsafeUrlAttribute, warnOnce } from "@shadow-js/web/extend";
 *
 * function setLink(el: Element, url: string): void {
 *   if (isUnsafeUrlAttribute("href", url)) {
 *     warnOnce("UNSAFE_URL_BLOCKED", `Blocked a script URL: ${url}`);
 *     return;
 *   }
 *   el.setAttribute("href", url);
 * }
 * @since 1.0.0
 */
export function warnOnce(code: WebWarningCode, detail: string, key?: string): void {
  if (!__DEV__) return;
  const id = key === undefined ? code : `${code}:${key}`;
  if (seen.has(id)) return;
  seen.add(id);
  console.warn(`[shadow ${code}] ${detail}`);
}

/**
 * The text of the `SRCDOC_DYNAMIC` warning, shared by the client and the server writer. `srcdoc` is a whole HTML
 * document the frame runs, so it has the trust of `innerHTML`, not of a URL: no scheme check applies to it.
 * @internal
 */
export const SRCDOC_DYNAMIC_DETAIL =
  'A computed value was written to "srcdoc". It is an HTML document the frame runs, with the trust of innerHTML: sanitize it, and add the sandbox attribute to the frame.';

/** Forgets which codes were already reported. Used by tests; not part of the public surface. @internal */
export function resetWebWarningDedupe(): void {
  seen.clear();
}

/**
 * Error thrown for attribute names that cannot appear in markup. Dev builds carry the full text;
 * production keeps the code and the name (the same split as core's messages).
 * @internal
 */
export function invalidAttributeName(name: string): TypeError {
  if (!__DEV__) return new TypeError(`SHADOW_INVALID_ATTRIBUTE_NAME: "${name}"`);
  return new TypeError(`[shadow INVALID_ATTRIBUTE_NAME] "${name}" is not a valid attribute name.`);
}
