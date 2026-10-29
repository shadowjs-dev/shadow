import {
  addCleanup,
  type Cleanup,
  currentOwner,
  disposeOwner,
  type ErrorHandler,
  handleError,
  Owner,
  runInScope,
  ShadowError,
  warn,
} from "./extend";

export type { Owner };

/** Where the copies of core list themselves; `Symbol.for` makes the key the same in every copy. */
const REGISTRY_KEY = "shadow-js.core.instances";

/**
 * The most copies the registry lists. Real programs have one, a misconfigured one two or three; the
 * limit keeps a program that loads core in a loop (a hot-reload bug) from growing the shared map.
 */
const MAX_LISTED_COPIES = 8;

/**
 * The identity of this copy of the module (every evaluation of the module makes its own) and the build it is:
 * the server build and the client build are different files by design, and tests that render on the server
 * and hydrate in one process load one of each, so only copies of the same build count as duplicates.
 */
const COPY: { readonly server: boolean } = { server: __SERVER__ };

/** The registry of the copies of core and how many roots each has alive, or undefined before any root exists. */
function copyRegistry(): Map<{ readonly server: boolean }, number> | undefined {
  const found = (globalThis as { [key: symbol]: unknown })[Symbol.for(REGISTRY_KEY)];
  return found instanceof Map ? found : undefined;
}

/** Development only. Counts a disposed root out of this copy's entry; the entry goes with its last root. */
function releaseRoot(): void {
  const registry = copyRegistry();
  const live = registry?.get(COPY);
  if (registry === undefined || live === undefined) return;
  if (live > 1) registry.set(COPY, live - 1);
  else registry.delete(COPY);
}

/**
 * Development only. Lists a new root under this copy of core in a registry on `globalThis`, which counts the
 * live roots of every copy, and warns `DUPLICATE_CORE` (once per copy) when another copy of the same build has
 * live roots: two copies cannot see each other's signals. A copy leaves the registry when its last root is disposed, so copies
 * that never run at the same time (separate test files, a reload) do not warn. Called from `createRoot` only
 * behind `__DEV__`, and only when a root is created, never when the module is imported. The release is one
 * shared function, so a root costs no closure: rows of a list make a root each.
 */
function listRoot(root: Owner): void {
  let registry = copyRegistry();
  if (registry === undefined) {
    registry = new Map();
    (globalThis as { [key: symbol]: unknown })[Symbol.for(REGISTRY_KEY)] = registry;
  }
  const listed = registry.has(COPY);
  for (const copy of registry.keys()) {
    if (copy !== COPY && copy.server === COPY.server) {
      warn("DUPLICATE_CORE");
      break;
    }
  }
  // A copy past the limit is not listed; the warning above has been given by then.
  if (!listed && registry.size >= MAX_LISTED_COPIES) return;
  registry.set(COPY, (registry.get(COPY) ?? 0) + 1);
  addCleanup(root, releaseRoot);
}

/**
 * Runs `fn` without subscribing the running computation to anything `fn` reads. Use it inside an
 * effect or a memo to read a value without re-running when that value changes. The current owner
 * is kept, so effects and cleanups created inside `fn` are still owned.
 *
 * @param fn The function to run untracked.
 * @returns Whatever `fn` returns. An error thrown by `fn` propagates unchanged.
 * @example
 * import { untrack, useEffect, useSignal } from "@shadow-js/core";
 *
 * const [count, setCount] = useSignal(0);
 * const [unit] = useSignal("clicks");
 * useEffect(() => {
 *   // Re-runs when `count` changes, never when `unit` changes.
 *   console.log(`${count()} ${untrack(unit)}`);
 * });
 * setCount(1);
 * @see useEvent
 * @since 1.0.0
 */
export function untrack<T>(fn: () => T): T {
  return runInScope({ listener: null }, fn);
}

/**
 * Options of {@link createRoot}.
 * @since 1.0.0
 */
export interface RootOptions {
  /**
   * When true, the root is not attached to the current owner: it outlives that owner and is
   * disposed only through the `dispose` function passed to the body. It still sees the context
   * values provided above the current owner.
   * @default false (the root is a child of the current owner and is disposed with it)
   */
  detached?: boolean;
}

/**
 * Creates an ownership scope. Everything created inside (effects, memos, cleanups, children) is
 * disposed together when `dispose` is called or, for attached roots, when the parent disposes. Use
 * it for code that runs outside a component, such as an app entry point, a test or a module that
 * owns long-lived effects. Development builds also use the root to find a second copy of core: a root
 * created while a root of another copy is alive warns `DUPLICATE_CORE` once.
 *
 * @param fn Body; receives the `dispose` function. Runs untracked, with the new root as owner.
 * @param options `detached` keeps the root out of the current owner. Undefined uses the default
 * (attached).
 * @returns Whatever `fn` returns.
 * @throws Rethrows any error thrown by `fn`, after the root and everything created in it are
 * disposed. When a cleanup of the root throws as well, both errors are thrown together as an
 * `AggregateError` (the body's first), so the body's error is never replaced.
 * @example
 * import { createRoot, useEffect, useSignal } from "@shadow-js/core";
 *
 * const [count, setCount] = useSignal(0);
 * const dispose = createRoot((dispose) => {
 *   useEffect(() => console.log(count()));
 *   return dispose;
 * });
 * setCount(1);
 * dispose(); // the effect stops and its cleanups run
 * @see getOwner
 * @since 1.0.0
 */
export function createRoot<T>(fn: (dispose: () => void) => T, options?: RootOptions): T {
  const detached = options?.detached === true;
  const current = currentOwner();
  const root = new Owner(detached ? null : current);
  if (detached) root.context = current === null ? null : current.context;
  if (__DEV__) listRoot(root);
  try {
    return runInScope({ owner: root, listener: null }, () => fn(() => disposeOwner(root)));
  } catch (error) {
    try {
      disposeOwner(root);
    } catch (cleanupError) {
      // The body's error says what went wrong; a cleanup error must not replace it.
      throw new AggregateError(
        [error, cleanupError],
        __DEV__ ? "The root body threw and so did its disposal." : "SHADOW_ROOT_ERRORS",
      );
    }
    throw error;
  }
}

/**
 * Returns the owner that currently adopts new effects, memos and cleanups. Capture it while a
 * component or root runs, then hand it to {@link runWithOwner} from code that runs later.
 *
 * @returns The current owner, or `null` outside any owner (at module scope, or in a callback that
 * runs after an `await` or a timer).
 * @example
 * import { getOwner, onCleanup, runWithOwner } from "@shadow-js/core";
 *
 * function Poller() {
 *   const owner = getOwner();
 *   setTimeout(() => {
 *     runWithOwner(owner, () => onCleanup(() => console.log("poller disposed")));
 *   }, 1000);
 *   return null;
 * }
 * @see runWithOwner
 * @since 1.0.0
 */
export function getOwner(): Owner | null {
  return currentOwner();
}

/**
 * Runs `fn` with `owner` as the current owner, untracked. Use it to restore ownership after an
 * `await` or inside callbacks that outlive the synchronous run, so that effects, cleanups and
 * context reads inside `fn` attach to that owner. A disposed owner is ignored: `fn` then runs
 * without an owner, and development builds warn `RUN_WITH_DISPOSED_OWNER`.
 *
 * @param owner The owner to make current, usually captured with {@link getOwner}. `null` runs `fn`
 * without an owner.
 * @param fn The function to run.
 * @returns Whatever `fn` returns. An error thrown by `fn` propagates unchanged.
 * @example
 * import { createContext, getOwner, runWithOwner, useContext } from "@shadow-js/core";
 *
 * const Locale = createContext("en");
 *
 * function Clock() {
 *   const owner = getOwner();
 *   queueMicrotask(() => {
 *     const locale = runWithOwner(owner, () => useContext(Locale));
 *     console.log(new Date().toLocaleTimeString(locale));
 *   });
 *   return null;
 * }
 * @see getOwner
 * @since 1.0.0
 */
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  let target = owner;
  if (target?.disposed) {
    warn("RUN_WITH_DISPOSED_OWNER");
    target = null;
  }
  return runInScope({ owner: target, listener: null }, fn);
}

/**
 * Registers `fn` to run when the current owner is disposed or, for an effect or memo, before it
 * re-runs. Cleanups run newest first and untracked; one that throws does not stop the others, and
 * its error goes to the nearest error handler ({@link onError}, {@link catchError}). Outside any owner the call does nothing, because
 * nothing would ever run the cleanup; development builds warn `NO_OWNER_CLEANUP`.
 *
 * @param fn The cleanup to register.
 * @example
 * import { onCleanup } from "@shadow-js/core";
 *
 * function Ticker() {
 *   const timer = setInterval(() => console.log("tick"), 1000);
 *   onCleanup(() => clearInterval(timer));
 *   return null;
 * }
 * @see onMount
 * @since 1.0.0
 */
export function onCleanup(fn: Cleanup): void {
  const owner = currentOwner();
  if (owner === null) {
    warn("NO_OWNER_CLEANUP");
    return;
  }
  addCleanup(owner, fn);
}

/**
 * Registers an error handler on the current owner. It receives errors thrown in this owner's scope
 * (its effects, memos, cleanups and child owners) that no closer handler took. Handlers on the same
 * owner are tried newest first; a handler that throws passes its own error to the next handler up.
 * Outside any owner the call does nothing; development builds warn `NO_OWNER_ERROR`.
 *
 * @param handler Receives the error, untracked. Throw from it to pass an error on to the next handler.
 * @example
 * import { onError, useEffect } from "@shadow-js/core";
 *
 * function Dashboard() {
 *   onError((error) => console.error("dashboard failed:", error));
 *   useEffect(() => {
 *     throw new Error("widget crashed"); // reaches the handler above
 *   });
 *   return null;
 * }
 * @see catchError
 * @since 1.0.0
 */
export function onError(handler: ErrorHandler): void {
  const owner = currentOwner();
  if (owner === null) {
    warn("NO_OWNER_ERROR");
    return;
  }
  if (owner.errorHandlers === null) owner.errorHandlers = [handler];
  else owner.errorHandlers.push(handler);
}

/**
 * Runs `fn` inside a new child scope whose errors go to `handler`: errors thrown synchronously by
 * `fn`, and later errors of the effects, memos and cleanups it created. The scope is disposed with
 * the current owner. Use it to contain the failures of one part of a component tree.
 *
 * @param fn The function to run; it runs untracked, with the new scope as owner.
 * @param handler Receives each error, untracked. Throw from it to pass the error on to the next handler up.
 * @returns Whatever `fn` returns, or `undefined` when `fn` threw and `handler` took the error.
 * @throws Rethrows the error `handler` throws when no handler above takes it (outside a flush).
 * @example
 * import { catchError, useEffect } from "@shadow-js/core";
 *
 * function Widget() {
 *   return catchError(
 *     () => {
 *       useEffect(() => {
 *         throw new Error("network down");
 *       });
 *       return "ready";
 *     },
 *     (error) => console.error("widget failed:", error),
 *   );
 * }
 * @see onError
 * @since 1.0.0
 */
export function catchError<T>(fn: () => T, handler: ErrorHandler): T | undefined {
  const scope = new Owner(currentOwner());
  scope.errorHandlers = [handler];
  try {
    return runWithOwner(scope, fn);
  } catch (error) {
    return void handleError(error, scope);
  }
}

/**
 * Returns an id that is identical on server and client for the same position in the owner tree.
 * The id uses only letters, digits, `-` and `_`, so it is valid in `id`, `for`, `aria-*` references
 * and in `querySelector("#" + id)` without escaping. Use it to link a label to its input, or an
 * element to its `aria-describedby` target, in markup that is rendered on the server and hydrated.
 *
 * @returns A new id, unique within the root; each call on the same owner returns the next one.
 * @throws ShadowError `NO_OWNER_ID` when called outside any owner, because no stable id exists
 * there.
 * @example
 * import { useId } from "@shadow-js/core";
 *
 * function EmailField() {
 *   const id = useId();
 *   return (
 *     <>
 *       <label for={id}>Email</label>
 *       <input id={id} type="email" />
 *     </>
 *   );
 * }
 * @since 1.0.0
 */
export function useId(): string {
  const owner = currentOwner();
  if (owner === null) throw new ShadowError("NO_OWNER_ID");
  // An owner with an id prefix (a component the renderer put in a hydration scope) hosts the ids of
  // everything below it: the prefix already encodes where the component is, and the owners between
  // here and there (effects exist in the browser, not on the server) must not leak into the id.
  for (let host: Owner | null = owner; host !== null; host = host.parent) {
    if (host.idPrefix === undefined) continue;
    const hosted = host.idCount;
    host.idCount += 1;
    return `s${host.idPrefix}${hosted}`;
  }
  const path: number[] = [];
  for (let node: Owner | null = owner; node !== null; node = node.parent) path.push(node.index);
  path.reverse();
  const sequence = owner.idCount;
  owner.idCount += 1;
  return `s${path.join("-")}_${sequence}`;
}
