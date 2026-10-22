/**
 * The diagnostic codes of the DOM runtime: `UNSAFE_URL_BLOCKED` (a URL attribute that would run
 * script was not written), `INVALID_ATTRIBUTE_NAME` (a name that cannot appear in markup) and
 * `DUPLICATE_CLASS_ATTRIBUTE` (one element carries `class` and `className`, so the parser drops one).
 * @since 1.0.0
 */
export type WebWarningCode =
  | "UNSAFE_URL_BLOCKED"
  | "INVALID_ATTRIBUTE_NAME"
  | "DUPLICATE_CLASS_ATTRIBUTE";

const seen = new Set<WebWarningCode>();

/**
 * Prints a development warning as `[shadow CODE] detail`, at most once per code for the life of the
 * page or process (the same pattern as core's `warn`): for a custom renderer that refuses a value the
 * way the built-in ones do. Production builds print nothing.
 *
 * @param code The diagnostic code. A code that was already reported is ignored, whatever the detail.
 * @param detail The text after the code.
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
export function warnOnce(code: WebWarningCode, detail: string): void {
  if (!__DEV__) return;
  if (seen.has(code)) return;
  seen.add(code);
  console.warn(`[shadow ${code}] ${detail}`);
}

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
