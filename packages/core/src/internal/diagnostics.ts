import { formatMessage, type MessageCode } from "./messages";

/**
 * The error class of every diagnostic the runtime throws, carrying a stable code next to the
 * message. Match on `code` rather than the message: the message is the full text in development
 * builds and only `SHADOW_<CODE>` in production builds. Throw it from a custom primitive to report a
 * core diagnostic the same way the built-in hooks do.
 *
 * @example
 * import { ShadowError } from "@shadow-js/core/extend";
 *
 * function isCycle(error: unknown): boolean {
 *   return error instanceof ShadowError && error.code === "CYCLE_DETECTED";
 * }
 * @see MESSAGES
 * @since 1.0.0
 */
export class ShadowError extends Error {
  /** The diagnostic code, a key of {@link MESSAGES}; the same in development and production builds. */
  declare readonly code: MessageCode;
  /**
   * Creates the error with the text of {@link formatMessage} for `code` and the name `"ShadowError"`.
   * @param code The diagnostic code.
   */
  constructor(code: MessageCode) {
    super(formatMessage(code));
    this.name = "ShadowError";
    this.code = code;
  }
}

/**
 * A function that receives the warnings of {@link warn} instead of `console.warn`. Install one with
 * {@link setWarningListener}.
 * @param code The diagnostic code of the warning.
 * @param message The text of {@link formatMessage} for that code.
 * @since 1.0.0
 */
export type WarningListener = (code: MessageCode, message: string) => void;

const seen = new Set<MessageCode>();
let listener: WarningListener | undefined;

/**
 * Sends every later warning to `next` instead of `console.warn`, for devtools and test helpers
 * (`@shadow-js/testing`) that collect warnings. Deduplication still applies: the listener receives
 * the first warning of each code only. Warnings exist in development builds only.
 *
 * @param next The listener to install. Undefined restores the default, `console.warn`.
 * @returns The listener that was installed before, or undefined when it was the default, so the
 * caller can restore it.
 * @example
 * import { type MessageCode, setWarningListener } from "@shadow-js/core/extend";
 *
 * const codes: MessageCode[] = [];
 * const previous = setWarningListener((code) => {
 *   codes.push(code);
 * });
 * // ... run the code under test, then:
 * setWarningListener(previous);
 * @see warn
 * @see resetWarningDedupe
 * @since 1.0.0
 */
export function setWarningListener(next: WarningListener | undefined): WarningListener | undefined {
  const previous = listener;
  listener = next;
  return previous;
}

/**
 * Forgets which codes {@link warn} has already reported, so the next warning of each code is
 * reported again. Use it between test cases and after a hot reload.
 *
 * @example
 * import { resetWarningDedupe } from "@shadow-js/core/extend";
 *
 * function startTestCase(): void {
 *   resetWarningDedupe(); // each case sees its own first warnings
 * }
 * @see warn
 * @since 1.0.0
 */
export function resetWarningDedupe(): void {
  seen.clear();
}

/**
 * Reports a development-only diagnostic. Only the first warning of each code is reported, for the
 * whole program, until {@link resetWarningDedupe}; it goes to the listener of
 * {@link setWarningListener}, or to `console.warn` with the text of {@link formatMessage}. Does
 * nothing in production builds. Use it for a mistake that should not stop the app; throw
 * {@link ShadowError} for one that must.
 *
 * @param code The diagnostic code to report.
 * @example
 * import { currentOwner, warn } from "@shadow-js/core/extend";
 *
 * export function useTicker(): void {
 *   if (currentOwner() === null) warn("NO_OWNER_CLEANUP");
 * }
 * @see setWarningListener
 * @since 1.0.0
 */
export function warn(code: MessageCode): void {
  if (!__DEV__) return;
  if (seen.has(code)) return;
  seen.add(code);
  const message = formatMessage(code);
  if (listener !== undefined) listener(code, message);
  else console.warn(message);
}
