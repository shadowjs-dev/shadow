import {
  createRoot,
  type ResourceCache,
  ResourceCacheContext,
  type ResourceTrackOptions,
  untrack,
} from "@shadow-js/core";
import { attachRootErrors, type RootErrorOptions } from "../control-flow/root-errors";
import { runWithServerHead, type ServerHead } from "../head/server-head";
import { createRootScope, resourceKey, withScope } from "../internal/hydration-scope";
import { type StreamBoundary, StreamContext, type StreamSink } from "../internal/stream-context";
import { SsrError } from "./errors";
// biome-ignore lint/suspicious/noShadowRestrictedNames: `escape` is the compiler's SSR helper name.
import { escape } from "./escape";
import { portalCollectorFor, type ServerPortals, withPortalSink } from "./portals";
import { serialize } from "./serialize";

/**
 * Options of {@link renderToStream}.
 * @since 1.0.0
 */
export interface StreamOptions {
  /**
   * Prefix of every hydration key: letters, digits, `_` and `-` only. Pass the same id to `hydrate()`.
   * @default "0"
   */
  readonly renderId?: string;
  /**
   * CSP nonce for the inline swap scripts. Characters outside letters, digits, `+`, `/`, `=`, `_` and
   * `-` are removed before it is written.
   * @default undefined (the scripts get no nonce attribute)
   */
  readonly nonce?: string;
  /**
   * Upper bound for the whole stream, in milliseconds, a positive finite number. When it runs out, the stream errors with an
   * `SsrError` whose `code` is `SSR_TIMEOUT`.
   * @default 30000
   */
  readonly timeoutMs?: number;
  /**
   * Aborts the render: the stream errors with the signal's reason and every pending fetch is abandoned.
   * @default undefined (the render is bounded only by `timeoutMs`)
   */
  readonly signal?: AbortSignal;
  /**
   * Collects the tags `useHead`, `<Title>`, ... register while the shell renders (see
   * `createServerHead`).
   * @default undefined (head tags are not collected)
   */
  readonly head?: ServerHead;
  /**
   * Called with the shell markup as soon as it is ready, before it is enqueued: the moment to write
   * the document head and choose the response status.
   * @default undefined (no callback)
   */
  readonly onShellReady?: (shell: string) => void;
  /**
   * Collects the markup of the portals the stream produces (see {@link createServerPortals}). The stream
   * does not write it: once the stream has ended, emit `portals.html()` at the end of `<body>`.
   * @default undefined (a portal renders nothing on the server)
   */
  readonly portals?: ServerPortals;
  /**
   * Receives an error an `ErrorBoundary` of the stream caught, once per caught error. An error in the shell
   * happens before the first chunk, so the caller can still choose the response status; an error in a later
   * boundary happens after the shell and changes only that boundary (its fallback stays).
   * @default undefined (caught errors are not reported)
   */
  readonly onCaughtError?: (error: unknown) => void;
  /**
   * Receives an error no boundary took. With it the stream does not error on that error and the markup lacks
   * the part that failed.
   * @default undefined (the error ends the stream in its `error` state)
   */
  readonly onUncaughtError?: (error: unknown) => void;
}

const RENDER_ID = /^[A-Za-z0-9_-]+$/;
const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * The most shell renders a stream makes while resources hold its first flush. Each render uses the held
 * values the one before resolved, so a chain of held resources is bounded like a boundary waterfall.
 */
const MAX_SHELL_PASSES = 10;

/**
 * One render of the shell: its markup, the boundaries still pending in it, the keys it asked for and the
 * fetches it started. Only the answering pass (the one the stream sends) reports its errors; the others
 * are discarded, and their fetches stay alive so a later pass can join them.
 */
interface ShellPass {
  html: string;
  boundaries: StreamBoundary[];
  readonly requested: Set<string>;
  /** The fetches this render started that hold the first flush (`deferStream`), by key. */
  readonly held: Array<{ readonly key: string; readonly entry: Promise<void> }>;
  /** The fetches this render started that the stream is still waiting for. */
  readonly inFlight: Set<Promise<void>>;
  readonly caught: unknown[];
  readonly uncaught: unknown[];
  answered: boolean;
  dispose: () => void;
}

/**
 * The constant swap runtime. `$S(id)` replaces the fallback of boundary `id` (the nodes between
 * its `<!--[b:id-->` and `<!--]-->` comments) with the content of `<template id="s:id">`; with a
 * second argument the boundary failed on the server and keeps its fallback for the client.
 */
const SWAP_RUNTIME =
  'window.$S=function(i,f){var t=document.getElementById("s:"+i);if(!t)return;' +
  "if(!f){var w=document.createTreeWalker(document,128),c;while(c=w.nextNode()){" +
  'if(c.data==="[b:"+i){var d=1,n=c.nextSibling,e=null;while(n){' +
  'if(n.nodeType===8){if(n.data.charAt(0)==="["){d++}else if(n.data==="]"){d--;if(d===0){e=n;break}}}' +
  "n=n.nextSibling}if(e){while(c.nextSibling!==e)c.parentNode.removeChild(c.nextSibling);" +
  "e.parentNode.insertBefore(t.content,e)}break}}}t.remove()};";

function script(body: string, nonce: string | undefined): string {
  const attribute =
    nonce === undefined ? "" : ` nonce="${nonce.replace(/[^A-Za-z0-9+/=_-]/g, "")}"`;
  return `<script${attribute}>${body}</script>`;
}

/**
 * Renders an app as a stream of HTML, for the fastest first byte: the shell first (pending Suspense
 * boundaries show their fallback), then one chunk per boundary as its data arrives, in the order the
 * data settles, and finally, when resources resolved, a
 * `<script type="application/json" data-sh="RENDER_ID">` block with their values. The page works without JavaScript: each chunk is a `<template>` that a
 * tiny inline script swaps in for the fallback. A boundary whose data can no longer arrive keeps its
 * fallback for the client.
 *
 * @param code Builds the app.
 * @param options Hydration-key prefix, nonce, time budget, abort signal, collectors, shell callback
 * and error reporters. Undefined uses the defaults of {@link StreamOptions}.
 * @returns A byte stream of the app markup, to be placed inside your document. Canceling it stops
 * the render.
 * @throws TypeError, synchronously, for an invalid `renderId` or `timeoutMs`. The stream itself errors with an
 * `SsrError` whose `code` is `SSR_TIMEOUT` when `timeoutMs` runs out, with the signal's reason when
 * `signal` aborts, and with an error no boundary caught when `onUncaughtError` is not set.
 * @example
 * import { createComponent, renderToStream } from "@shadow-js/web/server";
 *
 * function App() {
 *   return <h1>Hello</h1>;
 * }
 * function handle(request: Request): Response {
 *   const stream = renderToStream(() => createComponent(App, {}), { signal: request.signal });
 *   return new Response(stream, { headers: { "content-type": "text/html" } });
 * }
 * @see renderToStringAsync
 * @since 1.0.0
 */
export function renderToStream(
  code: () => unknown,
  options: StreamOptions = {},
): ReadableStream<Uint8Array> {
  const renderId = options.renderId ?? "0";
  if (typeof renderId !== "string" || !RENDER_ID.test(renderId)) {
    throw new TypeError("render options: renderId must be made of letters, digits, _ and -.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !(timeoutMs > 0) || !Number.isFinite(timeoutMs)) {
    throw new TypeError("render options: timeoutMs must be a positive finite number.");
  }
  const signal = options.signal;
  const portals = portalCollectorFor(options.portals);
  const encoder = new TextEncoder();
  // Every render of the shell, kept until the stream ends: a later pass joins the fetches an earlier one started.
  const passes: ShellPass[] = [];
  const disposeAll = (): void => {
    const errors: unknown[] = [];
    for (const pass of passes.splice(0)) {
      try {
        pass.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Stream cleanup failed.");
  };
  let canceled = false;
  // Cleared when the stream ends or is canceled, so a finished render never keeps the process alive.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelRender: (reason: unknown) => void = () => undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const settled = new Map<string, unknown>();
      // The fetch each key was last started with: a render that finds it unsettled joins it (ResourceCache.pending).
      const fetching = new Map<string, Promise<unknown>>();
      const push = (text: string): void => {
        if (signal?.aborted) throw signal.reason;
        if (!canceled) controller.enqueue(encoder.encode(text));
      };

      /** Renders the shell once. Its resources, boundaries and errors belong to this pass alone. */
      const renderPass = (): ShellPass => {
        const pass: ShellPass = {
          html: "",
          boundaries: [],
          requested: new Set<string>(),
          held: [],
          inFlight: new Set<Promise<void>>(),
          caught: [],
          uncaught: [],
          answered: false,
          dispose: () => undefined,
        };
        passes.push(pass);
        const cache: ResourceCache = {
          key: (explicit) => {
            const key = resourceKey(explicit);
            pass.requested.add(key);
            return key;
          },
          read: (key) => (settled.has(key) ? { value: settled.get(key) } : undefined),
          track: (key, promise, trackOptions?: ResourceTrackOptions) => {
            fetching.set(key, promise);
            const entry = promise.then(
              (value) => {
                settled.set(key, value);
              },
              () => undefined,
            );
            pass.inFlight.add(entry);
            void entry.finally(() => pass.inFlight.delete(entry));
            if (trackOptions?.deferStream === true) pass.held.push({ key, entry });
          },
          pending: (key) => fetching.get(key),
        };
        const sink: StreamSink = {
          defer: (boundary: StreamBoundary) => {
            pass.boundaries.push(boundary);
          },
        };
        // Errors of a pass that is not the answer are held back: the answering pass reports them, once.
        const reporters: RootErrorOptions = {
          onCaughtError: (error) => {
            if (pass.answered) options.onCaughtError?.(error);
            else pass.caught.push(error);
          },
          ...(options.onUncaughtError === undefined
            ? {}
            : {
                onUncaughtError: (error: unknown) => {
                  if (pass.answered) options.onUncaughtError?.(error);
                  else pass.uncaught.push(error);
                },
              }),
        };
        options.head?.clear();
        portals?.clear();
        pass.html = createRoot((stop) => {
          pass.dispose = stop;
          // Attached to the root of this render, so every boundary of it reports through these.
          attachRootErrors(reporters);
          const view = StreamContext({
            value: sink,
            get children() {
              return withPortalSink(portals, () =>
                ResourceCacheContext({
                  value: cache,
                  get children() {
                    return runWithServerHead(options.head, () =>
                      withScope(createRootScope(renderId), () => escape(code())),
                    );
                  },
                }),
              );
            },
          });
          return ((view as () => unknown)() as () => string)();
        });
        return pass;
      };

      let rejectAbort: (reason: unknown) => void = () => undefined;
      const abort = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
        timer = setTimeout(
          () =>
            reject(
              new SsrError("SSR_TIMEOUT", `The stream did not finish within ${timeoutMs} ms.`),
            ),
          timeoutMs,
        );
      });
      const onAbort = (): void =>
        rejectAbort(signal?.reason ?? new Error("The render was aborted."));
      signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        disposeAll();
      };
      // Wake a held shell or boundary immediately; late resource settlement must not render again.
      cancelRender = (reason) => {
        rejectAbort(reason);
        cleanup();
      };
      // Marks the abort handled for a render that has already finished (the stream closed, the timer
      // is cleared) and no longer awaits it. While the loop below awaits `abort`, its rejection is
      // rethrown there into `controller.error`, so a timeout or an abort is reported to the reader.
      abort.catch(() => undefined);

      try {
        if (signal?.aborted) throw signal.reason;
        // The shell is sent once the resources it holds have settled: a held render that finds a
        // value renders again with it, so the value is in the first chunk and not behind a fallback.
        let answer = renderPass();
        for (let round = 1; answer.held.length > 0; round += 1) {
          await Promise.race([abort, Promise.allSettled(answer.held.map((held) => held.entry))]);
          // No held value arrived (each held fetch failed): this render is the answer, with its fallbacks.
          if (!answer.held.some((held) => settled.has(held.key))) break;
          if (round >= MAX_SHELL_PASSES) {
            throw new SsrError(
              "SSR_BOUNDARY_WATERFALL",
              `Resources kept holding the stream after ${MAX_SHELL_PASSES} shell renders; flatten the data flow.`,
            );
          }
          answer = renderPass();
        }

        answer.answered = true;
        untrack(() => {
          for (const error of answer.caught) options.onCaughtError?.(error);
          for (const error of answer.uncaught) options.onUncaughtError?.(error);
          options.onShellReady?.(answer.html);
        });
        push(
          answer.boundaries.length > 0
            ? answer.html + script(SWAP_RUNTIME, options.nonce)
            : answer.html,
        );

        const failRemaining = (): void => {
          // Nothing can make progress (failed resources): leave the fallbacks for the client.
          for (const boundary of answer.boundaries.splice(0)) {
            push(
              `<template id="s:${boundary.id}"></template>` +
                script(`$S(${JSON.stringify(boundary.id)},1)`, options.nonce),
            );
          }
        };
        let strikes = 0;
        while (answer.boundaries.length > 0) {
          if (answer.inFlight.size === 0) {
            failRemaining();
            break;
          }
          const settledBefore = settled.size;
          await Promise.race([abort, Promise.race([...answer.inFlight])]);
          const current = answer.boundaries;
          answer.boundaries = [];
          let emitted = false;
          for (const boundary of current) {
            const html = boundary.rebuild();
            if (html === null) continue;
            emitted = true;
            push(
              `<template id="s:${boundary.id}">${html}</template>` +
                script(`$S(${JSON.stringify(boundary.id)})`, options.nonce),
            );
          }
          // Rounds that settle nothing new and emit nothing (only rejections) are bounded.
          strikes = settled.size === settledBefore && !emitted ? strikes + 1 : 0;
          if (answer.boundaries.length > 0 && strikes >= 2) failRemaining();
        }

        const data: Record<string, unknown> = {};
        for (const key of answer.requested) {
          if (!settled.has(key)) continue;
          Object.defineProperty(data, key, {
            value: settled.get(key),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        if (Object.keys(data).length > 0) {
          push(`<script type="application/json" data-sh="${renderId}">${serialize(data)}</script>`);
        }
        cleanup();
        if (!canceled) controller.close();
      } catch (error) {
        cleanup();
        if (!canceled) controller.error(error);
      }
    },
    cancel(reason) {
      canceled = true;
      cancelRender(reason);
    },
  });
}
