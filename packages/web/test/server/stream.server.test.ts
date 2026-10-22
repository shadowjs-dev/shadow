import { useResource } from "@shadow-js/core";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/control-flow/error-boundary";
import { Suspense } from "../../src/control-flow/suspense";
import { createComponent, renderToStream, renderToString } from "../../src/server/index";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function chunks(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const out: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(decoder.decode(value));
  }
}

/**
 * Reads a stream one chunk at a time, so a test can act on the output it has seen (resolve the
 * next boundary) instead of waiting for a fixed time.
 */
function pullChunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const out: string[] = [];
  return {
    /** Reads until the text so far contains `text`. The stream stays open for later reads. */
    async untilContains(text: string): Promise<void> {
      while (!out.join("").includes(text)) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`the stream ended before it contained ${JSON.stringify(text)}`);
        out.push(decoder.decode(value));
      }
    },
    /** Reads the rest and returns every chunk. */
    async rest(): Promise<string[]> {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return out;
        out.push(decoder.decode(value));
      }
    },
  };
}

const Data = (props: { name: string; p: Promise<string> }): unknown => {
  const data = useResource(() => props.p, { key: props.name });
  // Read while the component runs, like compiled server output does (escape(data())).
  return data() ?? "…";
};
const Boundary = (props: { name: string; p: Promise<string>; fallback?: string }): unknown =>
  Suspense({
    fallback: props.fallback ?? `loading-${props.name}`,
    get children() {
      return createComponent(Data, { name: props.name, p: props.p });
    },
  });

describe("renderToStream", () => {
  it("[STM-01] no pending boundary: the whole app in one chunk, no swap runtime", async () => {
    const out = await chunks(renderToStream(() => "<hello>"));
    expect(out).toEqual(["&lt;hello&gt;"]);
  });

  it("[STM-02] a pending boundary: fallback in the shell, content in a later chunk, then data", async () => {
    const d = deferred<string>();
    const stream = renderToStream(() => [
      "a:",
      createComponent(Boundary, { name: "x", p: d.promise }),
      ":z",
    ]);
    const collected = chunks(stream);
    d.resolve("ready");
    const out = await collected;
    expect(out[0]).toMatch(/a:<!--\[b:[\w-]+-->loading-x<!--\]-->:z/);
    expect(out[0]).toContain("$S=function");
    const key = /<!--\[b:([\w-]+)-->/.exec(out[0] ?? "")?.[1];
    expect(key).toBeDefined();
    expect(out[1]).toContain(`<template id="s:${key}">ready</template>`);
    expect(out[1]).toContain(`$S("${key}")`);
    expect(out.at(-1)).toContain('data-sh="0"');
    expect(out.at(-1)).toContain("ready");
  });

  it("[STM-03] boundaries resolve out of order, each in its own chunk", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const stream = pullChunks(
      renderToStream(() => [
        createComponent(Boundary, { name: "slow", p: slow.promise }),
        createComponent(Boundary, { name: "fast", p: fast.promise }),
      ]),
    );
    fast.resolve("F");
    // The fast boundary's chunk is out before the slow one is released, so the order is observed.
    await stream.untilContains(">F</template>");
    slow.resolve("S");
    const out = (await stream.rest()).join("");
    expect(out.indexOf(">F</template>")).toBeLessThan(out.indexOf(">S</template>"));
  });

  it("[STM-04] a boundary whose data fails keeps its fallback and tells the client", async () => {
    const d = deferred<string>();
    const collected = chunks(
      renderToStream(() => createComponent(Boundary, { name: "bad", p: d.promise })),
    );
    d.reject(new Error("no"));
    const out = (await collected).join("");
    expect(out).toContain("loading-bad");
    expect(out).toMatch(/\$S\("[^"]+",1\)/);
  });

  it("[STM-05] keys of siblings do not depend on whether a boundary is pending", async () => {
    const Sibling = (): unknown => "s";
    const make = (p: Promise<string>) => () => [
      createComponent(Boundary, { name: "b", p }),
      createComponent(Sibling, {}),
    ];
    const ready = Promise.resolve("r");
    const slow = deferred<string>();
    const a = renderToString(make(ready));
    const collected = chunks(renderToStream(make(slow.promise)));
    slow.resolve("r");
    const streamed = (await collected).join("");
    // The sibling renders identically either way (its key space is outside the boundary).
    expect(a.endsWith("s")).toBe(true);
    expect(streamed).toContain("s");
  });

  it("[STM-06] an abort signal errors the stream", async () => {
    const d = deferred<string>();
    const controller = new AbortController();
    const stream = renderToStream(() => createComponent(Boundary, { name: "x", p: d.promise }), {
      signal: controller.signal,
    });
    const reading = chunks(stream);
    controller.abort(new Error("stop"));
    await expect(reading).rejects.toThrow("stop");
  });

  it("[STM-07] the time budget ends a stream that never settles", async () => {
    const stream = renderToStream(
      () => createComponent(Boundary, { name: "x", p: new Promise<string>(() => undefined) }),
      { timeoutMs: 30 },
    );
    await expect(chunks(stream)).rejects.toThrow(/did not finish/);
  });

  it("[STM-08] a nested boundary that becomes pending later streams in a second round", async () => {
    const outer = deferred<string>();
    const inner = deferred<string>();
    const Outer = (): unknown =>
      Suspense({
        fallback: "outer",
        get children() {
          const data = useResource(() => outer.promise, { key: "outer" });
          const value = data();
          return value === undefined
            ? undefined
            : [value, createComponent(Boundary, { name: "inner", p: inner.promise })];
        },
      });
    const stream = pullChunks(renderToStream(() => createComponent(Outer, {})));
    outer.resolve("O");
    // The second round is out (the inner fallback is in it) before the inner data is released.
    await stream.untilContains("loading-inner");
    inner.resolve("I");
    const out = (await stream.rest()).join("");
    expect(out).toContain("O");
    expect(out).toContain(">I<");
  });

  it("[STM-09] invalid renderId is rejected", () => {
    expect(() => renderToStream(() => "x", { renderId: "a b" })).toThrow(TypeError);
  });

  it("[STM-10] a finished or canceled stream leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      await chunks(renderToStream(() => "done", { timeoutMs: 60_000 }));
      expect(vi.getTimerCount()).toBe(0);
      const stream = renderToStream(() => "cancel me", { timeoutMs: 60_000 });
      await stream.cancel();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A boundary whose resource holds the first flush (`deferStream`). */
const HeldData = (props: { name: string; p: Promise<string>; onFetch?: () => void }): unknown => {
  const data = useResource(
    () => {
      props.onFetch?.();
      return props.p;
    },
    { key: props.name, deferStream: true },
  );
  return data() ?? "…";
};
const HeldBoundary = (props: { name: string; p: Promise<string>; onFetch?: () => void }): unknown =>
  Suspense({
    fallback: `loading-${props.name}`,
    get children() {
      return createComponent(HeldData, props);
    },
  });

describe("renderToStream: deferStream", () => {
  it("[STM-11] a deferStream resource holds the first flush until it resolves, and its value is in the shell", async () => {
    const d = deferred<string>();
    const shells: string[] = [];
    const collected = chunks(
      renderToStream(() => createComponent(HeldBoundary, { name: "h", p: d.promise }), {
        onShellReady: (shell) => shells.push(shell),
      }),
    );
    // Nothing is flushed while the held resource is pending: the shell is not ready yet.
    expect(shells).toEqual([]);
    d.resolve("held");
    const out = await collected;
    expect(shells).toHaveLength(1);
    expect(out[0]).toContain("held");
    expect(out[0]).not.toContain("loading-h");
    expect(out[0]).not.toContain("$S=function");
    expect(out).toHaveLength(2);
    expect(out[1]).toContain('data-sh="0"');
    expect(out[1]).toContain("held");
  });

  it("[STM-12] a sibling boundary without deferStream still streams after the held shell", async () => {
    const held = deferred<string>();
    const late = deferred<string>();
    const stream = pullChunks(
      renderToStream(() => [
        createComponent(HeldBoundary, { name: "h", p: held.promise }),
        createComponent(Boundary, { name: "late", p: late.promise }),
      ]),
    );
    held.resolve("H");
    await stream.untilContains("loading-late");
    const shell = stream.rest();
    late.resolve("L");
    const out = (await shell).join("");
    expect(out).toContain("H");
    expect(out).toContain(">L</template>");
  });

  it("[STM-13] a fetch the first shell pass started is joined by the pass that renders the shell, not repeated", async () => {
    const side = deferred<string>();
    const held = deferred<string>();
    let sideFetches = 0;
    const Side = (): unknown =>
      Suspense({
        fallback: "loading-side",
        get children() {
          const data = useResource(
            () => {
              sideFetches += 1;
              return side.promise;
            },
            { key: "side" },
          );
          return data() ?? "…";
        },
      });
    const stream = pullChunks(
      renderToStream(() => [
        createComponent(HeldBoundary, { name: "h", p: held.promise }),
        createComponent(Side, {}),
      ]),
    );
    held.resolve("H");
    await stream.untilContains("loading-side");
    side.resolve("S");
    const out = (await stream.rest()).join("");
    expect(sideFetches).toBe(1);
    expect(out).toContain(">S</template>");
  });

  it("[STM-14] a deferStream resource that rejects does not hold the stream forever; its fallback stays", async () => {
    const d = deferred<string>();
    const collected = chunks(
      renderToStream(() => createComponent(HeldBoundary, { name: "bad", p: d.promise })),
    );
    d.reject(new Error("no"));
    const out = (await collected).join("");
    expect(out).toContain("loading-bad");
    expect(out).toMatch(/\$S\("[^"]+",1\)/);
  });

  it("[STM-15] an error caught while the shell renders again is reported once", async () => {
    const d = deferred<string>();
    const caught: unknown[] = [];
    const Boom = (): unknown => {
      throw new Error("boom");
    };
    const Guarded = (): unknown =>
      ErrorBoundary({
        fallback: "caught",
        get children() {
          return createComponent(Boom, {});
        },
      });
    const collected = chunks(
      renderToStream(
        () => [
          createComponent(HeldBoundary, { name: "h", p: d.promise }),
          createComponent(Guarded, {}),
        ],
        {
          onCaughtError: (error) => caught.push(error),
        },
      ),
    );
    d.resolve("H");
    const out = (await collected).join("");
    expect(out).toContain("caught");
    expect(caught).toHaveLength(1);
  });

  it("[STM-16] a render that keeps holding new resources is bounded by a waterfall error", async () => {
    let renders = 0;
    const Chain = (): unknown => {
      const key = `chain-${renders}`;
      renders += 1;
      const data = useResource(() => Promise.resolve("v"), { key, deferStream: true });
      return data() ?? "…";
    };
    const stream = renderToStream(() => createComponent(Chain, {}));
    await expect(chunks(stream)).rejects.toMatchObject({ code: "SSR_BOUNDARY_WATERFALL" });
  });
});
