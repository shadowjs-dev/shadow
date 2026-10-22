import { createRoot, useMemo, useSignal } from "@shadow-js/core";
import { expect, it, vi } from "vitest";
import { createComponent, renderToStream } from "../../src/server/index";
import { load } from "../support/compile";

const source = `
import { onCleanup, useResource } from "@shadow-js/core";
import { Suspense } from "@shadow-js/web";
export const events = { mounts: 0, cleanups: 0 };
function Slow(props) {
  const value = useResource(() => props.data, { key: props.freshKey ? "late-" + events.mounts : "late", deferStream: props.held });
  const output = value();
  if (output !== undefined) props.onValue?.();
  return <p>{output}</p>;
}
export function App(props) {
  events.mounts += 1;
  if (props.badCleanup && (events.mounts === 1 || props.allBadCleanups)) {
    onCleanup(() => { events.cleanups += 1; throw new Error("cleanup failed"); });
  } else onCleanup(() => { events.cleanups += 1; });
  return <Suspense fallback={<p>loading</p>}><Slow {...props} /></Suspense>;
}
`;
type Fixture = {
  App: (props: {
    data: Promise<string>;
    held?: boolean;
    onValue?: () => void;
    freshKey?: boolean;
    badCleanup?: boolean;
    allBadCleanups?: boolean;
  }) => unknown;
  events: { mounts: number; cleanups: number };
};

it("[STM-LIFE-01] an already-aborted request renders no application and preserves the abort reason", async () => {
  const control = new AbortController();
  const reason = new Error("request already closed");
  control.abort(reason);
  const render = vi.fn(() => "never");
  const stream = renderToStream(render, { signal: control.signal });
  await expect(new Response(stream).text()).rejects.toBe(reason);
  expect(render).not.toHaveBeenCalled();
});

it.each(["complete", "error", "timeout", "abort"] as const)(
  "[STM-LIFE-02] terminal %s removes its abort listener and timer",
  async (terminal) => {
    vi.useFakeTimers();
    const control = new AbortController();
    const added = vi.spyOn(control.signal, "addEventListener");
    const removed = vi.spyOn(control.signal, "removeEventListener");
    try {
      const app = await load<Fixture>(source, "ssr");
      app.events.mounts = 0;
      app.events.cleanups = 0;
      const code =
        terminal === "complete"
          ? () => "done"
          : terminal === "error"
            ? () => {
                throw new Error("render failed");
              }
            : () => createComponent(app.App, { data: new Promise<string>(() => undefined) });
      const stream = renderToStream(code, { signal: control.signal, timeoutMs: 50 });
      const result = new Response(stream).text();
      const assertion =
        terminal === "complete"
          ? expect(result).resolves.toBe("done")
          : expect(result).rejects.toThrow();
      if (terminal === "timeout") await vi.advanceTimersByTimeAsync(50);
      if (terminal === "abort") control.abort(new Error("gone"));
      await assertion;
      const listener = added.mock.calls.find(([name]) => name === "abort")?.[1];
      expect(listener).toBeDefined();
      expect(
        removed.mock.calls.some(([name, callback]) => name === "abort" && callback === listener),
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(app.events.cleanups).toBe(app.events.mounts);
    } finally {
      added.mockRestore();
      removed.mockRestore();
      vi.useRealTimers();
    }
  },
);

it("[STM-LIFE-03] canceling a held shell disposes it and never rerenders or reports shell readiness after late data", async () => {
  vi.useFakeTimers();
  const control = new AbortController();
  const removed = vi.spyOn(control.signal, "removeEventListener");
  try {
    const app = await load<Fixture>(source, "ssr");
    app.events.mounts = 0;
    app.events.cleanups = 0;
    let release: (value: string) => void = () => undefined;
    const data = new Promise<string>((resolve) => {
      release = resolve;
    });
    const onShellReady = vi.fn();
    const stream = renderToStream(() => createComponent(app.App, { data, held: true }), {
      signal: control.signal,
      onShellReady,
    });
    await stream.cancel("consumer stopped");
    release("late");
    await vi.runAllTimersAsync();
    expect(app.events).toEqual({ mounts: 1, cleanups: 1 });
    expect(onShellReady).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    removed.mockRestore();
    vi.useRealTimers();
  }
});

it("[STM-LIFE-04] shell callbacks run untracked and caller tracking resumes afterward", () => {
  const [secret, setSecret] = useSignal(0);
  const [tracked, setTracked] = useSignal(0);
  let runs = 0;
  const { dispose, read } = createRoot((stop) => ({
    dispose: stop,
    read: useMemo(() => {
      runs += 1;
      renderToStream(() => "done", {
        onShellReady: () => {
          secret();
        },
      });
      tracked();
      return runs;
    }),
  }));
  try {
    expect(read()).toBe(1);
    setSecret(1);
    expect(read()).toBe(1);
    setTracked(1);
    expect(read()).toBe(2);
  } finally {
    dispose();
  }
});

it("[STM-LIFE-05] invalid time budgets are refused synchronously instead of being coerced by host timers", () => {
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => renderToStream(() => "never", { timeoutMs })).toThrow(TypeError);
});

it("[STM-LIFE-06] an abort from shell readiness prevents output and preserves its reason", async () => {
  const control = new AbortController();
  const reason = new Error("closed at shell");
  const stream = renderToStream(() => "private shell", {
    signal: control.signal,
    onShellReady: () => control.abort(reason),
  });
  await expect(new Response(stream).text()).rejects.toBe(reason);
});

it("[STM-LIFE-07] aborting in a late boundary prevents its private chunk from being enqueued", async () => {
  const app = await load<Fixture>(source, "ssr");
  const control = new AbortController();
  const reason = new Error("closed during boundary");
  let release: (value: string) => void = () => undefined;
  const data = new Promise<string>((resolve) => {
    release = resolve;
  });
  const reader = renderToStream(
    () => createComponent(app.App, { data, onValue: () => control.abort(reason) }),
    { signal: control.signal },
  ).getReader();
  expect((await reader.read()).done).toBe(false);
  const next = expect(reader.read()).rejects.toBe(reason);
  release("private late value");
  await next;
});

it("[STM-LIFE-08] the held-shell waterfall stops at exactly ten passes and disposes every pass", async () => {
  const app = await load<Fixture>(source, "ssr");
  app.events.mounts = 0;
  app.events.cleanups = 0;
  const stream = renderToStream(() =>
    createComponent(app.App, { data: Promise.resolve("ready"), held: true, freshKey: true }),
  );
  await expect(new Response(stream).text()).rejects.toMatchObject({
    code: "SSR_BOUNDARY_WATERFALL",
  });
  expect(app.events).toEqual({ mounts: 10, cleanups: 10 });
});

it("[STM-LIFE-09] a failing cleanup in an earlier held pass does not leave later passes undisposed", async () => {
  const app = await load<Fixture>(source, "ssr");
  app.events.mounts = 0;
  app.events.cleanups = 0;
  const stream = renderToStream(() =>
    createComponent(app.App, { data: Promise.resolve("ready"), held: true, badCleanup: true }),
  );
  await expect(new Response(stream).text()).rejects.toThrow("cleanup failed");
  expect(app.events).toEqual({ mounts: 2, cleanups: 2 });
});

it("[STM-LIFE-10] multiple pass cleanup failures are aggregated after every pass is disposed", async () => {
  const app = await load<Fixture>(source, "ssr");
  app.events.mounts = 0;
  app.events.cleanups = 0;
  const stream = renderToStream(() =>
    createComponent(app.App, {
      data: Promise.resolve("ready"),
      held: true,
      badCleanup: true,
      allBadCleanups: true,
    }),
  );
  await expect(new Response(stream).text()).rejects.toMatchObject({
    errors: [
      expect.objectContaining({ message: "cleanup failed" }),
      expect.objectContaining({ message: "cleanup failed" }),
    ],
  });
  expect(app.events).toEqual({ mounts: 2, cleanups: 2 });
});

it("[STM-LIFE-11] a rejected held resource in the tenth pass may finish with its fallback without an eleventh render", async () => {
  const app = await load<Fixture>(source, "ssr");
  app.events.mounts = 0;
  app.events.cleanups = 0;
  const stream = renderToStream(() =>
    createComponent(app.App, {
      get data() {
        return app.events.mounts === 10
          ? Promise.reject(new Error("last resource failed"))
          : Promise.resolve("ready");
      },
      held: true,
      freshKey: true,
    }),
  );
  expect(await new Response(stream).text()).toContain("loading");
  expect(app.events).toEqual({ mounts: 10, cleanups: 10 });
});
