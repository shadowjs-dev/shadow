/**
 * The renderer extension API of `@shadow-js/web`: the building blocks `Show`, `For`, `Portal`,
 * `Dynamic`, `Suspense`, head tags and hydration are made from. Use them to write custom
 * components and renderers with the same behavior as the built-ins (zero comment nodes, region
 * adoption during hydration, identity-preserving reconciliation, URL and attribute safety).
 *
 * Import from `@shadow-js/web/extend`.
 * @packageDocumentation
 */
export { isUnsafeUrlAttribute } from "./attributes";
export { element } from "./element";
export { bindRegion, createRegion, type Region, removeRegion } from "./insert";
export {
  claimElement,
  claimPortal,
  isClaiming,
  takeRegion,
  withoutClaiming,
} from "./internal/claim";
export { type WebWarningCode, warnOnce } from "./internal/diagnostics";
export { type Claims, claims } from "./internal/hydration-hooks";
export {
  childScope,
  createRootScope,
  currentScope,
  enterComponent,
  type HydrationScope,
  nextKey,
  resourceKey,
  withScope,
} from "./internal/hydration-scope";
export { HTML_NS, MATHML_NS, SVG_NS } from "./internal/names";
export { PortalContext, type PortalSink } from "./internal/portal-context";
export { reconcileNodes } from "./internal/reconcile";
export { type StreamBoundary, StreamContext, type StreamSink } from "./internal/stream-context";
