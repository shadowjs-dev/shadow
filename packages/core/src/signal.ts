import {
  type Accessor,
  type Equals,
  readSignal,
  type Setter,
  SignalNode,
  writeSignal,
} from "./extend";
import { untrack } from "./ownership";

/**
 * Options of {@link useSignal}.
 * @since 1.0.0
 */
export interface SignalOptions<T> {
  /**
   * Decides whether a write is a change: readers are notified only when it returns `false`.
   * `false` notifies on every write, even of the same value. It runs untracked: a signal it reads
   * is not a dependency of the computation that writes.
   * @default Object.is
   */
  equals?: Equals<T>;
  /**
   * Label shown by devtools and diagnostics.
   * @default undefined (the signal is unnamed)
   */
  name?: string | undefined;
}

/**
 * Creates a reactive cell holding one value: the low-level primitive `useStore` builds on. Reads
 * inside effects and memos subscribe them; writes notify them. Works at module scope.
 *
 * @param value Initial value.
 * @param options Equality override and a devtools name. Undefined uses the defaults.
 * @returns A `[read, write]` pair. The writer also accepts an updater `(prev) => next`, which runs
 * untracked, and returns the value it stored.
 * @throws ShadowError `WRITE_IN_MEMO` from the writer, in development builds only, when it is
 * called while a {@link useMemo} computation runs (unless that memo sets `allowWrites`).
 * @example
 * import { useSignal } from "@shadow-js/core";
 *
 * const [count, setCount] = useSignal(0);
 * setCount((n) => n + 1);
 * console.log(count()); // 1
 * @see useStore
 * @see useMemo
 * @since 1.0.0
 */
export function useSignal<T>(value: T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  const equals: Equals<T> = options?.equals === undefined ? Object.is : options.equals;
  const signal = new SignalNode<T>(value, equals, options?.name);
  const read: Accessor<T> = () => readSignal(signal);
  const write = ((next: unknown) => {
    const resolved = (
      typeof next === "function" ? untrack(() => (next as (prev: T) => T)(signal.value)) : next
    ) as T;
    writeSignal(signal, resolved);
    return resolved;
  }) as Setter<T>;
  return [read, write];
}
