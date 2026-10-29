import { type Accessor, createComputation, type Equals, readComputation } from "./extend";

/**
 * Options of {@link useMemo}.
 * @since 1.0.0
 */
export interface MemoOptions<T> {
  /**
   * Decides whether a recomputation changed the value: readers are notified only when it returns
   * `false`. `false` always propagates. It runs untracked: a signal it reads is not a dependency of
   * the memo or of the reader that pulled it.
   * @default Object.is
   */
  equals?: Equals<T>;
  /**
   * Skip the initial computation until the first read. Without it the memo computes once when it
   * is created.
   * @default false
   */
  lazy?: boolean;
  /**
   * Label shown by devtools and diagnostics.
   * @default undefined (the memo is unnamed)
   */
  name?: string;
  /**
   * Turn off the development check that rejects signal writes while this memo computes. Set it for
   * a memo that builds children (components, `ref` callbacks, directives), where the code that runs
   * is setup and may write a counter or a registry; the control-flow components do. A memo that
   * derives a value must leave it off.
   * @default false
   */
  allowWrites?: boolean;
}

/**
 * Creates a cached derivation that recomputes only when a dependency actually changed.
 * Dependencies are discovered on every run, so branches that are not taken are not tracked.
 * A memo that throws inside an error boundary (an ancestor `onError` or `catchError`) reports the
 * error there and keeps its previous value; without a boundary it stores the error and rethrows it
 * to every reader.
 *
 * @param fn Computation; receives the previous value (`undefined` on the first run).
 * @param options Equality override, `lazy`, `allowWrites` and a devtools name. Undefined uses the
 * defaults.
 * @returns An accessor returning the current, always fresh value.
 * @throws ShadowError `CYCLE_DETECTED` from the accessor when the memo reads itself while it
 * computes. Outside an error boundary the accessor also rethrows the error `fn` threw on its last
 * run.
 * @example
 * import { useMemo, useSignal } from "@shadow-js/core";
 *
 * const [count, setCount] = useSignal(2);
 * const doubled = useMemo(() => count() * 2);
 * setCount(5);
 * console.log(doubled()); // 10
 * @see useSignal
 * @since 1.0.0
 */
export function useMemo<T>(
  fn: (previous: T | undefined) => T,
  options?: MemoOptions<T>,
): Accessor<T> {
  const node = createComputation({
    kind: "memo",
    fn: fn as (previous: never) => unknown,
    equals: options?.equals as Equals<unknown> | undefined,
    lazy: options?.lazy,
    allowWrites: options?.allowWrites,
    name: options?.name,
  });
  return () => readComputation<T>(node);
}
