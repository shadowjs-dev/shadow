import { getOwner, type Owner } from "@shadow-js/core";

/**
 * The error reporters a root was rendered or hydrated with (see `RenderOptions` and `HydrateOptions`).
 * @since 1.0.0
 */
export interface RootErrorOptions {
  /**
   * Receives an error that no error boundary took. The root then does not rethrow it.
   * @default undefined (no reporter; an error no boundary takes follows the default handling)
   */
  readonly onUncaughtError?: (error: unknown) => void;
  /**
   * Receives an error an `ErrorBoundary` caught (its fallback is shown).
   * @default undefined (no reporter)
   */
  readonly onCaughtError?: (error: unknown) => void;
  /**
   * Receives a hydration mismatch that was repaired on the client. Only `hydrate` reports these.
   * @default undefined (no reporter)
   */
  readonly onRecoverableError?: (error: unknown) => void;
}

/**
 * The key the reporters are stored under in an owner's context map. A symbol the context map inherits
 * (as a Provider's value is inherited), so every node below the root sees it, detached roots included.
 * A plain value rather than a context: a context would bring its Provider into every bundle.
 */
const ROOT_ERRORS: symbol = /* @__PURE__ */ Symbol("RootErrors");

/**
 * Attaches the options to the root that is being created (called inside its `createRoot`). The reporters
 * go into the root's context map, and an `onUncaughtError` becomes the root's error handler (a fresh root
 * has none, so it is the only one).
 * @internal
 */
export function attachRootErrors(options: RootErrorOptions): void {
  const root = getOwner();
  if (root === null) return;
  const map = Object.create(root.context) as Record<symbol, unknown>;
  map[ROOT_ERRORS] = options;
  root.context = map;
  if (options.onUncaughtError !== undefined) root.errorHandlers = [options.onUncaughtError];
}

/**
 * The reporters of the nearest root above `owner`, or undefined when no root was given options.
 * @internal
 */
export function rootErrorsOf(owner: Owner | null): RootErrorOptions | undefined {
  return owner?.context?.[ROOT_ERRORS] as RootErrorOptions | undefined;
}
