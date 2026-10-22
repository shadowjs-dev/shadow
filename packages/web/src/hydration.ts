import {
  batch,
  createRoot,
  flushSync,
  type Owner,
  type ResourceCache,
  ResourceCacheContext,
  runWithOwner,
  untrack,
} from "@shadow-js/core";
import { withHydration } from "@shadow-js/core/extend";
import { attachRootErrors, type RootErrorOptions } from "./control-flow/root-errors";
import { bindRegion, createRegion, removeRegion } from "./insert";
import {
  beginClaiming,
  claimElement,
  claimPortal,
  endClaiming,
  isClaiming,
  liftedRegions,
  releaseUnclaimedPortals,
  takeRegion,
  withoutClaiming,
} from "./internal/claim";
import { replayEarlyEvents } from "./internal/early-events";
import { type Claims, claims } from "./internal/hydration-hooks";
import { createRootScope, resourceKey, withScope } from "./internal/hydration-scope";

/**
 * Options of {@link hydrate}: the server render it continues, the root's owner, and the error
 * reporters it inherits from `RootErrorOptions` (`onUncaughtError`, `onCaughtError`,
 * `onRecoverableError`).
 * @since 1.0.0
 */
export interface HydrateOptions extends RootErrorOptions {
  /**
   * The id the server render used, so the client numbers its elements with the same keys. Must
   * equal the `renderId` given to the server render.
   * @default "0"
   */
  renderId?: string;
  /**
   * The resource values the server fetched: the `data` of `renderToStringAsync`. A resource whose
   * key is found here starts with that value instead of fetching it again. Each value is used once.
   * @default {} (no resource value is preloaded; resources fetch on the client)
   */
  data?: Record<string, unknown>;
  /**
   * The owner the hydrated root is created under, so its context (providers) is visible to the app.
   * @default null (the root has no parent owner)
   */
  owner?: Owner;
}

function dataCache(data: Record<string, unknown>): ResourceCache {
  const used = new Set<string>();
  return {
    key: resourceKey,
    read(key) {
      if (used.has(key) || !Object.hasOwn(data, key)) return undefined;
      used.add(key);
      return { value: data[key] };
    },
    track() {
      // Client fetches are not tracked: nothing waits for them.
    },
  };
}

/**
 * Removes marker comments the pass did not claim, so the live DOM never keeps any, and the server
 * blocks of portals the client did not render (they would show content the client does not have).
 */
function stripLeftovers(container: Node): void {
  const doc = container instanceof Document ? container : container.ownerDocument;
  if (doc === null) return;
  if (doc.body !== null) releaseUnclaimedPortals(doc.body);
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
  const stale: Comment[] = [];
  while (walker.nextNode()) {
    const comment = walker.currentNode as Comment;
    if (comment.data === "[" || comment.data === "]") stale.push(comment);
  }
  for (const comment of stale) comment.remove();
}

/**
 * Attaches the application to HTML the server already rendered into `container`. Elements are
 * claimed by their `data-hk` keys instead of created, so the DOM is not rebuilt and nodes keep
 * their identity. Event handlers and reactive bindings are attached; markers are removed. Parts the
 * server and client disagree on are repaired by reconciliation, never left half hydrated.
 *
 * @param code Runs once, untracked, and builds the same component tree the server rendered.
 * @param container Element or Document that holds the server markup.
 * @param options `renderId` (must match the server), the server's resource `data`, an `owner`, and
 * the error reporters. Undefined uses the defaults.
 * @returns A dispose function that stops the hydrated root and removes its nodes. Safe to call more
 * than once.
 * @throws Error (production message `SHADOW_HYDRATE_RUNNING`) when called while another hydration
 * pass is in progress.
 * @example
 * import { createComponent, hydrate } from "@shadow-js/web";
 *
 * function App() {
 *   return "Hello";
 * }
 *
 * const container = document.getElementById("app") as Element;
 * const data = JSON.parse(document.getElementById("data")?.textContent ?? "{}") as Record<
 *   string,
 *   unknown
 * >;
 * const dispose = hydrate(() => createComponent(App, {}), container, { data });
 * @see render
 * @since 1.0.0
 */
export function hydrate(
  code: () => unknown,
  container: Element | Document,
  options: HydrateOptions = {},
): () => void {
  if (isClaiming())
    throw new Error(
      __DEV__ ? "hydrate(): a hydration pass is already running." : "SHADOW_HYDRATE_RUNNING",
    );
  const registry = new Map<string, Element>();
  const roots: Element[] = container instanceof Element ? [container] : [];
  for (const element of [...roots, ...Array.from(container.querySelectorAll("[data-hk]"))]) {
    const key = element.getAttribute("data-hk");
    if (key !== null) registry.set(key, element);
  }
  beginClaiming(registry, options.onRecoverableError);
  // The renderer reaches the claiming code only through this hook, installed for this pass alone.
  const passClaims: Claims = {
    claimElement,
    takeRegion,
    liftedRegions,
    claimPortal,
    isClaiming,
    withoutClaiming,
  };
  const previousClaims = claims.current;
  claims.current = passClaims;
  const cache = dataCache(options.data ?? {});
  const region = createRegion(container, null, Array.from(container.childNodes));
  let stop: () => void;
  try {
    // The batch wraps the scope, not the other way round: its exit flushes the queued effects
    // (onMount, and the re-renders they cause) after the scope is restored. The scope numbers only
    // the templates the server rendered; an effect that builds new DOM must not draw keys from it
    // (that shifts the keys of later siblings and misses the ones the server never sent). Boundaries
    // rebuild from their own captured scope, so a reset inside the pass still claims its elements.
    stop = withHydration(() =>
      batch(() =>
        withScope(createRootScope(options.renderId), () =>
          runWithOwner(options.owner ?? null, () =>
            createRoot((dispose) => {
              attachRootErrors(options);
              ResourceCacheContext({
                value: cache,
                get children() {
                  bindRegion(region, untrack(code));
                  return null;
                },
              });
              return dispose;
            }),
          ),
        ),
      ),
    );
    flushSync();
  } finally {
    endClaiming();
    claims.current = previousClaims;
  }
  replayEarlyEvents();
  stripLeftovers(container);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    stop();
    removeRegion(region);
  };
}
