import type { Accessor, Equals } from "./extend";
import { useSignal } from "./signal";

/** Options of {@link useReducer}. @since 1.0.0 */
export interface ReducerOptions {
  /**
   * Decides whether a new state is a change: readers are notified only when it returns `false`.
   * @default Object.is
   */
  equals?: Equals<unknown>;
  /**
   * Label shown by devtools and diagnostics.
   * @default undefined (the state is unnamed)
   */
  name?: string;
}

/**
 * A state cell whose writes go through a reducer: `dispatch(action)` stores
 * `reducer(state, action)`. Equivalent to `useSignal` with the transition written in one place,
 * which keeps every state change of a complex value (a form, a queue) in one function. Reads are
 * fresh immediately after `dispatch`, like every write.
 *
 * @param reducer Pure function `(state, action) => next`.
 * @param initialState Starting state, stored as is.
 * @param options Equality override and a devtools name. Undefined uses the defaults.
 * @returns `[state, dispatch]`; `state()` tracks, `dispatch(action)` returns nothing. The reducer
 * runs untracked, once per dispatch.
 * @throws ShadowError `WRITE_IN_MEMO` from `dispatch`, in development builds only, when it is called
 * while a {@link useMemo} computation runs. `dispatch` also rethrows what the reducer throws.
 * @example
 * import { useReducer } from "@shadow-js/core";
 *
 * type Action = "inc" | "dec";
 * const [count, dispatch] = useReducer((n: number, a: Action) => (a === "inc" ? n + 1 : n - 1), 0);
 * dispatch("inc");
 * console.log(count()); // 1
 * @see useSignal
 * @since 1.0.0
 */
export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialState: S,
  options?: ReducerOptions,
): [Accessor<S>, (action: A) => void] {
  const [state, setState] = useSignal<S>(initialState, {
    equals: (options?.equals ?? Object.is) as Equals<S>,
    name: options?.name,
  });
  const dispatch = (action: A): void => {
    setState((previous) => reducer(previous, action));
  };
  return [state, dispatch];
}
