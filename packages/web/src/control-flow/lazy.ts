import { type Accessor, untrack, useMemo, useResource } from "@shadow-js/core";

type ComponentFunction<P> = (props: P) => unknown;

/**
 * A component made by {@link lazy}: call it (or write it in JSX) like any component, and use
 * `preload` to start the load early.
 * @since 1.0.0
 */
export interface LazyComponent<P> {
  /**
   * Renders the loaded component with `props`. While the code is loading the result is empty and the
   * nearest `<Suspense>` shows its fallback; without a boundary nothing is rendered until the load
   * resolves.
   */
  (props: P): Accessor<unknown>;
  /**
   * Starts loading without rendering and resolves to the component. Calls share one load, so the
   * loader runs once. A failed load is not cached: the next call or render loads again.
   */
  preload(): Promise<ComponentFunction<P>>;
}

/**
 * Defines a component whose code is loaded on first render. While loading, the nearest
 * `<Suspense>` shows its fallback; a failed load throws to the nearest `<ErrorBoundary>` and the
 * next render retries.
 *
 * @param loader Returns a promise of a module whose `default` export is the component, such as
 * `() => import("./chart")`. Called at most once while its load succeeds.
 * @returns A {@link LazyComponent}.
 * @throws Nothing synchronously. A rejected load surfaces as an error when the component's output
 * is read, so the nearest `<ErrorBoundary>` takes it; `preload()` rejects with the same error.
 * @example
 * import { lazy, Suspense } from "@shadow-js/web";
 *
 * function Chart(props: { title: string }) {
 *   return <h2>{props.title}</h2>;
 * }
 *
 * // In an app the loader is `() => import("./chart")`.
 * const LazyChart = lazy(() => Promise.resolve({ default: Chart }));
 *
 * function Page() {
 *   return (
 *     <Suspense fallback={<p>Loading...</p>}>
 *       <LazyChart title="Sales" />
 *     </Suspense>
 *   );
 * }
 * @see Suspense
 * @see ErrorBoundary
 * @since 1.0.0
 */
export function lazy<P>(
  loader: () => Promise<{ default: ComponentFunction<P> }>,
): LazyComponent<P> {
  let pending: Promise<ComponentFunction<P>> | undefined;
  let loaded: ComponentFunction<P> | undefined;

  const load = (): Promise<ComponentFunction<P>> => {
    if (pending === undefined) {
      pending = loader().then(
        (module) => {
          loaded = module.default;
          return module.default;
        },
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      );
    }
    return pending;
  };

  const Lazy = ((props: P): Accessor<unknown> => {
    if (loaded !== undefined) {
      const component = loaded;
      return useMemo(() => untrack(() => component(props)), { allowWrites: true });
    }
    const resource = useResource(() => load());
    return useMemo(
      () => {
        const component = resource();
        return component === undefined ? undefined : untrack(() => component(props));
      },
      { allowWrites: true },
    );
  }) as LazyComponent<P>;
  Lazy.preload = load;
  return Lazy;
}
