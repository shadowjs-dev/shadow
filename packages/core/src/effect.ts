import { type Cleanup, createComputation, currentOwner, warn } from "./extend";
import { untrack } from "./ownership";

/**
 * Options of {@link useEffect} in its tracking form `useEffect(fn, options)`.
 * @since 1.0.0
 */
export interface EffectOptions {
  /**
   * Label shown by devtools and diagnostics.
   * @default undefined (the effect is unnamed)
   */
  name?: string;
}

/**
 * Options of {@link useEffect} in its explicit-dependency form `useEffect(deps, fn, options)`.
 * @since 1.0.0
 */
export interface DeferredEffectOptions extends EffectOptions {
  /**
   * Skip the first call of `fn`: `deps` is still read (and tracked) on the first run, but `fn` only
   * runs for later changes of it.
   * @default false
   */
  defer?: boolean;
}

function createEffect(
  fnIn: (previous: never) => unknown,
  applyIn: ((value: never, previous: never) => unknown) | null,
  render: boolean,
  deferIn: boolean,
  name: string | undefined,
): void {
  // Effects never run on the server (G-24): no node, no ownership slot, no cost.
  if (__SERVER__) return;
  if (__DEV__ && currentOwner() === null) warn("NO_OWNER_EFFECT");
  let fn = fnIn;
  let apply = applyIn;
  let defer = deferIn;
  const gate = render ? null : (currentOwner()?.gate ?? null);
  if (gate !== null) {
    // Held until the gate first opens (a Suspense boundary resolving). The gate is only read until
    // then, so later changes of it never re-run the effect. `closed` is what the latest run of `fn`
    // found: `apply` runs right after it, and does nothing for a run that was held.
    let opened = false;
    let closed = false;
    const innerFn = fn;
    const innerApply = apply;
    // `defer` skips the first real run, not the held one, so it is handled here.
    let skipFirst = defer;
    defer = false;
    fn = (previous) => {
      closed = !opened && gate();
      opened ||= !closed;
      return closed ? undefined : innerFn(previous);
    };
    if (innerApply !== null) {
      apply = (value, previous) => {
        if (closed) return undefined;
        if (!skipFirst) return innerApply(value, previous);
        skipFirst = false;
        return undefined;
      };
    }
  }
  createComputation({
    kind: "effect",
    fn,
    render,
    defer,
    apply: apply ?? undefined,
    name,
  });
}

/**
 * Runs a side effect after rendering and again whenever a tracked signal changes. The first run
 * is deferred to the next flush. Effects never run on the server. Inside a `<Suspense>` boundary
 * that is still showing its fallback, the first run waits until the boundary first shows its content.
 *
 * Two forms: `useEffect(fn)` tracks everything `fn` reads; `useEffect(deps, fn)` tracks only
 * `deps` and runs `fn` untracked. Return a function to clean up before the next run or disposal.
 * An error thrown by the effect goes to the owner's error handler (`onError`, an error boundary).
 * In development, an effect created outside any owner warns `NO_OWNER_EFFECT`: it still runs, but
 * nothing can dispose it.
 *
 * @param fn The effect. Every signal it reads is tracked. It may return a cleanup function.
 * @param options A devtools name. Undefined uses the default.
 * @example
 * import { useEffect, useSignal } from "@shadow-js/core";
 *
 * function PageTitle(props: { unread: number }) {
 *   const [title] = useSignal("Inbox");
 *   useEffect(() => {
 *     document.title = `${title()} (${props.unread})`; // re-runs when either changes
 *   });
 *   return null;
 * }
 * @see useRenderEffect
 * @see onMount
 * @since 1.0.0
 */
export function useEffect(fn: () => void | Cleanup, options?: EffectOptions): void;
/**
 * Explicit-dependency form of {@link useEffect}: tracks only what `deps` reads, and calls `fn`
 * untracked with the new and the previous value of `deps`. Use it when the effect body reads
 * signals that must not re-run it.
 *
 * @param deps Tracked; its result is passed to `fn`.
 * @param fn Untracked; receives the value of `deps` and its previous value (`undefined` when there
 * is none yet). It may return a cleanup function, which runs before the next call or on disposal.
 * @param options `defer` skips the first call; a devtools name. Undefined uses the defaults.
 * @example
 * import { useEffect } from "@shadow-js/core";
 *
 * function Profile(props: { userId: string }) {
 *   useEffect(
 *     () => props.userId,
 *     (next, previous) => console.log(`switched from ${previous} to ${next}`),
 *     { defer: true }, // not called for the first id
 *   );
 *   return null;
 * }
 * @see useEffect
 * @since 1.0.0
 */
export function useEffect<T>(
  deps: () => T,
  fn: (value: T, previous: T | undefined) => void | Cleanup,
  options?: DeferredEffectOptions,
): void;
export function useEffect(
  first: () => unknown,
  second?: unknown,
  third?: DeferredEffectOptions,
): void {
  if (typeof second === "function") {
    createEffect(
      first,
      second as (value: never, previous: never) => unknown,
      false,
      third?.defer === true,
      third?.name,
    );
  } else {
    if (Array.isArray(second)) warn("EFFECT_DEPS_IGNORED");
    createEffect(first, null, false, false, (second as EffectOptions | undefined)?.name);
  }
}

/**
 * Like {@link useEffect} but belongs to the render phase: it runs synchronously when created and
 * before user effects on every flush. Used for DOM bindings; application code rarely needs it.
 * It is not held by a pending `<Suspense>` boundary, and it never runs on the server. In
 * development, one created outside any owner warns `NO_OWNER_EFFECT`.
 *
 * @param compute Tracked; its result is passed to `apply`. Without `apply`, it is the effect itself
 * and may return a cleanup function.
 * @param apply Untracked; receives the value and the previous value (`undefined` on the first
 * run), and may return a cleanup function. Undefined: only `compute` runs.
 * @example
 * import { createRoot, useRenderEffect, useSignal } from "@shadow-js/core";
 *
 * const button = document.createElement("button");
 * createRoot(() => {
 *   const [label] = useSignal("Save");
 *   useRenderEffect(label, (text) => {
 *     button.textContent = text; // runs now, and again when label changes
 *   });
 * });
 * @see useEffect
 * @since 1.0.0
 */
export function useRenderEffect<T>(
  compute: () => T,
  apply?: (value: T, previous: T | undefined) => void | Cleanup,
): void {
  createEffect(
    compute,
    (apply ?? null) as ((value: never, previous: never) => unknown) | null,
    true,
    false,
    undefined,
  );
}

/**
 * Runs `fn` once after the owner has been created and flushed, untracked, so signal changes never
 * run it again. Its return value, if a function, is the cleanup, which runs when the owner is
 * disposed. Never runs on the server. Like {@link useEffect}, it waits for a pending `<Suspense>`
 * boundary to show its content, and warns `NO_OWNER_EFFECT` in development outside any owner.
 *
 * @param fn Runs once, untracked. It may return a cleanup function.
 * @example
 * import { onMount } from "@shadow-js/core";
 *
 * function SearchBox() {
 *   let input: HTMLInputElement | undefined;
 *   onMount(() => input?.focus());
 *   return <input ref={(el: HTMLInputElement) => (input = el)} />;
 * }
 * @see useEffect
 * @since 1.0.0
 */
export function onMount(fn: () => void | Cleanup): void {
  createEffect(() => untrack(fn), null, false, false, "onMount");
}
