import { deleteRaw, isReservedKey, isWrappable, unwrapValue, writeRaw } from "./nodes";
import type { Reconciler } from "./types";

/**
 * Options of {@link reconcile}.
 * @since 1.0.0
 */
export interface ReconcileOptions {
  /**
   * Identity of array items: the name of a field (`"id"`) or a function returning the identity.
   * Items without an identity (not an object, or the field is absent, or the function returns
   * `undefined`) are matched by position.
   * @default "id"
   */
  key?: string | ((item: unknown) => unknown);
  /**
   * Keep keys, and array items, that `next` does not contain. When false, keys missing from `next`
   * are deleted and arrays are truncated to its length; when true, unmatched old array items are
   * kept after the new ones.
   * @default false
   */
  merge?: boolean;
}

/**
 * What a reconciler carries from `reconcile()` to `setStore`. Not re-exported by any entry: only
 * the store setter reads it.
 * @internal
 */
export interface ReconcileSpec {
  /** The desired data, as passed to `reconcile()` (it may still be a store proxy). */
  readonly next: unknown;
  /** Identity of array items, resolved from {@link ReconcileOptions.key}. */
  readonly key: string | ((item: unknown) => unknown);
  /** Whether keys and items absent from `next` are kept, from {@link ReconcileOptions.merge}. */
  readonly merge: boolean;
}

/** Each reconciler function maps to its spec. Keys are the reconciler functions themselves. */
const SPECS: WeakMap<object, ReconcileSpec> = new WeakMap();

/**
 * Looks up the spec of a reconciler created by {@link reconcile}. Not re-exported by any entry: the
 * store setter uses it to tell a reconciler from a draft updater.
 *
 * @param update Any function or object passed to `setStore`.
 * @returns The spec, or `undefined` when `update` is not a `reconcile()` result.
 * @internal
 */
export function specOf(update: object): ReconcileSpec | undefined {
  return SPECS.get(update);
}

/**
 * Describes a new value for a store. Passed to `setStore`, it changes only what differs from the
 * current state: objects are merged key by key, arrays are matched by `key` so retained items keep
 * their identity, and unchanged leaves are not written. Nothing is applied until `setStore` runs.
 * Use it to apply fresh server data to a store without re-rendering what did not change.
 *
 * @param next The desired data. Store proxies are accepted and unwrapped.
 * @param options Item identity (`key`) and whether to keep absent keys (`merge`). Undefined uses
 * the defaults (`key: "id"`, `merge: false`).
 * @returns A reconciler to pass to `setStore`, alone or as the last argument of a path.
 * @throws TypeError (production message `SHADOW_STORE_RECONCILE`) when the returned reconciler is
 * called directly instead of being passed to `setStore`. `setStore` throws TypeError
 * (`SHADOW_STORE_RECONCILE_SHAPE`) when `next` is not the same kind of container (object or
 * array) as the value it reconciles.
 * @example
 * import { reconcile, useStore } from "@shadow-js/core";
 *
 * interface Todo { id: number; title: string; done: boolean }
 * const [todos, setTodos] = useStore({ items: [] as Todo[] });
 *
 * async function refresh(): Promise<void> {
 *   const response = await fetch("/api/todos");
 *   setTodos("items", reconcile((await response.json()) as Todo[], { key: "id" }));
 * }
 * @see useStore
 * @since 1.0.0
 */
export function reconcile<T>(next: T, options?: ReconcileOptions): Reconciler<T> {
  const spec: ReconcileSpec = {
    next,
    key: options?.key ?? "id",
    merge: options?.merge === true,
  };
  const reconciler: Reconciler<T> = () => {
    throw new TypeError(
      __DEV__
        ? "ShadowStore: a reconcile() result must be passed to setStore()"
        : "SHADOW_STORE_RECONCILE",
    );
  };
  SPECS.set(reconciler, spec);
  return reconciler;
}

interface Frame {
  readonly target: object;
  readonly source: object;
}

/** Field name or function giving an item's identity; `undefined` means the item has none. */
function identityOf(item: unknown, key: string | ((item: unknown) => unknown)): unknown {
  if (!isWrappable(item)) return undefined;
  if (typeof key === "function") return key(item);
  return Object.hasOwn(item, key) ? Reflect.get(item, key) : undefined;
}

/** Same container kind: both arrays or both objects. */
function sameKind(a: object, b: object): boolean {
  return Array.isArray(a) === Array.isArray(b);
}

/**
 * Applies a reconciler to the store root. The diff is iterative: pending (target, source) pairs
 * live on an explicit stack, so data nested thousands of levels deep cannot overflow the call
 * stack. Each pair is visited once, which also terminates on cyclic input. Not re-exported by any
 * entry: only the store setter calls it, inside its transaction.
 *
 * @param root The raw (unwrapped) object or array to update in place.
 * @param spec The reconciler's spec, from {@link specOf}.
 * @param label The store label for messages (` (name)`, or an empty string).
 * @throws TypeError (production message `SHADOW_STORE_RECONCILE_SHAPE`) when `spec.next` is not the
 * same kind of container as `root`.
 * @internal
 */
export function applyReconcile(root: object, spec: ReconcileSpec, label: string): void {
  const next = unwrapValue(spec.next);
  if (!isWrappable(next) || !sameKind(root, next)) {
    throw new TypeError(
      __DEV__
        ? `ShadowStore${label}: reconcile() needs data of the same shape as the store root (an object or an array)`
        : "SHADOW_STORE_RECONCILE_SHAPE",
    );
  }
  const stack: Frame[] = [];
  const seen = new Map<object, Set<object>>();
  const enqueue = (target: object, source: object): void => {
    let targets = seen.get(source);
    if (targets === undefined) {
      targets = new Set();
      seen.set(source, targets);
    }
    if (targets.has(target)) return;
    targets.add(target);
    stack.push({ target, source });
  };

  enqueue(root, next);
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    if (Array.isArray(frame.source)) mergeArray(frame.target, frame.source, spec, enqueue);
    else mergeObject(frame.target, frame.source, spec, enqueue);
  }
}

function mergeObject(
  target: object,
  source: object,
  spec: ReconcileSpec,
  enqueue: (target: object, source: object) => void,
): void {
  for (const key of Object.keys(source)) {
    if (isReservedKey(key)) continue;
    const value = unwrapValue(Reflect.get(source, key));
    const had = Object.hasOwn(target, key);
    const current: unknown = had ? Reflect.get(target, key) : undefined;
    if (had && Object.is(current, value)) continue;
    if (had && isWrappable(current) && isWrappable(value) && sameKind(current, value)) {
      enqueue(current, value);
      continue;
    }
    writeRaw(target, key, value);
  }
  if (spec.merge) return;
  for (const key of Object.keys(target)) {
    if (!Object.hasOwn(source, key)) deleteRaw(target, key);
  }
}

function mergeArray(
  target: object,
  source: object,
  spec: ReconcileSpec,
  enqueue: (target: object, source: object) => void,
): void {
  const list = target as unknown[];
  const incoming = source as unknown[];
  // Copy first: matching reads the old positions, while the writes below move items.
  const original = list.slice();
  const identities = original.map((item) => identityOf(item, spec.key));
  const byIdentity = new Map<unknown, number>();
  for (let index = 0; index < original.length; index += 1) {
    const identity = identities[index];
    if (identity !== undefined && !byIdentity.has(identity)) byIdentity.set(identity, index);
  }

  const used: boolean[] = new Array<boolean>(original.length).fill(false);
  const matches: number[] = [];
  for (let position = 0; position < incoming.length; position += 1) {
    const item = unwrapValue(incoming[position]);
    const identity = identityOf(item, spec.key);
    let match = -1;
    if (identity !== undefined) {
      const found = byIdentity.get(identity);
      if (found !== undefined && used[found] !== true) match = found;
    } else if (position < original.length && identities[position] === undefined) {
      if (used[position] !== true) match = position;
    }
    if (match !== -1) used[match] = true;
    matches.push(match);
  }

  const values: unknown[] = [];
  for (let position = 0; position < incoming.length; position += 1) {
    const item = unwrapValue(incoming[position]);
    const match = matches[position] ?? -1;
    if (match === -1) {
      values.push(item);
      continue;
    }
    const previous = original[match];
    if (isWrappable(previous) && isWrappable(item) && sameKind(previous, item)) {
      if (previous !== item) enqueue(previous, item);
      values.push(previous);
    } else {
      values.push(item);
    }
  }
  if (spec.merge) {
    for (let index = 0; index < original.length; index += 1) {
      if (used[index] !== true) values.push(original[index]);
    }
  }

  for (let position = 0; position < values.length; position += 1) {
    writeRaw(target, String(position), values[position]);
  }
  if (list.length > values.length) writeRaw(target, "length", values.length);
}

/**
 * Marks a draft updater. It is the function itself (`setStore(produce((d) => { d.n += 1 }))` is
 * `setStore((d) => { d.n += 1 })`); it exists so code written for other libraries migrates as is.
 *
 * @param update The draft updater: it mutates the draft it receives.
 * @returns `update`, unchanged.
 * @example
 * import { produce, useStore } from "@shadow-js/core";
 *
 * const [cart, setCart] = useStore({ items: [] as string[], count: 0 });
 * setCart(
 *   produce((draft) => {
 *     draft.items.push("apple");
 *     draft.count += 1;
 *   }),
 * );
 * console.log(cart.count); // 1
 * @see useStore
 * @since 1.0.0
 */
export function produce<T>(update: (draft: T) => void): (draft: T) => void {
  return update;
}
