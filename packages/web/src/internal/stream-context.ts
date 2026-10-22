import { type Context, createContext } from "@shadow-js/core";

/**
 * A Suspense boundary whose content was not ready when the shell rendered: `renderToStream` calls
 * `rebuild` again each time a resource settles, and streams the markup once it is complete.
 * @since 1.0.0
 */
export interface StreamBoundary {
  /**
   * The boundary's hydration key. The shell must wrap the fallback in `<!--[b:ID-->` and `<!--]-->`
   * comments so the streamed chunk can replace it.
   */
  readonly id: string;
  /**
   * Renders the content again. Returns its final markup, or `null` when it is still pending, in which
   * case it has deferred itself again with {@link StreamSink.defer}.
   */
  rebuild(): string | null;
}

/**
 * Receives the boundaries that are still pending during a streaming render: what
 * {@link StreamContext} provides.
 * @since 1.0.0
 */
export interface StreamSink {
  /** Queues `boundary` to be rebuilt when the next resource settles. */
  defer(boundary: StreamBoundary): void;
}

/**
 * The context through which `renderToStream` lets a Suspense-like boundary defer its content: a
 * boundary that is pending in the shell renders its fallback between `<!--[b:ID-->` and `<!--]-->`
 * and defers a {@link StreamBoundary} to the sink. Its value is `null` for every other render (the
 * boundary then keeps its fallback).
 *
 * @example
 * import { useContext } from "@shadow-js/core";
 * import { StreamContext } from "@shadow-js/web/extend";
 *
 * function canStream(): boolean {
 *   // Inside a component rendered by renderToStream.
 *   return useContext(StreamContext) !== null;
 * }
 * @since 1.0.0
 */
export const StreamContext: Context<StreamSink | null> =
  /* @__PURE__ */ createContext<StreamSink | null>(null, {
    name: "Stream",
  });
