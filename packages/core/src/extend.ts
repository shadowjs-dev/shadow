/**
 * The extension API: everything the built-in hooks (`useSignal`, `useMemo`, `useEffect`,
 * `useStore`, `useResource`, `mapArray`, `useSelector`, contexts, ...) are built from. They import
 * ONLY this module, never the engine internals, so a third-party package can create hooks with the
 * same behavior, performance and diagnostics. A test (`public-api.test.ts`) enforces that.
 *
 * Import from `@shadow-js/core/extend`. These functions are stable but low level: prefer the hooks
 * unless you are building a new primitive.
 *
 * @packageDocumentation
 */

import { DEVTOOLS_EVENT, report } from "./internal/devtools";
import { ShadowError } from "./internal/diagnostics";
import {
  FLAG_ALLOW_WRITES,
  FLAG_DEFER,
  FLAG_LANE,
  FLAG_RENDER,
  FLAG_UNINIT,
  KIND_EFFECT,
  KIND_MEMO,
} from "./internal/flags";
import {
  Computation,
  hasObservers,
  markObservers,
  observersOf,
  readMemo,
  readSignal,
  recompute,
  Signal,
  type Source,
  sourcesOf,
  track,
  updateIfNecessary,
} from "./internal/graph";
import { type Owner, Owner as OwnerClass } from "./internal/owner";
import { enqueue } from "./internal/queue";
import { schedule } from "./internal/scheduler";
import { rt } from "./internal/state";
import type { Equals } from "./internal/types";

export { runWithContext } from "./context";
export {
  beginHold,
  createTransitionHold,
  endHold,
  holdReader,
  inTransition,
  pauseOwner,
  registerTransitionLane,
  resumeOwner,
  startTransition,
  transitionHooks,
  wakeSuspended,
} from "./internal/concurrency";
export { DEVTOOLS_EVENT, report as devtoolsReport } from "./internal/devtools";
export type { WarningListener } from "./internal/diagnostics";
export { resetWarningDedupe, ShadowError, setWarningListener, warn } from "./internal/diagnostics";
export { disposeTree as disposeOwner } from "./internal/dispose";
export { isHydrating, withHydration } from "./internal/hydration-flag";
export type { MessageCode } from "./internal/messages";
export { formatMessage, MESSAGES } from "./internal/messages";
export type { ContextMap } from "./internal/owner";
export { addCleanup, handleError, Owner } from "./internal/owner";
export { batch, flush, flushSync, group } from "./internal/scheduler";
export type {
  BoundaryHold,
  SlotBranch,
  SlotChoice,
  SlotOwned,
  SlotState,
  SlotSwap,
  TransitionHold,
} from "./internal/state";
export { isSuspension, SUSPENSION } from "./internal/suspension";
export type {
  Accessor,
  AnyFunction,
  Cleanup,
  Equals,
  ErrorHandler,
  Setter,
} from "./internal/types";
export type { Source as SourceNode };
export { Computation as ComputationNode, Signal as SignalNode };

// ---------- registers ----------

/**
 * Returns the owner that adopts nodes created right now. The extension-API form of `getOwner`: use
 * it in a primitive that attaches a node or a cleanup to its caller's owner.
 *
 * @returns The current owner, or `null` outside any owner.
 * @example
 * import { addCleanup, currentOwner } from "@shadow-js/core/extend";
 *
 * function useInterval(fn: () => void, ms: number): void {
 *   const timer = setInterval(fn, ms);
 *   const owner = currentOwner();
 *   if (owner !== null) addCleanup(owner, () => clearInterval(timer));
 * }
 * @see createOwner
 * @since 1.0.0
 */
export function currentOwner(): Owner | null {
  return rt.owner;
}

/**
 * Returns the computation that records reads right now. Use it in a primitive whose read behaves
 * differently for a tracked reader, for example one that holds a boundary only for a listening
 * memo or effect.
 *
 * @returns The listening memo or effect, or `null` when reads are untracked.
 * @example
 * import { currentListener } from "@shadow-js/core/extend";
 *
 * function readWithStats<T>(read: () => T, stats: { tracked: number }): T {
 *   if (currentListener() !== null) stats.tracked += 1;
 *   return read();
 * }
 * @see isTracking
 * @since 1.0.0
 */
export function currentListener(): Computation | null {
  return rt.listener;
}

/**
 * Says whether reads are being recorded as dependencies right now. Use it to skip subscription
 * work, or to warn, when a primitive is read outside an effect or a memo.
 *
 * @returns `true` while an effect or a memo runs tracked, `false` otherwise (module scope,
 * `untrack`, event handlers).
 * @example
 * import { untrack, useMemo } from "@shadow-js/core";
 * import { isTracking } from "@shadow-js/core/extend";
 *
 * const inMemo = useMemo(() => isTracking());
 * console.log(inMemo(), untrack(() => isTracking())); // true false
 * @see currentListener
 * @since 1.0.0
 */
export function isTracking(): boolean {
  return rt.listener !== null;
}

/**
 * Says whether a memo (not an effect) is computing right now: writing signals is a mistake there.
 * Cleanups that run while a memo tears down rows or children may write, so a disposal in progress
 * is not a violation, and neither is a memo created with `allowWrites`. Use it to guard a custom
 * write path the way {@link writeSignal} does.
 *
 * @returns `true` while a memo without `allowWrites` computes and no disposal is running.
 * @example
 * import { isComputingMemo, ShadowError } from "@shadow-js/core/extend";
 *
 * function appendLog(log: string[], entry: string): void {
 *   if (isComputingMemo()) throw new ShadowError("WRITE_IN_MEMO");
 *   log.push(entry);
 * }
 * @since 1.0.0
 */
export function isComputingMemo(): boolean {
  return (
    rt.disposing === 0 &&
    rt.running !== null &&
    rt.running.kind === KIND_MEMO &&
    (rt.running.flags & FLAG_ALLOW_WRITES) === 0
  );
}

/**
 * Runs `fn` with the given owner and listener in effect, and restores both afterward, even when
 * `fn` throws. The low-level form of `runWithOwner` and `untrack`; unlike `runWithOwner` it does
 * not check whether the owner is disposed.
 *
 * @param scope `owner` and `listener` to install. For each, `undefined` (or absent) keeps the
 * current one and `null` clears it.
 * Getters are evaluated once; a failed getter restores the original scope.
 * @param fn The function to run.
 * @returns Whatever `fn` returns. An error thrown by `fn` propagates after the registers are
 * restored.
 * @example
 * import { onCleanup } from "@shadow-js/core";
 * import { createOwner, disposeOwner, runInScope } from "@shadow-js/core/extend";
 *
 * const owner = createOwner(null);
 * runInScope({ owner, listener: null }, () => {
 *   onCleanup(() => console.log("released"));
 * });
 * disposeOwner(owner); // logs "released"
 * @see createOwner
 * @since 1.0.0
 */
export function runInScope<T>(
  scope: { owner?: Owner | null; listener?: Computation | null },
  fn: () => T,
): T {
  const owner = rt.owner;
  const listener = rt.listener;
  try {
    const nextOwner = scope.owner;
    if (nextOwner !== undefined) rt.owner = nextOwner;
    const nextListener = scope.listener;
    if (nextListener !== undefined) rt.listener = nextListener;
    return fn();
  } finally {
    rt.owner = owner;
    rt.listener = listener;
  }
}

// ---------- reactive cells ----------

/**
 * Creates the storage of a signal: its value, its equality and the observers that read it. Read it
 * with `readSignal` and write it with {@link writeSignal}; `useSignal` is built this way.
 *
 * @param value Initial value.
 * @param equals Decides whether a write is a change: readers are notified only when it returns
 * `false`. `false` notifies on every write.
 * @param name Label shown by devtools. Undefined leaves the signal unnamed.
 * @returns The signal node. It has no owner: it lives as long as something references it.
 * @example
 * import { createSignalNode, readSignal, writeSignal } from "@shadow-js/core/extend";
 *
 * const temperature = createSignalNode<number>(20, Object.is, "temperature");
 * const read = () => readSignal(temperature);
 * writeSignal(temperature, 21);
 * console.log(read()); // 21
 * @see writeSignal
 * @since 1.0.0
 */
export function createSignalNode<T>(value: T, equals: Equals<T>, name?: string): Signal<T> {
  return new Signal<T>(value, equals, name);
}

/**
 * Options of {@link writeSignal}.
 * @since 1.0.0
 */
export interface WriteOptions {
  /**
   * Permit the write while a memo computes, for bookkeeping signals owned by a primitive (a
   * Suspense counter, a resource's state). Turns the development `WRITE_IN_MEMO` check off for
   * this write.
   * @default false
   */
  allowInMemo?: boolean;
}

/**
 * Stores a new value in a signal node and notifies its readers when the value differs by the
 * signal's equality. Effects that read it run on the next flush; memos recompute on their next
 * read.
 *
 * @param signal The node, from {@link createSignalNode}.
 * @param next The new value. A function is stored as is: there is no updater form.
 * @param options `allowInMemo` permits the write while a memo computes. Undefined uses the default.
 * @returns `true` when the value changed and was stored, `false` when the equality kept the old
 * value (nobody is notified then).
 * @throws ShadowError `WRITE_IN_MEMO`, in development builds only, when a memo is computing and
 * `allowInMemo` is not set.
 * @example
 * import { createSignalNode, writeSignal } from "@shadow-js/core/extend";
 *
 * const status = createSignalNode<string>("idle", Object.is);
 * console.log(writeSignal(status, "loading")); // true
 * console.log(writeSignal(status, "loading")); // false: an equal value notifies nobody
 * @see notify
 * @since 1.0.0
 */
export function writeSignal<T>(signal: Signal<T>, next: T, options?: WriteOptions): boolean {
  if (__DEV__ && options?.allowInMemo !== true && isComputingMemo()) {
    throw new ShadowError("WRITE_IN_MEMO");
  }
  const equals = signal.equals;
  if (equals !== false && equals(signal.value, next)) return false;
  signal.value = next;
  if (__DEV__) {
    report(DEVTOOLS_EVENT.SIGNAL_WRITTEN, signal, next, rt.running, observersOf(signal));
  }
  notify(signal);
  return true;
}

/**
 * Marks the observers of `source` stale and schedules a flush. Call it after changing a source's
 * value in place (for example after mutating an array a signal node holds), where
 * {@link writeSignal} cannot see the change.
 *
 * @param source A signal or memo node. A source nobody observes is left alone.
 * @example
 * import { createSignalNode, notify } from "@shadow-js/core/extend";
 *
 * const list = createSignalNode<string[]>([], false);
 * list.value.push("milk"); // an in-place change: no equality can see it
 * notify(list); // the readers of `list` run again
 * @see writeSignal
 * @since 1.0.0
 */
export function notify(source: Source): void {
  if (!hasObservers(source)) return;
  markObservers(source);
  schedule();
}

export { markObservers, observersOf, readSignal, schedule, sourcesOf, track };

// ---------- computations (memos and effects) ----------

/**
 * Options of {@link createComputation}.
 * @since 1.0.0
 */
export interface ComputationOptions {
  /**
   * `"memo"` creates a cached value that readers pull with {@link readComputation}; `"effect"`
   * creates a side effect that the scheduler runs.
   */
  kind: "memo" | "effect";
  /**
   * The computation. It is tracked: every source it reads becomes a dependency. It receives the
   * previous value (a memo's last value, or an effect's last computed value when `apply` is set;
   * `undefined` otherwise). A memo stores its result; an effect without `apply` may return a
   * cleanup function.
   */
  fn: (previous: never) => unknown;
  /**
   * Memos: decides whether a recomputation changed the value; readers are notified only when it
   * returns `false`, and `false` always propagates. Ignored for effects.
   * @default Object.is
   */
  equals?: Equals<unknown>;
  /**
   * Label shown by devtools and diagnostics.
   * @default undefined (the node is unnamed)
   */
  name?: string;
  /**
   * Effects: run in the render phase, synchronously at creation and before user effects in each
   * flush. Ignored for memos.
   * @default false
   */
  render?: boolean;
  /**
   * Effects with `apply`: skip the first call of `apply`; `fn` still runs and tracks.
   * @default false
   */
  defer?: boolean;
  /**
   * Memos: do not compute until the first read.
   * @default false (the memo computes once at creation)
   */
  lazy?: boolean;
  /**
   * Memos that run component setup (such as a hot-reload wrapper): writing signals inside is
   * legitimate there, so the dev-mode write guard stays off.
   * @default false
   */
  allowWrites?: boolean;
  /**
   * Effects: second stage, run untracked with the value `fn` computed and the previous one. It may
   * return a cleanup function.
   * @default undefined (`fn` is the whole effect)
   */
  apply?: (value: never, previous: never) => unknown;
  /**
   * Owner to attach to. `null` creates a node that no owner disposes.
   * @default the current owner
   */
  owner?: Owner | null;
  /**
   * Effects: always run in the transition lane (the watcher behind `useDeferredValue`).
   * @default false
   */
  lane?: boolean;
}

/**
 * Creates a memo or effect node: the building block of `useMemo`, `useEffect` and the render
 * effects of a renderer. Memos compute immediately unless `lazy`; render effects run immediately;
 * user effects are queued for the next flush. The node is owned and disposed with its owner.
 * Errors of a memo are stored and rethrown to its readers; errors of an effect go to the owner's
 * error handler.
 *
 * @param options What to create, how it runs and where it is owned.
 * @returns The node. Read a memo with {@link readComputation}; an effect needs no handle.
 * @throws The error of a render effect's first run when no error handler takes it and no flush is
 * running.
 * @example
 * import { createComputation, createSignalNode, readComputation, readSignal, writeSignal } from "@shadow-js/core/extend";
 *
 * const price = createSignalNode<number>(10, Object.is);
 * const withTax = createComputation({ kind: "memo", fn: () => readSignal(price) * 1.2 });
 * createComputation({
 *   kind: "effect",
 *   fn: () => console.log(readComputation<number>(withTax)),
 * });
 * writeSignal(price, 20); // the effect logs 24 on the next flush
 * @see readComputation
 * @since 1.0.0
 */
export function createComputation(options: ComputationOptions): Computation {
  const owner = options.owner === undefined ? rt.owner : options.owner;
  if (options.kind === "memo") {
    const node = new Computation(
      owner,
      KIND_MEMO,
      FLAG_UNINIT | (options.allowWrites === true ? FLAG_ALLOW_WRITES : 0),
      options.fn,
      options.equals ?? Object.is,
      options.name,
    );
    if (options.lazy !== true) updateIfNecessary(node);
    return node;
  }
  const flags =
    (options.render === true ? FLAG_RENDER : 0) |
    (options.defer === true ? FLAG_DEFER : 0) |
    (options.lane === true ? FLAG_LANE : 0);
  const node = new Computation(owner, KIND_EFFECT, flags, options.fn, false, options.name);
  node.apply = options.apply ?? null;
  if (options.render === true) {
    // A suspended render effect keeps its DOM and waits on its own: its creator completes normally
    // (the branch that holds it decides whether to commit; see createBranches).
    recompute(node);
  } else {
    enqueue(node);
    schedule();
  }
  return node;
}

/**
 * Reads a memo node: brings it up to date if a source changed, subscribes the running computation
 * to it, and rethrows the error its last run stored. The accessor `useMemo` returns is this call.
 *
 * @param node A memo node from {@link createComputation}.
 * @returns The memo's current value.
 * @throws The error the memo's last computation threw, when no error handler took it. ShadowError
 * `CYCLE_DETECTED` when the memo is read while it computes.
 * @example
 * import { createComputation, createSignalNode, readComputation, readSignal } from "@shadow-js/core/extend";
 *
 * const first = createSignalNode<string>("Ada", Object.is);
 * const greeting = createComputation({ kind: "memo", fn: () => `Hello, ${readSignal(first)}` });
 * console.log(readComputation<string>(greeting)); // "Hello, Ada"
 * @see createComputation
 * @since 1.0.0
 */
export function readComputation<T>(node: Computation): T {
  return readMemo<T>(node);
}

/**
 * Brings a memo or effect node up to date if one of its sources changed, without tracking it. Use
 * it to settle a node before reading its fields directly.
 *
 * @param node A node from {@link createComputation}. A node that is up to date is left as is.
 * @throws ShadowError `CYCLE_DETECTED` when a dependency is still computing (a cycle). An effect
 * that re-runs routes its errors to its owner's error handler.
 * @example
 * import { createComputation, createSignalNode, readSignal, refresh, writeSignal } from "@shadow-js/core/extend";
 *
 * const count = createSignalNode<number>(1, Object.is);
 * const doubled = createComputation({ kind: "memo", fn: () => readSignal(count) * 2 });
 * writeSignal(count, 2);
 * refresh(doubled);
 * console.log(doubled.value); // 4
 * @see readComputation
 * @since 1.0.0
 */
export function refresh(node: Computation): void {
  updateIfNecessary(node);
}

/**
 * Creates a plain owner: a scope that adopts the nodes and cleanups created under it and disposes
 * them together. The building block of `createRoot` and of control-flow branches.
 *
 * @param parent The owner to attach to and inherit context from. Undefined (or omitted) uses the
 * current owner; `null` creates a root with no context that only an explicit dispose ends.
 * @returns The new owner. Dispose it with `disposeOwner`.
 * @example
 * import { useEffect } from "@shadow-js/core";
 * import { createOwner, disposeOwner, runInScope } from "@shadow-js/core/extend";
 *
 * const branch = createOwner();
 * runInScope({ owner: branch, listener: null }, () => {
 *   useEffect(() => console.log("branch effect"));
 * });
 * disposeOwner(branch); // the effect and its cleanups are gone
 * @see runInScope
 * @since 1.0.0
 */
export function createOwner(parent?: Owner | null): Owner {
  return new OwnerClass(parent === undefined ? rt.owner : parent);
}
