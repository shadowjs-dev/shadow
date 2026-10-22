import { captureScriptBody, DEFAULT_EARLY_EVENTS } from "../internal/early-events";
import { ssrRaw } from "./element";

/**
 * Options of {@link generateHydrationScript} and {@link HydrationScript}.
 * @since 1.0.0
 */
export interface HydrationScriptOptions {
  /**
   * CSP nonce for the script. It is written only when it is a plain token (letters, digits, `+`, `/`,
   * `=`, `_`, `-`); any other value is ignored and the script gets no nonce.
   * @default undefined (no nonce attribute)
   */
  readonly nonce?: string;
  /**
   * Event types to capture before hydration. Only plain lower-case names (`[a-z]+`) are kept; others
   * are skipped.
   * @default ["click", "input"]
   */
  readonly eventNames?: readonly string[];
}

const NONCE = /^[A-Za-z0-9+/=_-]+$/;

/**
 * Returns the inline `<script>` that records the events a user makes before the app has hydrated, so
 * `hydrate()` can replay them once its handlers are attached (a click made while the bundle loads is
 * not lost). Put it in the `<head>` of the server-rendered page, before the bundle.
 *
 * @param options The CSP nonce and the event types to capture. Undefined uses the defaults of
 * {@link HydrationScriptOptions}.
 * @returns The script element as a string of markup.
 * @example
 * import { generateHydrationScript, renderToString } from "@shadow-js/web/server";
 *
 * function page(app: () => unknown, nonce: string): string {
 *   const body = renderToString(app);
 *   return `<html><head>${generateHydrationScript({ nonce })}</head><body>${body}</body></html>`;
 * }
 * @see HydrationScript
 * @since 1.0.0
 */
export function generateHydrationScript(options: HydrationScriptOptions = {}): string {
  const nonce = options.nonce;
  const attribute = nonce !== undefined && NONCE.test(nonce) ? ` nonce="${nonce}"` : "";
  const names = options.eventNames ?? DEFAULT_EARLY_EVENTS;
  return `<script${attribute}>${captureScriptBody(names)}</script>`;
}

/**
 * {@link generateHydrationScript} as a component, for a document rendered with server JSX:
 * `<HydrationScript nonce={nonce} />` in the `<head>`.
 *
 * @param props The CSP nonce and the event types to capture. Undefined uses the defaults of
 * {@link HydrationScriptOptions}.
 * @returns The script as trusted raw markup.
 * @example
 * import { createComponent, HydrationScript, renderToString } from "@shadow-js/web/server";
 *
 * function Document() {
 *   return (
 *     <html>
 *       <head>
 *         <HydrationScript nonce="r4nd0m" />
 *       </head>
 *       <body>Hello</body>
 *     </html>
 *   );
 * }
 * const html = renderToString(() => createComponent(Document, {}));
 * @see generateHydrationScript
 * @since 1.0.0
 */
export function HydrationScript(props: HydrationScriptOptions = {}): unknown {
  return ssrRaw(generateHydrationScript(props));
}
