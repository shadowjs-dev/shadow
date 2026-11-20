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

import { diagnosticUrl, reportDiagnostic, resetWarningDedupe } from "@shadow-js/core/extend";

/**
 * Prints a development warning as `[shadow CODE] detail`, followed by where it happened in the owner
 * tree and the page that explains the code, once per code and place (the same channel as core's
 * `warn`, so `subscribeDiagnostics` of `@shadow-js/core/extend` hears it): for a custom renderer that
 * refuses a value the way the built-in ones do. Production builds print nothing.
 *
 * @param code The diagnostic code. A code already reported from the same place (the owner path of
 *   the component that was running) is ignored, whatever the detail.
 * @param detail The text after the code.
 * @param key Optional. With a key the warning is once per `code` and `key` instead of once per code
 *   and place, for a warning about a name where each name deserves a report. Pass a bounded set
 *   of keys: at most 256 of one code are reported.
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
  if (__DEV__)
    reportDiagnostic(code, `[shadow ${code}] ${detail}`, { key, url: diagnosticUrl(code) });
}

/**
 * The text of the `SRCDOC_DYNAMIC` warning, shared by the client and the server writer. `srcdoc` is a whole HTML
 * document the frame runs, so it has the trust of `innerHTML`, not of a URL: no scheme check applies to it.
 * @internal
 */
export const SRCDOC_DYNAMIC_DETAIL =
  'A computed value was written to "srcdoc". It is an HTML document the frame runs, with the trust of innerHTML: sanitize it, and add the sandbox attribute to the frame.';

/**
 * Prints a development warning about one event (a hydration mismatch, a call with no owner) on the
 * shared channel, every time it happens: `[shadow CODE] detail`, where it happened and the page that
 * explains the code. Production builds print nothing.
 * @internal
 */
export function warnEvent(code: string, detail: string): void {
  if (__DEV__)
    reportDiagnostic(code, `[shadow ${code}] ${detail}`, { url: diagnosticUrl(code), every: true });
}

/** Forgets which codes were already reported. Used by tests; not part of the public surface. @internal */
export function resetWebWarningDedupe(): void {
  resetWarningDedupe();
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
