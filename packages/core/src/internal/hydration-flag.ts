import { rt } from "./state";

/**
 * Tells whether the code runs while `hydrate()` claims server markup. Read it at creation in a hook
 * whose first render must match the server, as `useExternalStore` does to read its server snapshot.
 *
 * @returns True inside {@link withHydration}, false otherwise.
 * @example
 * import { isHydrating } from "@shadow-js/core/extend";
 *
 * function initialWidth(serverWidth: number): number {
 *   return isHydrating() ? serverWidth : window.innerWidth;
 * }
 * @see withHydration
 * @since 1.0.0
 */
export function isHydrating(): boolean {
  return rt.hydrating;
}

/**
 * Runs `fn` with the hydration flag set, so the hooks created inside see {@link isHydrating} return
 * true, and restores the previous flag in `finally`. Renderers wrap their hydration pass in it (the
 * `hydrate()` of `@shadow-js/web` does); application code does not need it.
 *
 * @param fn The hydration pass. A throw is rethrown after the flag is restored.
 * @returns What `fn` returns.
 * @example
 * import { isHydrating, withHydration } from "@shadow-js/core/extend";
 *
 * const during = withHydration(() => isHydrating()); // true
 * const after = isHydrating(); // false again
 * @since 1.0.0
 */
export function withHydration<T>(fn: () => T): T {
  const previous = rt.hydrating;
  rt.hydrating = true;
  try {
    return fn();
  } finally {
    rt.hydrating = previous;
  }
}
