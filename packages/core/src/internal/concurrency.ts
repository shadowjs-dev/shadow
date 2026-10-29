import { runWithContext } from "../context";
import { SuspenseContext } from "../suspense";
import { DEVTOOLS_EVENT, report } from "./devtools";
import { ShadowError } from "./diagnostics";
import { disposeTree } from "./dispose";
import {
  CLEAN,
  DIRTY,
  FLAG_DISPOSED,
  FLAG_LANE,
  FLAG_PARKED,
  FLAG_QUEUED,
  FLAG_RENDER,
  FLAG_TRANSITION,
  KIND_EFFECT,
} from "./flags";
import { Computation, hasObservers, markObservers, readSignal, Signal } from "./graph";
import { addCleanup, finishDisposal, Owner } from "./owner";
import { clearQueues, hasPending, place, renderQueue, userQueue } from "./queue";
import { byCreation, MAX_FLUSH_PASSES, reportUncaught, runQueued, schedule } from "./scheduler";
import {
  type BoundaryHold,
  type Hooks,
  rt,
  type SlotBranch,
  type SlotChoice,
  type SlotOwned,
  type SlotState,
  type SlotSwap,
  type TransitionHold,
} from "./state";
import { isSuspension, SUSPENSION } from "./suspension";

/*
 * Transitions, Activity pauses and Suspense holds. Nothing here runs unless an API that needs it is
 * called (startTransition, useTransition, useDeferredValue, pauseOwner, a Suspense hold inside a
 * transition): the first of those creates the hooks (`ensureHooks`), and the engine reaches them only
 * through `rt.hooks`. Module level holds no state of its own: the queues, waiters and holds are
 * closure variables of `createHooks`.
 */

/** Transition-lane effects run per macrotask; between two chunks urgent work and input can run. */
const LANE_CHUNK = 64;

/** The length of the suspended list from which the disposed nodes are dropped, at each power of two. */
const SUSPENDED_SWEEP_AT = 64;

/** Visits `root` and every node below it. Iterative: the depth is user controlled. */
function walk(root: Owner, visit: (node: Owner) => void): void {
  const stack: Owner[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as Owner;
    visit(node);
    for (let child = node.lastChild; child !== null; child = child.prevSibling) stack.push(child);
  }
}

/** Creates the transition machinery. Called once, by the first API that needs it. */
function createHooks(): Hooks {
  const laneRender: Computation[] = [];
  const laneUser: Computation[] = [];
  /**
   * The promise every transition that waits for the lane shares (`waiting` counts the callers, for
   * devtools). One promise instead of one resolver per call: while a hold stays engaged the list of resolvers grew
   * with every `startTransition`, and all of them resolve at the same moment anyway.
   */
  let applied: Promise<void> | null = null;
  let resolveApplied: (() => void) | null = null;
  let waiting = 0;
  /**
   * Memos and effects that caught a suspension; woken all at once when a boundary releases them. A
   * node is listed once (it is a set), and the disposed ones are dropped each time the list
   * length is a power of two from `SUSPENDED_SWEEP_AT` on, so a hold that stays engaged cannot make the list, or the nodes it keeps alive,
   * grow with the number of nodes that came and went.
   */
  const suspended = new Set<Computation>();
  /** Suspense boundaries currently holding a transition (the lane is busy while any holds). */
  let holds = 0;
  let scheduled = false;

  const hasLanePending = (): boolean => laneRender.length > 0 || laneUser.length > 0;
  const laneBusy = (): boolean => hasLanePending() || holds > 0;

  /**
   * Runs one chunk of a lane queue. An entry without FLAG_TRANSITION was promoted to the urgent queue
   * after it was queued here; it is skipped (the urgent queue owns its FLAG_QUEUED).
   */
  const drainLane = (queue: Computation[], limit: number): number => {
    const batch = queue.splice(0, limit);
    batch.sort(byCreation);
    for (const effect of batch) {
      if ((effect.flags & FLAG_TRANSITION) === 0) continue;
      effect.flags &= ~(FLAG_QUEUED | FLAG_TRANSITION);
      if ((effect.flags & FLAG_DISPOSED) !== 0) continue;
      if (effect.pauses > 0) {
        effect.flags |= FLAG_PARKED | FLAG_TRANSITION;
        continue;
      }
      runQueued(effect);
    }
    return batch.length;
  };

  /** Resolves the transitions that wait for the lane, once the lane is idle. */
  const settleLane = (): void => {
    if (laneBusy() || resolveApplied === null) return;
    const resolve = resolveApplied;
    applied = resolveApplied = null;
    if (__DEV__) {
      report(DEVTOOLS_EVENT.TRANSITION_END, waiting);
      waiting = 0;
    }
    resolve();
  };

  /** Asks for one lane macrotask (the timer lets the browser paint and take input first). */
  const scheduleLane = (): void => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(flushLane, 0);
  };

  /**
   * Runs the transition lane: one chunk per macrotask, render effects first. Writes made here belong to
   * the lane, so the effects they wake join it. Errors nobody handled are reported, not thrown, because
   * no caller is waiting for this macrotask.
   */
  const flushLane = (): void => {
    scheduled = false;
    if (rt.flushing) {
      scheduleLane();
      return;
    }
    const previous = rt.inTransition;
    rt.inTransition = true;
    rt.flushing = true;
    let budget = LANE_CHUNK;
    let passes = 0;
    try {
      while (budget > 0 && hasLanePending()) {
        passes += 1;
        if (passes > MAX_FLUSH_PASSES) {
          clearQueues();
          rt.uncaught.push(new ShadowError("INFINITE_LOOP"));
          break;
        }
        const queue = laneRender.length > 0 ? laneRender : laneUser;
        budget -= drainLane(queue, budget);
      }
    } finally {
      rt.inTransition = previous;
      rt.flushing = false;
    }
    const errors = rt.uncaught.splice(0, rt.uncaught.length);
    for (const error of errors) reportUncaught(error);
    if (hasLanePending()) scheduleLane();
    else settleLane();
    if (hasPending()) schedule();
  };

  const startTransition = (fn: () => void): Promise<void> => {
    // A user callback runs untracked and as a transition: its reads are not subscriptions of the caller.
    const previous = rt.inTransition;
    const listener = rt.listener;
    rt.inTransition = true;
    rt.listener = null;
    try {
      fn();
    } finally {
      rt.inTransition = previous;
      rt.listener = listener;
    }
    if (__DEV__) report(DEVTOOLS_EVENT.TRANSITION_START);
    if (__DEV__) waiting += 1;
    applied ??= new Promise<void>((resolve) => {
      resolveApplied = resolve;
    });
    const shared = applied;
    settleLane();
    return shared;
  };

  /** The hook's `place`: parks a paused effect or queues a lane effect. */
  const parkOrLane = (effect: Computation, inLane: boolean): void => {
    if (effect.pauses > 0) {
      // Paused: parked (unqueued) until the owner resumes. A lane effect keeps its lane.
      effect.flags = inLane
        ? effect.flags | FLAG_PARKED | FLAG_TRANSITION
        : (effect.flags | FLAG_PARKED) & ~FLAG_TRANSITION;
      return;
    }
    const render = (effect.flags & FLAG_RENDER) !== 0;
    effect.flags = (effect.flags & ~FLAG_PARKED) | FLAG_QUEUED | FLAG_TRANSITION;
    if (render) laneRender.push(effect);
    else laneUser.push(effect);
    scheduleLane();
  };

  const promote = (effect: Computation): void => {
    // Lane-only effects (useDeferredValue's watcher) and paused effects stay where they are.
    if ((effect.flags & FLAG_LANE) !== 0 || effect.pauses > 0) return;
    if ((effect.flags & FLAG_PARKED) !== 0) {
      place(effect, false);
      return;
    }
    if ((effect.flags & (FLAG_QUEUED | FLAG_TRANSITION)) !== (FLAG_QUEUED | FLAG_TRANSITION))
      return;
    // Still listed in the lane array; the lane skips entries that no longer carry FLAG_TRANSITION.
    effect.flags &= ~FLAG_TRANSITION;
    if ((effect.flags & FLAG_RENDER) !== 0) renderQueue.push(effect);
    else userQueue.push(effect);
  };

  const clear = (): void => {
    for (const queue of [laneRender, laneUser]) {
      for (const effect of queue) {
        effect.flags &= ~(FLAG_QUEUED | FLAG_TRANSITION);
        effect.state = CLEAN;
      }
      queue.length = 0;
    }
  };

  const suspend = (node: Computation, error: unknown): boolean => {
    if (error !== SUSPENSION) return false;
    // Listed once: a node that suspends again before the wake-up is already in the set.
    if (!suspended.has(node)) {
      const size = suspended.size;
      if (size >= SUSPENDED_SWEEP_AT && (size & (size - 1)) === 0) {
        // A disposed node never wakes, so keeping it would leak it for as long as the hold lasts.
        for (const entry of suspended) {
          if (entry.disposed) suspended.delete(entry);
        }
      }
      suspended.add(node);
    }
    return true;
  };

  const holdReader = (tracker: { hold?(): boolean }): void => {
    if (tracker.hold?.() === true) throw SUSPENSION;
  };

  const beginHold = (): void => {
    holds += 1;
  };

  const endHold = (): void => {
    if (holds > 0) holds -= 1;
    if (hasLanePending()) scheduleLane();
    settleLane();
  };

  const wakeSuspended = (): void => {
    const woken = Array.from(suspended);
    suspended.clear();
    // The woken work is still the transition: it runs in the lane, so a resource it reads again is
    // held the same way, not shown as a fallback by an urgent pass.
    const previous = rt.inTransition;
    rt.inTransition = true;
    try {
      for (const node of woken) {
        if (node.disposed) continue;
        node.state = DIRTY;
        if (node.kind === KIND_EFFECT) place(node, true);
        else markObservers(node);
      }
    } finally {
      rt.inTransition = previous;
    }
    schedule();
  };

  const pause = (owner: Owner): void => {
    // Every node is paused before any cleanup runs: a cleanup that throws must not leave the rest
    // unpaused. Preorder reversed is the disposal order: children first, newest first.
    const nodes: Owner[] = [];
    walk(owner, (node) => {
      node.pauses += 1;
      nodes.push(node);
    });
    rt.disposing += 1;
    try {
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i];
        if (
          node instanceof Computation &&
          node.kind === KIND_EFFECT &&
          (node.flags & FLAG_RENDER) === 0 &&
          !node.disposed
        ) {
          node.runCleanups();
        }
      }
    } finally {
      finishDisposal();
    }
  };

  const createHold = (onSettled: () => void): TransitionHold => {
    let count = 0;
    let holding = false;
    let engagedOnce = false;
    const tracker = {
      increment(): void {
        count += 1;
      },
      decrement(): void {
        count -= 1;
        if (count !== 0) return;
        if (holding) {
          holding = false;
          // Everything that kept its value for this hold runs again, now that the data arrived.
          wakeSuspended();
          endHold();
        }
        onSettled();
      },
      hold(): boolean {
        engagedOnce = true;
        if (!holding) {
          holding = true;
          beginHold();
        }
        return true;
      },
    };
    return {
      run: (fn) => runWithContext(SuspenseContext, tracker, fn),
      count: () => count,
      engaged: () => engagedOnce,
      drop: () => {
        if (!holding) return;
        holding = false;
        endHold();
      },
    };
  };

  const resume = (owner: Owner): void => {
    walk(owner, (node) => {
      if (node.pauses > 0) node.pauses -= 1;
      if (!(node instanceof Computation) || node.pauses !== 0 || node.disposed) return;
      if (node.kind === KIND_EFFECT) {
        // A render effect that was not due while paused keeps its DOM: re-running it would rebuild its
        // subtree (a Provider's children, for one) and lose that state.
        if ((node.flags & FLAG_RENDER) !== 0 && (node.flags & FLAG_PARKED) === 0) return;
        node.state = DIRTY;
        place(node, false);
      } else if (node.state !== CLEAN) {
        // A memo that changed while paused was not recomputed, so its readers outside this owner were
        // not woken either (they read the frozen value). Wake them now that it can be recomputed.
        markObservers(node);
      }
    });
    schedule();
  };

  /** A Suspense boundary's hold: engaged by a transition read, released when its data arrived. */
  const boundaryHold = (): BoundaryHold => {
    let holding = false;
    return {
      engage: () => {
        if (!holding) {
          holding = true;
          beginHold();
        }
        return true;
      },
      release: () => {
        if (!holding) return;
        holding = false;
        // Everything that kept its value for this boundary runs again, with the data that arrived.
        wakeSuspended();
        endHold();
      },
      holding: () => holding,
    };
  };

  /**
   * The transition layer of one branch slot (Show, Switch). A change made during a transition, while a
   * branch is on screen, builds the new branch under a hold and keeps the shown one until the hold
   * settles; then it commits. The slot's output memo calls `step` first, so the usual path (its own
   * teardown) only runs when no transition is involved. Its state lives in `state`, which the memo
   * reads and writes.
   */
  const slotSwap = <C extends SlotChoice>(
    state: SlotState<C>,
    build: (choice: C, owned: SlotOwned, eager: boolean) => unknown,
    same: (a: C, b: C) => boolean,
    parent: Owner | null,
  ): SlotSwap<C> => {
    /** A transition's branch waiting for its reads; the shown branch stays until it is ready. */
    let pending: SlotBranch<C> | undefined;
    /** Owns the branches built during transitions: they live as long as the slot's owner. */
    const holder = new Owner(parent);
    /** Counts the settled holds; the memo reads it, so it runs again when a pending branch is ready. */
    const settled = new Signal<number>(0, false, undefined);

    const settle = (): void => {
      settled.value += 1;
      if (hasObservers(settled)) {
        markObservers(settled);
        schedule();
      }
    };

    /** Tears a branch down. Its owner is marked `disposing` first (see the accessors of Show). */
    const retireBranch = (branch: SlotBranch<C>): void => {
      branch.owned.disposing = true;
      try {
        branch.hold?.drop();
        branch.dispose?.();
      } finally {
        branch.owned.disposing = false;
      }
    };

    const commit = (branch: SlotBranch<C>): void => {
      const previous = state.live;
      state.live = branch;
      if (previous !== undefined) retireBranch(previous);
    };

    /** Builds a transition's branch under the holder. A held read leaves it pending, not shown. */
    const buildPending = (choice: C): SlotBranch<C> => {
      const owned: SlotOwned = { index: choice.index, value: choice.when, disposing: false };
      const hold: TransitionHold = createHold(() => {
        // Only the branch still waiting may commit; a dropped one must not wake the slot.
        if (pending !== undefined && pending.hold === hold) settle();
      });
      const root = new Owner(holder);
      const previousOwner = rt.owner;
      const previousListener = rt.listener;
      rt.owner = root;
      rt.listener = null;
      let result: unknown;
      try {
        // The branch's reads report to its own hold (not the boundary), so they do not bring the
        // fallback back. No Provider: its render effect would be re-run by the wake-up, rebuilding
        // the branch and starting its loads again.
        try {
          result = hold.run(() => build(choice, owned, true));
        } catch (error) {
          if (!isSuspension(error)) throw error;
        }
        const marker = new Owner(root);
        addCleanup(marker, () => {
          owned.disposing = true;
        });
      } finally {
        rt.owner = previousOwner;
        rt.listener = previousListener;
      }
      return {
        choice,
        owned,
        result,
        dispose: () => disposeTree(root),
        hold: hold.engaged() ? hold : null,
      };
    };

    return {
      step(choice: C): boolean {
        readSignal(settled);
        if (pending !== undefined) {
          if (!same(pending.choice, choice)) {
            const dropped = pending;
            pending = undefined;
            dropped.hold?.drop();
            dropped.dispose?.();
          } else if ((pending.hold?.count() ?? 0) > 0) {
            // Still waiting for data: the shown branch stays on screen, untouched.
            return true;
          } else {
            const ready = pending;
            pending = undefined;
            commit(ready);
            return true;
          }
        }
        // A transition replacing the shown branch: build it first, keep the shown one until it is ready.
        if (state.live !== undefined && rt.inTransition) {
          const built = buildPending(choice);
          if (built.hold === null) commit(built);
          else pending = built;
          return true;
        }
        // The usual path follows: the branch on screen is retired here (an unmanaged one is torn down).
        const live = state.live;
        state.live = undefined;
        if (live !== undefined) retireBranch(live);
        return false;
      },
    };
  };

  return {
    place: parkOrLane,
    promote,
    clear,
    suspend,
    holdReader,
    startTransition,
    beginHold,
    endHold,
    wakeSuspended,
    pause,
    resume,
    createHold,
    slotSwap,
    boundaryHold,
  };
}

/** Installs the transition machinery on first use; later calls return the same hooks. */
function ensureHooks(): Hooks {
  const existing = rt.hooks;
  if (existing !== null) return existing;
  const created = createHooks();
  rt.hooks = created;
  return created;
}

/**
 * Installs the transition machinery (the transition lane, Activity pauses and Suspense holds) now
 * instead of at the first `startTransition`. The machinery is created on first use so that an
 * application that never uses transitions does not carry its code; call this from a primitive whose
 * later work needs the lane to exist, as `useDeferredValue` does. Calling it again does nothing.
 *
 * @example
 * import { registerTransitionLane } from "@shadow-js/core/extend";
 *
 * export function useBackgroundValue(): void {
 *   registerTransitionLane(); // later lane-only effects of this hook find the lane
 * }
 * @see startTransition
 * @since 1.0.0
 */
export function registerTransitionLane(): void {
  ensureHooks();
}

/**
 * Runs `fn` as a transition: the effects its writes wake wait in the transition lane, which runs
 * after urgent work (in a macrotask, one chunk at a time). Reads see the writes at once; the DOM
 * catches up when the lane runs. Use it for an update that may be slow to render or load, so input
 * stays responsive and a Suspense boundary keeps its content instead of showing its fallback. `fn`
 * runs untracked. The returned promise resolves when the lane is idle and no Suspense boundary holds
 * the transition.
 *
 * On the server there are no effects, so `fn` simply runs and the promise is already resolved.
 *
 * @param fn Callback whose writes form the transition.
 * @returns A promise that resolves when the transition has been applied.
 * @throws What `fn` throws, synchronously; no transition is started then.
 * @example
 * import { startTransition, useSignal } from "@shadow-js/core";
 *
 * const [page, setPage] = useSignal("home");
 * async function openReports(): Promise<void> {
 *   await startTransition(() => setPage("reports"));
 *   console.log(`${page()} is on screen`);
 * }
 * @see inTransition
 * @since 1.0.0
 */
export function startTransition(fn: () => void): Promise<void> {
  if (__SERVER__) {
    fn();
    return Promise.resolve();
  }
  return ensureHooks().startTransition(fn);
}

/**
 * Starts a Suspense hold: the boundary keeps showing its current content while a transition waits
 * for data. Holds are counted, and the running transitions stay pending (`isPending` of
 * `useTransition`, the promise of `startTransition`) until every hold has ended. For renderers that
 * implement Suspense; each call needs one {@link endHold}. Does nothing before the transition
 * machinery exists (no transition has run).
 *
 * @example
 * import { beginHold, endHold, wakeSuspended } from "@shadow-js/core/extend";
 *
 * export function holdUntil(data: Promise<unknown>): void {
 *   beginHold(); // the boundary keeps its content
 *   void data.finally(() => {
 *     wakeSuspended();
 *     endHold();
 *   });
 * }
 * @see endHold
 * @since 1.0.0
 */
export function beginHold(): void {
  rt.hooks?.beginHold();
}

/**
 * Ends a Suspense hold started with {@link beginHold}. Call {@link wakeSuspended} first, so the
 * memos and effects that waited are queued; this then schedules the lane for them and, once the lane
 * is idle and no hold remains, resolves the transitions that were waiting. Extra calls never take the
 * count below zero. Does nothing before the transition machinery exists.
 *
 * @example
 * import { endHold, wakeSuspended } from "@shadow-js/core/extend";
 *
 * export function release(): void {
 *   wakeSuspended(); // the held readers run again with the data that arrived
 *   endHold();
 * }
 * @see beginHold
 * @since 1.0.0
 */
export function endHold(): void {
  rt.hooks?.endHold();
}

/**
 * Wakes every memo and effect that kept its value for a transition (it caught {@link SUSPENSION}):
 * each runs again in the transition lane, so it reads the data that arrived. A Suspense boundary
 * calls it when it releases its hold, before {@link endHold}. Does nothing before the transition
 * machinery exists.
 *
 * @example
 * import { endHold, wakeSuspended } from "@shadow-js/core/extend";
 *
 * export function onDataArrived(): void {
 *   wakeSuspended();
 *   endHold();
 * }
 * @see endHold
 * @since 1.0.0
 */
export function wakeSuspended(): void {
  rt.hooks?.wakeSuspended();
}

/**
 * Lets a pending read inside a transition keep the boundary's content: when the tracker's `hold()`
 * returns true (the boundary holds its content for the transition), the reader throws
 * {@link SUSPENSION} and keeps its previous value until the boundary wakes it. Call it from a data
 * primitive's reader when its data is pending, the reader is tracked and {@link inTransition} is
 * true, as `useResource` does. Does nothing before the transition machinery exists, or when the
 * tracker has no `hold`.
 *
 * @param tracker The Suspense tracker of the nearest boundary (`SuspenseContext`).
 * @throws {@link SUSPENSION} (not an error) when the boundary holds its content.
 * @example
 * import { useContext, SuspenseContext } from "@shadow-js/core";
 * import { currentListener, holdReader, inTransition } from "@shadow-js/core/extend";
 *
 * export function readPending(): void {
 *   const tracker = useContext(SuspenseContext);
 *   if (tracker !== null && currentListener() !== null && inTransition()) holdReader(tracker);
 * }
 * @see isSuspension
 * @since 1.0.0
 */
export function holdReader(tracker: { hold?(): boolean }): void {
  rt.hooks?.holdReader(tracker);
}

/**
 * Tells whether a transition callback or a transition-lane run is active, so the writes made now
 * belong to the lane. Use it in a primitive that treats transition reads differently, such as a data
 * reader that holds the boundary only in a transition.
 *
 * @returns True inside `startTransition`'s callback and while the lane runs.
 * @example
 * import { startTransition } from "@shadow-js/core";
 * import { inTransition } from "@shadow-js/core/extend";
 *
 * void startTransition(() => {
 *   console.log(inTransition()); // true in the browser
 * });
 * console.log(inTransition()); // false
 * @see startTransition
 * @since 1.0.0
 */
export function inTransition(): boolean {
  return rt.inTransition;
}

/**
 * Creates the hold of a value a transition builds (see {@link TransitionHold}): the reads that wait
 * for data inside `hold.run(...)` count against this hold instead of the Suspense boundary around the
 * value, so the value on screen stays until the new one is ready. For renderers that build values
 * during a transition.
 *
 * @param onSettled Called each time the number of waiting reads drops back to zero.
 * @returns The hold, or null when the transition machinery does not exist yet (no transition has run,
 * so nothing can be held).
 * @example
 * import { createTransitionHold } from "@shadow-js/core/extend";
 *
 * const hold = createTransitionHold(() => console.log("ready to commit"));
 * const built = hold === null ? "now" : hold.run(() => "pending");
 * @see transitionHooks
 * @since 1.0.0
 */
export function createTransitionHold(onSettled: () => void): TransitionHold | null {
  const hooks = rt.hooks;
  return hooks === null ? null : hooks.createHold(onSettled);
}

/**
 * Returns the transition machinery while a transition is running, otherwise null. Renderers reach
 * the slot and boundary layers (`slotSwap`, `boundaryHold`) only through it: a transition can only be
 * running once the machinery exists, so this never creates it (a static call that did would keep the
 * whole machinery in every bundle that renders a Show).
 *
 * @returns The hooks during a transition callback or lane run, null otherwise.
 * @example
 * import { transitionHooks } from "@shadow-js/core/extend";
 *
 * export function boundaryHoldIfTransition() {
 *   return transitionHooks()?.boundaryHold() ?? null;
 * }
 * @see inTransition
 * @since 1.0.0
 */
export function transitionHooks(): Hooks | null {
  return rt.inTransition ? rt.hooks : null;
}

/**
 * Pauses `owner` and everything below it (Activity hidden). User effects run their cleanups and wait.
 * DOM bindings (render effects) wait without a cleanup, so their nodes stay as they are. Memos keep their
 * last value, and effects created below are parked until the owner resumes. Pauses nest: each
 * `pauseOwner` needs one `resumeOwner`. Use it to hide a subtree while keeping its state.
 *
 * @param owner The owner to pause, with its whole subtree.
 * @example
 * import { createOwner, pauseOwner, resumeOwner } from "@shadow-js/core/extend";
 *
 * const hidden = createOwner(null);
 * pauseOwner(hidden); // its effects stop; its memos keep their values
 * resumeOwner(hidden); // its user effects run again with the latest values
 * @see resumeOwner
 * @since 1.0.0
 */
export function pauseOwner(owner: Owner): void {
  ensureHooks().pause(owner);
}

/**
 * Resumes an owner paused with {@link pauseOwner}; the subtree runs again once its last pause ends.
 * User effects below it run once more with the current values (their cleanups ran on pause). DOM
 * bindings run only if something they read changed while paused, so a hidden subtree is not rebuilt
 * on show. Memos that changed while paused wake their readers outside the owner. Call it once per
 * `pauseOwner`, not on an owner that is not paused.
 *
 * @param owner The paused owner.
 * @example
 * import { createOwner, pauseOwner, resumeOwner } from "@shadow-js/core/extend";
 *
 * const panel = createOwner(null);
 * pauseOwner(panel);
 * resumeOwner(panel); // every user effect below runs once with the latest values
 * @see pauseOwner
 * @since 1.0.0
 */
export function resumeOwner(owner: Owner): void {
  rt.hooks?.resume(owner);
}
