import { useMemo } from "@shadow-js/core";

/**
 * A value the compiler keeps live: the result of `const x = <expression reading signals>` inside a
 * component. Read it as `x.value` or call it as `x()`, so `{double}` and `{double()}` both work in
 * JSX. When the value is itself a function, calling the derived calls that function with the
 * arguments, so a derived function stays callable.
 *
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { derived } from "@shadow-js/web";
 *
 * function setup() {
 *   const [count, setCount] = useSignal(2);
 *   const double = derived(() => count() * 2);
 *   console.log(double.value); // 4
 *   setCount(5);
 *   console.log(double()); // 10
 * }
 * @see derived
 * @since 1.0.0
 */
export interface Derived<T> {
  /**
   * Returns the current value, tracked. When the value is a function, calls it with `args` and
   * returns its result instead.
   */
  (...args: unknown[]): unknown;
  /** The current value, tracked: reading it inside an effect or binding subscribes that reader. */
  readonly value: T;
}

/**
 * Wraps a computation as a {@link Derived} value that recomputes only when the signals it reads
 * change. The compiler emits it for `const x = <expression reading signals>` inside components; it
 * is not meant to be written by hand.
 *
 * @param compute The computation. Runs in a memo, so it is tracked and cached between reads.
 * @returns A {@link Derived} whose `value` (and call result) follows `compute`.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { derived } from "@shadow-js/web";
 *
 * function setup() {
 *   const [price] = useSignal(20);
 *   const total = derived(() => price() * 3);
 *   console.log(total.value); // 60
 * }
 * @see Derived
 * @since 1.0.0
 */
export function derived<T>(compute: () => T): Derived<T> {
  const memo = useMemo(compute);
  const read = ((...args: unknown[]): unknown => {
    const current = memo();
    return typeof current === "function"
      ? (current as (...a: unknown[]) => unknown)(...args)
      : current;
  }) as { (...args: unknown[]): unknown; value: T };
  Object.defineProperty(read, "value", { get: memo });
  return read as Derived<T>;
}
