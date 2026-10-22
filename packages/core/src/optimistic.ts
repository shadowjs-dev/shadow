import type { Accessor } from "./extend";
import { useMemo } from "./memo";
import { useSignal } from "./signal";

/**
 * Optimistic state: shows `reducer` applied over the real value for every action whose
 * `settled` promise is still pending. When the promise settles (either way) the action is
 * dropped and the view falls back to the real source, which is where the confirmed result lives.
 *
 * @param source The authoritative value, tracked.
 * @param reducer Pure function combining the current state with one pending action. It runs for
 * every pending action, in the order they were applied, each time the state recomputes.
 * @returns `[state, apply]`. `state` is a memo; `apply(action, settled)` adds the action at once
 * and drops it when `settled` resolves or rejects. Pass the mutation's promise as `settled`.
 * @example
 * import { useOptimistic, useSignal } from "@shadow-js/core";
 *
 * const [todos, setTodos] = useSignal<string[]>([]);
 * const [shown, addTodo] = useOptimistic(todos, (list, text: string) => [...list, text]);
 * const save = (text: string) =>
 *   fetch("/api/todos", { method: "POST", body: text }).then(() => setTodos((l) => [...l, text]));
 * addTodo("milk", save("milk")); // shown() includes "milk" at once
 * @see useAction
 * @since 1.0.0
 */
export function useOptimistic<T, A>(
  source: Accessor<T>,
  reducer: (state: T, action: A) => T,
): [Accessor<T>, (action: A, settled: Promise<unknown>) => void] {
  const [pending, setPending] = useSignal<ReadonlyArray<{ action: A }>>([]);
  const state = useMemo(() => {
    let current = source();
    for (const entry of pending()) current = reducer(current, entry.action);
    return current;
  });
  const apply = (action: A, settled: Promise<unknown>): void => {
    const entry = { action };
    setPending((list) => [...list, entry]);
    const drop = (): void => {
      setPending((list) => list.filter((item) => item !== entry));
    };
    settled.then(drop, drop);
  };
  return [state, apply];
}
