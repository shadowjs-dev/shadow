import { type Accessor, batch, currentOwner, handleError } from "./extend";
import { untrack } from "./ownership";
import { useSignal } from "./signal";

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * A state machine for a form-style action: `dispatch(...args)` runs `action(previous, ...args)`,
 * tracks whether it is pending, and commits its result. The ShadowJS form of React's
 * `useActionState` (state, dispatch, pending). `previous` is the last committed state.
 *
 * Only the latest dispatch commits: when two actions overlap, a slower result that settles after a
 * newer dispatch is discarded, so the screen never goes back to an older answer. A failure does not
 * change the state; it clears `pending` and is sent to the owner's error handler (`onError`), so an
 * error boundary can show it. Without an owner the returned promise rejects instead.
 *
 * @param action `(previous, ...args) => next`, synchronous or async. It runs untracked.
 * @param initialState The state before the first dispatch.
 * @returns `[state, dispatch, pending]`. A synchronous result commits at once; `pending` is true
 * only while a returned promise is unsettled. `dispatch` returns a promise that settles when this
 * call has finished, whether it committed or not.
 * @throws Nothing synchronously. Without an owner, the promise returned by `dispatch` rejects with
 * the action's error. With an owner, the error goes to its error handler, or is reported as an
 * uncaught error (`reportError`) when no handler is registered above it.
 * @example
 * import { useAction } from "@shadow-js/core";
 *
 * const [message, send, sending] = useAction(async (_prev: string, text: string) => {
 *   await fetch("/api/messages", { method: "POST", body: text });
 *   return `sent: ${text}`;
 * }, "");
 * void send("hello");
 * console.log(sending(), message());
 * @see useOptimistic
 * @see useTransition
 * @since 1.0.0
 */
export function useAction<S, A extends unknown[]>(
  action: (previous: S, ...args: A) => S | PromiseLike<S>,
  initialState: S,
): [state: Accessor<S>, dispatch: (...args: A) => Promise<void>, pending: Accessor<boolean>] {
  const owner = currentOwner();
  const [state, setState] = useSignal<S>(initialState);
  const [pending, setPending] = useSignal(false);
  let latest = 0;

  const dispatch = (...args: A): Promise<void> => {
    latest += 1;
    const id = latest;
    const previous = untrack(state);
    const commit = (value: S): void => {
      if (id !== latest) return;
      batch(() => {
        setState(() => value);
        setPending(false);
      });
    };
    const fail = (error: unknown): void => {
      // A stale dispatch changes no state, but its error is still the owner's to hear.
      if (id === latest) setPending(false);
      if (owner === null) throw error;
      try {
        handleError(error, owner);
      } catch (uncaught) {
        // No handler took it: report it, as documented, instead of throwing out of dispatch.
        if (typeof reportError === "function") reportError(uncaught);
        else queueMicrotask(() => Promise.reject(uncaught));
      }
    };
    let result: S | PromiseLike<S>;
    try {
      result = untrack(() => action(previous, ...args));
    } catch (error) {
      try {
        fail(error);
      } catch (thrown) {
        // Without an owner the returned promise carries the error.
        return Promise.reject(thrown);
      }
      return Promise.resolve();
    }
    if (!isPromiseLike<S>(result)) {
      commit(result);
      return Promise.resolve();
    }
    setPending(true);
    return Promise.resolve(result).then(commit, fail);
  };
  return [state, dispatch, pending];
}
