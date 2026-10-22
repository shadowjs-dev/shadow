import { type Context, createContext } from "./context";

/**
 * Counter protocol between asynchronous sources and the nearest `<Suspense>` boundary.
 * A source calls `increment()` when it starts blocking its readers and `decrement()` exactly once
 * when it settles.
 * @since 1.0.0
 */
export interface SuspenseTracker {
  /**
   * Records one more pending source. The boundary shows its fallback while the count is above
   * zero; call it once per source, the first time a reader sees that source pending.
   */
  increment(): void;
  /**
   * Records that one pending source settled (with a value or an error). Call it exactly once per
   * `increment()`; when the count returns to zero the boundary shows its content again.
   */
  decrement(): void;
  /**
   * Called when a transition reads pending data in this boundary. Returns true when the boundary keeps
   * its content meanwhile: the reader then throws the suspension and keeps its previous value until
   * the boundary releases it. Returns false (or is absent) to show the fallback as usual.
   * @default undefined (the boundary never holds its content: the fallback shows as usual)
   */
  hold?(): boolean;
}

/**
 * The context through which an asynchronous source finds the nearest `<Suspense>` boundary. Each
 * boundary provides its {@link SuspenseTracker}; the value is `null` outside any boundary. Read it
 * when building a data primitive that should hold the boundary while it loads, as `useResource`
 * does.
 *
 * @example
 * import { SuspenseContext, useContext } from "@shadow-js/core";
 *
 * function useLoadingHold(promise: Promise<unknown>): void {
 *   const tracker = useContext(SuspenseContext); // null outside any <Suspense>
 *   if (tracker === null) return;
 *   tracker.increment(); // the boundary shows its fallback
 *   promise.finally(() => tracker.decrement());
 * }
 * @see useResource
 * @since 1.0.0
 */
export const SuspenseContext: Context<SuspenseTracker | null> =
  /* @__PURE__ */ createContext<SuspenseTracker | null>(null, { name: "Suspense" });

/**
 * Bridge between resources and the server/hydration runtime. During server rendering it collects
 * in-flight fetches and replays finished ones on the next pass; during hydration it serves the
 * values the server already fetched, so the client does not fetch them again.
 * @since 1.0.0
 */
export interface ResourceCache {
  /**
   * Deterministic key for a resource created at this point of the render. `explicit` is the
   * resource's `key` option, or `undefined` when it has none.
   */
  key(explicit: string | undefined): string;
  /** A cached value, wrapped so that `undefined` values are representable. */
  read(key: string): { value: unknown } | undefined;
  /**
   * A fetch started; the cache stores its value under `key` when it resolves. `options.deferStream` is
   * true for a resource that holds the first streamed flush (see `ResourceOptions.deferStream`).
   */
  track(key: string, promise: Promise<unknown>, options?: ResourceTrackOptions): void;
  /**
   * The fetch an earlier pass of the same render started for `key` and that has not settled, when there
   * is one. A resource that finds it waits for that fetch instead of starting another, so a pass that
   * renders again does not fetch twice. Optional: a cache that does not keep earlier fetches omits it.
   */
  pending?(key: string): Promise<unknown> | undefined;
}

/** What {@link ResourceCache.track} is told about a fetch. @since 1.0.0 */
export interface ResourceTrackOptions {
  /** True when the resource was created with `deferStream: true`. */
  readonly deferStream?: boolean | undefined;
}

/**
 * The context through which `useResource` reaches the renderer's {@link ResourceCache}. Server
 * renderers and hydration provide it; the value is `null` when resources should always fetch. Only
 * a custom renderer needs to provide it.
 *
 * @example
 * import { type ResourceCache, ResourceCacheContext } from "@shadow-js/core";
 *
 * const values = new Map<string, unknown>();
 * let created = 0;
 * const cache: ResourceCache = {
 *   key: (explicit) => explicit ?? `resource-${created++}`,
 *   read: (key) => (values.has(key) ? { value: values.get(key) } : undefined),
 *   track: (key, promise) => void promise.then((value) => values.set(key, value)),
 * };
 * const page = <ResourceCacheContext value={cache}><p>Loading data</p></ResourceCacheContext>;
 * @see useResource
 * @since 1.0.0
 */
export const ResourceCacheContext: Context<ResourceCache | null> =
  /* @__PURE__ */ createContext<ResourceCache | null>(null, { name: "ResourceCache" });
