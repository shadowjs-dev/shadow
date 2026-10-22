/**
 * The server twin of the client `Derived`: what {@link derived} returns. Nothing is reactive on the
 * server, so it holds the value computed once. Read it as `x.value` or call it as `x()`.
 *
 * @example
 * import { derived } from "@shadow-js/web/server";
 *
 * const total = derived(() => 20 * 3);
 * total.value; // 60
 * total(); // 60
 * @see derived
 * @since 1.0.0
 */
export interface Derived<T> {
  /**
   * Returns the value. When the value is a function, calls it with `args` and returns its result
   * instead, so a derived function stays callable.
   */
  (...args: unknown[]): unknown;
  /** The value `compute` returned. */
  readonly value: T;
}

/**
 * The server twin of the client `derived`, which the compiler emits for `const x = <expression
 * reading signals>` inside a component. On the server it calls `compute` once, immediately, and
 * returns a constant {@link Derived}.
 *
 * @param compute The computation. Runs once, when `derived` is called; an error it throws propagates.
 * @returns A {@link Derived} holding the result.
 * @example
 * import { derived } from "@shadow-js/web/server";
 *
 * const greeting = derived(() => (name: string) => `Hello, ${name}`);
 * greeting("Ada"); // "Hello, Ada": a derived function stays callable
 * @see Derived
 * @since 1.0.0
 */
export function derived<T>(compute: () => T): Derived<T> {
  const current = compute();
  const read = ((...args: unknown[]): unknown =>
    typeof current === "function"
      ? (current as (...a: unknown[]) => unknown)(...args)
      : current) as {
    (...args: unknown[]): unknown;
    value: T;
  };
  Object.defineProperty(read, "value", { value: current });
  return read as Derived<T>;
}
