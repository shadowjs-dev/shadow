import {
  type Cleanup,
  getOwner,
  onCleanup,
  untrack,
  useMemo,
  useRenderEffect,
} from "@shadow-js/core";

/**
 * Runs `fn` as a render effect: synchronously when created, and again when the signals it reads
 * change. It is the effect the compiler emits for DOM bindings; application code usually prefers
 * `useEffect`. A function returned by `fn` is its cleanup, run before the next run and when the
 * owner disposes. It never runs on the server, and in development an effect created outside an
 * owner warns `NO_OWNER_EFFECT`.
 *
 * @param fn Tracked body. Returns an optional cleanup function.
 * @example
 * import { createRoot, useSignal } from "@shadow-js/core";
 * import { effect } from "@shadow-js/web";
 *
 * const label = document.createElement("span");
 * createRoot(() => {
 *   const [name] = useSignal("Ada");
 *   effect(() => {
 *     label.textContent = name(); // runs now, and again when name changes
 *   });
 * });
 * @see memo
 * @since 1.0.0
 */
export function effect(fn: () => void | Cleanup): void;
/**
 * Two-form render effect: `compute` is tracked and `apply` runs untracked with the new and the
 * previous value. A function returned by `apply` is its cleanup. Use it to keep the tracked reads
 * apart from the code that writes the DOM.
 *
 * @param compute Tracked. Its result is passed to `apply`.
 * @param apply Untracked. Receives the value and the previous value (`undefined` on the first run)
 * and returns an optional cleanup function.
 * @example
 * import { createRoot, useSignal } from "@shadow-js/core";
 * import { effect } from "@shadow-js/web";
 *
 * const title = document.createElement("h1");
 * createRoot(() => {
 *   const [text] = useSignal("Hello");
 *   effect(text, (value, previous) => {
 *     title.textContent = value;
 *     console.log(previous); // undefined on the first run
 *   });
 * });
 * @see memo
 * @since 1.0.0
 */
export function effect<T>(
  compute: () => T,
  apply: (value: T, previous: T | undefined) => void | Cleanup,
): void;
export function effect<T>(
  compute: () => T,
  apply?: (value: T, previous: T | undefined) => void | Cleanup,
): void {
  if (apply === undefined) useRenderEffect(compute);
  else useRenderEffect(compute, apply);
}

/**
 * Creates a cached derivation that recomputes only when the signals it reads change. It is core's
 * `useMemo` under the short name the compiler emits.
 *
 * @param fn The computation. Tracked; its result is cached until a dependency changes.
 * @returns An accessor for the current value.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { memo } from "@shadow-js/web";
 *
 * function setup() {
 *   const [count, setCount] = useSignal(2);
 *   const doubled = memo(() => count() * 2);
 *   setCount(4);
 *   console.log(doubled()); // 8
 * }
 * @see effect
 * @since 1.0.0
 */
export function memo<T>(fn: () => T): () => T {
  return useMemo<T>(fn);
}

/**
 * Applies a directive: calls `fn(el, arg)` untracked, so a directive or a ref never subscribes the
 * surrounding effect to what it reads. A function returned by `fn` is a cleanup, run when the owner
 * disposes.
 *
 * @param fn The directive. Receives the element and the accessor of its argument.
 * @param el The element the directive applies to.
 * @param arg Accessor for the directive's argument. Undefined passes `undefined` through; the
 * directive reads the accessor where it wants to track it.
 * @example
 * import { use } from "@shadow-js/web";
 *
 * function tooltip(el: Element, text: () => string) {
 *   el.setAttribute("title", text());
 * }
 * const button = document.createElement("button");
 * use(tooltip, button, () => "Save the draft");
 * @see refTo
 * @since 1.0.0
 */
export function use<T>(
  fn: (el: Element, arg: () => T) => unknown,
  el: Element,
  arg?: () => T,
): void {
  const cleanup = untrack(() => fn(el, arg as () => T));
  // A ref callback may return a cleanup (React 19): it runs when the owner of the element is disposed.
  if (typeof cleanup === "function") onCleanup(cleanup as Cleanup);
}

/**
 * Fills a ref of any form the compiler accepts. A callback is called with the element (its returned
 * cleanup runs when the owner disposes). A `{ current }` object gets the element as `current`, and
 * `null` once the owner is disposed, as React's `useRef` objects do. Any other value is ignored.
 *
 * @param target The ref value: a callback, a `{ current }` object, or anything else (ignored).
 * @param el The element the ref receives.
 * @example
 * import { refTo } from "@shadow-js/web";
 *
 * const box = { current: null as HTMLDivElement | null };
 * const div = document.createElement("div");
 * refTo(box, div);
 * console.log(box.current === div); // true
 * @see use
 * @since 1.0.0
 */
export function refTo(target: unknown, el: Element): void {
  if (typeof target === "function") {
    use(target as (node: Element, arg: () => unknown) => unknown, el);
    return;
  }
  if (target === null || typeof target !== "object" || !("current" in target)) return;
  const holder = target as { current: unknown };
  holder.current = el;
  if (getOwner() !== null) {
    onCleanup(() => {
      holder.current = null;
    });
  }
}
