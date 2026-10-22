import { createRoot, type ResourceCache, ResourceCacheContext } from "@shadow-js/core";
import { attachRootErrors, type RootErrorOptions } from "../control-flow/root-errors";
import { runWithServerHead, type ServerHead } from "../head/server-head";
import { createRootScope, resourceKey, withScope } from "../internal/hydration-scope";
import { SsrError } from "./errors";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
import { escape } from "./escape";
import {
  type PortalCollector,
  portalCollectorFor,
  type ServerPortals,
  withPortalSink,
} from "./portals";

/**
 * Options of {@link renderToString}, and the base of {@link AsyncRenderOptions}.
 * @since 1.0.0
 */
export interface RenderOptions {
  /**
   * Prefix of every hydration key: letters, digits, `_` and `-` only. Give each app rendered into the
   * same page its own id, and pass the same id to `hydrate()`.
   * @default "0"
   */
  readonly renderId?: string;
  /**
   * Collects the tags `useHead`, `<Title>`, `<Meta>`, ... register while rendering (see
   * `createServerHead`).
   * @default undefined (head tags are not collected)
   */
  readonly head?: ServerHead;
  /**
   * Collects the markup of the portals the render produces (see {@link createServerPortals}). Emit
   * `portals.html()` at the end of `<body>` once the render is done.
   * @default undefined (a portal renders nothing on the server)
   */
  readonly portals?: ServerPortals;
  /**
   * Receives an error an `ErrorBoundary` of the render caught. The boundary's fallback is in the markup,
   * so the caller can answer the request with the status of the error. Called once per caught error.
   * For {@link renderToStringAsync} only the last pass is reported.
   * @default undefined (caught errors are not reported)
   */
  readonly onCaughtError?: (error: unknown) => void;
  /**
   * Receives an error no boundary took. With it the render does not throw that error and the markup
   * lacks the part that failed.
   * @default undefined (the error propagates out of the render)
   */
  readonly onUncaughtError?: (error: unknown) => void;
}

/**
 * Options of {@link renderToStringAsync}: the {@link RenderOptions} plus the limits of the multi-pass
 * render.
 * @since 1.0.0
 */
export interface AsyncRenderOptions extends RenderOptions {
  /**
   * Upper bound for the whole render, in milliseconds: a positive finite number.
   * @default 10000
   */
  readonly timeoutMs?: number;
  /**
   * Maximum number of render passes: an integer of at least 1. Each pass renders with the resource
   * values the previous passes resolved.
   * @default 10
   */
  readonly maxPasses?: number;
}

/**
 * What {@link renderToStringAsync} resolves to: the markup and the resource data to embed for
 * hydration.
 * @since 1.0.0
 */
export interface AsyncRenderResult {
  /** The markup of the last pass. */
  readonly html: string;
  /**
   * The resolved resource values the last pass read, keyed as the client looks them up. Embed it in
   * the page with {@link serialize} and pass it to `hydrate()` as its `data` option, so the client
   * reuses the values instead of fetching again.
   */
  readonly data: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PASSES = 10;
const RENDER_ID = /^[A-Za-z0-9_-]+$/;

/** Validates a render id: it is written into markup, so only plain tokens are accepted. */
function checkRenderId(renderId: string): string {
  if (typeof renderId !== "string" || !RENDER_ID.test(renderId)) {
    throw new TypeError("render options: renderId must be made of letters, digits, _ and -.");
  }
  return renderId;
}

/**
 * The reporters of a render, in the shape the root takes them. An `onUncaughtError` is set only when the
 * caller gave one: a root with a handler does not rethrow, so without one the error must keep propagating.
 */
function reportersOf(options: RenderOptions | undefined): RootErrorOptions {
  return {
    ...(options?.onCaughtError === undefined ? {} : { onCaughtError: options.onCaughtError }),
    ...(options?.onUncaughtError === undefined ? {} : { onUncaughtError: options.onUncaughtError }),
  };
}

/**
 * Runs `code` under the render's resource cache and returns the escaped markup. The root scope
 * is entered inside the provider, so accessors evaluated during escaping see the same cache.
 * Must run inside the root that is being rendered: the reporters are attached to it.
 */
function renderMarkup(
  code: () => unknown,
  renderId: string,
  cache: ResourceCache | null,
  head: ServerHead | undefined,
  portals: PortalCollector | null,
  reporters: RootErrorOptions,
): string {
  attachRootErrors(reporters);
  // The provider returns an accessor; reading it surfaces an error thrown while rendering.
  return (
    withPortalSink(portals, () =>
      ResourceCacheContext({
        value: cache,
        get children() {
          return runWithServerHead(head, () =>
            withScope(createRootScope(renderId), () => escape(code())),
          );
        },
      }),
    ) as () => string
  )();
}

/**
 * Renders an app to an HTML string synchronously: the simplest server render, for pages whose data
 * is already at hand. Suspense boundaries whose resources are still pending render their fallback
 * (use {@link renderToStringAsync} or {@link renderToStream} to wait for data). Effects never run.
 * The root is disposed before this returns, and an error from `code` propagates after that cleanup.
 *
 * @param code Builds the app: returns a component result, an `SsrNode`, text or an array.
 * @param options Hydration-key prefix, head and portal collectors, and error reporters. Undefined uses
 * the defaults of {@link RenderOptions}.
 * @returns The escaped markup of the app.
 * @throws TypeError for an invalid `renderId`, for `portals` not created by
 * {@link createServerPortals}, or for a value that cannot be rendered (see {@link escape}). An error
 * no boundary caught propagates unless `onUncaughtError` is set.
 * @example
 * import { createComponent, renderToString } from "@shadow-js/web/server";
 *
 * function App() {
 *   return <h1>Hello</h1>;
 * }
 * const html = renderToString(() => createComponent(App, {}));
 * @see renderToStringAsync
 * @see renderToStream
 * @since 1.0.0
 */
export function renderToString(code: () => unknown, options?: RenderOptions): string {
  const renderId = checkRenderId(options?.renderId ?? "0");
  const portals = portalCollectorFor(options?.portals);
  const reporters = reportersOf(options);
  return createRoot((dispose) => {
    try {
      return renderMarkup(code, renderId, null, options?.head, portals, reporters);
    } finally {
      dispose();
    }
  });
}

/** The errors one pass reported to its root, kept until the pass is known to be the answer. */
interface PassErrors {
  readonly caught: unknown[];
  readonly uncaught: unknown[];
}

/** One render pass: its markup, the keys it asked for, and the fetches it started. */
interface Pass {
  readonly html: string;
  readonly requested: Set<string>;
  readonly tracked: Array<{ readonly key: string; readonly promise: Promise<unknown> }>;
  readonly errors: PassErrors;
  readonly dispose: () => void;
}

/**
 * Runs one pass. The root stays alive until the caller disposes it, so fetches are not aborted. The
 * pass records its errors instead of reporting them: every pass renders the same boundaries again, so
 * only the answering pass (see {@link reportPass}) reports.
 */
function runPass(
  code: () => unknown,
  renderId: string,
  settled: ReadonlyMap<string, unknown>,
  head: ServerHead | undefined,
  portals: PortalCollector | null,
  user: RootErrorOptions,
): Pass {
  const requested = new Set<string>();
  const tracked: Array<{ readonly key: string; readonly promise: Promise<unknown> }> = [];
  const errors: PassErrors = { caught: [], uncaught: [] };
  const reporters: RootErrorOptions = {
    onCaughtError: (error) => {
      errors.caught.push(error);
    },
    // Recorded only when the caller reports uncaught errors; otherwise the error must still throw.
    ...(user.onUncaughtError === undefined
      ? {}
      : {
          onUncaughtError: (error: unknown) => {
            errors.uncaught.push(error);
          },
        }),
  };
  const seen = new Set<string>();
  const cache: ResourceCache = {
    key: (explicit) => {
      const key = resourceKey(explicit);
      requested.add(key);
      return key;
    },
    read: (key) => (settled.has(key) ? { value: settled.get(key) } : undefined),
    track: (key, promise) => {
      if (seen.has(key)) return;
      seen.add(key);
      tracked.push({ key, promise });
    },
  };
  return createRoot((dispose) => {
    // Every pass registers the same tags and portals again: only the last pass counts.
    head?.clear();
    portals?.clear();
    const html = renderMarkup(code, renderId, cache, head, portals, reporters);
    return { html, requested, tracked, errors, dispose };
  });
}

/**
 * Hands the errors of the answering pass to the caller's reporters, in the order they happened. Called
 * once per render, so each caught error is reported once even when several passes rendered it.
 */
function reportPass(errors: PassErrors, user: RootErrorOptions): void {
  for (const error of errors.caught) user.onCaughtError?.(error);
  for (const error of errors.uncaught) user.onUncaughtError?.(error);
}

/** Records a value under a key with defineProperty, so keys such as "__proto__" stay data. */
function defineData(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** The values of `settled` that the pass asked for. */
function collectData(
  requested: ReadonlySet<string>,
  settled: ReadonlyMap<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of requested) {
    if (settled.has(key)) defineData(data, key, settled.get(key));
  }
  return data;
}

/** Shared state of one async render: its cancellation flag and the roots still alive. */
interface Job {
  canceled: boolean;
  readonly roots: Array<() => void>;
}

function assertActive(job: Job): void {
  if (job.canceled)
    throw new SsrError("SSR_TIMEOUT", "The render was canceled after its time budget.");
}

/**
 * The multi-pass algorithm. Pass N renders with the values resolved so far; the fetches it starts
 * are awaited, and another pass runs only if one of them produced a value that the next render can
 * use. A pass with no new value is final: its markup is the answer.
 */
async function runPasses(
  code: () => unknown,
  renderId: string,
  maxPasses: number,
  job: Job,
  head: ServerHead | undefined,
  portals: PortalCollector | null,
  user: RootErrorOptions,
): Promise<AsyncRenderResult> {
  const settled = new Map<string, unknown>();
  for (let pass = 1; ; pass += 1) {
    assertActive(job);
    const current = runPass(code, renderId, settled, head, portals, user);
    job.roots.push(current.dispose);
    if (current.tracked.length === 0) {
      current.dispose();
      reportPass(current.errors, user);
      return { html: current.html, data: collectData(current.requested, settled) };
    }
    const results = await Promise.allSettled(current.tracked.map((entry) => entry.promise));
    assertActive(job);
    let advanced = false;
    results.forEach((result, index) => {
      const entry = current.tracked[index];
      if (entry === undefined || result.status !== "fulfilled") return;
      if (!settled.has(entry.key)) advanced = true;
      settled.set(entry.key, result.value);
    });
    current.dispose();
    if (!advanced) {
      reportPass(current.errors, user);
      return { html: current.html, data: collectData(current.requested, settled) };
    }
    if (pass >= maxPasses) {
      throw new SsrError(
        "SSR_BOUNDARY_WATERFALL",
        `Resources kept loading new resources after ${maxPasses} passes; raise maxPasses or flatten the data flow.`,
      );
    }
  }
}

/** Validates the numeric options. */
function checkAsyncOptions(options: AsyncRenderOptions | undefined): {
  timeoutMs: number;
  maxPasses: number;
} {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPasses = options?.maxPasses ?? DEFAULT_MAX_PASSES;
  if (typeof timeoutMs !== "number" || !(timeoutMs > 0) || !Number.isFinite(timeoutMs)) {
    throw new TypeError("render options: timeoutMs must be a positive finite number.");
  }
  if (!Number.isInteger(maxPasses) || maxPasses < 1) {
    throw new TypeError("render options: maxPasses must be an integer of at least 1.");
  }
  return { timeoutMs, maxPasses };
}

/**
 * Renders an app to an HTML string once its data has loaded: each pass renders with the resource
 * values found so far, the fetches it starts are awaited, and another pass runs while one of them
 * produced a new value. Resources that reject are not cached and render their fallback. The error
 * reporters (`onCaughtError`, `onUncaughtError`) are called once, for the pass that gives the answer.
 *
 * @param code Builds the app.
 * @param options The {@link RenderOptions} plus `timeoutMs` and `maxPasses`. Undefined uses the
 * defaults of {@link AsyncRenderOptions}.
 * @returns A promise of the final markup and the resolved resource values, to embed in the page.
 * @throws TypeError (synchronously rejected) for an invalid `renderId`, `timeoutMs` or `maxPasses`.
 * The promise rejects with an `Error` named `SsrError` whose `code` is `SSR_BOUNDARY_WATERFALL` when
 * more than `maxPasses` passes are needed, or `SSR_TIMEOUT` when the time budget runs out; and with
 * the error of a failing render.
 * @example
 * import { createComponent, renderToStringAsync, serialize } from "@shadow-js/web/server";
 *
 * function App() {
 *   return <h1>Hello</h1>;
 * }
 * async function page(): Promise<string> {
 *   const { html, data } = await renderToStringAsync(() => createComponent(App, {}));
 *   return `${html}<script type="application/json" data-sh="0">${serialize(data)}</script>`;
 * }
 * @see renderToString
 * @see renderToStream
 * @since 1.0.0
 */
export async function renderToStringAsync(
  code: () => unknown,
  options?: AsyncRenderOptions,
): Promise<AsyncRenderResult> {
  const renderId = checkRenderId(options?.renderId ?? "0");
  const { timeoutMs, maxPasses } = checkAsyncOptions(options);
  const job: Job = { canceled: false, roots: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      job.canceled = true;
      reject(new SsrError("SSR_TIMEOUT", `The render did not finish within ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  try {
    const portals = portalCollectorFor(options?.portals);
    return await Promise.race([
      runPasses(code, renderId, maxPasses, job, options?.head, portals, reportersOf(options)),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
    job.canceled = true;
    for (const dispose of job.roots.splice(0)) dispose();
  }
}
