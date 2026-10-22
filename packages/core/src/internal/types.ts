/**
 * A function that releases what an owner or an effect set up: a timer, a subscription, a listener.
 * Register one with `onCleanup` (or `addCleanup` from `@shadow-js/core/extend`), or return one from
 * an effect.
 * @since 1.0.0
 */
export type Cleanup = () => void;

/**
 * A function that receives an error routed to an owner, as registered with `onError` or
 * `catchError`. Throwing from it hands the new error to the next handler up the owner tree.
 * @param error The thrown value; not necessarily an `Error`.
 * @since 1.0.0
 */
export type ErrorHandler = (error: unknown) => void;

/**
 * A reactive read: calling it returns the current value, and subscribes the running effect or memo
 * to it when one is listening.
 * @since 1.0.0
 */
export type Accessor<T> = () => T;

/**
 * Any function type. {@link Setter} uses it to tell a value from an updater.
 * @since 1.0.0
 */
export type AnyFunction = (...args: never[]) => unknown;

/**
 * The writer of a signal: it stores a value, or the result of an updater called with the previous
 * value, and returns what it stored. Function values cannot be passed directly because they would be
 * taken for updaters: wrap them, as in `set(() => fn)`.
 * @since 1.0.0
 */
export interface Setter<T> {
  /** Stores `value` (not a function) and returns it. */
  <U extends T>(value: Exclude<U, AnyFunction>): U;
  /** Stores what `updater` returns for the previous value, and returns it. */
  <U extends T>(updater: (prev: T) => U): U;
}

/**
 * The equality that decides whether a write or a recomputation is a change: readers are notified
 * only when it returns false. `false` instead of a function treats every write as a change.
 * @since 1.0.0
 */
export type Equals<T> = false | ((prev: T, next: T) => boolean);
