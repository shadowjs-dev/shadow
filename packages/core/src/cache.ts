import { currentOwner, type Owner } from "./extend";
import { untrack } from "./ownership";

/** Options of {@link cache}. @since 1.0.0 */
export interface CacheOptions {
  /**
   * Most results kept per scope (one root); the oldest is dropped first. A positive integer.
   * @default 100
   */
  limit?: number;
}

interface Entry {
  readonly args: readonly unknown[];
  readonly value: unknown;
}

function sameArgs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/** The outermost owner: the root of the render (a request on the server, the app on the client). */
function rootOf(owner: Owner | null): Owner | null {
  let root = owner;
  while (root !== null && root.parent !== null) root = root.parent;
  return root;
}

/**
 * Memoizes `fn` per request: within one root (a server render, or the app on the client) the same
 * arguments return the same result without calling `fn` again. Arguments compare with `Object.is`,
 * position by position. Results are kept in a list bounded by `limit`; the oldest is dropped first.
 * A call that throws is not kept. `fn` runs untracked, so the first caller does not alone subscribe to what
 * it reads. Outside any owner nothing is scoped, so `fn` runs every time.
 *
 * Use it to share one data fetch between components rendered in the same request.
 *
 * @param fn The function to memoize. Its result is kept as is, so a promise is shared, not awaited.
 * @param options Per-scope limit. Undefined uses the default.
 * @returns A function with the same signature.
 * @throws RangeError when `limit` is not a positive integer (message code `SHADOW_CACHE_LIMIT` in
 * production builds). The returned function rethrows what `fn` throws.
 * @example
 * import { cache } from "@shadow-js/core";
 *
 * const loadUser = cache((id: string) =>
 *   fetch(`/api/users/${id}`).then((response) => response.json()),
 * );
 * // Two components calling loadUser("u1") in the same render fetch once.
 * @see useResource
 * @since 1.0.0
 */
export function cache<A extends unknown[], R>(
  fn: (...args: A) => R,
  options?: CacheOptions,
): (...args: A) => R {
  const limit = options?.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      __DEV__ ? "cache: limit must be a positive integer" : "SHADOW_CACHE_LIMIT",
    );
  }
  const scopes = new WeakMap<Owner, Entry[]>();
  return (...args: A): R => {
    const root = rootOf(currentOwner());
    if (root === null) return untrack(() => fn(...args));
    let entries = scopes.get(root);
    if (entries === undefined) {
      entries = [];
      scopes.set(root, entries);
    }
    for (const entry of entries) {
      if (sameArgs(entry.args, args)) return entry.value as R;
    }
    const value = untrack(() => fn(...args));
    entries.push({ args, value });
    if (entries.length > limit) entries.shift();
    return value;
  };
}
