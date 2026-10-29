import {
  currentOwner,
  DEVTOOLS_EVENT,
  devtoolsReport,
  group,
  isComputingMemo,
  ShadowError,
} from "../extend";
import { untrack } from "../ownership";
import { useSignal } from "../signal";
import { isReservedKey, isWrappable, unwrapValue } from "./nodes";
import { draftOf, readProxyOf, Transaction } from "./proxies";
import { snapshot } from "./read";
import { applyReconcile, reconcile, specOf } from "./reconcile";
import type { MixedInitial, NotMixed, SetStore, Store, StoreResult } from "./types";

/**
 * Options of {@link useStore}.
 * @since 1.0.0
 */
export interface StoreOptions {
  /**
   * Label shown in error messages and by devtools.
   * @default undefined (the store is unnamed)
   */
  name?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rangeKeys(range: { from?: number; to?: number; by?: number }, length: number): number[] {
  const from = range.from ?? 0;
  const to = range.to ?? length - 1;
  const by = range.by ?? 1;
  if (!Number.isFinite(by) || by === 0)
    throw new TypeError(
      __DEV__ ? "ShadowStore: a range needs a non-zero `by`" : "SHADOW_STORE_RANGE",
    );
  const keys: number[] = [];
  for (let i = from; by > 0 ? i <= to : i >= to; i += by) {
    keys.push(i);
    if (keys.length > length + 1) break;
  }
  return keys;
}

/** The keys one path step addresses on `target` (a draft). */
function stepKeys(target: object, step: unknown, label: string): Array<string | number> {
  const keys: Array<string | number> = [];
  if (Array.isArray(target)) {
    if (typeof step === "number") keys.push(step);
    else if (typeof step === "function") {
      const filter = step as (item: unknown, index: number) => boolean;
      for (let i = 0; i < target.length; i += 1) if (filter(target[i], i)) keys.push(i);
    } else if (Array.isArray(step)) keys.push(...(step as number[]));
    else if (typeof step === "object" && step !== null)
      keys.push(...rangeKeys(step, target.length));
    else
      throw new TypeError(
        __DEV__ ? `ShadowStore${label}: bad path step for an array` : "SHADOW_STORE_PATH_ARRAY",
      );
  } else if (typeof step === "string" || typeof step === "number") {
    keys.push(step);
  } else if (Array.isArray(step)) {
    keys.push(...(step as Array<string | number>));
  } else {
    throw new TypeError(
      __DEV__ ? `ShadowStore${label}: bad path step for an object` : "SHADOW_STORE_PATH_OBJECT",
    );
  }
  for (const key of keys) {
    if (typeof key === "string" && isReservedKey(key)) {
      throw new TypeError(
        __DEV__
          ? `ShadowStore${label}: the key "${key}" cannot be used in a path`
          : "SHADOW_STORE_PATH_KEY",
      );
    }
  }
  return keys;
}

/** Writes `value` (or the updater's result) at the end of a path, merging plain objects. */
function applyPath(root: object, path: unknown[], label: string): void {
  const value = path[path.length - 1];
  const steps = path.slice(0, -1);
  const walk = (target: object, depth: number): void => {
    for (const key of stepKeys(target, steps[depth], label)) {
      const holder = target as Record<string | number, unknown>;
      if (depth === steps.length - 1) {
        const previous = holder[key];
        const spec = typeof value === "function" ? specOf(value) : undefined;
        if (spec !== undefined) {
          // reconcile(...) at a path diffs only that sub-tree.
          if (isWrappable(previous)) applyReconcile(unwrapValue(previous) as object, spec, label);
          else holder[key] = spec.next;
          continue;
        }
        const next =
          typeof value === "function" ? (value as (p: unknown) => unknown)(previous) : value;
        if (isPlainObject(next) && isWrappable(previous) && !Array.isArray(previous)) {
          mergeInto(previous as Record<string, unknown>, next, label);
        } else {
          holder[key] = next;
        }
      } else {
        const child = holder[key];
        if (!isWrappable(child)) {
          throw new TypeError(
            __DEV__
              ? `ShadowStore${label}: the path goes through a value that is not an object`
              : "SHADOW_STORE_PATH_VALUE",
          );
        }
        walk(child, depth + 1);
      }
    }
  };
  walk(root, 0);
}

function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  label: string,
): void {
  for (const key of Object.keys(source)) {
    if (isReservedKey(key)) {
      throw new TypeError(
        __DEV__
          ? `ShadowStore${label}: the key "${key}" cannot be assigned`
          : "SHADOW_STORE_ASSIGN_KEY",
      );
    }
    target[key] = source[key];
  }
}

/**
 * Devtools handles of the stores, by store root. Dev builds only: the WeakMap is unused (and dropped)
 * in production, where `__DEV__` is false.
 */
const storeHandles = /* @__PURE__ */ new WeakMap<object, Array<{ readonly name: string }>>();

function createDeepStore<T extends object>(initial: T, label: string): [Store<T>, SetStore<T>] {
  const root = unwrapValue(initial) as object;
  const store = readProxyOf(root) as Store<T>;

  // One untyped entry point for every form of update. It is assignable to SetStore<T> because its
  // parameters accept anything: the typed overloads are the public contract, and the devtools
  // path setter below calls this function directly with a path it built at run time.
  const apply = (...args: unknown[]): void => {
    if (__DEV__ && isComputingMemo()) throw new ShadowError("WRITE_IN_MEMO");
    if (args.length === 0)
      throw new TypeError(
        __DEV__ ? `ShadowStore${label}: setStore() needs an argument` : "SHADOW_STORE_NO_ARGUMENT",
      );
    const first = args[0];
    group(() =>
      untrack(() => {
        if (args.length > 1) {
          const tx = new Transaction(label);
          try {
            applyPath(draftOf(root, tx), args, label);
          } finally {
            tx.open = false;
          }
          return;
        }
        if (typeof first === "function") {
          const spec = specOf(first);
          if (spec !== undefined) {
            applyReconcile(root, spec, label);
            return;
          }
          const tx = new Transaction(label);
          let result: unknown;
          try {
            result = (first as (draft: unknown) => unknown)(draftOf(root, tx));
          } finally {
            tx.open = false;
          }
          if (result !== undefined) replaceWith(root, result, label);
          return;
        }
        replaceWith(root, first, label);
      }),
    );
  };
  const setStore: SetStore<T> = apply;
  if (__DEV__) {
    const handle = {
      name: label === "" ? "store" : label.replace(/^ \((.*)\)$/, "$1"),
      snapshot: () => snapshot(store),
      set: (path: readonly (string | number)[], value: unknown) => {
        apply(...path, value);
      },
    };
    // Devtools hold the handle weakly, so the handle must stay reachable exactly as long as the store.
    // The store's proxy and its setter both reach `root`, and a WeakMap value lives as long as its key.
    // A root shared by two stores keeps both handles.
    const anchored = storeHandles.get(root);
    if (anchored === undefined) storeHandles.set(root, [handle]);
    else anchored.push(handle);
    devtoolsReport(DEVTOOLS_EVENT.STORE_CREATED, handle, currentOwner());
  }
  return [store, setStore];
}

/** `setStore(value)`: an array replaces (diffed in place), a plain object merges its keys. */
function replaceWith(root: object, value: unknown, label: string): void {
  if (Array.isArray(root)) {
    if (!Array.isArray(value)) {
      throw new TypeError(
        __DEV__
          ? `ShadowStore${label}: an array store is updated with an array or a function`
          : "SHADOW_STORE_ARRAY_UPDATE",
      );
    }
    const spec = specOf(reconcile(value));
    if (spec !== undefined) applyReconcile(root, spec, label);
    return;
  }
  if (!isPlainObject(value)) {
    throw new TypeError(
      __DEV__
        ? `ShadowStore${label}: setStore() expects an object, a function or a reconcile() result`
        : "SHADOW_STORE_UPDATE_ARGUMENT",
    );
  }
  const tx = new Transaction(label);
  try {
    mergeInto(draftOf(root, tx) as Record<string, unknown>, value, label);
  } finally {
    tx.open = false;
  }
}

/**
 * The state hook. Pass a single value for a reactive cell, or plain data for a deep store:
 *
 * ```ts
 * const [count, setCount] = useStore(0);                 // count() / setCount(n => n + 1)
 * const [todos, setTodos] = useStore({ items: [] as Todo[] });
 * todos.items[0]?.done;                                  // tracks exactly this property
 * setTodos((draft) => { draft.items.push(todo); });      // notifies only what changed
 * setTodos("items", (t) => t.id === 3, "done", true);    // path form
 * ```
 *
 * Reads inside effects, memos and JSX subscribe to the exact value or property read; writes notify
 * exactly the readers of what changed, in one batch. A store wraps plain objects and arrays in
 * place; class instances, `Date`, `Map`, `Set` and functions are single values. A value that may
 * be `null` or another type (`Todo[] | null`) is a single value too: it is replaced as a whole, and
 * plain data assigned to it is read through the same fine-grained proxies a store uses.
 *
 * A property read in a tracked context gets a small notifier. Reading many transient keys
 * (`store.byId[id]` with churning ids) does not grow it for the life of the store: once an object
 * has collected a few hundred notifiers, the ones nothing observes any more are dropped, and a key
 * read again gets a fresh one that reflects the current value.
 *
 * @param initial Initial value or plain data. Plain objects and arrays are wrapped in place, not
 * copied.
 * @param options `name` labels the store in messages. Undefined uses the default (unnamed).
 * @returns `[read, write]` for a single value, `[store, setStore]` for plain data.
 * @throws ShadowError `WRITE_IN_MEMO` from the setter, in development builds only, when it is called
 * while a {@link useMemo} computation runs. `setStore` throws TypeError (production messages
 * `SHADOW_STORE_*`) for an update it cannot apply: no argument, a bad path step, a path through a
 * value that is not an object, a reserved key such as `__proto__`, or a non-array value for an
 * array store. Writing to the store view itself throws TypeError (`SHADOW_STORE_READ_ONLY`).
 * @example
 * import { useStore } from "@shadow-js/core";
 *
 * interface Todo { id: number; title: string; done: boolean }
 *
 * const [count, setCount] = useStore(0);
 * const [todos, setTodos] = useStore({ items: [] as Todo[] });
 * setCount((n) => n + 1);
 * setTodos((draft) => {
 *   draft.items.push({ id: 1, title: "Write docs", done: false });
 * });
 * setTodos("items", (todo) => todo.id === 1, "done", true);
 * console.log(count(), todos.items[0]?.done); // 1 true
 * @see useSignal
 * @see reconcile
 * @since 1.0.0
 */
export function useStore<T extends NotMixed<T>>(initial: T, options?: StoreOptions): StoreResult<T>;
export function useStore<T>(initial: MixedInitial<T>, options?: StoreOptions): StoreResult<T>;
export function useStore(initial: unknown, options?: StoreOptions): unknown {
  const label = options?.name === undefined ? "" : ` (${options.name})`;
  const root = unwrapValue(initial);
  if (isWrappable(root)) return createDeepStore(root, label);
  // A single value, which may be plain data later (`Todo[] | null`): objects and arrays that are
  // assigned are wrapped in read proxies, so `todos()?.[0]?.done` tracks exactly what it reads.
  const [read, write] = useSignal<unknown>(
    wrapCell(initial),
    options?.name === undefined ? undefined : { name: options.name },
  );
  const set = (next: unknown): unknown =>
    write(
      typeof next === "function"
        ? (previous: unknown) => wrapCell((next as (previous: unknown) => unknown)(previous))
        : wrapCell(next),
    );
  return [read, set];
}

/** The value a single-value cell holds: plain data becomes its (stable) read proxy. */
function wrapCell(value: unknown): unknown {
  const raw = unwrapValue(value);
  return isWrappable(raw) ? readProxyOf(raw) : value;
}
