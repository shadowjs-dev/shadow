/**
 * Server runtime of ShadowJS: the helpers the compiler's `generate: "ssr"` output calls, the
 * renderers, and the serializer for embedding data in a page. Import it as `@shadow-js/web/server`.
 * @since 1.0.0
 */
export { mergeProps } from "@shadow-js/core";
export { createServerHead, type ServerHead } from "../head/server-head";
export { type NormalizedTag, normalizeTags } from "../head/validate";
export { ssrAttribute } from "./attributes";
export { ssrClass, ssrStyle } from "./class-style";
export { createComponent, memo } from "./component";
export { type Derived, derived } from "./derived";
export { ssr, ssrElement, ssrHydrationKey, ssrRaw } from "./element";
export { escape } from "./escape";
export { ssrSelectValue, ssrTextArea } from "./form-controls";
export {
  generateHydrationScript,
  HydrationScript,
  type HydrationScriptOptions,
} from "./hydration-script";
export { createServerPortals, type ServerPortals } from "./portals";
export type { AsyncRenderOptions, AsyncRenderResult, RenderOptions } from "./render";
export { renderToString, renderToStringAsync } from "./render";
export { deserialize, serialize } from "./serialize";
export type { StreamOptions } from "./stream";
export { renderToStream } from "./stream";
