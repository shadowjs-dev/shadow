import {
  type Accessor,
  createSignalNode,
  disposeOwner,
  Owner,
  readSignal,
  type SignalNode,
  warn,
  writeSignal,
} from "./extend";
import { useMemo } from "./memo";
import { createRoot, getOwner, onCleanup, runWithOwner, untrack } from "./ownership";

/**
 * A list as the list primitives read it. `null`, `undefined` and `false` count as an empty list.
 * @since 1.0.0
 */
export type ListSource<T> = () => readonly T[] | null | undefined | false;

/**
 * One mapped row: its own root, its mapped value, and the signals behind `item()` and `index()`. The signals are created
 * by the first read, so a row whose callback never reads its index (or, unkeyed, its item) allocates neither.
 */
class Row<T, U> {
  /** Reuse key: the item itself (unkeyed), `key(item)` (keyed) or the position (indexed). */
  readonly key: unknown;
  /** False for a later copy of a key in a keyed list. Such a row is never reused. */
  readonly first: boolean;
  /** Item last written to the row. Kept as a plain field so an unchanged item skips the signal. */
  item: T;
  /** Index last written to the row. */
  index: number;
  value: U = undefined as U;
  dispose: () => void = noop;
  /** Created by the first `item()` read; null until then. */
  private itemNode: SignalNode<T> | null = null;
  /** Created by the first `index()` read; null until then. */
  private indexNode: SignalNode<number> | null = null;

  constructor(key: unknown, first: boolean, item: T, index: number) {
    this.key = key;
    this.first = first;
    this.item = item;
    this.index = index;
  }

  readItem(): T {
    this.itemNode ??= createSignalNode(this.item, Object.is);
    return readSignal(this.itemNode);
  }

  readIndex(): number {
    this.indexNode ??= createSignalNode(this.index, Object.is);
    return readSignal(this.indexNode);
  }

  /** List bookkeeping, not a user write: allowed while the list memo computes. */
  setItem(next: T): void {
    this.item = next;
    if (this.itemNode !== null) writeSignal(this.itemNode, next, { allowInMemo: true });
  }

  setIndex(next: number): void {
    this.index = next;
    if (this.indexNode !== null) writeSignal(this.indexNode, next, { allowInMemo: true });
  }
}

/** The dispose of a row whose root has not been made yet. */
function noop(): void {
  // Replaced by the root's own dispose before the row is used.
}

/** One incoming item of a list update, with the key it is matched by. */
interface Entry<T> {
  readonly item: T;
  readonly key: unknown;
  readonly first: boolean;
}

/** How incoming items are matched against the rows of the previous update. */
interface Keying<T> {
  /** Reuse key of the item at `position`. User code, so it runs untracked. */
  readonly keyOf: (item: T, position: number) => unknown;
  /** Keyed lists: only the first copy of a key may reuse a row. Otherwise copies pair up in order. */
  readonly distinct: boolean;
}

/** The row shown while the list is empty, in its own root. */
interface Fallback<U> {
  readonly value: U;
  readonly dispose: () => void;
}

/** A row chosen by one update, in output order. */
interface Staged<T, U> {
  readonly row: Row<T, U>;
  readonly item: T;
  readonly position: number;
  readonly fresh: boolean;
}

/**
 * Maps each item of a list to a row that lives as long as the item does. Rows whose key survives
 * an update keep their mapped value; new items get new rows; removed items have their rows disposed.
 *
 * Unkeyed: rows are matched by item reference, and `map` receives the item value. Equal primitives
 * pair up in order of occurrence. The returned accessor is lazy and memoized: rows are created and
 * disposed when it is read, so a list nobody reads keeps removed rows alive until the next read.
 *
 * @param list Source list. `null`, `undefined` and `false` are an empty list.
 * @param map Runs once per new row, untracked, in the row's own root. `index()` follows the row.
 * @param options `fallback` is shown while the list is empty. Undefined: an empty list maps to `[]`.
 * @returns Accessor of the mapped rows, in the order of the input.
 * @throws Nothing itself. Reading the accessor rethrows what `map` or a row cleanup threw; several
 * errors at once arrive as one `AggregateError`.
 * @example
 * import { createRoot, mapArray, useSignal } from "@shadow-js/core";
 *
 * createRoot(() => {
 *   const [users] = useSignal([{ name: "Ada" }, { name: "Linus" }]);
 *   const names = mapArray(users, (user, index) => `${index() + 1}. ${user.name}`);
 *   console.log(names()); // ["1. Ada", "2. Linus"]
 * });
 * @see indexArray
 * @since 1.0.0
 */
export function mapArray<T, U>(
  list: ListSource<T>,
  map: (item: T, index: () => number) => U,
  options?: { key?: undefined; fallback?: () => U },
): Accessor<U[]>;
/**
 * Keyed form: rows are matched by `key(item)`. `map` receives an accessor, so a new object under
 * the same key updates `item()` without re-creating the row. A duplicate key warns in dev and its
 * later copies get fresh rows on every update (dev warning `EACH_KEY_DUPLICATE`, once). Keys
 * compare like `Map` keys, so `NaN` matches `NaN`.
 *
 * @param list Source list. `null`, `undefined` and `false` are an empty list.
 * @param map Runs once per new row, untracked, in the row's own root. `item()` and `index()` follow
 * the row.
 * @param options `key` identifies each item and runs untracked; `fallback` is shown while the list
 * is empty.
 * @returns Accessor of the mapped rows, in the order of the input.
 * @throws Nothing itself. Reading the accessor rethrows what `map`, `key` or a row cleanup threw;
 * several errors at once arrive as one `AggregateError`.
 * @example
 * import { createRoot, mapArray, useSignal } from "@shadow-js/core";
 *
 * createRoot(() => {
 *   const [todos] = useSignal([{ id: 1, title: "Write docs" }]);
 *   const rows = mapArray(todos, (todo) => `#${todo().id} ${todo().title}`, {
 *     key: (todo) => todo.id,
 *   });
 *   console.log(rows()); // ["#1 Write docs"]
 * });
 * @see indexArray
 * @since 1.0.0
 */
export function mapArray<T, U>(
  list: ListSource<T>,
  map: (item: () => T, index: () => number) => U,
  options: { key: (item: T) => unknown; fallback?: () => U },
): Accessor<U[]>;
export function mapArray<T, U>(
  list: ListSource<T>,
  map: (item: T | (() => T), index: () => number) => U,
  options?: { key?: ((item: T) => unknown) | undefined; fallback?: (() => U) | undefined },
): Accessor<U[]> {
  const keyOf = options?.key;
  return listRows(
    list,
    keyOf === undefined
      ? { keyOf: (item: T) => item, distinct: false }
      : { keyOf: (item: T) => keyOf(item), distinct: true },
    (item, readItem, readIndex) => map(keyOf === undefined ? item : readItem, readIndex),
    options?.fallback,
  );
}

/**
 * Maps each position of a list to a row. Rows are created and removed only when the length
 * changes; the row at position `i` stays, and its `item()` accessor follows the value at `i`.
 *
 * @param list Source list. `null`, `undefined` and `false` are an empty list.
 * @param map Runs once per position, untracked, in the row's own root.
 * @param options `fallback` is shown while the list is empty. Undefined: an empty list maps to `[]`.
 * @returns Accessor of the mapped rows, in the order of the input.
 * @throws Nothing itself. Reading the accessor rethrows what `map` or a row cleanup threw; several
 * errors at once arrive as one `AggregateError`.
 * @example
 * import { createRoot, indexArray, useSignal } from "@shadow-js/core";
 *
 * createRoot(() => {
 *   const [values] = useSignal(["a", "b"]);
 *   const cells = indexArray(values, (value, index) => `${index}: ${value()}`);
 *   console.log(cells()); // ["0: a", "1: b"]
 * });
 * @see mapArray
 * @since 1.0.0
 */
export function indexArray<T, U>(
  list: ListSource<T>,
  map: (item: () => T, index: number) => U,
  options?: { fallback?: () => U },
): Accessor<U[]> {
  return listRows(
    list,
    { keyOf: (_item: T, position: number) => position, distinct: false },
    (_item, readItem, readIndex) => map(readItem, untrack(readIndex)),
    options?.fallback,
  );
}

/**
 * The shared engine. The memo tracks `list()` and reconciles the previous rows against the new
 * items; each row is a child of a private holder owner, so the memo's own recomputation never
 * disposes rows, and disposing the list's owner disposes the holder with every row in it.
 */
function listRows<T, U>(
  list: ListSource<T>,
  keying: Keying<T>,
  build: (item: T, readItem: () => T, readIndex: () => number) => U,
  fallback: (() => U) | undefined,
): Accessor<U[]> {
  const holder = new Owner(getOwner());
  onCleanup(() => {
    disposeOwner(holder);
  });
  let rows: Row<T, U>[] = [];
  let emptyFallback: Fallback<U> | undefined;
  return useMemo<U[]>(
    () => {
      // Reading the list's contents is tracked, so a store array (proxy) updates the list when an
      // item is pushed, removed or replaced; user key functions then run untracked.
      const source = listItems(list());
      const items: readonly unknown[] = Array.isArray(source)
        ? Array.prototype.slice.call(source)
        : source;
      const entries = untrack(() => toEntries(items as readonly never[], keying));
      const reuse = matchRows(rows, entries);
      const created: Row<T, U>[] = [];
      const staged: Staged<T, U>[] = [];
      let nextFallback: Fallback<U> | undefined;
      try {
        entries.forEach((entry, position) => {
          const from = reuse[position] ?? -1;
          const kept = from === -1 ? undefined : rows[from];
          if (kept !== undefined) {
            staged.push({ row: kept, item: entry.item, position, fresh: false });
            return;
          }
          const row = openRow(holder, entry.key, entry.first, entry.item, position, build);
          created.push(row);
          staged.push({ row, item: entry.item, position, fresh: true });
        });
        if (entries.length === 0 && fallback !== undefined) {
          nextFallback = emptyFallback ?? openFallback(holder, fallback);
        }
      } catch (error) {
        // Nothing above touched the previous state, so only the rows made in this pass go.
        const failures: unknown[] = [];
        for (const row of created) disposeCollecting(row.dispose, failures);
        if (nextFallback !== undefined && nextFallback !== emptyFallback) {
          disposeCollecting(nextFallback.dispose, failures);
        }
        throw combineFailures(error, failures);
      }

      // Commit. Writes to retained rows come last, after every creation has succeeded.
      const failures: unknown[] = [];
      const previousRows = rows;
      const previousFallback = emptyFallback;
      rows = staged.map((stage) => stage.row);
      emptyFallback = nextFallback;
      const kept = new Uint8Array(previousRows.length);
      for (const from of reuse) {
        if (from !== -1) kept[from] = 1;
      }
      previousRows.forEach((row, from) => {
        if (kept[from] !== 1) disposeCollecting(row.dispose, failures);
      });
      if (previousFallback !== undefined && previousFallback !== nextFallback) {
        disposeCollecting(previousFallback.dispose, failures);
      }
      for (const stage of staged) {
        if (stage.fresh) continue;
        const row = stage.row;
        if (row.index !== stage.position) row.setIndex(stage.position);
        if (!Object.is(row.item, stage.item)) row.setItem(stage.item);
      }
      throwFailures(failures);
      if (nextFallback !== undefined) return [nextFallback.value];
      return rows.map((row) => row.value);
    },
    // The row callbacks build children (components, refs, directives): setup may write signals.
    { lazy: true, allowWrites: true },
  );
}

/** Treats `null`, `undefined` and `false` as an empty list. */
function listItems<T>(value: readonly T[] | null | undefined | false): readonly T[] {
  return value === null || value === undefined || value === false ? [] : value;
}

/** Computes each item's reuse key. Keyed lists flag later copies of a key and warn once. */
function toEntries<T>(items: readonly T[], keying: Keying<T>): Entry<T>[] {
  const entries: Entry<T>[] = [];
  const seen = new Set<unknown>();
  let duplicate = false;
  for (const [position, item] of items.entries()) {
    const key = keying.keyOf(item, position);
    let first = true;
    if (keying.distinct) {
      if (seen.has(key)) {
        first = false;
        duplicate = true;
      } else {
        seen.add(key);
      }
    }
    entries.push({ item, key, first });
  }
  if (duplicate) warn("EACH_KEY_DUPLICATE");
  return entries;
}

/** Keys compare like `Map` keys: `NaN` matches `NaN`. */
function sameKey(a: unknown, b: unknown): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function canReuse<T, U>(row: Row<T, U> | undefined, entry: Entry<T> | undefined): boolean {
  return (
    row !== undefined &&
    entry !== undefined &&
    row.first &&
    entry.first &&
    sameKey(row.key, entry.key)
  );
}

/**
 * Pairs each new position with the old row it reuses; -1 means a fresh row is needed. The prefix
 * and suffix runs settle append, prepend, remove and swap at the ends in one step each. The middle
 * is matched through a Map from key to the chain of old positions with that key (earliest first),
 * so the whole pass is linear on average. Iterative throughout.
 */
function matchRows<T, U>(old: readonly Row<T, U>[], next: readonly Entry<T>[]): Int32Array {
  const m = old.length;
  const n = next.length;
  const reuse = new Int32Array(n).fill(-1);
  let start = 0;
  while (start < m && start < n && canReuse(old[start], next[start])) {
    reuse[start] = start;
    start += 1;
  }
  let oldEnd = m - 1;
  let newEnd = n - 1;
  while (oldEnd >= start && newEnd >= start && canReuse(old[oldEnd], next[newEnd])) {
    reuse[newEnd] = oldEnd;
    oldEnd -= 1;
    newEnd -= 1;
  }
  if (start > oldEnd || start > newEnd) return reuse;

  const heads = new Map<unknown, number>();
  const chain = new Int32Array(m).fill(-1);
  for (let i = oldEnd; i >= start; i -= 1) {
    const row = old[i];
    if (row === undefined || !row.first) continue;
    chain[i] = heads.get(row.key) ?? -1;
    heads.set(row.key, i);
  }
  for (let j = start; j <= newEnd; j += 1) {
    const entry = next[j];
    if (entry === undefined || !entry.first) continue;
    const head = heads.get(entry.key);
    if (head === undefined || head === -1) continue;
    reuse[j] = head;
    heads.set(entry.key, chain[head] ?? -1);
  }
  return reuse;
}

/**
 * Creates one row in its own root under the holder. The row exists before `build` runs, so a read of `item()` or
 * `index()` during the build sees the final values. The root is detached from the memo on purpose.
 */
function openRow<T, U>(
  holder: Owner,
  key: unknown,
  first: boolean,
  item: T,
  index: number,
  build: (item: T, readItem: () => T, readIndex: () => number) => U,
): Row<T, U> {
  const row = new Row<T, U>(key, first, item, index);
  const readItem = (): T => row.readItem();
  const readIndex = (): number => row.readIndex();
  runWithOwner(holder, () =>
    createRoot((dispose) => {
      row.dispose = dispose;
      row.value = untrack(() => build(item, readItem, readIndex));
    }),
  );
  return row;
}

/** Creates the empty-list row in its own root under the holder. */
function openFallback<U>(holder: Owner, fallback: () => U): Fallback<U> {
  return runWithOwner(holder, () =>
    createRoot((dispose) => ({ value: untrack(fallback), dispose })),
  );
}

/** Disposes one row root. A throwing cleanup is collected so that the other rows still go. */
function disposeCollecting(dispose: () => void, failures: unknown[]): void {
  try {
    dispose();
  } catch (error) {
    failures.push(error);
  }
}

function combineFailures(primary: unknown, failures: readonly unknown[]): unknown {
  if (failures.length === 0) return primary;
  return new AggregateError(
    [primary, ...failures],
    __DEV__ ? "Several errors were thrown while mapping a list." : "SHADOW_MAP_ERRORS",
  );
}

/** Rethrows the one disposal failure, or all of them together. */
function throwFailures(failures: readonly unknown[]): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(
    failures,
    __DEV__
      ? "Several errors were thrown while disposing list rows."
      : "SHADOW_LIST_DISPOSE_ERRORS",
  );
}
