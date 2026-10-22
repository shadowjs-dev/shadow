import type { Accessor, Setter } from "../extend";

/** Values that are never wrapped in a store view: primitives, functions and built-in objects. */
type Opaque =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined
  | ((...args: never[]) => unknown)
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | Promise<unknown>;

/**
 * Read-only view of `T`. Reads through it subscribe to the exact property read; writes are a type
 * error and throw at runtime outside `setStore`.
 * @since 1.0.0
 */
export type Store<T> = T extends Opaque ? T : { readonly [K in keyof T]: Store<T[K]> };

/**
 * Writable counterpart of a value: `readonly` is removed at every depth. Used for the raw results
 * of `unwrap` and `snapshot`, because inference from a {@link Store} type yields a readonly shape.
 * @since 1.0.0
 */
export type Mutable<T> = T extends Opaque ? T : { -readonly [K in keyof T]: Mutable<T[K]> };

/** Brand that marks a `reconcile()` result at the type level. Never present at runtime. */
declare const reconcilerBrand: unique symbol;

/**
 * Value produced by {@link reconcile}. It can only be passed to a store's `setStore`.
 * @since 1.0.0
 */
export type Reconciler<T> = ((draft: T) => void) & {
  readonly [reconcilerBrand]?: (value: T) => void;
};

/**
 * True for values `useStore` wraps in a deep, fine-grained store (plain objects and arrays). Used by
 * {@link StoreResult}; not re-exported by an entry.
 * @since 1.0.0
 */
export type IsPlainData<T> = [T] extends [Opaque]
  ? false
  : [T] extends [readonly unknown[]]
    ? true
    : [T] extends [object]
      ? true
      : false;

/**
 * True when `T` mixes plain data with opaque members (for example `Todo[] | null`). Used by
 * {@link StoreResult} and {@link NotMixed}; not re-exported by an entry.
 * @since 1.0.0
 */
export type IsMixed<T> = [T] extends [Opaque]
  ? false
  : [Extract<T, Opaque>] extends [never]
    ? false
    : true;

/** Index forms of a path step on an array: a position, a filter, several positions or a range. */
type ArrayStep<U> =
  | number
  | ((item: U, index: number) => boolean)
  | readonly number[]
  | { from?: number; to?: number; by?: number };

type Step<T> = T extends readonly (infer U)[] ? ArrayStep<U> : keyof T | readonly (keyof T)[];

type Next<T, K> = T extends readonly (infer U)[]
  ? U
  : K extends readonly (infer E)[]
    ? E extends keyof T
      ? T[E]
      : never
    : K extends keyof T
      ? T[K]
      : never;

/**
 * What a path's last step accepts: a value, an updater, a `reconcile()` result, or a partial object
 * that is merged. Used by {@link SetStore}; not re-exported by an entry.
 * @since 1.0.0
 */
export type Leaf<V> =
  | V
  | ((previous: V) => V)
  | Reconciler<V>
  | (V extends object ? Partial<V> : never);

/**
 * Updates a store. Every form is one batched, fine-grained transaction:
 *
 * - `setStore((draft) => { draft.items.push(x) })` mutates a draft; returning a value replaces
 *   (reconciles) instead.
 * - `setStore({ title: "x" })` merges keys into an object; `setStore([...])` replaces an array.
 * - `setStore(reconcile(next))` diffs `next` into the store.
 * - `setStore("todos", 2, "done", true)` writes at a path of up to four steps, fully type-checked;
 *   a step may be a key, several keys, an array filter `(item) => item.done`, or a range
 *   `{ from, to, by }`; the last argument may be a value, an updater, or a partial object that is
 *   merged. Deeper or dynamic paths go through a draft function.
 * @since 1.0.0
 */
export interface SetStore<T> {
  /**
   * Draft form: `update` mutates a draft of the whole store. Returning a value instead replaces
   * the store with it (an array is reconciled, a plain object is merged).
   */
  (update: (draft: T) => void | T | Partial<T>): void;
  /** Reconcile form: diffs the data given to {@link reconcile} into the store. */
  (update: Reconciler<T>): void;
  /** Value form: an array replaces an array store (diffed in place); an object merges its keys. */
  (value: T extends readonly unknown[] ? T : Partial<T>): void;
  /** Path form with one step: `a` selects the keys or items, `value` is the leaf update. */
  <A extends Step<T>>(a: A, value: Leaf<Next<T, A>>): void;
  /** Path form with two steps. */
  <A extends Step<T>, B extends Step<Next<T, A>>>(
    a: A,
    b: B,
    value: Leaf<Next<Next<T, A>, B>>,
  ): void;
  /** Path form with three steps. */
  <A extends Step<T>, B extends Step<Next<T, A>>, C extends Step<Next<Next<T, A>, B>>>(
    a: A,
    b: B,
    c: C,
    value: Leaf<Next<Next<Next<T, A>, B>, C>>,
  ): void;
  /** Path form with four steps, the deepest typed path; deeper updates use the draft form. */
  <
    A extends Step<T>,
    B extends Step<Next<T, A>>,
    C extends Step<Next<Next<T, A>, B>>,
    D extends Step<Next<Next<Next<T, A>, B>, C>>,
  >(
    a: A,
    b: B,
    c: C,
    d: D,
    value: Leaf<Next<Next<Next<Next<T, A>, B>, C>, D>>,
  ): void;
}

/**
 * What `useStore(initial)` returns: `[store, setStore]` for plain data, and an `[accessor, setter]`
 * pair for a single value, including a value that may be plain data or `null` (`Todo[] | null`).
 * @since 1.0.0
 */
export type StoreResult<T> =
  IsMixed<T> extends true
    ? [Accessor<Store<T>>, Setter<T>]
    : IsPlainData<T> extends true
      ? [Store<Mutable<T>>, SetStore<Mutable<T>>]
      : [Accessor<T>, Setter<T>];

/**
 * Constraint of the first `useStore` overload: `T` must not mix plain data with opaque members.
 * A union such as `Todo[] | null` is a single value that starts as one of its non-data members
 * and is replaced by the setter (second overload), because data passed as the initial value would
 * make a store at run time.
 * @since 1.0.0
 */
export type NotMixed<T> = IsMixed<T> extends true ? never : unknown;

/**
 * The initial value of a mixed `T`: only its opaque members (`null`, `undefined`, primitives). The
 * parameter type of the second `useStore` overload; not re-exported by an entry.
 * @since 1.0.0
 */
export type MixedInitial<T> = Extract<T, Opaque>;
