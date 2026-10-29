import { useEffect } from "./effect";
import type { Accessor, Equals } from "./extend";
import { isHydrating } from "./extend";
import { untrack } from "./ownership";
import { useSignal } from "./signal";

/** Options of {@link useExternalStore}. @since 1.0.0 */
export interface ExternalStoreOptions<T> {
  /**
   * The snapshot the server renders (there is no subscription there). Without it the server reads
   * `getSnapshot` once. Keep it equal to what the browser reads on its first render: a difference is
   * corrected only after subscribing, and no hydration test covers that case yet. While hydrating,
   * the browser's first render also uses it.
   * @default undefined (the server, and hydration, read `getSnapshot`)
   */
  getServerSnapshot?: () => T;
  /**
   * Decides whether a new snapshot is a change: the accessor updates only when it returns `false`.
   * @default Object.is
   */
  equals?: Equals<T>;
  /**
   * Label shown by devtools and diagnostics.
   * @default undefined (the store is unnamed)
   */
  name?: string;
}

/**
 * Reads a value that lives outside ShadowJS (a store, a browser API, an observable) as a reactive
 * accessor. The one bridge for every external source, and the ShadowJS form of React's
 * `useSyncExternalStore` and Solid's `from`.
 *
 * `subscribe(notify)` is called in an effect after the owner is created and returns the
 * unsubscribe function, which runs when the owner is disposed. `getSnapshot()` is read untracked
 * at creation, on every notification, and once after subscribing (so a change made between the
 * first read and the subscription is not lost). The accessor updates only when the snapshot differs
 * by `equals`. On the server nothing is subscribed: the accessor returns `getServerSnapshot()`.
 *
 * @param subscribe Registers `notify`; returns the unsubscribe function.
 * @param getSnapshot Returns the current value. Reads inside it are not tracked.
 * @param options Server snapshot, equality and a devtools name. Undefined uses the defaults.
 * @returns An accessor of the current snapshot.
 * @example
 * import { useExternalStore } from "@shadow-js/core";
 *
 * function subscribe(notify: () => void): () => void {
 *   window.addEventListener("online", notify);
 *   window.addEventListener("offline", notify);
 *   return () => {
 *     window.removeEventListener("online", notify);
 *     window.removeEventListener("offline", notify);
 *   };
 * }
 *
 * function OnlineBadge() {
 *   const online = useExternalStore(subscribe, () => navigator.onLine, { getServerSnapshot: () => true });
 *   return <span>{online() ? "online" : "offline"}</span>;
 * }
 * @see useSignal
 * @since 1.0.0
 */
export function useExternalStore<T>(
  subscribe: (notify: () => void) => () => void,
  getSnapshot: () => T,
  options?: ExternalStoreOptions<T>,
): Accessor<T> {
  if (__SERVER__) {
    const snapshot = untrack(options?.getServerSnapshot ?? getSnapshot);
    return () => snapshot;
  }
  // While hydrating, the first render must equal the server markup: the server snapshot, when given.
  // The browser's snapshot is applied by the subscription below.
  const first =
    isHydrating() && options?.getServerSnapshot !== undefined
      ? options.getServerSnapshot
      : getSnapshot;
  const [value, setValue] = useSignal<T>(untrack(first), {
    equals: options?.equals ?? Object.is,
    name: options?.name,
  });
  const sync = (): void => {
    const next = untrack(getSnapshot);
    setValue(() => next);
  };
  useEffect(() => {
    // `subscribe` is a user callback: what it reads must not re-run (and re-subscribe) this effect.
    const unsubscribe = untrack(() => subscribe(sync));
    try {
      // Catch up with changes made between the first read and the subscription.
      sync();
    } catch (error) {
      // The effect fails, so no cleanup is registered: release the subscription here.
      unsubscribe();
      throw error;
    }
    return unsubscribe;
  });
  return value;
}
