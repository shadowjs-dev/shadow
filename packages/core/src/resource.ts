import { useContext } from "./context";
import { useRenderEffect } from "./effect";
import {
  type Accessor,
  batch,
  createSignalNode,
  currentListener,
  currentOwner,
  DEVTOOLS_EVENT,
  devtoolsReport,
  holdReader,
  inTransition,
  readSignal,
  writeSignal,
} from "./extend";
import { onCleanup, untrack } from "./ownership";
import { ResourceCacheContext, SuspenseContext, type SuspenseTracker } from "./suspense";

/**
 * Where a {@link Resource} is in its life: `"unresolved"` (no value and no fetch, for example while
 * the source is falsy), `"pending"` (the first fetch is in flight), `"ready"` (a value is shown and
 * nothing is in flight), `"refreshing"` (a value is shown while a newer fetch runs) or `"errored"`
 * (the last fetch failed; reading the resource throws).
 * @since 1.0.0
 */
export type ResourceState = "unresolved" | "pending" | "ready" | "refreshing" | "errored";

/** Passed to every fetcher call. @since 1.0.0 */
export interface ResourceInfo<T = unknown> {
  /** Aborted when a newer fetch starts or the owner is disposed. */
  signal: AbortSignal;
  /** True when this call was started by `refetch()` or a source change after a value existed. */
  refetching: boolean;
  /** The last value, if any. */
  value: T | undefined;
}

/**
 * Options of {@link useResource}.
 * @since 1.0.0
 */
export interface ResourceOptions<T> {
  /**
   * Value shown before the first fetch settles. With it the resource never reads as `"pending"`: the
   * first fetch still runs, as a refresh (`"refreshing"`, `info.refetching` true), and never
   * suspends. A key that is present with the value `undefined` counts as given.
   * @default No initial value: the first fetch reads as `"pending"` and suspends its readers.
   */
  initialValue?: T;
  /**
   * The key that matches the value a server render recorded with the resource that hydrates it.
   * Give one when the creation order may differ between server and client.
   * @default undefined (a key is generated from the resource's position in the render)
   */
  key?: string;
  /**
   * On the server, the streamed response holds its first flush until this resource settles, so its value
   * is in the shell (the first chunk) and not in a later chunk behind a fallback. A resource that
   * rejects does not hold the stream: its fallback stays. Only resources created while the shell renders
   * hold it; a resource created later, by a streamed boundary, streams as usual. Other renderers
   * (`renderToString`, `renderToStringAsync`) already wait for every resource, so the option has no
   * effect there. Matches Solid's option of the same name.
   * @default false
   */
  deferStream?: boolean;
  /**
   * Label shown by devtools next to the resource's state changes. It has no effect on caching or on
   * the server key (use `key` for that) and costs nothing in production builds, where devtools reporting
   * is removed.
   * @default undefined (the resource is unnamed)
   */
  name?: string;
}

/** Reactive handle to an asynchronous value. @since 1.0.0 */
export interface Resource<T> extends Accessor<T | undefined> {
  /** The current {@link ResourceState}. Tracked when read in an effect or memo. */
  readonly state: ResourceState;
  /** True while a fetch is in flight (`"pending"` or `"refreshing"`). Tracked. */
  readonly loading: boolean;
  /** The error of the last fetch, or `undefined` when it did not fail. Tracked; never throws. */
  readonly error: unknown;
  /** The last successfully loaded value; unlike the call form it never throws or suspends. */
  readonly latest: T | undefined;
  /**
   * Fetches again (keeping the previous value visible). The promise resolves with the new value,
   * or with `undefined` when the fetch failed (see `error`) or a newer one replaced it; it never
   * rejects, so a call you do not await is safe.
   */
  refetch(): Promise<T | undefined>;
  /** Replaces the value without fetching, cancels a fetch in flight, and returns the new value. */
  mutate(value: T | ((previous: T | undefined) => T)): T;
}

/**
 * A signal cell whose writes are allowed everywhere (see {@link createSignalNode}). `distinct`
 * false notifies on every write, true only when the value changes.
 */
function cell<T>(initial: T, distinct: boolean): [Accessor<T>, (next: T) => void] {
  const node = createSignalNode<T>(initial, distinct ? Object.is : false);
  return [
    () => readSignal(node),
    (next) => {
      writeSignal(node, next, { allowInMemo: true });
    },
  ];
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Loads data asynchronously and exposes it reactively. Reading it while the first load is pending
 * holds the nearest `<Suspense>` boundary around the reader (not the creator) in its fallback;
 * reading it after a failure throws the error to the nearest error boundary. Refetching keeps the previous
 * value visible (`state === "refreshing"`) and never re-suspends.
 *
 * Two forms: `useResource(fetcher)` fetches once; `useResource(source, fetcher)` refetches whenever
 * `source()` changes and stays `unresolved` while it is `false`, `null` or `undefined`.
 *
 * `T` is inferred from what the fetcher returns. `info.value` is typed `unknown` unless the
 * parameter is annotated: `(info: ResourceInfo<User>) => ...`.
 *
 * @param fetcher Called untracked, once at creation (skipped when a server render already provided
 * the value) and again for every `refetch()`. It receives an abort signal, the `refetching` flag
 * and the last value; it returns the value or a promise.
 * @param options Initial value, server key and a devtools name. Undefined uses the defaults.
 * @returns The resource: call it to read the value; `state`, `loading`, `error`, `latest`,
 * `refetch` and `mutate` are on the same function.
 * @throws Nothing itself: a fetcher that throws or rejects makes the resource `"errored"`. Reading
 * the resource then rethrows that error, so the nearest error boundary receives it.
 * @example
 * import { useResource } from "@shadow-js/core";
 *
 * function Clock() {
 *   const time = useResource(({ signal }) => fetch("/api/time", { signal }).then((r) => r.text()));
 *   return <p>{time.loading ? "Loading..." : time()}</p>;
 * }
 * @see ResourceOptions
 * @see cache
 * @since 1.0.0
 */
export function useResource<T>(
  fetcher: (info: ResourceInfo) => T | Promise<T>,
  options?: ResourceOptions<T>,
): Resource<T>;
/**
 * Source form of {@link useResource}: fetches for each value of `source`, and refetches whenever it
 * changes. While `source()` is `false`, `null` or `undefined` nothing is fetched and the resource
 * stays `"unresolved"` (or keeps its value, `"ready"`). A newer fetch aborts the previous one, whose
 * late result is ignored.
 *
 * @param source Tracked; its value is passed to `fetcher`. A plain value fetches once.
 * @param fetcher Called untracked with the source value and the fetch info.
 * @param options Initial value, server key and a devtools name. Undefined uses the defaults.
 * @returns The resource (see {@link Resource}).
 * @throws Nothing itself. Reading the resource rethrows the error of a failed fetch.
 * @example
 * import { useResource, useSignal } from "@shadow-js/core";
 *
 * function UserCard() {
 *   const [id] = useSignal(1);
 *   const user = useResource(id, (id, { signal }) =>
 *     fetch(`/api/users/${id}`, { signal }).then((r) => r.json() as Promise<{ name: string }>),
 *   );
 *   return <p>{user()?.name}</p>;
 * }
 * @since 1.0.0
 */
export function useResource<S, T>(
  source: Accessor<S | false | null | undefined>,
  fetcher: (source: S, info: ResourceInfo) => T | Promise<T>,
  options?: ResourceOptions<T>,
): Resource<T>;
// A source that is a plain value fetches once for that value.
export function useResource<S extends string | number | boolean | bigint | object, T>(
  source: S,
  fetcher: (source: S, info: ResourceInfo) => T | Promise<T>,
  options?: ResourceOptions<T>,
): Resource<T>;
// Annotating the info parameter (`(info: ResourceInfo<User>) => ...`) types `info.value`.
export function useResource<T>(
  fetcher: (info: ResourceInfo<T>) => T | Promise<T>,
  options?: ResourceOptions<T>,
): Resource<T>;
export function useResource<S, T>(
  source: Accessor<S | false | null | undefined>,
  fetcher: (source: S, info: ResourceInfo<T>) => T | Promise<T>,
  options?: ResourceOptions<T>,
): Resource<T>;
export function useResource<S, T>(
  first: unknown,
  second?: unknown,
  third?: ResourceOptions<T>,
): Resource<T> {
  const hasSource = typeof second === "function";
  // The source is an accessor, or a plain value that never changes (a function is always an accessor).
  const source = (
    hasSource ? (typeof first === "function" ? first : () => first) : () => true
  ) as Accessor<S | false | null | undefined>;
  const oneShot = first as (info: ResourceInfo<T>) => T | Promise<T>;
  const fetcher = (hasSource ? second : (_input: S, info: ResourceInfo<T>) => oneShot(info)) as (
    source: S,
    info: ResourceInfo<T>,
  ) => T | Promise<T>;
  const options = (hasSource ? third : (second as ResourceOptions<T> | undefined)) ?? {};

  const hasInitial = "initialValue" in options;
  // Extension-API cells: a resource may be created (and so start loading) while a memo computes,
  // for example when a router renders a route inside one. Its own state is not a derived value.
  const [value, setValue] = cell<T | undefined>(options.initialValue, false);
  const [state, writeState] = cell<ResourceState>(hasInitial ? "ready" : "unresolved", true);
  // Filled below with the accessor users hold, so devtools can name the resource that changed.
  let handle: unknown;
  const setState = (next: ResourceState): void => {
    writeState(next);
    if (__DEV__) {
      devtoolsReport(DEVTOOLS_EVENT.RESOURCE_STATE, handle, next, options.name, currentOwner());
    }
  };
  const [failure, setFailure] = cell<unknown>(undefined, false);
  const cache = useContext(ResourceCacheContext);
  const cacheKey = cache === null ? undefined : cache.key(options.key);
  const cached = cache !== null && cacheKey !== undefined ? cache.read(cacheKey) : undefined;
  let usedCache = false;

  let version = 0;
  let controller: AbortController | undefined;
  let disposed = false;
  let lastSource: S | undefined;
  let hasValue = hasInitial;
  // Boundaries held by readers: whoever reads this resource while it is pending, inside a
  // <Suspense>, keeps that boundary showing its fallback until the first load settles.
  const holders = new Set<SuspenseTracker>();

  const release = (): void => {
    if (holders.size === 0) return;
    const held = [...holders];
    holders.clear();
    for (const tracker of held) tracker.decrement();
  };

  /** Applies a result unless a newer load or a dispose made it stale; says whether it applied. */
  const settle = (id: number, apply: () => void): boolean => {
    if (disposed || id !== version) return false;
    batch(apply);
    release();
    return true;
  };

  /** Starts a load. The promise resolves with the value, or undefined when it failed or went stale. */
  const load = (input: S, refetching: boolean): Promise<T | undefined> => {
    if (cached !== undefined && !usedCache && !refetching) {
      // Server data (hydration) or a previous server pass: no fetch needed for the first load.
      usedCache = true;
      hasValue = true;
      batch(() => {
        setValue(cached.value as T);
        setState("ready");
      });
      return Promise.resolve(cached.value as T);
    }
    controller?.abort();
    const current = new AbortController();
    controller = current;
    version += 1;
    const id = version;
    batch(() => {
      setState(hasValue ? "refreshing" : "pending");
      setFailure(undefined);
    });
    let output: T | Promise<T>;
    try {
      // A fetch an earlier pass of the same render still runs is joined, not repeated (a refetch never joins).
      const joined =
        refetching || cache === null || cacheKey === undefined
          ? undefined
          : cache.pending?.(cacheKey);
      output =
        joined !== undefined
          ? (joined as Promise<T>)
          : untrack(() =>
              fetcher(input, { signal: current.signal, refetching, value: untrack(value) }),
            );
    } catch (error) {
      settle(id, () => {
        setFailure(error);
        setState("errored");
      });
      return Promise.resolve(undefined);
    }
    if (isPromiseLike<T>(output)) {
      if (cache !== null && cacheKey !== undefined)
        cache.track(cacheKey, Promise.resolve(output), {
          deferStream: options.deferStream,
        });
      return Promise.resolve(output).then(
        (result) =>
          settle(id, () => {
            hasValue = true;
            setValue(result);
            setState("ready");
          })
            ? result
            : undefined,
        (error: unknown) => {
          settle(id, () => {
            setFailure(error);
            setState("errored");
          });
          return undefined;
        },
      );
    }
    const immediate = output;
    const applied = settle(id, () => {
      hasValue = true;
      setValue(immediate);
      setState("ready");
    });
    return Promise.resolve(applied ? immediate : undefined);
  };

  const onSource = (input: S | false | null | undefined): void => {
    if (input === false || input === null || input === undefined) {
      controller?.abort();
      version += 1;
      release();
      setState(hasValue ? "ready" : "unresolved");
      return;
    }
    lastSource = input;
    load(input, hasValue);
  };
  const read = (() => {
    const current = state();
    if (current === "errored") throw failure();
    if (current === "pending") {
      const tracker = useContext(SuspenseContext);
      if (tracker !== null && !holders.has(tracker)) {
        holders.add(tracker);
        tracker.increment();
      }
      // A transition reading pending data inside a boundary that shows content: the reader keeps its
      // previous value instead of showing this loading state (React's "keep content while suspended").
      if (tracker !== null && currentListener() !== null && inTransition()) holdReader(tracker);
    }
    return value();
  }) as Resource<T>;

  Object.defineProperties(read, {
    state: { get: state },
    loading: { get: () => state() === "pending" || state() === "refreshing" },
    error: { get: failure },
    latest: { get: value },
    refetch: {
      value: (): Promise<T | undefined> => {
        const input = untrack(source);
        if (input === false || input === null || input === undefined)
          return Promise.resolve(undefined);
        lastSource = input;
        return load(input, hasValue);
      },
    },
    mutate: {
      value: (next: T | ((previous: T | undefined) => T)): T => {
        let resolved: T | undefined;
        batch(() => {
          resolved =
            typeof next === "function"
              ? (next as (previous: T | undefined) => T)(untrack(value))
              : next;
          controller?.abort();
          version += 1;
          hasValue = true;
          setValue(resolved as T);
          setFailure(undefined);
          setState("ready");
        });
        release();
        return resolved as T;
      },
    },
  });
  void lastSource;
  // The accessor must exist before the first load starts: its first state report (pending) names it
  // to devtools, and a report about a handle that is still unassigned would be dropped.
  handle = read;
  // On the server nothing is reactive: read the source once and start the fetch.
  if (__SERVER__) onSource(untrack(source));
  else useRenderEffect(source, onSource);
  onCleanup(() => {
    disposed = true;
    controller?.abort();
    release();
  });
  return read;
}
