import { isServer } from "@shadow-js/core";
import { useHead } from "./head/use-head";
import type { HeadAttributeValue } from "./head/validate";

/**
 * Options of {@link preconnect}, {@link preloadModule} and {@link preinitModule}.
 * @since 1.0.0
 */
export interface CrossOriginOptions {
  /**
   * CORS mode of the connection or request: `"anonymous"` sends no credentials, `"use-credentials"`
   * sends cookies and client certificates. Fonts and `fetch` preloads need one of them.
   * @default undefined (no `crossorigin` attribute; the browser's default for the resource applies)
   */
  readonly crossOrigin?: "anonymous" | "use-credentials";
}

/**
 * Options of {@link preload}: the destination is required, as the browser needs it to pick the
 * right request.
 * @since 1.0.0
 */
export interface PreloadOptions extends CrossOriginOptions {
  /**
   * The destination of the request, which the browser uses to pick its priority and headers. It
   * must match how the resource is used later, or the preloaded copy is not reused.
   */
  readonly as:
    | "audio"
    | "document"
    | "embed"
    | "fetch"
    | "font"
    | "image"
    | "object"
    | "script"
    | "style"
    | "track"
    | "video"
    | "worker";
  /**
   * MIME type, so the browser can skip unsupported formats (for example `font/woff2`).
   * @default undefined (no `type` attribute)
   */
  readonly type?: string;
  /**
   * Media query the hint applies to (for example `(min-width: 800px)`); the browser skips the
   * preload when it does not match.
   * @default undefined (no `media` attribute; the hint always applies)
   */
  readonly media?: string;
}

/**
 * Options of {@link preinit}.
 * @since 1.0.0
 */
export interface PreinitOptions extends CrossOriginOptions {
  /**
   * What to load: `"style"` inserts a stylesheet, `"script"` inserts an async script. Required, as
   * the two produce different elements.
   */
  readonly as: "style" | "script";
}

type Attributes = Readonly<Record<string, string>>;

/** Hints are page-level and only ever use http(s) URLs; anything else throws, like head tags do. */
function checkUrl(href: string): void {
  const url = new URL(href, "https://base.invalid");
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(
      __DEV__
        ? `resource hint: "${href}" must be an http(s) or relative URL`
        : "SHADOW_RESOURCE_HINT_URL",
    );
  }
}

/** Whether an element already carries every attribute of a hint (so the hint is already there). */
function carries(element: Element, attributes: Attributes): boolean {
  for (const [name, value] of Object.entries(attributes)) {
    if (element.getAttribute(name) !== value) return false;
  }
  return true;
}

/**
 * Inserts a hint element once: an identical element already in the head (server-rendered or added
 * earlier) is kept. On the server the hint joins the render's head collector, when there is one.
 */
function hint(
  tag: "link" | "script",
  attributes: Attributes,
  serverTag: () => void = () => undefined,
): void {
  if (isServer) {
    serverTag();
    return;
  }
  if (typeof document === "undefined") return;
  for (const existing of document.head.querySelectorAll(tag)) {
    if (carries(existing, attributes)) return;
  }
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.head.append(element);
}

/** Server form of a hint: a head link (scripts cannot be head tags, see {@link preinitModule}). */
function serverLink(attributes: Readonly<Record<string, HeadAttributeValue>>): () => void {
  return () => useHead({ tag: "link", props: attributes });
}

/**
 * Tells the browser to open a connection (DNS, TCP, TLS) to an origin the page will use soon.
 * React's `preconnect`. Calling it again for the same origin adds nothing. Works in a component, in
 * an event handler, or at module scope on the client.
 *
 * @param href An http(s) origin or URL.
 * @param options CORS mode (needed for fonts and fetch with credentials). Undefined adds no
 * `crossorigin` attribute.
 * @throws TypeError (production message `SHADOW_RESOURCE_HINT_URL`) for a URL that is not http(s) or
 * relative.
 * @example
 * import { preconnect } from "@shadow-js/web";
 *
 * preconnect("https://fonts.example.com", { crossOrigin: "anonymous" });
 * @see prefetchDNS
 * @see preload
 * @since 1.0.0
 */
export function preconnect(href: string, options?: CrossOriginOptions): void {
  checkUrl(href);
  const attributes: Attributes = {
    rel: "preconnect",
    href,
    ...(options?.crossOrigin === undefined ? {} : { crossorigin: options.crossOrigin }),
  };
  hint("link", attributes, serverLink(attributes));
}

/**
 * Resolves an origin's DNS ahead of use. Cheaper than {@link preconnect}; React's `prefetchDNS`.
 * @param href An http(s) origin or URL.
 * @throws TypeError (production message `SHADOW_RESOURCE_HINT_URL`) for a URL that is not http(s) or relative.
 * @example
 * import { prefetchDNS } from "@shadow-js/web";
 *
 * prefetchDNS("https://api.example.com");
 * @see preconnect
 * @since 1.0.0
 */
export function prefetchDNS(href: string): void {
  checkUrl(href);
  const attributes: Attributes = { rel: "dns-prefetch", href };
  hint("link", attributes, serverLink(attributes));
}

/**
 * Starts fetching a resource the page will need, at high priority. The browser stores it for the
 * later request with the same URL and destination (React's `preload`).
 *
 * @param href An http(s) or relative URL.
 * @param options The destination (`as`, required) and the optional type, media and CORS mode.
 * @throws TypeError (production message `SHADOW_RESOURCE_HINT_URL`) for a URL that is not http(s) or relative.
 * @example
 * import { preload } from "@shadow-js/web";
 *
 * preload("/fonts/inter.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
 * @see preloadModule
 * @see preinit
 * @since 1.0.0
 */
export function preload(href: string, options: PreloadOptions): void {
  checkUrl(href);
  const attributes: Attributes = {
    rel: "preload",
    href,
    as: options.as,
    ...(options.type === undefined ? {} : { type: options.type }),
    ...(options.media === undefined ? {} : { media: options.media }),
    ...(options.crossOrigin === undefined ? {} : { crossorigin: options.crossOrigin }),
  };
  hint("link", attributes, serverLink(attributes));
}

/**
 * Starts loading an ES module the page will import, so the import does not wait for the module
 * graph to be discovered. React's `preloadModule`.
 * @param href An http(s) or relative URL of the module.
 * @param options CORS mode. Undefined adds no `crossorigin` attribute.
 * @throws TypeError (production message `SHADOW_RESOURCE_HINT_URL`) for a URL that is not http(s) or relative.
 * @example
 * import { preloadModule } from "@shadow-js/web";
 *
 * preloadModule("/chunks/editor.js");
 * @see preinitModule
 * @see preload
 * @since 1.0.0
 */
export function preloadModule(href: string, options?: CrossOriginOptions): void {
  checkUrl(href);
  const attributes: Attributes = {
    rel: "modulepreload",
    href,
    ...(options?.crossOrigin === undefined ? {} : { crossorigin: options.crossOrigin }),
  };
  hint("link", attributes, serverLink(attributes));
}

/**
 * Loads a stylesheet or script now, and keeps it applied or executed (React's `preinit`). A
 * stylesheet becomes a `<link rel="stylesheet">`; a script becomes an async `<script>` in the head.
 * On the server a script can only be hinted as a preload, because head tags cannot be scripts.
 *
 * @param href An http(s) or relative URL.
 * @param options What to load (`style` or `script`, required) and the CORS mode.
 * @throws TypeError (production message `SHADOW_RESOURCE_HINT_URL`) for a URL that is not http(s) or relative.
 * @example
 * import { preinit } from "@shadow-js/web";
 *
 * preinit("/theme.css", { as: "style" });
 * @see preload
 * @see preinitModule
 * @since 1.0.0
 */
export function preinit(href: string, options: PreinitOptions): void {
  checkUrl(href);
  if (options.as === "style") {
    const attributes: Attributes = {
      rel: "stylesheet",
      href,
      ...(options.crossOrigin === undefined ? {} : { crossorigin: options.crossOrigin }),
    };
    hint("link", attributes, serverLink(attributes));
    return;
  }
  const attributes: Attributes = {
    src: href,
    async: "",
    ...(options.crossOrigin === undefined ? {} : { crossorigin: options.crossOrigin }),
  };
  hint("script", attributes, serverLink({ rel: "preload", href, as: "script" }));
}

/**
 * Loads and runs an ES module now (React's `preinitModule`). On the client it inserts a
 * `<script type="module">`; on the server it hints the module with `modulepreload`, since the
 * script itself is loaded by the page.
 *
 * @param href An http(s) or relative URL of the module.
 * @param options CORS mode. Undefined adds no `crossorigin` attribute.
 * @throws TypeError (production message `SHADOW_RESOURCE_HINT_URL`) for a URL that is not http(s) or relative.
 * @example
 * import { preinitModule } from "@shadow-js/web";
 *
 * preinitModule("/chunks/app.js");
 * @see preloadModule
 * @see preinit
 * @since 1.0.0
 */
export function preinitModule(href: string, options?: CrossOriginOptions): void {
  checkUrl(href);
  const attributes: Attributes = {
    src: href,
    type: "module",
    ...(options?.crossOrigin === undefined ? {} : { crossorigin: options.crossOrigin }),
  };
  hint(
    "script",
    attributes,
    serverLink({
      rel: "modulepreload",
      href,
      ...(options?.crossOrigin === undefined ? {} : { crossorigin: options.crossOrigin }),
    }),
  );
}
