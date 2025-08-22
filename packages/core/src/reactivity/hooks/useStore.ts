import { scheduleEffect } from "../scheduler";
import { __currentEffect, __currentEffectDeps } from "./useEffect";

export type Store<T> = {
  /**
   * Reactive getter for the store's current value.
   * Reading this within an effect subscribes that effect to changes.
   */
  (): T;
  /**
   * Direct, non-reactive access to the current value.
   */
  value: T;
  /**
   * Internal marker so we can detect Shadow stores at runtime.
   */
  __isStore: boolean;
};

/**
 * Create a reactive store.
 *
 * - Calling the returned function reads the current value and subscribes
 *   the current effect (if any).
 * - Calling the setter updates the value and notifies subscribers.
 *
 * HMR (dev-only, Vite):
 * - Pass a stable `hmrKey` to preserve the store value across module updates.
 *   The value is saved in `import.meta.hot.data` on dispose and restored
 *   when the module re-evaluates after a hot update.
 *
 * Example:
 *   const [count, setCount] = useStore(0, {
 *     hmrKey: import.meta.url + "#App.count"
 *   });
 *
 * @param initialValue Initial value of the store.
 * @param opts Optional settings.
 *  - hmrKey: string key to persist the value across Vite HMR updates.
 * @returns A tuple [store, set] where:
 *   - store is a callable getter (Store<T>)
 *   - set is a setter (newValue: T | ((prev: T) => T)) => void
 */
export function useStore<T>(
  initialValue: T,
  opts?: { hmrKey?: string }
): [Store<T>, (newValue: T | ((prev: T) => T)) => void] {
  // Current value (may be overridden by HMR restore in dev)
  let value = initialValue;

  // Dev-only HMR state restore/persist using Vite's hot data bucket.
  // This is a no-op in production builds.
  // Note: requires a stable hmrKey per store.
  const hot =
    typeof import.meta !== "undefined"
      ? (
          import.meta as {
            hot?: {
              accept?: () => void;
              dispose?: (cb: () => void) => void;
              data?: Record<string, unknown>;
            };
          }
        ).hot
      : null;
  if (opts?.hmrKey && hot?.data) {
    const bucket = (hot.data.__shadowStores ||= Object.create(null)) as Record<
      string,
      unknown
    >;

    if (opts.hmrKey in bucket) {
      value = bucket[opts.hmrKey] as T;
    }

    hot.accept?.();
    hot.dispose?.(() => {
      bucket[opts.hmrKey!] = value;
    });
  }

  // Effects subscribed to this store
  const subscribers = new Set<() => void>();

  /**
   * Read the current value and subscribe the current effect (if any).
   */
  const read = () => {
    if (__currentEffect) {
      // Register current effect as a subscriber
      subscribers.add(__currentEffect);
    }
    // Also record this store's subscriber set for cleanup purposes
    if (__currentEffectDeps) {
      __currentEffectDeps.add(subscribers);
    }
    return value;
  };

  /**
   * Write to the store and notify subscribers when the value changes.
   *
   * @param newValue New store value.
   */
  const write = (newValue: T | ((prev: T) => T)) => {
    value =
      typeof newValue === "function"
        ? (newValue as (prev: T) => T)(value)
        : newValue;
    if (value !== newValue) {
      subscribers.forEach((effect) => scheduleEffect(effect));
    }
  };

  // The store is a callable getter with extra properties
  const store = (() => read()) as Store<T>;

  // Define a non-reactive property accessor `.value`
  Object.defineProperty(store, "value", {
    get: read,
    set: write,
  });

  // Mark as a Shadow store
  (store as { __isStore: true }).__isStore = true;

  return [store, write];
}
