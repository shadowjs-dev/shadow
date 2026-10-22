import { untrack } from "./ownership";

/**
 * A stable callback that always runs its handler untracked. The ShadowJS form of React's
 * `useEffectEvent`: components run once and props are getters, so the handler already sees the
 * latest values. What it adds is the untracked call: an effect that calls the event does not
 * subscribe to the signals the handler reads.
 *
 * @param handler The handler. Its arguments and result are passed through.
 * @returns A new function with the same signature that calls `handler` untracked. Create it once,
 * in the component body, and keep the reference.
 * @example
 * import { useEffect, useEvent, useSignal } from "@shadow-js/core";
 *
 * function Ticker() {
 *   const [count] = useSignal(0);
 *   const onTick = useEvent(() => console.log(count())); // count() is not tracked by the effect
 *   useEffect(() => {
 *     const id = setInterval(() => onTick(), 1000);
 *     return () => clearInterval(id);
 *   });
 *   return null;
 * }
 * @see untrack
 * @since 1.0.0
 */
export function useEvent<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => untrack(() => handler(...args));
}
