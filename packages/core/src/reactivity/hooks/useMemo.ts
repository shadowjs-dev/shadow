import { useEffect } from "./useEffect";
import { useStore, type Store } from "./useStore";
import { ERRORS } from "../../errors";

/**
 * Memoize a computed value reactively.
 *
 * `useMemo` creates a reactive store that automatically updates whenever the
 * computation function's dependencies change. Unlike `useEffect`, `useMemo`
 * returns a reactive value that can be used in JSX expressions.
 *
 * The memoized value is computed immediately and updates reactively based on
 * any reactive dependencies accessed during the computation.
 *
 * @param fn - Function that computes the memoized value. This function should
 *             be pure and return the value to be memoized.
 * @returns A reactive store containing the memoized value. The returned store
 *          can be called as a getter and will automatically update when dependencies change.
 *
 * @example
 * ```tsx
 * function ExpensiveComponent({ items }) {
 *   // Memoize expensive computation
 *   const sortedItems = useMemo(() => {
 *     console.log("Sorting items...");
 *     return [...items()].sort((a, b) => a.name.localeCompare(b.name));
 *   });
 *
 *   return (
 *     <ul>
 *       <For each={sortedItems()}>
 *         {(item) => <li>{item.name}</li>}
 *       </For>
 *     </ul>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Memoizing complex calculations
 * function StatsComponent({ data }) {
 *   const average = useMemo(() => {
 *     const values = data().map(item => item.value);
 *     return values.reduce((sum, val) => sum + val, 0) / values.length;
 *   });
 *
 *   const max = useMemo(() => {
 *     return Math.max(...data().map(item => item.value));
 *   });
 *
 *   return (
 *     <div>
 *       <p>Average: {average()}</p>
 *       <p>Maximum: {max()}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useMemo<T>(fn: () => T): Store<T> {
  if (typeof fn !== "function") {
    throw ERRORS.HOOK_INVALID_ARGUMENT("useMemo", "fn", "function");
  }

  const [get, set] = useStore<T>(fn());

  useEffect(() => {
    set(fn());
  });

  return get;
}
