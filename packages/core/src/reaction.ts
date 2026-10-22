import {
  createComputation,
  createOwner,
  currentOwner,
  disposeOwner,
  type Owner,
  runInScope,
} from "./extend";
import { untrack } from "./ownership";

/**
 * Creates a tracker that reports the first change of what it reads. `useReaction(onInvalidate)`
 * returns `track(fn)`: `fn` runs at once (synchronously) and the signals it reads are recorded.
 * The first change of any of them calls `onInvalidate` once, untracked, and then nothing is
 * observed until `track` is called again. The ShadowJS form of Solid's `createReaction`.
 *
 * Use it when the work that follows a change is not a pure rerun of `fn` (for example, re-fetching
 * after a change and then deciding what to track next). For ordinary effects use `useEffect`.
 *
 * @param onInvalidate Called once, untracked, after a change of a tracked read.
 * @returns `track(fn)`. Each call replaces the previous tracking. Tracking lives in a child of the
 * owner that called `useReaction`, so it stops when that owner is disposed.
 * @example
 * import { useReaction, useSignal } from "@shadow-js/core";
 *
 * function Results() {
 *   const [filters] = useSignal({ query: "" });
 *   const [stale, setStale] = useSignal(false);
 *   const track = useReaction(() => setStale(true));
 *   track(() => filters()); // the first change of filters marks the results stale
 *   return <p>{stale() ? "Refresh to update" : "Up to date"}</p>;
 * }
 * @see useEffect
 * @since 1.0.0
 */
export function useReaction(onInvalidate: () => void): (track: () => void) => void {
  const owner = currentOwner();
  let scope: Owner | null = null;
  return (track: () => void): void => {
    if (scope !== null) disposeOwner(scope);
    const next = createOwner(owner);
    scope = next;
    let tracking = true;
    runInScope({ owner: next, listener: null }, () => {
      createComputation({
        kind: "effect",
        render: true,
        owner: next,
        fn: () => {
          if (tracking) {
            tracking = false;
            track();
            return undefined;
          }
          untrack(onInvalidate);
          return undefined;
        },
      });
    });
  };
}
