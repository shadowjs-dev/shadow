import {
  type Accessor,
  catchError,
  createRoot,
  getOwner,
  onCleanup,
  untrack,
  useMemo,
  useSignal,
} from "@shadow-js/core";
import { handleError, readSignal, SignalNode, writeSignal } from "@shadow-js/core/extend";
import { currentScope, type HydrationScope, withScope } from "../extend";
import type { JsxChild } from "../jsx/types";
import { attachHotModules, createHotLink, type HotLink } from "./hot-link";
import { rootErrorsOf } from "./root-errors";

/**
 * Props of {@link ErrorBoundary}.
 * @since 1.0.0
 */
export interface ErrorBoundaryProps {
  /**
   * Shown after an error. A function is called untracked as `(error, reset)`; any other value is
   * shown as is.
   */
  readonly fallback: JsxChild | ((error: unknown, reset: () => void) => unknown);
  /**
   * The protected content, read untracked when the children are built.
   * @default undefined (nothing is protected; the boundary renders nothing)
   */
  readonly children?: JsxChild | (() => unknown);
}

/**
 * {@link ErrorBoundaryProps} with untyped members, for code that forwards a fallback or children it
 * does not know the shape of.
 * @since 1.0.0
 */
export interface ErrorBoundaryLooseProps {
  /** Shown after an error; the same contract as {@link ErrorBoundaryProps.fallback}. */
  readonly fallback: unknown;
  /**
   * The protected content; the same contract as {@link ErrorBoundaryProps.children}.
   * @default undefined (nothing is protected; the boundary renders nothing)
   */
  readonly children?: unknown;
}

/** A caught error, wrapped so that any thrown value (including `undefined`) is representable. */
interface Failure {
  readonly error: unknown;
}

/**
 * Renders `children`. If they throw while being created, or any effect, memo or cleanup inside
 * them throws later, the children are disposed and `fallback` is rendered instead. A function
 * fallback receives the error and a `reset` that rebuilds the children from scratch.
 *
 * Errors raised while the boundary is building or tearing down its children are captured and
 * never write a signal, because writing inside a memo is an error. Late errors write the failure
 * signal, which re-runs the boundary. After the boundary is disposed, late errors are dropped.
 * Errors thrown by the fallback are not caught by this boundary; they reach the parent.
 *
 * @param props See {@link ErrorBoundaryProps}.
 * @returns An accessor of the current content (children or fallback).
 * @throws Nothing itself. An error from the children is shown through `fallback`, and an error
 * thrown by a function `fallback` goes to the enclosing boundary or the root's error handler.
 * @example
 * import { ErrorBoundary } from "@shadow-js/web";
 *
 * function Dashboard() {
 *   return <p>Dashboard</p>;
 * }
 *
 * function Page() {
 *   return (
 *     <ErrorBoundary
 *       fallback={(error, reset) => (
 *         <button onClick={reset}>Retry after: {String(error)}</button>
 *       )}
 *     >
 *       <Dashboard />
 *     </ErrorBoundary>
 *   );
 * }
 * @see Suspense
 * @since 1.0.0
 */
export function ErrorBoundary(props: ErrorBoundaryProps): Accessor<unknown>;
export function ErrorBoundary(props: ErrorBoundaryLooseProps): Accessor<unknown>;
export function ErrorBoundary(props: ErrorBoundaryLooseProps): Accessor<unknown> {
  // An extension-API cell: a failure is boundary state, written from places a plain write refuses
  // (a sibling boundary's fallback throwing while its memo computes).
  const failureCell = new SignalNode<Failure | undefined>(undefined, Object.is);
  /** Where an error of this boundary's own fallback goes: the boundary that encloses it. */
  const parentOwner = getOwner();
  // The root's reporters (render/hydrate options): an error this boundary takes is reported to them.
  const roots = rootErrorsOf(parentOwner);
  /** The hydration scope at creation (a copy of its counts), or null outside a hydration or server render. */
  const live = currentScope();
  const origin: HydrationScope | null =
    live === null ? null : { id: live.id, count: live.count, resources: live.resources };
  const failure = (): Failure | undefined => readSignal(failureCell);
  const setFailure = (next: Failure | undefined): void => {
    writeSignal(failureCell, next, { allowInMemo: true });
  };
  /** Bumped by reset(): forces a rebuild even when no failure was recorded. */
  const [version, setVersion] = useSignal(0, { equals: false });
  /** False once the boundary's owner is disposed. */
  let alive = true;
  /** True while the body memo is building or tearing down children; errors are captured then. */
  let busy = false;
  /** An error captured while busy, consumed by the next body computation. */
  let pending: Failure | undefined;

  const reset = (): void => {
    if (!alive) return;
    setFailure(undefined);
    setVersion((count) => count + 1);
  };

  /**
   * Dev only: the modules the children were built from. While the fallback is shown, a hot update of one of
   * them resets the boundary, so the edit that fixes the error shows the children without a retry.
   */
  const hot: HotLink | undefined = __DEV__
    ? createHotLink(() => {
        reset();
      })
    : undefined;

  const report = (error: unknown): void => {
    if (!alive) return;
    roots?.onCaughtError?.(error);
    if (busy) {
      if (pending === undefined) pending = { error };
      return;
    }
    setFailure({ error });
  };

  /** Returns the captured error and clears it. A function, so TypeScript does not narrow the variable. */
  const takePending = (): Failure | undefined => {
    const captured = pending;
    pending = undefined;
    return captured;
  };

  const fallbackFor = (error: unknown): unknown => {
    const fallback = props.fallback;
    if (typeof fallback !== "function") return fallback;
    try {
      return untrack(() =>
        (fallback as (error: unknown, reset: () => void) => unknown)(error, reset),
      );
    } catch (thrown) {
      // A failing fallback is not this boundary's business: hand it to the enclosing boundary now.
      // Left to the memo it would only surface when a consumer outside that boundary reads it.
      handleError(thrown, parentOwner);
      return undefined;
    }
  };

  /** Builds the children or the fallback, as the current failure state says. */
  const build = (): unknown => {
    busy = true;
    try {
      version();
      const current = failure() ?? takePending();
      if (current !== undefined) {
        hot?.arm();
        return fallbackFor(current.error);
      }

      hot?.modules.clear();
      const scope = createRoot((dispose) => {
        if (hot !== undefined) attachHotModules(hot.modules);
        return {
          dispose,
          value: catchError(() => untrack(() => props.children), report),
        };
      });
      const creation = takePending();
      if (creation !== undefined) {
        scope.dispose();
        hot?.arm();
        return fallbackFor(creation.error);
      }
      hot?.disarm();
      return scope.value;
    } finally {
      // Newest child of the body memo: its cleanup marks the teardown before any child cleanup runs.
      createRoot(() => {
        onCleanup(() => {
          busy = true;
        });
      });
      busy = false;
    }
    // Children and the fallback are built here; their setup may write signals.
  };
  // Every build starts from the hydration scope the boundary was created in (a copy, so the count
  // is the same each time). A rebuild during a hydration pass then numbers its templates as the
  // first build did, so it claims the server's elements instead of missing keys.
  const body = useMemo<unknown>(
    () => (origin === null ? build() : withScope({ ...origin }, build)),
    { allowWrites: true },
  );

  // Created after the body memo, so it is the newest child of the owner and is disposed first.
  createRoot(() => {
    onCleanup(() => {
      alive = false;
      hot?.disarm();
    });
  });
  return body;
}
