import { type Accessor, indexArray, untrack } from "@shadow-js/core";

/**
 * Props of {@link Index}.
 * @since 1.0.0
 */
export interface IndexProps<T> {
  /**
   * The list to render. `null`, `undefined` and `false` count as an empty list. Read lazily, so it
   * is tracked.
   */
  readonly each: readonly T[] | null | undefined | false;
  /**
   * Shown while the list is empty. Read lazily.
   * @default undefined (an empty list renders nothing)
   */
  readonly fallback?: unknown;
  /**
   * Called once per position, untracked. The item is an accessor that follows the value at this
   * position; the index is a plain number, because a position never changes.
   */
  readonly children: (item: () => T, index: number) => unknown;
}

/**
 * Renders one row per position. Rows are created and removed only when the length changes; the
 * row at position `i` stays, and its item accessor follows the value at `i`. Use it for
 * primitive lists where identity does not matter.
 *
 * @param props See {@link IndexProps}.
 * @returns An accessor of the row values, in input order.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { Index } from "@shadow-js/web";
 *
 * function Cells() {
 *   const [values] = useSignal([10, 20, 30]);
 *   return (
 *     <ul>
 *       <Index each={values()}>{(value, index) => <li>{`${index}: ${value()}`}</li>}</Index>
 *     </ul>
 *   );
 * }
 * @see For
 * @since 1.0.0
 */
export function Index<T>(props: IndexProps<T>): Accessor<unknown[]> {
  return indexArray(
    () => props.each,
    (item: () => T, index: number) => untrack(() => props.children)(item, index),
    { fallback: () => props.fallback },
  );
}
