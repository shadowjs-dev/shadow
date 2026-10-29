import { type Context, createContext } from "@shadow-js/core";

/**
 * Receives the markup of the portals a server render produces: what {@link PortalContext} provides
 * when the render was given a `portals` collector.
 * @since 1.0.0
 */
export interface PortalSink {
  /**
   * Records the markup of the portal with hydration key `key`. A key recorded again replaces the
   * earlier markup. Throws an `SsrError` whose `code` is `SSR_PORTAL_LIMIT` past 256 portals in one
   * render.
   */
  add(key: string, html: string): void;
  /**
   * Renders a `Portal`'s content into this sink under hydration key `key`. The collectors the
   * renderers provide have it; `Portal` calls it instead of importing the markup writer, so the
   * browser bundle of an app that uses `Portal` does not carry server rendering code. A sink without
   * it receives nothing from `Portal`.
   * @param key The portal's key, `undefined` when the render has no scope (nothing is written).
   * @param children Reads the content: a thunk, because it must be built inside the portal's scope.
   */
  render?(key: string | undefined, children: () => unknown): void;
}

/**
 * The context through which a server render hands portals their collector: the renderers provide it
 * when they are given a `portals` option (see `createServerPortals`). A custom portal reads it on the
 * server and records its markup under its hydration key, so the client's `claimPortal` adopts it.
 * Its value is `null` for every other render, and in the browser, where a portal writes nothing on
 * the server.
 *
 * @example
 * import { useContext } from "@shadow-js/core";
 * import { nextKey, PortalContext } from "@shadow-js/web/extend";
 * import { escape } from "@shadow-js/web/server";
 *
 * function ServerToast(props: { text: string }): null {
 *   const key = nextKey();
 *   const sink = useContext(PortalContext);
 *   if (sink !== null && key !== undefined) sink.add(key, `<div role="status">${escape(props.text)}</div>`);
 *   return null;
 * }
 * @see claimPortal
 * @since 1.0.0
 */
export const PortalContext: Context<PortalSink | null> =
  /* @__PURE__ */ createContext<PortalSink | null>(null, {
    name: "Portal",
  });
