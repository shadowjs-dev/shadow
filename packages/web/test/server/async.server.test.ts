import { useResource } from "@shadow-js/core";
import { describe, expect, it, vi } from "vitest";
import { Suspense } from "../../src/control-flow/suspense";
import {
  createComponent,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
  escape,
  renderToStringAsync,
  ssr,
  ssrHydrationKey,
} from "../../src/server/index";

/** A component reading one keyed resource; renders the value or nothing while it is pending. */
function Value(props: { name: string; load: () => Promise<string> | string }) {
  const data = useResource(() => props.load(), { key: props.name });
  return escape(data());
}

describe("renderToStringAsync", () => {
  it("[SSR-121] resolves an async resource in a second pass and reports its value", async () => {
    const result = await renderToStringAsync(() =>
      createComponent(Value, { name: "user", load: () => Promise.resolve("ada") }),
    );
    expect(result.html).toBe("ada");
    expect(result.data).toEqual({ "k:user": "ada" });
  });

  it("[SSR-122] the fetcher runs once per key across passes; later passes read the cache", async () => {
    const fetcher = vi.fn(() => Promise.resolve("v"));
    await renderToStringAsync(() => createComponent(Value, { name: "k", load: fetcher }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("[SSR-123] synchronous resources need only one pass", async () => {
    let renders = 0;
    const result = await renderToStringAsync(() => {
      renders += 1;
      return createComponent(Value, { name: "sync", load: () => "now" });
    });
    expect(renders).toBe(1);
    expect(result.html).toBe("now");
    // Core reports only promises to the cache, so a synchronous value is not in data. The client
    // runs the same synchronous fetcher again, which is cheap and gives the same value.
    expect(result.data).toEqual({});
  });

  it("[SSR-124] a resource that reads another resource builds a waterfall, one level per pass", async () => {
    const Chain = (props: { depth: number; total: number }): unknown => {
      const data = useResource(() => Promise.resolve(`level${props.depth}`), {
        key: `level${props.depth}`,
      });
      if (data() === undefined) return "";
      if (props.depth + 1 >= props.total) return escape(data());
      return [
        escape(data()),
        createComponent(Chain, { depth: props.depth + 1, total: props.total }),
      ];
    };
    const result = await renderToStringAsync(() => createComponent(Chain, { depth: 0, total: 3 }));
    expect(result.html).toBe("level0level1level2");
    expect(result.data).toEqual({
      "k:level0": "level0",
      "k:level1": "level1",
      "k:level2": "level2",
    });
  });

  it("[SSR-125] a waterfall longer than maxPasses rejects with SSR_BOUNDARY_WATERFALL", async () => {
    const Chain = (props: { depth: number; total: number }): unknown => {
      const data = useResource(() => Promise.resolve(props.depth), { key: `d${props.depth}` });
      if (data() === undefined) return "";
      return createComponent(Chain, { depth: props.depth + 1, total: props.total });
    };
    await expect(
      renderToStringAsync(() => createComponent(Chain, { depth: 0, total: 50 }), { maxPasses: 3 }),
    ).rejects.toMatchObject({ code: "SSR_BOUNDARY_WATERFALL" });
  });

  it("[SSR-126] maxPasses of 1 rejects as soon as an async resource needs a second pass", async () => {
    await expect(
      renderToStringAsync(
        () => createComponent(Value, { name: "one", load: () => Promise.resolve("x") }),
        {
          maxPasses: 1,
        },
      ),
    ).rejects.toMatchObject({ code: "SSR_BOUNDARY_WATERFALL" });
  });

  it("[SSR-127] a pending resource that never settles rejects with SSR_TIMEOUT", async () => {
    await expect(
      renderToStringAsync(
        () =>
          createComponent(Value, {
            name: "never",
            load: () => new Promise<string>(() => undefined),
          }),
        {
          timeoutMs: 20,
        },
      ),
    ).rejects.toMatchObject({ code: "SSR_TIMEOUT" });
  });

  it("[SSR-128] a rejected resource is left out of data and renders its fallback", async () => {
    const Guarded = () => {
      const data = useResource(() => Promise.reject(new Error("offline")), { key: "bad" });
      return escape(data());
    };
    const Page = () =>
      Suspense({
        fallback: ssr(["<p", ">", "</p>"], ssrHydrationKey(), "loading"),
        get children() {
          return createComponent(Guarded, {});
        },
      });
    const result = await renderToStringAsync(() => createComponent(Page, {}));
    expect(result.html).toMatch(/^<p data-hk="0-0-0">loading<\/p>$/);
    expect(result.data).toEqual({});
  });

  it("[SSR-129] explicit keys are used verbatim in data", async () => {
    const result = await renderToStringAsync(() =>
      createComponent(Value, { name: "explicit-key", load: () => Promise.resolve("x") }),
    );
    expect(Object.keys(result.data)).toEqual(["k:explicit-key"]);
  });

  it("[SSR-130] data only contains keys the final pass asked for", async () => {
    const result = await renderToStringAsync(() => "no resources here");
    expect(result).toEqual({ html: "no resources here", data: {} });
  });

  it("[SSR-131] two renders in flight at once keep their own keys and output", async () => {
    const [left, right] = await Promise.all([
      renderToStringAsync(() =>
        createComponent(Value, { name: "left", load: () => Promise.resolve("L") }),
      ),
      renderToStringAsync(() =>
        createComponent(Value, { name: "right", load: () => Promise.resolve("R") }),
      ),
    ]);
    expect(left).toEqual({ html: "L", data: { "k:left": "L" } });
    expect(right).toEqual({ html: "R", data: { "k:right": "R" } });
  });

  it("[SSR-132] a render error rejects the promise and leaves no pass running", async () => {
    await expect(
      renderToStringAsync(() => {
        throw new Error("app failed");
      }),
    ).rejects.toThrow("app failed");
  });

  it("[SSR-133] an invalid renderId rejects the promise", async () => {
    await expect(renderToStringAsync(() => "x", { renderId: "a b" })).rejects.toThrow(TypeError);
  });

  it("[SSR-134] an invalid timeoutMs or maxPasses rejects with a TypeError", async () => {
    await expect(renderToStringAsync(() => "x", { timeoutMs: -1 })).rejects.toThrow(TypeError);
    await expect(renderToStringAsync(() => "x", { maxPasses: 0 })).rejects.toThrow(TypeError);
  });
});
