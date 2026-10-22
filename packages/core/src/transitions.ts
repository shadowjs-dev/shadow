import {
  type Accessor,
  createComputation,
  type Equals,
  inTransition,
  registerTransitionLane,
  startTransition,
} from "./extend";
import { untrack } from "./ownership";
import { useSignal } from "./signal";

/**
 * Options of {@link useDeferredValue}.
 * @since 1.0.0
 */
export interface DeferredValueOptions<T> {
  /**
   * Decides whether the deferred value changed: readers are notified only when it returns `false`.
   * @default Object.is
   */
  equals?: Equals<T>;
  /**
   * Label shown by devtools and diagnostics.
   * @default "useDeferredValue" for the watcher; the value itself is unnamed
   */
  name?: string;
}

/**
 * Runs `fn` as a transition and reports whether it is pending. Returns `[isPending, start]`:
 * `isPending` is true from `start(fn)` until the transition has been applied (including any Suspense
 * boundary it waits on); `start(fn)` is {@link startTransition} that also updates `isPending`.
 *
 * Use it for updates that may be slow to show (navigating to a page that loads data): the previous
 * screen stays until the new one is ready, and the input stays responsive meanwhile.
 *
 * @returns `[isPending, start]`. `isPending` is an accessor; `start` returns a promise that
 * resolves when the transition has been applied. On the server `start` runs `fn` at once.
 * @throws Nothing itself. `start` rethrows synchronously what `fn` throws, after clearing
 * `isPending` when no other transition of this hook is running.
 * @example
 * import { useSignal, useTransition } from "@shadow-js/core";
 *
 * function Tabs() {
 *   const [page, setPage] = useSignal("home");
 *   const [pending, start] = useTransition();
 *   return (
 *     <button disabled={pending()} onClick={() => start(() => setPage("reports"))}>
 *       {page() === "reports" ? "Reports" : "Open reports"}
 *     </button>
 *   );
 * }
 * @see startTransition
 * @see useDeferredValue
 * @since 1.0.0
 */
export function useTransition(): [Accessor<boolean>, (fn: () => void) => Promise<void>] {
  const [pending, setPending] = useSignal(false);
  let running = 0;
  const start = (fn: () => void): Promise<void> => {
    running += 1;
    // Urgent: the pending state must show before the transition's own work.
    untrack(() => setPending(true));
    let applied: Promise<void>;
    try {
      applied = startTransition(fn);
    } catch (error) {
      running -= 1;
      if (running === 0) untrack(() => setPending(false));
      throw error;
    }
    return applied.then(() => {
      running -= 1;
      if (running === 0) untrack(() => setPending(false));
    });
  };
  return [pending, start];
}

/**
 * Returns a value that follows `source` in the transition lane: it keeps the previous value while
 * urgent updates run, and takes the new value when the lane applies it. Reads of the source are
 * unaffected. On the server it returns the source itself (there is no lane).
 *
 * @param source The value to follow. Tracked by a watcher that runs in the transition lane.
 * @param options Equality and a devtools name. Undefined uses the defaults.
 * @returns An accessor of the deferred value. It starts as the source's current value.
 * @example
 * import { useDeferredValue, useMemo, useSignal } from "@shadow-js/core";
 *
 * const names = ["Ada", "Grace", "Linus"];
 * function Search() {
 *   const [query, setQuery] = useSignal("");
 *   const deferredQuery = useDeferredValue(query);
 *   const results = useMemo(() => names.filter((name) => name.includes(deferredQuery())));
 *   return (
 *     <label>
 *       <input value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
 *       {results().join(", ")}
 *     </label>
 *   );
 * }
 * @see useTransition
 * @since 1.0.0
 */
export function useDeferredValue<T>(
  source: Accessor<T>,
  options?: DeferredValueOptions<T>,
): Accessor<T> {
  if (__SERVER__) return source;
  registerTransitionLane();
  const [value, setValue] = useSignal<T>(untrack(source), {
    equals: options?.equals ?? Object.is,
    ...(options?.name === undefined ? {} : { name: options.name }),
  });
  // The watcher runs in the lane. Its first run (queued at creation) finds the value equal, so it
  // writes nothing; a later run writes the source's value, and an equal value notifies nobody.
  createComputation({
    kind: "effect",
    fn: () => source(),
    apply: (next: T) => {
      setValue(() => next);
    },
    lane: true,
    name: options?.name ?? "useDeferredValue",
  });
  return value;
}

export { inTransition };
