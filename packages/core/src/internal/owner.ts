import { DEVTOOLS_EVENT, report } from "./devtools";
import { rt } from "./state";
import type { Cleanup, ErrorHandler } from "./types";

/**
 * The context values an owner sees, keyed by the symbol of each context. A provider creates a map
 * whose prototype is its parent's map, so a lookup is one property read and never walks owners.
 * @since 1.0.0
 */
export type ContextMap = Record<symbol, unknown>;

/**
 * A node in the ownership tree: it owns the effects, memos and owners created under it, their
 * cleanups and error handlers, and disposes them together. Create one with `createOwner` and end it
 * with `disposeOwner`; the class is exported for `instanceof` checks and for reading its state.
 * Computations (`ComputationNode`) are owners too. Children are a doubly linked list so detaching one
 * is O(1); disposal walks the tree iteratively because its depth is user controlled (R-CODE-11).
 *
 * @example
 * import { createOwner, disposeOwner, Owner } from "@shadow-js/core/extend";
 *
 * const owner = createOwner(null);
 * console.log(owner instanceof Owner, owner.depth); // true 0
 * disposeOwner(owner);
 * console.log(owner.disposed); // true
 * @see createOwner
 * @see disposeOwner
 * @since 1.0.0
 */
export class Owner {
  // Fields the constructor assigns are `declare`d: a plain field would also emit an empty initializer
  // (`parent;`) that every bundle carries.
  /** The owner this node was created under, or null for a root. Kept after disposal. */
  declare parent: Owner | null;
  /** The newest child that is still alive, or null when there is none. */
  lastChild: Owner | null = null;
  /** The next older sibling that is still alive, or null. */
  prevSibling: Owner | null = null;
  /** The next newer sibling that is still alive, or null. */
  nextSibling: Owner | null = null;
  /**
   * The cleanups registered with `addCleanup` or `onCleanup`: null for none, a function for one, an
   * array (oldest first) for several. Emptied when they run.
   */
  cleanups: Cleanup | Cleanup[] | null = null;
  /** The context values this node sees: inherited from the parent at creation, null for a root. */
  declare context: ContextMap | null;
  /**
   * The handlers registered with `onError` or `catchError`, oldest first (they are tried newest
   * first), or null for none. A computation clears them before each run.
   */
  errorHandlers: ErrorHandler[] | null = null;
  /** Number of children ever created; gives each child a stable index for useId(). */
  childCount = 0;
  /** Number of ids useId() has handed out from this owner. */
  idCount = 0;
  /** Position among the parent's children, assigned at creation. */
  declare index: number;
  /** Distance from the root: 0 for a root, the parent's depth plus one otherwise. */
  declare depth: number;
  /**
   * The hydration-scope prefix of a component's owner, set by the renderer. When present, useId()
   * builds the ids below it from this prefix instead of the owner path.
   * @default undefined
   */
  // A real field, not `declare`d: the renderer sets it only on component owners, and an owner shape that
  // already holds it keeps every owner on one hidden class.
  idPrefix: string | undefined;
  /** True once the node has been disposed. */
  disposed = false;
  /**
   * While this returns true, user effects (and `onMount`) created below this owner wait: they do
   * not run until it returns false for the first time. Suspense sets it so the effects of content
   * that is still loading are held back. The read is tracked. A node starts with the gate of its
   * parent, so the nearest gate is the one on the owner an effect is created under.
   */
  gate: (() => boolean) | null = null;
  /**
   * Number of pauses (Activity hidden) that cover this node. Inherited at creation, and changed for a
   * whole subtree by `pauseOwner`/`resumeOwner`. Above zero, effects wait and memos keep their value.
   */
  pauses = 0;

  /**
   * Creates an owner and links it as the newest child of `parent`. It inherits the parent's context
   * and pauses.
   * @param parent The owner to attach to, or null for a root.
   */
  constructor(parent: Owner | null) {
    this.parent = parent;
    if (parent === null) {
      this.context = null;
      this.depth = this.index = 0;
    } else {
      this.context = parent.context;
      this.depth = parent.depth + 1;
      this.pauses = parent.pauses;
      // The nearest gate above, copied: a boundary sets its own gate before it creates what lives below it.
      this.gate = parent.gate;
      this.index = parent.childCount;
      parent.childCount += 1;
      const last = parent.lastChild;
      this.prevSibling = last;
      if (last !== null) last.nextSibling = this;
      parent.lastChild = this;
    }
    // Computations report themselves (with their kind); plain owners and subclasses of it here.
    if (__DEV__ && new.target === Owner) {
      report(DEVTOOLS_EVENT.OWNER_CREATED, this, parent, parent === null ? "root" : "owner");
    }
  }

  /**
   * Hook for subclasses: release graph edges before the node is marked disposed. Declared, not
   * defined: a plain owner holds no graph edges, and an empty method would ship in every bundle.
   */
  protected release?(): void;

  /**
   * Disposes this node only (children must already be gone).
   * @internal
   */
  disposeSelf(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Detach first: a cleanup that throws must never leave a dead node in the tree (R-CODE-5).
    const parent = this.parent;
    if (parent !== null) {
      const prev = this.prevSibling;
      const next = this.nextSibling;
      if (prev !== null) prev.nextSibling = next;
      if (next !== null) next.prevSibling = prev;
      else parent.lastChild = prev;
      this.prevSibling = null;
      this.nextSibling = null;
    }
    this.release?.();
    // A computation reports itself with its own event (it is the only subclass, and only it has a kind).
    if (__DEV__) {
      report(
        "kind" in this ? DEVTOOLS_EVENT.COMPUTATION_DISPOSED : DEVTOOLS_EVENT.OWNER_DISPOSED,
        this,
      );
    }
    this.runCleanups();
  }

  /**
   * Runs own cleanups newest first, untracked, isolating failures.
   * @internal
   */
  runCleanups(): void {
    const cleanups = this.cleanups;
    if (cleanups === null) return;
    this.cleanups = null;
    const previousOwner = rt.owner;
    const previousListener = rt.listener;
    rt.owner = null;
    rt.listener = null;
    try {
      if (typeof cleanups === "function") {
        runCleanup(cleanups, this);
      } else {
        for (let i = cleanups.length - 1; i >= 0; i -= 1) {
          const cleanup = cleanups[i];
          if (cleanup !== undefined) runCleanup(cleanup, this);
        }
      }
    } finally {
      rt.owner = previousOwner;
      rt.listener = previousListener;
    }
  }
}

function runCleanup(cleanup: Cleanup, owner: Owner): void {
  try {
    cleanup();
  } catch (error) {
    handleError(error, owner);
  }
}

/**
 * Registers `cleanup` on an explicit owner. It runs when the owner is disposed or, when the owner is a
 * computation, before its next run. Cleanups run newest first, untracked and with no current owner;
 * one that throws goes to {@link handleError} for that owner and does not stop the others. Use it
 * where `onCleanup` cannot be called: the owner is not the current one, or the code must not warn.
 * Unlike `onCleanup`, nothing checks that the owner is still alive: a cleanup added to a disposed
 * owner never runs.
 *
 * @param owner The owner whose disposal runs the cleanup.
 * @param cleanup The function to run.
 * @example
 * import { addCleanup, currentOwner } from "@shadow-js/core/extend";
 *
 * export function useInterval(tick: () => void, ms: number): void {
 *   const owner = currentOwner();
 *   const timer = setInterval(tick, ms);
 *   if (owner !== null) addCleanup(owner, () => clearInterval(timer));
 * }
 * @see disposeOwner
 * @since 1.0.0
 */
export function addCleanup(owner: Owner, cleanup: Cleanup): void {
  const existing = owner.cleanups;
  if (existing === null) owner.cleanups = cleanup;
  else if (typeof existing === "function") owner.cleanups = [existing, cleanup];
  else existing.push(cleanup);
}

/**
 * Disposes every child of `owner` (newest first), keeping `owner` itself alive.
 * @internal
 */
export function disposeChildren(owner: Owner): void {
  for (;;) {
    const child = owner.lastChild;
    if (child === null) return;
    disposeTree(child);
  }
}

/** Rethrows what disposal collected once the outermost disposal is finished. */
function finishDisposal(): void {
  rt.disposing -= 1;
  if (rt.disposing > 0 || rt.flushing || rt.uncaught.length === 0) return;
  const errors = rt.uncaught;
  rt.uncaught = [];
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(
    errors,
    __DEV__ ? "Several errors were thrown while disposing." : "SHADOW_DISPOSE_ERRORS",
  );
}

/**
 * Disposes `root` and everything below it: children first, then own cleanups, newest first.
 * Iterative post-order walk: a leaf is disposed, which re-links its parent's `lastChild`
 * to the previous sibling, so the loop naturally visits the remaining subtree. The public
 * `disposeOwner` (dispose.ts) wraps it with the flush that follows.
 * @internal
 */
export function disposeTree(root: Owner): void {
  rt.disposing += 1;
  try {
    let node: Owner = root;
    for (;;) {
      while (node.lastChild !== null) node = node.lastChild;
      const parent: Owner | null = node.parent;
      node.disposeSelf();
      if (node === root || parent === null) break;
      node = parent;
    }
  } finally {
    finishDisposal();
  }
}

/**
 * Routes `error` to the nearest handler registered with `catchError` or `onError`, searching `from`
 * and then its ancestors, newest handler first on each owner. Handlers run untracked and restore
 * the caller's tracking even when they rethrow. Use it for errors that happen outside
 * any computation (a rejected promise, an event callback), so they reach the same boundary as errors
 * thrown during rendering. A handler that throws hands its own error to the next handler up the
 * chain. With no handler left the error is uncaught: collected until the running flush or disposal
 * ends (which then throws it), or thrown at once otherwise.
 *
 * @param error The thrown value.
 * @param from The owner where the error happened. Null searches no handler: the error is uncaught.
 * @throws The error (or the last error a handler threw) when no handler catches it and no flush or
 * disposal is running.
 * @example
 * import { currentOwner, handleError } from "@shadow-js/core/extend";
 *
 * export function useSaveOnLoad(save: () => Promise<void>): void {
 *   const owner = currentOwner();
 *   save().catch((error: unknown) => handleError(error, owner));
 * }
 * @since 1.0.0
 */
export function handleError(error: unknown, from: Owner | null): void {
  if (__DEV__) report(DEVTOOLS_EVENT.ERROR, from, error, codeOf(error));
  let current = error;
  for (let owner = from; owner !== null; owner = owner.parent) {
    const handlers = owner.errorHandlers;
    if (handlers === null) continue;
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
      const handler = handlers[i];
      if (handler === undefined) continue;
      const previousListener = rt.listener;
      try {
        rt.listener = null;
        return void handler(current);
      } catch (next) {
        current = next;
      } finally {
        rt.listener = previousListener;
      }
    }
  }
  reportUncaught(current);
}

/**
 * True when `handleError(_, from)` would reach a handler registered by catchError()/onError().
 * @internal
 */
export function hasErrorHandler(from: Owner | null): boolean {
  for (let owner = from; owner !== null; owner = owner.parent) {
    const handlers = owner.errorHandlers;
    if (handlers !== null && handlers.length > 0) return true;
  }
  return false;
}

/**
 * The diagnostic code of a ShadowJS error, for devtools. Reads an own data property only: a getter on a thrown
 * value would run user code inside the error path, and a throw there would replace the error being handled.
 */
function codeOf(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function reportUncaught(error: unknown): void {
  if (rt.flushing || rt.disposing > 0) rt.uncaught.push(error);
  else throw error;
}
