import { useEffect } from "./useEffect";
import { useStore, type Store } from "./useStore";
import { ERRORS } from "../../errors";

type Reducer<State, Action> = (state: State, action: Action) => State;

// Type guard to detect Shadow store
function isStore<T>(value: unknown): value is Store<T> {
  return (
    typeof value === "function" &&
    (value as { __isStore?: boolean }).__isStore === true
  );
}

/**
 * Create an optimistic state derived from a base state (store or plain value).
 *
 * Overloads:
 * - useOptimistic(baseStoreOrValue)
 * - useOptimistic(baseStoreOrValue, reducer)
 *
 * @param base Base state as a Store<T> or a plain value.
 * @param reducer Optional reducer to compute next optimistic state from action.
 * @returns [optimisticStore, dispatchOrSet]
 */
export function useOptimistic<T>(
  base: Store<T>
): [Store<T>, (nextState: T) => void];
export function useOptimistic<T, A>(
  base: Store<T>,
  reducer: Reducer<T, A>
): [Store<T>, (action: A) => void];
export function useOptimistic<T>(base: T): [Store<T>, (nextState: T) => void];
export function useOptimistic<T, A>(
  base: T,
  reducer: Reducer<T, A>
): [Store<T>, (action: A) => void];

export function useOptimistic<T, A>(
  base: T | Store<T>,
  reducer?: Reducer<T, A>
): [Store<T>, (arg: A | T) => void] {
  if (reducer !== undefined && typeof reducer !== "function") {
    throw ERRORS.HOOK_INVALID_REDUCER("useOptimistic");
  }

  const getBaseValue = () => (isStore<T>(base) ? base() : (base as T));
  const [optimistic, setOptimistic] = useStore<T>(getBaseValue());

  // Keep optimistic state in sync with base if base is a store
  useEffect(() => {
    if (isStore<T>(base)) {
      setOptimistic(base());
    }
  });

  // Update either via reducer or direct set
  const apply = (arg: A | T) => {
    if (reducer) {
      setOptimistic(reducer(optimistic(), arg as A));
    } else {
      setOptimistic(arg as T);
    }
  };

  return [optimistic, apply];
}
