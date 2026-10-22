/**
 * The runtime's side of the devtools protocol (version 1, see `@shadow-js/devtools`). The runtime
 * does not import that package: it looks up a global hook, in development builds only, and every
 * call site is wrapped as `if (__DEV__) report(...)` so production bundles drop it entirely.
 */

/**
 * The event kinds of the devtools protocol (version 1), numbered as `EVENT` in `@shadow-js/devtools`
 * numbers them. Pass one to {@link devtoolsReport} when a custom primitive shows up in devtools; the
 * meaning of the other arguments of each kind is in the protocol table of the devtools README.
 *
 * Kinds 16 and 17 are the transition events, reported by `internal/concurrency.ts`: `TRANSITION_START`
 * (16) after a `transition()` callback has run, with no arguments; `TRANSITION_END` (17) when the
 * transition lane is idle, with the number of transitions it resolved. The devtools agent does not use
 * them yet.
 *
 * @example
 * import { DEVTOOLS_EVENT } from "@shadow-js/core/extend";
 *
 * function describe(kind: number): string {
 *   if (kind === DEVTOOLS_EVENT.SIGNAL_WRITTEN) return "signal written";
 *   if (kind === DEVTOOLS_EVENT.ERROR) return "error";
 *   return `event ${kind}`;
 * }
 * @see devtoolsReport
 * @since 1.0.0
 */
export const DEVTOOLS_EVENT = {
  OWNER_CREATED: 1,
  OWNER_DISPOSED: 2,
  SIGNAL_CREATED: 3,
  SIGNAL_WRITTEN: 4,
  COMPUTATION_CREATED: 5,
  COMPUTATION_RUN: 6,
  COMPUTATION_DISPOSED: 7,
  COMPONENT_MOUNTED: 8,
  COMPONENT_UNMOUNTED: 9,
  RESOURCE_STATE: 10,
  ERROR: 11,
  HYDRATION_MISMATCH: 12,
  FLUSH_START: 13,
  FLUSH_END: 14,
  STORE_CREATED: 15,
  TRANSITION_START: 16,
  TRANSITION_END: 17,
} as const;

const KEY = "__SHADOWJS_DEVTOOLS_HOOK__";

interface Hook {
  readonly version: number;
  report(kind: number, a?: unknown, b?: unknown, c?: unknown, d?: unknown, e?: unknown): void;
}

/**
 * Reports one event to the devtools hook (`globalThis.__SHADOWJS_DEVTOOLS_HOOK__`, protocol version
 * 1) when one is installed. Does nothing without a hook, with a hook of another version, and in
 * production builds. Exported from `@shadow-js/core/extend` as `devtoolsReport`. Pass the runtime's
 * own objects, not copies, so a report allocates nothing.
 *
 * @param kind The event kind, one of {@link DEVTOOLS_EVENT}.
 * @param a First argument of the event (see the protocol table of the devtools README).
 * @param b Second argument of the event, or undefined when the kind has none.
 * @param c Third argument of the event, or undefined when the kind has none.
 * @param d Fourth argument of the event, or undefined when the kind has none.
 * @param e Fifth argument of the event, or undefined when the kind has none.
 * @example
 * import { isDev } from "@shadow-js/core";
 * import { currentOwner, DEVTOOLS_EVENT, devtoolsReport } from "@shadow-js/core/extend";
 *
 * function reportFailure(error: unknown): void {
 *   if (isDev) devtoolsReport(DEVTOOLS_EVENT.ERROR, currentOwner(), error, undefined);
 * }
 * @see DEVTOOLS_EVENT
 * @since 1.0.0
 */
export function report(
  kind: number,
  a?: unknown,
  b?: unknown,
  c?: unknown,
  d?: unknown,
  e?: unknown,
): void {
  if (!__DEV__) return;
  const hook = Reflect.get(globalThis, KEY) as Hook | undefined;
  if (hook !== undefined && hook.version === 1) hook.report(kind, a, b, c, d, e);
}
