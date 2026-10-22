import {
  createRoot,
  flushSync,
  onCleanup,
  useEffect,
  useRenderEffect,
  useResource,
  useSignal,
} from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { lazy } from "../../src/control-flow/lazy";
import { Suspense } from "../../src/control-flow/suspense";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
};

describe("Suspense", () => {
  it("[SPN-01] shows the fallback until the first load settles, then the content", async () => {
    const d = deferred<string>();
    const seen: unknown[] = [];
    createRoot(() => {
      const view = Suspense({
        fallback: "loading",
        get children() {
          const res = useResource(() => d.promise);
          useRenderEffect(() => void res());
          return () => res();
        },
      });
      useEffect(() => {
        const v = view();
        seen.push(typeof v === "function" ? (v as () => unknown)() : v);
      });
    });
    flushSync();
    d.resolve("done");
    await settle();
    expect(seen).toEqual(["loading", "done"]);
  });

  it("[SPN-02] children are created once and keep state while the fallback shows", async () => {
    let created = 0;
    let cleaned = 0;
    const d = deferred<number>();
    const [trigger, setTrigger] = useSignal(false);
    createRoot(() => {
      Suspense({
        fallback: "f",
        get children() {
          created += 1;
          onCleanup(() => {
            cleaned += 1;
          });
          useResource(() => d.promise);
          void trigger;
          return "content";
        },
      });
    });
    flushSync(() => setTrigger(true));
    d.resolve(1);
    await settle();
    expect(created).toBe(1);
    expect(cleaned).toBe(0);
  });

  it("[SPN-03] refetching does not bring the fallback back", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    let calls = 0;
    let res!: ReturnType<typeof useResource<number>>;
    const seen: unknown[] = [];
    createRoot(() => {
      const view = Suspense({
        fallback: "f",
        get children() {
          res = useResource(() => {
            calls += 1;
            return calls === 1 ? first.promise : second.promise;
          });
          useRenderEffect(() => void res());
          return "content";
        },
      });
      useEffect(() => void seen.push(view()));
    });
    flushSync();
    first.resolve(1);
    await settle();
    res.refetch();
    flushSync();
    expect(seen).toEqual(["f", "content"]);
  });

  it("[SPN-04] nested boundaries only suspend the one that owns the resource", async () => {
    const d = deferred<number>();
    const outer: unknown[] = [];
    createRoot(() => {
      const view = Suspense({
        fallback: "outer",
        get children() {
          return Suspense({
            fallback: "inner",
            get children() {
              const inner = useResource(() => d.promise);
              useRenderEffect(() => void inner());
              return "x";
            },
          });
        },
      });
      useEffect(() => {
        const inner = view();
        outer.push(typeof inner === "function" ? (inner as () => unknown)() : inner);
      });
    });
    flushSync();
    expect(outer).toEqual(["inner"]);
  });
});

describe("lazy", () => {
  it("[LZY-01] loads once, suspends, then renders the component with its props", async () => {
    const d = deferred<{ default: (props: { n: number }) => string }>();
    let loads = 0;
    const Comp = lazy(() => {
      loads += 1;
      return d.promise;
    });
    const seen: unknown[] = [];
    createRoot(() => {
      const view = Suspense({
        fallback: "f",
        get children() {
          return Comp({ n: 2 });
        },
      });
      useEffect(() => {
        const first = view();
        const inner = typeof first === "function" ? (first as () => unknown)() : first;
        seen.push(inner);
      });
    });
    flushSync();
    d.resolve({ default: (props) => `n=${props.n}` });
    await settle();
    expect(seen).toEqual(["f", "n=2"]);
    createRoot(() => {
      const again = Comp({ n: 3 });
      expect(again()).toBe("n=3");
    });
    expect(loads).toBe(1);
  });

  it("[LZY-02] a failed load throws on read and the next render retries", async () => {
    let attempt = 0;
    const Comp = lazy<object>(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error("net"));
      return Promise.resolve({ default: () => "ok" });
    });
    let view!: () => unknown;
    createRoot(() => {
      view = Comp({});
    });
    await settle();
    expect(() => view()).toThrow("net");
    createRoot(() => {
      view = Comp({});
    });
    await settle();
    expect(view()).toBe("ok");
    expect(attempt).toBe(2);
  });

  it("[LZY-03] preload loads without rendering", async () => {
    let loads = 0;
    const Comp = lazy<object>(() => {
      loads += 1;
      return Promise.resolve({ default: () => "p" });
    });
    await Comp.preload();
    await Comp.preload();
    expect(loads).toBe(1);
  });
});
