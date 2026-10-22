/**
 * The claiming half of hydration, as a hook. `hydrate()` installs the real implementation for the
 * length of its pass; outside a pass the hooks are idle: nothing is claimed, and the renderer builds
 * the same DOM it builds on a fresh page. Templates, regions, `Dynamic`, `Portal` and `NoHydration`
 * call through {@link claims}, so only code that reaches `hydrate()` carries the claiming code (the
 * registry, the server-block lifting and the portal scan). A custom renderer reads the same hook.
 * @since 1.0.0
 */
export interface Claims {
  /** Claims the server element for `key` (see `claimElement`). */
  claimElement(key: string | undefined): Element | null;
  /** Adopts the next server region of `parent` (see `takeRegion`). */
  takeRegion(parent: Node, anchorNode: Node | null): Node[] | undefined;
  /** The content of every region lifted out of a claimed element (see `liftedRegions`). */
  liftedRegions(): readonly (readonly Node[])[] | undefined;
  /** Adopts the server block of a portal (see `claimPortal`). */
  claimPortal(key: string | undefined): Node[] | undefined;
  /** True while a hydration pass claims server DOM (see `isClaiming`). */
  isClaiming(): boolean;
  /** Runs `fn` with claiming off (see `withoutClaiming`). */
  withoutClaiming<T>(fn: () => T): T;
}

const idle: Claims = {
  claimElement: () => null,
  takeRegion: () => undefined,
  liftedRegions: () => undefined,
  claimPortal: () => undefined,
  isClaiming: () => false,
  withoutClaiming: (fn) => fn(),
};

/**
 * The claims in effect. Read at each call (never captured), so a region that is updated after its
 * hydration pass ended builds fresh DOM. Only `hydrate()` replaces it, and restores it in `finally`.
 * Outside a hydration pass every method is a no-op.
 *
 * @example
 * import { claims, nextKey } from "@shadow-js/web/extend";
 *
 * function createCard(): Element {
 *   // Adopts the server's element during hydrate(); builds a new one otherwise.
 *   return claims.current.claimElement(nextKey()) ?? document.createElement("article");
 * }
 * @see Claims
 * @since 1.0.0
 */
export const claims: { current: Claims } = { current: idle };
