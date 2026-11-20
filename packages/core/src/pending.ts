import {
  createComputation,
  disposeOwner,
  group,
  refresh,
  type SourceNode,
  sourcesOf,
  track,
} from "./extend";

/** What says whether the data behind a source is being loaded, registered by the primitive that owns it. */
const loaders = /* @__PURE__ */ new WeakMap<SourceNode, () => boolean>();

/**
 * The most graph nodes one {@link isPending} call visits. An expression reaches its resources through
 * a handful of memos; the limit only stops a walk over a graph far larger than any expression reads.
 */
const MAX_VISITED = 10_000;

/**
 * Tells {@link isPending} that `source` holds loaded data and how to ask whether a load is running.
 * `useResource` registers its own sources; call it from a custom data primitive (a query library, a
 * socket-backed value) so that `isPending` sees it too.
 *
 * @param source The signal or custom source that readers of the data track.
 * @param loading Returns true while a load or a reload of that data is running. It is called
 * tracked: read a signal in it, so the caller of `isPending` runs again when the load ends.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { createSignalNode, readSignal, registerLoading, writeSignal } from "@shadow-js/core/extend";
 *
 * export function useFeed(open: (push: (item: string) => void) => void) {
 *   const latest = createSignalNode<string | undefined>(undefined, Object.is);
 *   const [waiting, setWaiting] = useSignal(true);
 *   registerLoading(latest, waiting);
 *   open((item) => {
 *     writeSignal(latest, item);
 *     setWaiting(false);
 *   });
 *   return () => readSignal(latest);
 * }
 * @see isPending
 * @since 1.2.0
 */
export function registerLoading(source: SourceNode, loading: () => boolean): void {
  loaders.set(source, loading);
}

/**
 * Tells whether the data an expression shows is being loaded: true while a resource the expression
 * reads, directly or through memos, is loading for the first time or reloading. Use it to mark what
 * is on screen as stale during a reload (dim a list, disable a control) without replacing it by a
 * fallback. The expression is evaluated to find what it reads, but apart from that it has no effect:
 * a pending resource read inside it does not hold a `<Suspense>` boundary, and an error it throws is
 * not thrown here.
 *
 * Called in a tracked scope (JSX, a memo, an effect), the answer is reactive: the scope runs again
 * when a load starts or ends, and when the expression comes to read other data.
 *
 * @param read The expression, as a function: `() => user()` or `() => filtered().length`.
 * @returns True while at least one resource under the expression is loading or reloading.
 * @example
 * import { isPending, useResource, useSignal } from "@shadow-js/core";
 *
 * function Cities(props: { fetchCities: (state: string) => Promise<string[]> }) {
 *   const [state, setState] = useSignal("CA");
 *   const cities = useResource(state, props.fetchCities, { initialValue: [] });
 *   return (
 *     <ul class={{ stale: isPending(cities) }} onClick={() => setState("NY")}>
 *       {cities()?.join(", ")}
 *     </ul>
 *   );
 * }
 * @see useResource
 * @since 1.2.0
 */
export function isPending(read: () => unknown): boolean {
  // A memo with no owner evaluates the expression: it records every source the expression reads (the
  // caller's own tracking would skip one it has read already in this run), it has no context, so a
  // pending resource read inside it holds no Suspense boundary, and it stores what the expression throws.
  const probe = createComputation({
    kind: "memo",
    lazy: true,
    owner: null,
    fn: read as (previous: never) => unknown,
  });
  let pending = false;
  try {
    refresh(probe);
    const queue = sourcesOf(probe);
    // The caller depends on what the expression read: when that changes, the answer may.
    for (const source of queue) track(source);
    const visited = new Set<SourceNode>(queue);
    // Iterative, and bounded: the graph below an expression is as deep as the application made it.
    for (let head = 0; head < queue.length && visited.size <= MAX_VISITED; head += 1) {
      const source = queue[head] as SourceNode;
      const loading = loaders.get(source);
      // Every loader is asked, with no early exit: the caller then tracks each of them, and runs again
      // whichever load starts or ends.
      if (loading?.() === true) pending = true;
      if (source.kind === 0) continue;
      for (const below of sourcesOf(source as Parameters<typeof sourcesOf>[0])) {
        if (visited.has(below)) continue;
        visited.add(below);
        queue.push(below);
      }
    }
  } finally {
    // In a group: ending the probe must not flush the effects the caller's own writes left queued.
    group(() => disposeOwner(probe));
  }
  return pending;
}
