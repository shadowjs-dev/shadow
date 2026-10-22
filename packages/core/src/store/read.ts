import { isReservedKey, isWrappable, readRaw, unwrapValue } from "./nodes";
import type { Mutable, Store } from "./types";

/**
 * Returns the raw data behind a store. Reads and writes on the result bypass tracking and
 * notification, so writing to it is a bug; use it for identity checks and passing data on.
 *
 * @param store A store view. A value that is not a store view is returned as is.
 * @returns The underlying object, without proxies. It is the live data, not a copy.
 * @example
 * import { unwrap, useStore } from "@shadow-js/core";
 *
 * const initial = { items: [1, 2, 3] };
 * const [list] = useStore(initial);
 * console.log(unwrap(list) === initial); // true: the store wraps its data in place
 * @see snapshot
 * @since 1.0.0
 */
export function unwrap<T>(store: Store<T>): Mutable<T> {
  return unwrapValue(store) as Mutable<T>;
}

/** A new, empty container of the same kind as `value`, with the same length for arrays. */
function shellOf(value: object): object {
  return Array.isArray(value) ? new Array<unknown>((value as unknown[]).length) : {};
}

/**
 * Returns a deep plain copy of a store's current data. It reads raw data directly, so it does
 * not subscribe the running computation, and the copy is independent of later writes. Cycles and
 * shared objects are preserved. The walk is iterative, so deep data cannot overflow the stack. Use
 * it to serialize a store, send it to a server or keep an undo history.
 *
 * @param store A store view. A value that is not plain data is returned as is.
 * @returns A plain, untracked deep copy.
 * @example
 * import { snapshot, useStore } from "@shadow-js/core";
 *
 * const [form, setForm] = useStore({ name: "Ada", tags: ["admin"] });
 * const saved = snapshot(form);
 * setForm({ name: "Grace" });
 * console.log(saved.name, JSON.stringify(saved)); // Ada {"name":"Ada","tags":["admin"]}
 * @see unwrap
 * @since 1.0.0
 */
export function snapshot<T>(store: Store<T>): Mutable<T> {
  const root = unwrapValue(store);
  if (!isWrappable(root)) return root as Mutable<T>;
  const copies = new Map<object, object>();
  const out: object = shellOf(root);
  copies.set(root, out);
  const pending: object[] = [root];
  for (let source = pending.pop(); source !== undefined; source = pending.pop()) {
    const copy = copies.get(source);
    if (copy === undefined) continue;
    for (const key of Object.keys(source)) {
      if (isReservedKey(key)) continue;
      const value = unwrapValue(readRaw(source, key));
      if (isWrappable(value)) {
        let child = copies.get(value);
        if (child === undefined) {
          child = shellOf(value);
          copies.set(value, child);
          pending.push(value);
        }
        Reflect.set(copy, key, child);
      } else {
        Reflect.set(copy, key, value);
      }
    }
  }
  return out as Mutable<T>;
}
