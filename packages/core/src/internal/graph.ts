import { DEVTOOLS_EVENT, report } from "./devtools";
import { ShadowError } from "./diagnostics";
import {
  CHECK,
  CLEAN,
  DIRTY,
  FLAG_DEFER,
  FLAG_DISPOSED,
  FLAG_HAS_ERROR,
  FLAG_REFRESHING,
  FLAG_RENDER,
  FLAG_RUNNING,
  FLAG_UNINIT,
  KIND_EFFECT,
  KIND_MEMO,
  KIND_SIGNAL,
} from "./flags";
import {
  addCleanup,
  disposeChildren,
  finishDisposal,
  handleError,
  hasErrorHandler,
  Owner,
} from "./owner";
import { enqueue } from "./queue";
import { nextSequence, rt } from "./state";
import type { Cleanup, Equals } from "./types";

// Shared and frozen until a computation reads its first source: most effects and memos in a large
// tree own few edges, and an empty array per node dominates creation cost.
const NO_SOURCES: Edges<Source> = Object.freeze([]) as unknown as Edges<Source>;

/** Memo nesting depth after which pulls switch from recursion to the iterative walk. */
const DEEP_LIMIT = 128;

/**
 * Anything that can be read reactively and notify observers: a signal, a memo, or a custom source
 * of a primitive. Exported from `@shadow-js/core/extend` as `SourceNode`. Read one with
 * {@link track}; after changing it, call {@link markObservers} and `schedule` (or `notify`).
 * @since 1.0.0
 */
export interface Source {
  /**
   * The node kind: 0 for a signal and for any custom source, which have no sources of their own; a
   * computation has its own kind. A refresh walks only the sources whose kind is not 0.
   */
  readonly kind: number;
  /** The current value. */
  value: unknown;
  /**
   * The computations that read this source in their last run, as pairs: an observer, then the index of this source in
   * that observer's `sources`. Null or empty when none. Read it with `observersOf`, which returns the observers alone.
   */
  observers: Edges<Computation> | null;
  /** Stamp of the last computation run that tracked this source (dedupes repeated reads). */
  stamp: number;
}

/**
 * The edges of one node, stored as pairs in one array: the node on the other side of the edge, then the index of this
 * node's entry in that node's own edge array. One array per side costs half the memory of two parallel ones, and
 * removing an edge stays O(1): the last pair moves into the vacated place and tells its owner where it went.
 */
export type Edges<T> = Array<T | number>;

/**
 * The storage of a signal: its value, its equality and the computations that read it. Exported from
 * `@shadow-js/core/extend` as `SignalNode`; create one with `createSignalNode`, read it with
 * {@link readSignal} and write it with `writeSignal`, which notifies its readers. Build a custom
 * primitive on it the way `useSignal` does.
 *
 * @example
 * import { createSignalNode, readSignal, SignalNode, writeSignal } from "@shadow-js/core/extend";
 *
 * const count = createSignalNode<number>(0, Object.is, "count");
 * writeSignal(count, 1);
 * console.log(readSignal(count), count instanceof SignalNode); // 1 true
 * @see createSignalNode
 * @since 1.0.0
 */
export class Signal<T = unknown> implements Source {
  /** Always 0, the kind of a signal. */
  readonly kind: number = KIND_SIGNAL;
  // Fields the constructor assigns are `declare`d: a plain field would also emit an empty initializer
  // (`parent;`) that every bundle carries.
  /**
   * The current value. Assigning it directly notifies no one: use `writeSignal`, or call `notify`
   * after the assignment.
   */
  declare value: T;
  /** Decides whether a write is a change; `false` treats every write as one. */
  declare equals: Equals<T>;
  /** The computations that read this signal in their last run, as pairs (see {@link Source.observers}). */
  observers: Edges<Computation> | null = null;
  /** Stamp of the last computation run that tracked this signal (dedupes repeated reads). */
  stamp = 0;
  /**
   * Label shown by devtools and diagnostics.
   * @default undefined (the signal is unnamed)
   */
  declare name: string | undefined;

  /**
   * Creates a signal. Prefer `createSignalNode`, which takes the same arguments.
   * @param value Initial value.
   * @param equals Equality that decides whether a write is a change.
   * @param name Devtools label, or undefined for an unnamed signal.
   */
  constructor(value: T, equals: Equals<T>, name?: string) {
    this.value = value;
    this.equals = equals;
    this.name = name;
    if (__DEV__) report(DEVTOOLS_EVENT.SIGNAL_CREATED, this, rt.owner, name, value);
  }
}

/**
 * A memo or an effect: an owner that reads sources and (for memos) is itself a source. Exported from
 * `@shadow-js/core/extend` as `ComputationNode`; create one with `createComputation` and read a memo
 * with `readComputation`. It owns what its function creates: each run first disposes the children
 * and runs the cleanups of the previous run.
 *
 * @example
 * import { createComputation, createSignalNode, readComputation, readSignal } from "@shadow-js/core/extend";
 *
 * const price = createSignalNode(10, Object.is);
 * const total = createComputation({ kind: "memo", fn: () => readSignal(price) * 2 });
 * console.log(readComputation<number>(total)); // 20
 * @see createComputation
 * @since 1.0.0
 */
export class Computation extends Owner implements Source {
  // Fields the constructor assigns are `declare`d: a plain field would also emit an empty initializer
  // (`parent;`) that every bundle carries.
  /** 1 for a memo, 2 for an effect. */
  declare kind: number;
  /** How stale the node is: 0 (clean), 1 (a transitive source changed), 2 (a direct source changed). */
  declare state: number;
  /** Engine bit flags (queued, running, disposed, render phase, ...). Read-only outside the engine. */
  declare flags: number;
  /** A memo's last value; an effect's last computed value when it has an `apply` stage. */
  declare value: unknown;
  /** The error a memo's last run threw, rethrown to its readers; undefined when it succeeded. */
  error: unknown = undefined;
  /** A memo's equality: readers are notified only when it says the new value differs. */
  declare equals: Equals<unknown>;
  /** The function each run calls with the previous value; null once disposed. */
  fn: ((previous: never) => unknown) | null;
  /**
   * An effect's second stage, run untracked with the computed value and the previous one; null for
   * none and once disposed.
   */
  apply: ((value: never, previous: never) => unknown) | null = null;
  /**
   * The sources the last run read, in reading order, as pairs: a source, then the index of this computation in that
   * source's `observers`. Read it with `sourcesOf`, which returns the sources alone.
   */
  sources: Edges<Source> = NO_SOURCES;
  /** The computations that read this memo in their last run, as pairs (see {@link Source.observers}). */
  observers: Edges<Computation> | null = null;
  /** Stamp of the current run while it tracks, and of the last run that tracked this memo. */
  stamp = 0;
  /** During a run: how many leading entries of `sources` were confirmed again (they keep their edges). */
  trackIndex = 0;
  /** Creation order; breaks ties between effects at equal depth (G-16). */
  declare seq: number;
  /**
   * Label shown by devtools and diagnostics.
   * @default undefined (the computation is unnamed)
   */
  declare name: string | undefined;

  /**
   * Creates a computation that has not run yet. Prefer `createComputation`, which also runs or
   * queues it.
   * @param parent The owner to attach to, or null.
   * @param kind 1 for a memo, 2 for an effect.
   * @param flags Initial engine bit flags.
   * @param fn The function each run calls.
   * @param equals A memo's equality; `false` for an effect.
   * @param name Devtools label, or undefined.
   */
  constructor(
    parent: Owner | null,
    kind: number,
    flags: number,
    fn: (previous: never) => unknown,
    equals: Equals<unknown>,
    name: string | undefined,
  ) {
    super(parent);
    this.kind = kind;
    this.flags = flags;
    this.state = DIRTY;
    this.fn = fn;
    this.equals = equals;
    this.name = name;
    this.value = undefined;
    this.seq = nextSequence();
    if (__DEV__) {
      report(
        DEVTOOLS_EVENT.COMPUTATION_CREATED,
        this,
        parent,
        kind === KIND_MEMO ? "memo" : "effect",
        name,
        (flags & FLAG_RENDER) !== 0,
      );
    }
  }

  protected override release(): void {
    this.flags |= FLAG_DISPOSED;
    unlinkFrom(this, 0);
    this.fn = null;
    this.apply = null;
  }
}

/**
 * Removes the pair at `at` from `source.observers` in O(1): the last pair moves into its place, and its observer is told
 * where it went.
 */
function removeObserver(source: Source, at: number): void {
  const observers = source.observers;
  if (observers === null) return;
  const last = observers.length - 2;
  if (at !== last) {
    const moved = observers[last] as Computation;
    const movedAt = observers[last + 1] as number;
    observers[at] = moved;
    observers[at + 1] = movedAt;
    moved.sources[movedAt + 1] = at;
  }
  observers.length = last;
}

/** Drops every edge from `node` to its sources. */
export function unlinkSources(node: Computation): void {
  unlinkFrom(node, 0);
}

/** Drops the edges from `node` to the sources at index `from` of `node.sources` and later, and truncates the list. */
function unlinkFrom(node: Computation, from: number): void {
  const sources = node.sources;
  if (sources.length <= from) return;
  for (let i = sources.length - 2; i >= from; i -= 2) {
    // The index in the source is read each time: removing an edge may move this node's pair in another source.
    removeObserver(sources[i] as Source, sources[i + 1] as number);
  }
  sources.length = from;
}

/**
 * The array with the pair `first`, `second` appended: a new array of exactly the right size while short (`new Array(n)`
 * allocates the backing store at that size, where `push` on a short array reserves room for sixteen), the same array
 * grown by `push` from sixteen entries on.
 */
function withEdge<T>(array: Array<T | number>, first: T, second: number): Array<T | number> {
  const length = array.length;
  if (length >= 16) {
    array.push(first, second);
    return array;
  }
  const next = new Array<T | number>(length + 2);
  for (let i = 0; i < length; i += 1) next[i] = array[i] as T | number;
  next[length] = first;
  next[length + 1] = second;
  return next;
}

/**
 * Records that the running computation read `source`, so a later {@link markObservers} on it marks
 * that computation stale. Call it in the reader of a custom source; {@link readSignal} does it for
 * signals. Does nothing when untracked, and a source read again in the same run is recorded once.
 *
 * @param source The source that was read.
 * @example
 * import { markObservers, schedule, type SourceNode, track } from "@shadow-js/core/extend";
 *
 * const clock: SourceNode = { kind: 0, value: Date.now(), observers: null, stamp: 0 };
 * export function now(): number {
 *   track(clock);
 *   return clock.value as number;
 * }
 * setInterval(() => {
 *   clock.value = Date.now();
 *   markObservers(clock);
 *   schedule();
 * }, 1000);
 * @see readSignal
 * @since 1.0.0
 */
export function track(source: Source): void {
  const listener = rt.listener;
  if (listener === null) return;
  if (source.stamp === listener.stamp) return;
  source.stamp = listener.stamp;
  // Same dependency at the same position as last run: keep the edge, touch nothing.
  const position = listener.trackIndex;
  if (position < listener.sources.length) {
    if (listener.sources[position] === source) {
      listener.trackIndex = position + 2;
      return;
    }
    unlinkFrom(listener, position);
  }
  // Edge arrays are small: most nodes have one to three edges. `push` on a short array reserves room for about sixteen
  // entries (200 bytes where an exact array takes 64, measured), and a large list pays it for every row. A short array
  // therefore grows into a new exact one; from sixteen entries on `push` amortizes. Nothing iterates an edge array of
  // a node while it tracks, so replacing the array is safe.
  const observers = source.observers;
  const sources = listener.sources;
  const at = observers === null ? 0 : observers.length;
  const index = sources.length;
  source.observers =
    observers === null
      ? [listener, index]
      : (withEdge(observers, listener, index) as Edges<Computation>);
  listener.sources = withEdge(sources, source, at) as Edges<Source>;
  listener.trackIndex = index + 2;
}

/**
 * The sources the last run of a computation read, in reading order. Use it to inspect the graph (a debugger, a test);
 * it is a snapshot, so changing the returned array changes no edge.
 *
 * @param node The memo or effect.
 * @returns The signals and memos it reads now.
 * @example
 * import { createComputation, createSignalNode, flushSync, readSignal, sourcesOf } from "@shadow-js/core/extend";
 *
 * const count = createSignalNode<number>(1, Object.is, "count");
 * const effect = createComputation({ kind: "effect", fn: () => void readSignal(count) });
 * flushSync();
 * console.log(sourcesOf(effect).length); // 1
 * @see observersOf
 * @since 1.0.0
 */
export function sourcesOf(node: Computation): Source[] {
  return everyOther(node.sources) as Source[];
}

/**
 * The computations that read a signal or memo in their last run, in the order their edges were made. It is a snapshot,
 * so changing the returned array changes no edge. The node's own `observers` array stores pairs (the observer and an
 * index for the engine), so read it through this function.
 *
 * @param source A signal, a memo or a custom source.
 * @returns The memos and effects that read it now.
 * @example
 * import { createComputation, createSignalNode, flushSync, observersOf, readSignal } from "@shadow-js/core/extend";
 *
 * const count = createSignalNode<number>(1, Object.is, "count");
 * createComputation({ kind: "effect", fn: () => void readSignal(count) });
 * flushSync();
 * console.log(observersOf(count).length); // 1
 * @see sourcesOf
 * @since 1.0.0
 */
export function observersOf(source: Source): Computation[] {
  return source.observers === null ? [] : (everyOther(source.observers) as Computation[]);
}

/** True when at least one computation read `source` in its last run. */
export function hasObservers(source: Source): boolean {
  return source.observers !== null && source.observers.length > 0;
}

/** The first element of every pair of an edge array. */
function everyOther<T>(edges: Edges<T>): T[] {
  const out: T[] = [];
  for (let i = 0; i < edges.length; i += 2) out.push(edges[i] as T);
  return out;
}

// Scratch stack for markObservers; never holds data across calls.
const markStack: Computation[] = [];

function stale(observer: Computation, next: number): void {
  const previous = observer.state;
  if (observer.kind === KIND_EFFECT) {
    if (previous < next) observer.state = next;
    if (previous === CLEAN) enqueue(observer);
    else if (!rt.inTransition) rt.hooks?.promote(observer);
    return;
  }
  if (previous >= next) return;
  observer.state = next;
  if (previous !== CLEAN) return;
  if (observer.observers !== null && observer.observers.length > 0) markStack.push(observer);
}

/**
 * A suspension (a transition read pending data inside a held boundary) keeps the node's value until the
 * boundary releases it. True when `error` was one, and the node was recorded for that wake-up.
 */
function trySuspend(node: Computation, error: unknown): boolean {
  return rt.hooks?.suspend(node, error) === true;
}

/**
 * A memo or effect frozen by a pause keeps its last value and does not refresh until it resumes.
 * A memo that never computed is not frozen (it has no value to keep).
 */
export function isFrozen(node: Computation): boolean {
  return node.pauses > 0 && (node.flags & FLAG_UNINIT) === 0;
}

/**
 * Marks the direct observers of a changed source DIRTY and everything downstream CHECK, and queues
 * the effects it reaches. It does not request a flush: call `schedule` afterward, or use `notify`,
 * which does both. Iterative: the graph can be 100,000 nodes deep (G-10).
 *
 * @param source The source whose value changed.
 * @example
 * import { markObservers, schedule, type SignalNode } from "@shadow-js/core/extend";
 *
 * export function push(list: SignalNode<string[]>, item: string): void {
 *   list.value.push(item); // same array: writeSignal would see no change
 *   markObservers(list);
 *   schedule();
 * }
 * @see track
 * @since 1.0.0
 */
export function markObservers(source: Source): void {
  staleObservers(source.observers, DIRTY);
  while (markStack.length > 0) {
    staleObservers((markStack.pop() as Computation).observers, CHECK);
  }
}

/** Marks every observer in a list of edge pairs stale at the given level. */
function staleObservers(observers: Edges<Computation> | null, next: number): void {
  if (observers === null) return;
  for (let i = 0; i < observers.length; i += 2) stale(observers[i] as Computation, next);
}

// Scratch frames for updateIfNecessary; entries above `frameTop` are dead.
const frameNodes: Computation[] = [];
const frameIndex: number[] = [];
let frameTop = 0;

/**
 * Brings `root` up to date: verifies stale sources oldest-first and recomputes only nodes whose
 * sources really changed (equality cut-off, G-2). Iterative so deep chains cannot overflow (G-10).
 * With `eagerSources`, DIRTY nodes also refresh their previous sources first, which keeps the
 * native stack flat for chains where every node reads both a fresh signal and its predecessor.
 */
export function updateIfNecessary(root: Computation, eagerSources = false): void {
  if (root.state === CLEAN) return;
  const base = frameTop;
  frameNodes[frameTop] = root;
  frameIndex[frameTop] = 0;
  frameTop += 1;
  root.flags |= FLAG_REFRESHING;
  try {
    while (frameTop > base) {
      const at = frameTop - 1;
      const node = frameNodes[at] as Computation;
      if (node.state === CHECK || (node.state === DIRTY && eagerSources)) {
        const sources = node.sources;
        let cursor = frameIndex[at] as number;
        let descended = false;
        while (cursor < sources.length) {
          const source = sources[cursor] as Source;
          cursor += 2;
          if (source.kind === KIND_SIGNAL) continue;
          const dependency = source as Computation;
          if (!needsUpdate(dependency)) continue;
          if ((dependency.flags & FLAG_RUNNING) !== 0) throw new ShadowError("CYCLE_DETECTED");
          // An owner that is about to re-run would dispose this dependency: update it first.
          if (!refreshAncestors(dependency)) continue;
          frameIndex[at] = cursor;
          frameNodes[frameTop] = dependency;
          frameIndex[frameTop] = 0;
          frameTop += 1;
          dependency.flags |= FLAG_REFRESHING;
          descended = true;
          break;
        }
        if (descended) continue;
      }
      if (node.state === DIRTY) recompute(node);
      else node.state = CLEAN;
      node.flags &= ~FLAG_REFRESHING;
      frameTop -= 1;
    }
  } finally {
    // An exception leaves frames on the stack: they must not stay marked as being refreshed.
    for (let i = base; i < frameTop; i += 1) {
      (frameNodes[i] as Computation).flags &= ~FLAG_REFRESHING;
    }
    frameNodes.length = base;
    frameIndex.length = base;
    frameTop = base;
  }
}

/** True when `node` is stale, alive and not frozen: running it now is both possible and needed. */
function needsUpdate(node: Computation): boolean {
  return node.state !== CLEAN && (node.flags & FLAG_DISPOSED) === 0 && !isFrozen(node);
}

/**
 * Brings stale owners of `node` up to date, topmost first. An owner that is about to re-run will
 * dispose `node`; computing `node` first would run it with state that is already out of date
 * (a zombie, G-17). Iterative: the owner chain depth is user controlled.
 *
 * @returns Whether `node` still needs updating afterward (an owner's run may have cleaned or disposed it).
 */
export function refreshAncestors(node: Computation): boolean {
  if (!needsUpdate(node)) return false;
  const stale: Computation[] = [];
  for (let owner = node.parent; owner !== null; owner = owner.parent) {
    if (
      owner instanceof Computation &&
      owner.state !== CLEAN &&
      (owner.flags & (FLAG_RUNNING | FLAG_REFRESHING)) === 0
    ) {
      stale.push(owner);
    }
  }
  for (let i = stale.length - 1; i >= 0; i -= 1) {
    const ancestor = stale[i] as Computation;
    if (needsUpdate(ancestor)) updateIfNecessary(ancestor);
  }
  return needsUpdate(node);
}

/**
 * Reads a signal's value, subscribing the running computation to it when one is listening. The
 * reader of a custom primitive built on `createSignalNode`.
 *
 * @param signal The signal to read.
 * @returns The current value.
 * @example
 * import { createSignalNode, readSignal } from "@shadow-js/core/extend";
 *
 * const name = createSignalNode("Ada", Object.is);
 * export const getName = (): string => readSignal(name);
 * @see track
 * @since 1.0.0
 */
export function readSignal<T>(signal: Signal<T>): T {
  if (rt.listener !== null) track(signal);
  return signal.value;
}

/** Reads a memo: refreshes it if stale, tracks it, rethrows its stored error. */
export function readMemo<T>(memo: Computation): T {
  if ((memo.flags & FLAG_RUNNING) !== 0) throw new ShadowError("CYCLE_DETECTED");
  if (memo.state !== CLEAN && refreshAncestors(memo)) {
    updateIfNecessary(memo, rt.recomputeDepth >= DEEP_LIMIT);
  }
  if (rt.listener !== null) track(memo);
  if ((memo.flags & FLAG_HAS_ERROR) !== 0) throw memo.error;
  return memo.value as T;
}

/** Re-runs a memo or effect: disposes the previous run, re-tracks sources, stores the result. */
export function recompute(node: Computation): void {
  const fn = node.fn;
  if (fn === null) return;
  // One disposal for the children and the cleanups: all of them run even when one throws (the errors
  // are held in rt.uncaught), and the node still re-runs (it would stay dirty otherwise).
  rt.disposing += 1;
  try {
    disposeChildren(node);
    node.runCleanups();
  } finally {
    rt.disposing -= 1;
  }
  // Edges are kept and re-confirmed in order while the function runs (see track()).
  node.trackIndex = 0;
  // Each run starts from a clean slate: handlers, ids and child indices belong to one run.
  node.errorHandlers = null;
  node.idCount = 0;
  node.childCount = 0;

  const previousOwner = rt.owner;
  const previousListener = rt.listener;
  const previousRunning = rt.running;
  rt.owner = node;
  rt.listener = node;
  rt.running = node;
  rt.recomputeDepth += 1;
  node.state = CLEAN;
  node.flags |= FLAG_RUNNING;
  node.stamp = nextSequence();

  let result: unknown;
  let failed = false;
  let failure: unknown;
  const startedAt = __DEV__ ? performance.now() : 0;
  try {
    result = (fn as (previous: unknown) => unknown)(node.value);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    rt.owner = previousOwner;
    rt.listener = previousListener;
    rt.running = previousRunning;
    rt.recomputeDepth -= 1;
    node.flags &= ~FLAG_RUNNING;
    // Sources this run did not read again are no longer dependencies. A node disposed while it ran
    // (it disposed its own owner) keeps none: reads after the disposal must not leave edges that
    // nothing will ever remove.
    unlinkFrom(node, (node.flags & FLAG_DISPOSED) !== 0 ? 0 : node.trackIndex);
  }

  let changed = true;
  if (node.kind === KIND_MEMO) changed = settleMemo(node, result, failed, failure);
  else settleEffect(node, result, failed, failure);
  if (__DEV__) {
    report(
      DEVTOOLS_EVENT.COMPUTATION_RUN,
      node,
      startedAt,
      performance.now() - startedAt,
      changed,
      sourcesOf(node),
    );
  }
  // The teardown's errors are thrown once the run is settled (unless a flush or an outer disposal collects them).
  rt.disposing += 1;
  finishDisposal();
}

/**
 * Calls a comparator untracked. It is a user callback: left tracked, the computation that writes (or the
 * reader that pulled the memo, the listener again once the run is over) would subscribe to whatever it
 * reads. Restored in `finally`, so a throwing comparator leaves the register as it found it.
 */
export function isEqual<T>(equals: (prev: T, next: T) => boolean, prev: T, next: T): boolean {
  const listener = rt.listener;
  rt.listener = null;
  try {
    return equals(prev, next);
  } finally {
    rt.listener = listener;
  }
}

/** Stores a memo's result; says whether its value changed (observers were told). */
function settleMemo(
  node: Computation,
  result: unknown,
  failed: boolean,
  failure: unknown,
): boolean {
  // A suspended memo keeps its previous value: its readers see nothing change until it resumes.
  if (failed && trySuspend(node, failure)) return false;
  const first = (node.flags & FLAG_UNINIT) !== 0;
  node.flags &= ~FLAG_UNINIT;
  const hadError = (node.flags & FLAG_HAS_ERROR) !== 0;
  let changed: boolean;
  if (failed && routeToHandler(node, failure)) {
    return false;
  }
  if (failed) {
    node.flags |= FLAG_HAS_ERROR;
    node.error = failure;
    changed = true;
  } else {
    node.flags &= ~FLAG_HAS_ERROR;
    node.error = undefined;
    const equals = node.equals;
    try {
      changed = first || hadError || equals === false || !isEqual(equals, node.value, result);
      if (changed) node.value = result;
    } catch (comparatorError) {
      // A throwing comparator is a failing memo, not a wedged graph: readers see the error.
      node.flags |= FLAG_HAS_ERROR;
      node.error = comparatorError;
      changed = true;
    }
  }
  if (!changed || first) return changed;
  const observers = node.observers;
  if (observers === null) return changed;
  for (let i = 0; i < observers.length; i += 2) {
    const observer = observers[i] as Computation;
    if (observer.state === CHECK) observer.state = DIRTY;
  }
  return changed;
}

/**
 * A memo that fails inside a boundary (an ancestor registered catchError()/onError()) reports to it
 * when it fails, and keeps its previous value. Readers then see that value instead of the error:
 * the reader may live outside the boundary (the DOM region that displays the memo's result), where a
 * rethrown error would escape the very boundary meant to catch it. Without a handler the error is
 * stored and rethrown to readers, so it is never silent.
 *
 * The first computation counts too: its value is `undefined`, and it is typically read by a
 * consumer outside the boundary (a DOM region), not by the code that created it.
 */
function routeToHandler(node: Computation, failure: unknown): boolean {
  if (!hasErrorHandler(node)) return false;
  node.flags &= ~FLAG_HAS_ERROR;
  node.error = undefined;
  try {
    handleError(failure, node);
  } catch (unhandled) {
    // The chain ended in a handler that rethrew: readers see it, as for any unhandled failure.
    node.flags |= FLAG_HAS_ERROR;
    node.error = unhandled;
  }
  return true;
}

function settleEffect(node: Computation, result: unknown, failed: boolean, failure: unknown): void {
  if (failed) {
    if (!trySuspend(node, failure)) handleError(failure, node);
    return;
  }
  const apply = node.apply;
  let cleanup: unknown;
  if (apply === null) {
    cleanup = result;
  } else {
    const deferred = (node.flags & FLAG_DEFER) !== 0;
    node.flags &= ~FLAG_DEFER;
    const previousValue = node.value;
    node.value = result;
    if (deferred) return;
    const previousOwner = rt.owner;
    const previousListener = rt.listener;
    const previousRunning = rt.running;
    rt.owner = node;
    rt.listener = null;
    // Writes from an effect's apply are legal even when the effect was created inside a memo.
    rt.running = node;
    try {
      cleanup = (apply as (value: unknown, previous: unknown) => unknown)(result, previousValue);
    } catch (error) {
      if (!trySuspend(node, error)) handleError(error, node);
      return;
    } finally {
      rt.owner = previousOwner;
      rt.listener = previousListener;
      rt.running = previousRunning;
    }
  }
  if (typeof cleanup === "function") {
    addCleanup(node, cleanup as Cleanup);
    // The effect disposed its own owner while running: nothing will dispose it again, so run now.
    if ((node.flags & FLAG_DISPOSED) !== 0) node.runCleanups();
  }
}
