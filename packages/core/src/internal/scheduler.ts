import { DEVTOOLS_EVENT, report } from "./devtools";
import { ShadowError, warn } from "./diagnostics";
import { DIRTY, FLAG_DISPOSED, FLAG_PARKED, FLAG_QUEUED, FLAG_TRANSITION } from "./flags";
import type { Computation } from "./graph";
import { recompute, refreshAncestors, updateIfNecessary } from "./graph";
import { handleError } from "./owner";
import { clearQueues, hasPending, renderQueue, userQueue } from "./queue";
import { rt } from "./state";

/**
 * Flush passes allowed before the loop guard aborts (R-CODE-12).
 * @internal
 */
export const MAX_FLUSH_PASSES = 1000;

let microtaskScheduled = false;

/**
 * Sort order of queued effects: parents before children (by depth), siblings by creation (G-16).
 * @internal
 */
export function byCreation(a: Computation, b: Computation): number {
  return a.depth - b.depth || a.seq - b.seq;
}

/**
 * Runs one queued effect. Its stale owners come first: an owner that is about to re-run disposes the
 * effect, and running it before (a zombie, G-17) would read state that is already out of date.
 * @internal
 */
export function runQueued(effect: Computation): void {
  try {
    if (!refreshAncestors(effect)) return;
    // A directly dirtied effect needs no source verification: skip the frame machinery.
    if (effect.state === DIRTY) recompute(effect);
    else updateIfNecessary(effect);
  } catch (error) {
    handleError(error, effect);
  }
}

/** Runs every queued effect of one phase, parents before children, siblings by creation. */
function drain(queue: Computation[]): number {
  const batch = queue.splice(0, queue.length);
  // Effects mostly arrive in creation order already: the sort then finds one ascending run and is O(n).
  batch.sort(byCreation);
  for (const effect of batch) {
    effect.flags &= ~FLAG_QUEUED;
    if ((effect.flags & FLAG_DISPOSED) !== 0) continue;
    if (effect.pauses > 0) {
      // Paused after it was queued: wait (unqueued) until the owner resumes.
      effect.flags = (effect.flags & ~FLAG_TRANSITION) | FLAG_PARKED;
      continue;
    }
    runQueued(effect);
  }
  return batch.length;
}

function raise(errors: unknown[]): void {
  const [first] = errors;
  if (errors.length === 1) throw first;
  throw new AggregateError(
    errors,
    __DEV__ ? "Several errors were thrown while flushing effects." : "SHADOW_FLUSH_ERRORS",
  );
}

/**
 * Runs every pending effect now: what the scheduled microtask does. Drains the queues until nothing
 * is pending; render effects always run before user effects, parents before children, siblings by
 * creation, and effects woken by a write in the flush run in a following pass. Errors nobody handled
 * are collected and thrown once the queues are empty, so one failing effect never wedges the rest.
 * Does nothing when a flush is already running. Transition-lane effects are not run here: they wait
 * for the lane. Prefer {@link flushSync} in application code.
 *
 * @throws The error of an effect that no error handler caught; several are thrown together as an
 * `AggregateError`.
 * @throws ShadowError `INFINITE_LOOP` when effects keep waking each other for more than 1000 passes:
 * the queued effects are dropped and the flush stops.
 * @example
 * import { flush, writeSignal, type SignalNode } from "@shadow-js/core/extend";
 *
 * export function setNow(signal: SignalNode<number>, value: number): void {
 *   writeSignal(signal, value);
 *   flush(); // the effects that read the signal have run
 * }
 * @see flushSync
 * @since 1.0.0
 */
export function flush(): void {
  if (rt.flushing) return;
  rt.flushing = true;
  let passes = 0;
  let runs = 0;
  if (__DEV__) report(DEVTOOLS_EVENT.FLUSH_START, renderQueue.length, userQueue.length);
  try {
    while (hasPending()) {
      // Render effects first, and until none is left; render passes count too: a render effect that
      // keeps writing its own source must abort.
      passes += 1;
      if (passes > MAX_FLUSH_PASSES) {
        clearQueues();
        rt.uncaught.push(new ShadowError("INFINITE_LOOP"));
        break;
      }
      const ran = drain(renderQueue.length > 0 ? renderQueue : userQueue);
      if (__DEV__) runs += ran;
    }
  } finally {
    rt.flushing = false;
    if (__DEV__) report(DEVTOOLS_EVENT.FLUSH_END, runs);
  }
  const errors = rt.uncaught;
  if (errors.length > 0) {
    rt.uncaught = [];
    raise(errors);
  }
}

/**
 * Surfaces an error from the microtask flush where nothing can catch it.
 * @internal
 */
export function reportUncaught(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else queueMicrotask(() => Promise.reject(error));
}

function runScheduled(): void {
  microtaskScheduled = false;
  if (!hasPending()) return;
  try {
    flush();
  } catch (error) {
    reportUncaught(error);
  }
}

/**
 * Requests a flush in a microtask: call it after marking observers stale by hand, as
 * {@link markObservers} does not. Does nothing when a microtask flush is already due, inside a
 * batch or group (which flushes or schedules on exit), during a flush (which picks the work up), or
 * during a transition (its effects wait for the lane). An error thrown by that flush has no caller
 * to reach: it goes to the global `reportError`, or becomes an unhandled promise rejection.
 *
 * @example
 * import { markObservers, schedule, type SourceNode } from "@shadow-js/core/extend";
 *
 * export function touch(source: SourceNode): void {
 *   markObservers(source);
 *   schedule(); // the effects that read `source` run in a microtask
 * }
 * @see notify
 * @since 1.0.0
 */
export function schedule(): void {
  // A transition write waits for the lane (scheduled when the effect is queued), never for a microtask.
  if (rt.inTransition || rt.batches > 0 || rt.flushing || microtaskScheduled) return;
  microtaskScheduled = true;
  queueMicrotask(runScheduled);
}

/**
 * Groups writes like {@link batch} but never flushes synchronously: when the outermost group ends,
 * the effects wait for the microtask (or an enclosing batch / `flushSync`), exactly as after a
 * single signal write. Store setters use it so that one `setStore(...)` behaves like one `set()`;
 * use it for a primitive whose one call makes several writes.
 *
 * @param fn The writes to group. Its throw is rethrown after the group ends.
 * @returns What `fn` returns.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { group } from "@shadow-js/core/extend";
 *
 * const [first, setFirst] = useSignal("Ada");
 * const [last, setLast] = useSignal("Lovelace");
 * group(() => {
 *   setFirst("Grace");
 *   setLast("Hopper");
 * }); // effects reading both run once, in the next microtask
 * @see batch
 * @since 1.0.0
 */
export function group<T>(fn: () => T): T {
  rt.batches += 1;
  try {
    return fn();
  } finally {
    rt.batches -= 1;
    if (rt.batches === 0 && hasPending()) schedule();
  }
}

/**
 * Flushes when `wanted`, then rethrows `failure` when `failed`. A failing flush is thrown on its own, or
 * together with `failure` (an `AggregateError` with `message`) when both threw.
 * @internal
 */
export function flushThenThrow(
  wanted: boolean,
  failed: boolean,
  failure: unknown,
  message: string,
): void {
  if (wanted) {
    try {
      flush();
    } catch (error) {
      if (!failed) throw error;
      throw new AggregateError([failure, error], message);
    }
  }
  if (failed) throw failure;
}

/**
 * The body `batch` and `flushSync` share: runs `fn` with the effects deferred, then flushes (always when
 * `sync`, else when this was the outermost batch and no flush is running). A throw of `fn` is held until
 * the flush has run, and thrown with the flush's own error as an `AggregateError` when both threw.
 */
function runBatched<T>(fn: (() => T) | undefined, sync: boolean): T {
  rt.batches += 1;
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    result = fn === undefined ? undefined : fn();
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    rt.batches -= 1;
  }
  flushThenThrow(
    sync || (rt.batches === 0 && !rt.flushing && hasPending()),
    failed,
    failure,
    __DEV__ ? "Both the callback and the flush threw." : "SHADOW_BATCH_ERRORS",
  );
  return result as T;
}

/**
 * Runs `fn` with effects deferred until the outermost batch ends, then runs them synchronously, so
 * several writes wake each effect once. Reads inside the batch always see fresh values (G-6). Inside
 * a running flush the effects are left to that flush.
 *
 * @param fn The writes to batch.
 * @returns What `fn` returns.
 * @throws What `fn` throws, after the flush. An error of the flush is thrown as {@link flush} throws
 * it (including ShadowError `INFINITE_LOOP`); when `fn` threw as well, both are thrown together as an
 * `AggregateError`.
 * @example
 * import { batch, useSignal } from "@shadow-js/core";
 *
 * const [first, setFirst] = useSignal("Ada");
 * const [last, setLast] = useSignal("Lovelace");
 * batch(() => {
 *   setFirst("Grace");
 *   setLast("Hopper");
 * }); // effects reading both have run once, here
 * @see flushSync
 * @since 1.0.0
 */
export function batch<T>(fn: () => T): T {
  return runBatched(fn, false);
}

/**
 * Runs `fn` (optional) in a batch and runs every pending effect before returning, so the DOM and
 * other effects are up to date on the next line. Use it in tests and before reading layout. Called
 * while a flush is running (from inside an effect), it only runs `fn` and leaves the effects to that
 * flush; development builds warn `FLUSH_IN_EFFECT`.
 *
 * @param fn The writes to make first. Undefined only flushes.
 * @returns What `fn` returns, or undefined without `fn`.
 * @throws What `fn` throws, after the flush. An error of the flush is thrown as {@link flush} throws
 * it (including ShadowError `INFINITE_LOOP`); when `fn` threw as well, both are thrown together as an
 * `AggregateError`.
 * @example
 * import { createRoot, flushSync, useEffect, useSignal } from "@shadow-js/core";
 *
 * createRoot(() => {
 *   const [count, setCount] = useSignal(0);
 *   useEffect(() => console.log(count()));
 *   flushSync(); // logs 0
 *   flushSync(() => setCount(1)); // logs 1 before this line ends
 * });
 * @see batch
 * @since 1.0.0
 */
export function flushSync<T = void>(fn?: () => T): T {
  if (rt.flushing) {
    warn("FLUSH_IN_EFFECT");
    return (fn === undefined ? undefined : fn()) as T;
  }
  return runBatched(fn, true);
}
