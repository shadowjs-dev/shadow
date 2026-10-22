/**
 * The diagnostic catalog: every code the runtime throws (as {@link ShadowError}) or warns with
 * (through {@link warn}), mapped to its development text. Read it to show or match a diagnostic by
 * code. {@link formatMessage} reads it only in development builds, so production bundles keep the
 * code (`SHADOW_<CODE>`) and drop the text (R-CODE-8) unless your own code imports this object.
 *
 * @example
 * import { MESSAGES, type MessageCode } from "@shadow-js/core/extend";
 *
 * function explain(code: MessageCode): string {
 *   return `${code}: ${MESSAGES[code]}`;
 * }
 * @see formatMessage
 * @since 1.0.0
 */
export const MESSAGES = {
  NO_OWNER_EFFECT:
    "An effect was created outside any owner, so it can never be disposed. Create it inside a component or createRoot().",
  NO_OWNER_CLEANUP: "onCleanup() was called outside any owner, so the cleanup will never run.",
  NO_OWNER_ERROR: "onError() was called outside any owner, so the handler can never be reached.",
  WRITE_IN_MEMO:
    "A signal was written inside a useMemo() computation. Derive values from sources instead, or write from an effect.",
  CYCLE_DETECTED: "A reactive cycle was detected: a computation read itself while it was running.",
  INFINITE_LOOP:
    "Effects kept re-triggering each other for more than 1000 passes; the flush was aborted.",
  FLUSH_IN_EFFECT:
    "flushSync() was called while a flush was already running; the call was ignored.",
  RUN_WITH_DISPOSED_OWNER:
    "runWithOwner() was called with an owner that is already disposed; the callback ran without an owner.",
  DUPLICATE_CORE:
    "More than one copy of @shadow-js/core is loaded. Signals created by one copy are invisible to the other.",
  CONTEXT_MISSING: "useContext() found no provider and the context has no default value.",
  NO_OWNER_ID:
    "useId() was called outside any owner; the id is not stable across server and client.",
  EACH_KEY_DUPLICATE: "Duplicate key in a keyed list; later duplicates get fresh rows each update.",
  EFFECT_DEPS_IGNORED:
    "useEffect(fn, [deps]) ignores the array and re-runs on any signal it reads; use useEffect(deps, fn).",
} as const;

/**
 * A diagnostic code: one key of {@link MESSAGES}, such as `"WRITE_IN_MEMO"`. {@link ShadowError}
 * carries one in its `code` field, and {@link warn} takes one.
 * @since 1.0.0
 */
export type MessageCode = keyof typeof MESSAGES;

/**
 * Turns a diagnostic code into the text the runtime throws or logs: the full sentence in development
 * builds and only a stable code in production builds, so message strings never reach user bundles.
 * Use it when a custom primitive reports a core diagnostic in its own way.
 *
 * @param code The diagnostic code.
 * @returns `[shadow <CODE>] <text>` in development builds, `SHADOW_<CODE>` in production builds.
 * @example
 * import { formatMessage } from "@shadow-js/core/extend";
 *
 * const text = formatMessage("CONTEXT_MISSING");
 * // development: "[shadow CONTEXT_MISSING] useContext() found no provider ..."
 * // production:  "SHADOW_CONTEXT_MISSING"
 * @see MESSAGES
 * @since 1.0.0
 */
export function formatMessage(code: MessageCode): string {
  return __DEV__ ? `[shadow ${code}] ${MESSAGES[code]}` : `SHADOW_${code}`;
}
