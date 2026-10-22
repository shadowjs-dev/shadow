import { onCleanup, untrack } from "./ownership";

/**
 * A ref object that is also a ref callback: pass it as `ref={r}` (the renderer calls it with the
 * element) and read the element as `r.current`. `undefined` when nothing is attached.
 * @since 1.0.0
 */
export interface Ref<T> {
  /** Stores `value` as `current`; `undefined` clears it. The renderer calls it with the element. */
  (value: T | undefined): void;
  /** The value last passed to the ref, or `undefined` when nothing is attached. Not reactive. */
  readonly current: T | undefined;
}

/**
 * Creates a {@link Ref}. Calling it with a value stores the value; calling it with `undefined`
 * clears it. The same object works as a plain ref callback, so no `forwardRef` is needed.
 * @returns A callable ref with a `current` getter, `undefined` until the ref is called.
 * @example
 * import { createRef } from "@shadow-js/core";
 *
 * function SearchBox() {
 *   const input = createRef<HTMLInputElement>();
 *   return <input ref={input} onKeyDown={() => input.current?.select()} />;
 * }
 * @see useImperativeHandle
 * @since 1.0.0
 */
export function createRef<T>(): Ref<T> {
  let current: T | undefined;
  const ref = ((value: T | undefined): void => {
    current = value;
  }) as Ref<T>;
  Object.defineProperty(ref, "current", { get: () => current, enumerable: true });
  return ref;
}

/**
 * Publishes an imperative handle to a ref: `create()` runs once, untracked, and its result is
 * passed to `ref`; when the owner is disposed `ref` receives `undefined`. Components run once, so
 * the handle never needs refreshing: put live state behind accessors inside the handle.
 *
 * A missing `ref` is accepted and `create` does not run, so forwarding an optional ref needs no
 * branch.
 *
 * @param ref The ref callback (a {@link Ref}, or any function of the handle). `null` or `undefined`
 * makes the call a no-op.
 * @param create Builds the handle. Runs once, untracked.
 * @example
 * import { createRef, useImperativeHandle } from "@shadow-js/core";
 *
 * function FancyInput(props: { ref?: (handle: { focus(): void } | undefined) => void }) {
 *   const input = createRef<HTMLInputElement>();
 *   useImperativeHandle(props.ref, () => ({ focus: () => input.current?.focus() }));
 *   return <input ref={input} />;
 * }
 * @see createRef
 * @since 1.0.0
 */
export function useImperativeHandle<T>(
  ref: ((value: T | undefined) => void) | null | undefined,
  create: () => T,
): void {
  if (ref === undefined || ref === null) return;
  ref(untrack(create));
  onCleanup(() => ref(undefined));
}
