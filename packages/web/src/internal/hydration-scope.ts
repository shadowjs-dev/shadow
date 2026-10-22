/**
 * A hydration scope: the deterministic source of hydration keys shared by the server renderer and
 * the client hydrator. Keys depend only on the nesting and order of component calls, never on owners,
 * effects or memos, so server and client agree as long as they run the same components. Scopes are
 * created by {@link createRootScope}, {@link enterComponent} and {@link childScope}; treat their
 * fields as read-only.
 *
 * @since 1.0.0
 */
export interface HydrationScope {
  /** Prefix of every key allocated in this scope, ending with `-` (`"0-"` for a root, `"0-3-"` below). */
  readonly id: string;
  /** Next number handed out by this scope: component scopes and template root keys share it. */
  count: number;
  /** Number of auto-keyed resources created directly in this scope so far. */
  resources: number;
}

let current: HydrationScope | null = null;

/**
 * Creates the scope a render or a hydration starts from: what `renderToString` and `hydrate()` put in
 * effect around the app. A custom renderer that hands out hydration keys does the same.
 *
 * @param renderId The prefix of every key of this render. Default: `"0"`, the default `renderId` of
 * the renderers.
 * @returns A fresh scope whose `id` is `` `${renderId}-` ``.
 * @example
 * import { createRootScope, nextKey, withScope } from "@shadow-js/web/extend";
 *
 * const keys = withScope(createRootScope("app"), () => [nextKey(), nextKey()]);
 * // ["app-0", "app-1"]
 * @see withScope
 * @since 1.0.0
 */
export function createRootScope(renderId = "0"): HydrationScope {
  return { id: `${renderId}-`, count: 0, resources: 0 };
}

/**
 * Returns the hydration scope in effect.
 *
 * @returns The current scope; `null` outside a server render, a hydration, or a {@link withScope}
 * call.
 * @example
 * import { currentScope } from "@shadow-js/web/extend";
 *
 * function scopeLabel(): string {
 *   return currentScope()?.id ?? "no scope";
 * }
 * @since 1.0.0
 */
export function currentScope(): HydrationScope | null {
  return current;
}

/**
 * Runs `fn` with `scope` in effect, so the keys `fn` draws come from it. The previous scope is
 * restored when `fn` returns or throws.
 *
 * @param scope The scope to put in effect; `null` runs `fn` with no scope (no keys are drawn).
 * @param fn The code to run, synchronously, once.
 * @returns What `fn` returns. An error `fn` throws propagates.
 * @example
 * import { childScope, nextKey, withScope } from "@shadow-js/web/extend";
 *
 * // The keys of an isolated subtree, independent of its siblings.
 * const first = withScope(childScope("0-4"), () => nextKey()); // "0-4-0"
 * @see createRootScope
 * @since 1.0.0
 */
export function withScope<T>(scope: HydrationScope | null, fn: () => T): T {
  const previous = current;
  current = scope;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/**
 * Runs a component call in a scope of its own, so the keys it draws depend only on its position
 * among its parent's calls: what `createComponent` does on the client and on the server. The
 * component's scope takes the next number of the parent scope.
 *
 * @param fn The component call, run synchronously, once.
 * @returns What `fn` returns. Without a scope in effect, `fn` simply runs.
 * @example
 * import { createRootScope, enterComponent, nextKey, withScope } from "@shadow-js/web/extend";
 *
 * withScope(createRootScope(), () => {
 *   nextKey(); // "0-0"
 *   return enterComponent(() => nextKey()); // "0-1-0": the component's first key
 * });
 * @since 1.0.0
 */
export function enterComponent<T>(fn: () => T): T {
  const parent = current;
  if (parent === null) return fn();
  return withScope({ id: `${parent.id}${parent.count++}-`, count: 0, resources: 0 }, fn);
}

/**
 * Draws the key of the next template root in the current scope: what `template()` and
 * `ssrHydrationKey()` call, in the same order on the server and the client. Each call advances the
 * scope.
 *
 * @returns The key (`"0-0"`, `"0-1"`, ...); undefined outside a scope.
 * @example
 * import { claimElement, nextKey } from "@shadow-js/web/extend";
 *
 * function createBadge(): Element {
 *   return claimElement(nextKey()) ?? document.createElement("span");
 * }
 * @see claimElement
 * @since 1.0.0
 */
export function nextKey(): string | undefined {
  const scope = current;
  if (scope === null) return undefined;
  return `${scope.id}${scope.count++}`;
}

/**
 * Returns the key a resource's value is stored under in the server data, the same on the server and
 * the client: the explicit key when there is one, else one drawn from the current scope.
 *
 * @param explicit The resource's own key. When given, the result is `` `k:${explicit}` ``, a prefix
 * no generated key has. Undefined draws the next resource key of the scope.
 * @returns `` `k:${explicit}` ``; otherwise the scope id, `r` and the creation index (`"0-1-r0"`);
 * `"r"` outside a scope.
 * @example
 * import { createRootScope, resourceKey, withScope } from "@shadow-js/web/extend";
 *
 * withScope(createRootScope(), () => [resourceKey(undefined), resourceKey("user")]);
 * // ["0-r0", "k:user"]
 * @since 1.0.0
 */
export function resourceKey(explicit: string | undefined): string {
  if (explicit !== undefined) return `k:${explicit}`;
  const scope = current;
  if (scope === null) return "r";
  return `${scope.id}r${scope.resources++}`;
}

/**
 * Creates a fresh scope for an isolated part of the tree, such as a Suspense boundary's content or
 * fallback, or a portal's content: its keys depend only on `key`, not on the siblings around it.
 *
 * @param key The key of the boundary (from `nextKey()`); undefined means no scope.
 * @returns A scope whose `id` is `` `${key}-` ``; `null` when `key` is undefined.
 * @example
 * import { childScope, nextKey, withScope } from "@shadow-js/web/extend";
 *
 * function renderIsolated<T>(build: () => T): T {
 *   return withScope(childScope(nextKey()), build);
 * }
 * @see withScope
 * @since 1.0.0
 */
export function childScope(key: string | undefined): HydrationScope | null {
  return key === undefined ? null : { id: `${key}-`, count: 0, resources: 0 };
}
