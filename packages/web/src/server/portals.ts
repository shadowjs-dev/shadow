import { childScope, withScope } from "../internal/hydration-scope";
import { PortalContext, type PortalSink } from "../internal/portal-context";
import { SsrError } from "./errors";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
import { escape } from "./escape";

/**
 * The most portals one render may produce. A page with more open overlays than this is a bug, and the
 * collector refuses to grow without a bound.
 * @internal
 */
export const MAX_SERVER_PORTALS = 256;

/**
 * The markup of the portals a server render produced (see {@link createServerPortals}). Pass it to
 * the render as its `portals` option, then emit `html()` at the end of `<body>`, after the app markup.
 * The client adopts each block when it hydrates the portal that wrote it.
 *
 * @example
 * import { createComponent, createServerPortals, renderToString } from "@shadow-js/web/server";
 *
 * function App() {
 *   return <main>Hello</main>;
 * }
 * const portals = createServerPortals();
 * const app = renderToString(() => createComponent(App, {}), { portals });
 * const page = `<!doctype html><html><body><div id="app">${app}</div>${portals.html()}</body></html>`;
 * @since 1.0.0
 */
export interface ServerPortals {
  /**
   * The collected blocks, in the order the render produced them: each is `<!--portal:KEY-->` markup
   * `<!--/portal:KEY-->`. Emit it once, at the end of `<body>`.
   * @returns The markup; empty when no portal was rendered.
   */
  html(): string;
}

/** The collector behind a {@link ServerPortals}: what a renderer writes into while it renders. @internal */
export class PortalCollector implements PortalSink {
  private readonly entries = new Map<string, string>();

  add(key: string, html: string): void {
    if (!this.entries.has(key) && this.entries.size >= MAX_SERVER_PORTALS) {
      throw new SsrError(
        "SSR_PORTAL_LIMIT",
        `A render produced more than ${MAX_SERVER_PORTALS} portals; close some overlays or raise the limit.`,
      );
    }
    this.entries.set(key, html);
  }

  /** Forgets what an earlier pass of the same render wrote. */
  clear(): void {
    this.entries.clear();
  }

  html(): string {
    let out = "";
    for (const [key, html] of this.entries) {
      out += `<!--portal:${key}-->${html}<!--/portal:${key}-->`;
    }
    return out;
  }
}

const collectors = new WeakMap<ServerPortals, PortalCollector>();

/**
 * Creates the collector a server render writes its portals into. Without one, a `Portal` renders
 * nothing on the server. Create one per request: a render clears it before it starts, and one render
 * may produce at most 256 portals (more throw an `SsrError` whose `code` is `SSR_PORTAL_LIMIT`).
 *
 * @returns A new, empty {@link ServerPortals}.
 * @example
 * import { createComponent, createServerPortals, renderToString } from "@shadow-js/web/server";
 *
 * function App() {
 *   return <main>Hello</main>;
 * }
 * const portals = createServerPortals();
 * const app = renderToString(() => createComponent(App, {}), { portals });
 * const page = `<body><div id="app">${app}</div>${portals.html()}</body>`;
 * @since 1.0.0
 */
export function createServerPortals(): ServerPortals {
  const collector = new PortalCollector();
  const portals: ServerPortals = { html: () => collector.html() };
  collectors.set(portals, collector);
  return portals;
}

/**
 * The collector behind a `portals` option.
 * @throws TypeError when the value did not come from {@link createServerPortals}.
 * @internal
 */
export function collectorOf(portals: ServerPortals): PortalCollector {
  const collector = collectors.get(portals);
  if (collector === undefined) {
    throw new TypeError("portals must be created with createServerPortals().");
  }
  return collector;
}

/**
 * The server half of a `Portal`: renders its content into the render's collector. The content gets its
 * own hydration scope, so the keys of the siblings do not depend on whether the portal rendered. Writes
 * nothing when the render has no collector or the portal has no key (no render scope).
 *
 * @param key The portal's key, from `nextKey()` at the call site.
 * @param children Reads the portal's content. A thunk, because reading a JSX child builds it, and the
 * content must be built inside its own scope.
 * @param sink The collector the portal context provides (null for a render without one).
 * @internal
 */
export function renderServerPortal(
  key: string | undefined,
  children: () => unknown,
  sink: PortalSink | null,
): void {
  if (sink === null || key === undefined) return;
  const html = withScope(childScope(key), () => escape(children()));
  sink.add(key, html);
}

/**
 * Runs `build` with the portal sink provided, and returns what `build` returns (the render's accessor).
 * A null sink provides nothing, so the portals of that render write nothing.
 * @internal
 */
export function withPortalSink<T>(sink: PortalSink | null, build: () => T): T {
  const view = PortalContext({
    value: sink,
    get children() {
      return build();
    },
  });
  return (view as () => T)();
}

/**
 * The collector a renderer writes into for one call: null without a `portals` option, else the cleared
 * collector.
 * @internal
 */
export function portalCollectorFor(portals: ServerPortals | undefined): PortalCollector | null {
  if (portals === undefined) return null;
  const collector = collectorOf(portals);
  collector.clear();
  return collector;
}
