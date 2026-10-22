import { batch, createRoot, flushSync, untrack } from "@shadow-js/core";
import { attachRootErrors, type RootErrorOptions } from "./control-flow/root-errors";
import { bindRegion, createRegion, removeRegion } from "./insert";
import { claims } from "./internal/hydration-hooks";
import { withScope } from "./internal/hydration-scope";

/**
 * Options of {@link render}: the error reporters of the root.
 * @since 1.0.0
 */
export type RenderOptions = RootErrorOptions;

/**
 * Mounts `code` into `container`. Creates an owner, inserts the output, flushes the effects, and
 * returns a dispose function that stops the owner and removes the nodes this call inserted. A
 * second render into the same container appends after the first.
 *
 * @param code Runs once, untracked, to build the tree (a component call, a node, text or an array).
 *   Return an accessor (for example `() => count`) from it to make the root content reactive.
 * @param container Element, Document or DocumentFragment that receives the output.
 * @param options The root's error reporters (`onUncaughtError`, `onCaughtError`). Undefined sets
 * no reporter.
 * @returns A dispose function, safe to call more than once.
 * @example
 * import { createComponent, render } from "@shadow-js/web";
 *
 * function App() {
 *   return "Hello";
 * }
 *
 * const dispose = render(
 *   () => createComponent(App, {}),
 *   document.getElementById("root") as Element,
 * );
 * dispose(); // stops the root and removes the text it inserted
 * @see hydrate
 * @since 1.0.0
 */
export function render(
  code: () => unknown,
  container: Element | Document | DocumentFragment,
  options?: RenderOptions,
): () => void {
  const region = createRegion(container, null, undefined);
  // One batch around the build: effects (and anything a resource's batch would flush mid-build)
  // wait until the whole tree exists, so a Suspense boundary knows what is pending before its
  // content's effects are considered.
  // A fresh root never consumes the enclosing hydration pass's nodes or key sequence.
  const stop = claims.current.withoutClaiming(() =>
    withScope(null, () =>
      batch(() =>
        createRoot((dispose) => {
          // An error nothing else took ends here; with onUncaughtError it is reported instead of thrown.
          if (options !== undefined) attachRootErrors(options);
          // The component tree is built once; only accessors inside the result stay reactive.
          bindRegion(region, untrack(code));
          return dispose;
        }),
      ),
    ),
  );
  flushSync();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    stop();
    removeRegion(region);
  };
}
