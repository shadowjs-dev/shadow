import type { Computation } from "./graph";
import type { Owner } from "./owner";

/**
 * A hold for a value a transition builds while its reads wait for data (a `Show` branch built during a
 * transition): the reads that wait count against this hold, not against the Suspense boundary around
 * the value, so the shown value stays until the hold settles. Created by `createTransitionHold`.
 * @since 1.0.0
 */
export interface TransitionHold {
  /** Runs `fn` with this hold as the Suspense boundary of the reads inside it. */
  run<T>(fn: () => T): T;
  /** Reads still waiting for data. */
  count(): number;
  /** True once a read in the hold was held (the value is then pending, not ready). */
  engaged(): boolean;
  /** Ends the hold without waking anything (the value is being dropped). */
  drop(): void;
}

/**
 * The choice a branch slot (Show, Switch) shows: its index, and what decides a rebuild. Renderers
 * extend it with what they need to build the branch.
 * @since 1.0.0
 */
export interface SlotChoice {
  /** Which branch is chosen: its position among the slot's branches, or the renderer's fallback index. */
  readonly index: number;
  /** True when the branch is rebuilt whenever `when` changes identity; false when only `index` counts. */
  readonly keyed: boolean;
  /** The condition value that selected the branch. */
  readonly when: unknown;
}

/**
 * The record of a branch's owner that its accessors read: the value and whether it is being torn down.
 * @since 1.0.0
 */
export interface SlotOwned {
  /** The index of the branch this record belongs to (see {@link SlotChoice.index}). */
  index: number;
  /** The latest condition value while the branch is shown; what its accessor returns during teardown. */
  value: unknown;
  /** True while the branch is torn down: its accessor then returns `value` instead of throwing. */
  disposing: boolean;
}

/**
 * A branch a slot shows, or builds during a transition. A branch without `dispose` is torn down by its memo.
 * @since 1.0.0
 */
export interface SlotBranch<C extends SlotChoice> {
  /** The choice the branch was built for. */
  readonly choice: C;
  /** The record its accessors read. */
  readonly owned: SlotOwned;
  /** What the branch produced: the value the slot's output returns while the branch is shown. */
  readonly result: unknown;
  /**
   * Tears the branch down. Set for the branches a transition built: they live under the holder, not
   * under the memo.
   * @default undefined (the slot's memo tears the branch down)
   */
  readonly dispose?: () => void;
  /**
   * The hold a transition built the branch under; null when none of its reads was held.
   * @default undefined (a memo-owned branch has no hold)
   */
  readonly hold?: TransitionHold | null;
}

/**
 * What a slot's output memo keeps: the branch on screen (its result is the value the output returns).
 * @since 1.0.0
 */
export interface SlotState<C extends SlotChoice> {
  /** The branch on screen, or undefined before the first build and while the memo rebuilds it. */
  live: SlotBranch<C> | undefined;
}

/**
 * The transition layer of one slot, from `transitionHooks()?.slotSwap(...)`: it keeps the shown
 * branch while a transition builds the next one (see `slotSwap` in concurrency.ts).
 * @since 1.0.0
 */
export interface SlotSwap<C extends SlotChoice> {
  /**
   * Runs one pass of the slot's memo for `choice`. True when a transition keeps the shown value. False
   * when the usual path follows: the branch on screen has been retired and `state.live` is cleared.
   */
  step(choice: C): boolean;
}

/**
 * The hold of one Suspense boundary: engaged by a transition read, released when its data arrived.
 * From `transitionHooks()?.boundaryHold()`.
 * @since 1.0.0
 */
export interface BoundaryHold {
  /** Engages the hold (a second call changes nothing) so the boundary keeps its content; returns true. */
  engage(): boolean;
  /** When engaged: wakes the readers that waited, then ends the hold. Otherwise does nothing. */
  release(): void;
  /** True while the hold is engaged. */
  holding(): boolean;
}

/**
 * The transition machinery the engine calls through `rt.hooks`: transition lanes, pauses (Activity)
 * and suspensions (Suspense holds). It is created by the first call of an API that needs it (see
 * concurrency.ts), so an application that never calls one of those APIs carries none of their code.
 * Renderers reach it through `transitionHooks()`.
 * @since 1.0.0
 */
export interface Hooks {
  /** The transition layer of one branch slot (see `slotSwap` in concurrency.ts). */
  slotSwap<C extends SlotChoice>(
    state: SlotState<C>,
    build: (choice: C, owned: SlotOwned, eager: boolean) => unknown,
    same: (a: C, b: C) => boolean,
    parent: Owner | null,
  ): SlotSwap<C>;
  /** A Suspense boundary's hold (see `boundaryHold` in concurrency.ts). */
  boundaryHold(): BoundaryHold;
  /** Queues an effect that is due in the transition lane, or parks it while its owner is paused. */
  place(effect: Computation, inLane: boolean): void;
  /** An urgent write reached an effect that waits in the lane or is parked: it moves to the urgent queue. */
  promote(effect: Computation): void;
  /** Forgets the lane queues (the flush loop guard). */
  clear(): void;
  /** Keeps `node` for a transition when `error` is a suspension; returns false for any other error. */
  suspend(node: Computation, error: unknown): boolean;
  /** The engine side of `holdReader`: throws the suspension sentinel when `tracker.hold()` is true. */
  holdReader(tracker: { hold?(): boolean }): void;
  /** The engine side of `startTransition` in the browser. */
  startTransition(fn: () => void): Promise<void>;
  /** The engine side of `beginHold`: counts one more Suspense hold. */
  beginHold(): void;
  /** The engine side of `endHold`: counts one hold less and settles the lane. */
  endHold(): void;
  /** The engine side of `wakeSuspended`. */
  wakeSuspended(): void;
  /** The engine side of `pauseOwner`. */
  pause(owner: Owner): void;
  /** The engine side of `resumeOwner`. */
  resume(owner: Owner): void;
  /** The engine side of `createTransitionHold`. */
  createHold(onSettled: () => void): TransitionHold;
}

/**
 * The runtime registers (R-CODE-4): the only module-level mutable state of core besides
 * monotonic counters. Every write is paired with a `finally` restore (R-CODE-5).
 *
 * Not a public symbol: `core/extend` re-exports only the types of this module, and the registers stay
 * behind the extension functions (`currentOwner`, `untrack` and friends) so a plugin cannot leave one set.
 * @internal
 */
export const rt: {
  /** Owner that adopts newly created nodes. */
  owner: Owner | null;
  /** Computation that records the signals it reads; null while untracked. */
  listener: Computation | null;
  /** Computation currently executing, tracked or not (used by the write-in-memo guard). */
  running: Computation | null;
  /** Nesting depth of batch()/flushSync() calls. */
  batches: number;
  /** True while the flush loop is draining the effect queues. */
  flushing: boolean;
  /** Nesting depth of memo recomputation, used to switch to iterative pulls. */
  nesting: number;
  /** Nesting depth of disposals in progress; errors raised meanwhile are collected, not thrown. */
  disposing: number;
  /** Errors nobody handled during the current flush or disposal; rethrown once it completes. */
  uncaught: unknown[];
  /** True while a transition callback or a transition-lane run is active: writes made now join the lane. */
  inTransition: boolean;
  /** True while `hydrate()` claims server markup (useExternalStore reads its server snapshot). */
  hydrating: boolean;
  /** The transition machinery, or null until an API that needs it is first called. */
  hooks: Hooks | null;
} = {
  owner: null,
  listener: null,
  running: null,
  batches: 0,
  flushing: false,
  nesting: 0,
  disposing: 0,
  uncaught: [],
  inTransition: false,
  hydrating: false,
  hooks: null,
};

let counter = 0;
/**
 * Monotonic creation sequence; orders sibling effects (G-16). Not a public symbol: only the engine
 * stamps nodes with it.
 * @internal
 */
export function nextSequence(): number {
  counter += 1;
  return counter;
}
