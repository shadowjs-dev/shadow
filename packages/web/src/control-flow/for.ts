import { type Accessor, mapArray, untrack } from "@shadow-js/core";

/**
 * Props of {@link For} without `key`: rows are matched by item reference.
 * @since 1.0.0
 */
export interface ForUnkeyedProps<T> {
  /**
   * The list to render. `null`, `undefined` and `false` count as an empty list. Read lazily, inside
   * the list memo, so it is tracked.
   */
  readonly each: readonly T[] | null | undefined | false;
  /**
   * Shown while the list is empty. Read lazily.
   * @default undefined (an empty list renders nothing)
   */
  readonly fallback?: unknown;
  /**
   * Absent in this form: rows are matched by item reference. Pass `key` to match by key.
   * No default: omit it for reference matching.
   */
  readonly key?: undefined;
  /** Called once per row, untracked. The callback receives the item value. */
  readonly children: (item: T, index: () => number) => unknown;
}

/**
 * Props of {@link For} with `key`: rows are matched by `key(item)`.
 * @since 1.0.0
 */
export interface ForKeyedProps<T> {
  /**
   * The list to render. `null`, `undefined` and `false` count as an empty list. Read lazily, inside
   * the list memo, so it is tracked.
   */
  readonly each: readonly T[] | null | undefined | false;
  /**
   * Shown while the list is empty. Read lazily.
   * @default undefined (an empty list renders nothing)
   */
  readonly fallback?: unknown;
  /** Identifies each item. A new object under the same key updates the row's `item()`. */
  readonly key: (item: T) => unknown;
  /** Called once per row, untracked. The callback receives an accessor of the item. */
  readonly children: (item: () => T, index: () => number) => unknown;
}

/**
 * Props of {@link For}.
 * @since 1.0.0
 */
export type ForProps<T> = ForUnkeyedProps<T> | ForKeyedProps<T>;

/**
 * Calls the row callback. `props.children` is read untracked, once per row.
 * @internal
 */
function renderRow(props: { readonly children: unknown }, item: unknown, index: () => number) {
  const render = untrack(() => props.children) as (item: unknown, index: () => number) => unknown;
  return render(item, index);
}

/**
 * Renders one row per item. Rows whose key survives an update keep their DOM and state; only
 * changed items create or dispose rows. The list is read lazily, inside the list memo.
 *
 * Whether rows are keyed is decided when `For` is created: it reads `key` once. When the list
 * is empty and `fallback` is not given, the result is `[undefined]`, which renders nothing.
 *
 * @param props See {@link ForUnkeyedProps} and {@link ForKeyedProps}.
 * @returns An accessor of the row values, in input order.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { For } from "@shadow-js/web";
 *
 * function TodoList() {
 *   const [todos] = useSignal([{ id: 1, title: "Write docs" }]);
 *   return (
 *     <ul>
 *       <For each={todos()} key={(todo) => todo.id} fallback={<li>Nothing to do</li>}>
 *         {(todo) => <li>{todo().title}</li>}
 *       </For>
 *     </ul>
 *   );
 * }
 * @see Index
 * @since 1.0.0
 */
export function For<T>(props: ForKeyedProps<T>): Accessor<unknown[]>;
export function For<T>(props: ForUnkeyedProps<T>): Accessor<unknown[]>;
export function For<T>(props: ForProps<T>): Accessor<unknown[]> {
  const list = (): readonly T[] | null | undefined | false => props.each;
  const fallback = (): unknown => props.fallback;
  const keyOf = props.key;
  if (keyOf === undefined) {
    return mapArray(list, (item: T, index: () => number) => renderRow(props, item, index), {
      fallback,
    });
  }
  return mapArray(list, (item: () => T, index: () => number) => renderRow(props, item, index), {
    key: keyOf,
    fallback,
  });
}
