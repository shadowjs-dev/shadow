import {
  flushSync,
  onMount,
  useEffect,
  useRenderEffect,
  useResource,
  useSignal,
} from "@shadow-js/core";
import { createComponent, render, Suspense } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mount(view: () => unknown): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  return { host, dispose: render(view, host) };
}

/** A Suspense whose children are built lazily, as compiled JSX does (inside the boundary). */
function boundary(Content: () => unknown): unknown {
  return createComponent(Suspense, {
    fallback: "wait",
    get children() {
      return createComponent(Content, {});
    },
  });
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

describe("effects in a suspended subtree", () => {
  it("[HLD-01] onMount and useEffect wait for the boundary, then run once", async () => {
    const d = deferred<string>();
    const log: string[] = [];
    const Content = (): unknown => {
      onMount(() => {
        log.push("mount");
      });
      useEffect(() => {
        log.push("effect");
      });
      const data = useResource(() => d.promise, { key: "d" });
      useRenderEffect(() => data());
      return "x";
    };
    mount(() => boundary(Content));
    flushSync();
    await settle();
    expect(log).toEqual([]);
    d.resolve("x");
    await settle();
    expect(log).toEqual(["mount", "effect"]);
  });

  it("[HLD-02] the content's DOM bindings are not held: the content exists while the fallback shows", async () => {
    const d = deferred<string>();
    let sawNodeInEffect = false;
    const Content = (): unknown => {
      const data = useResource(() => d.promise, { key: "d" });
      const el = document.createElement("p");
      el.textContent = "built";
      useEffect(() => {
        sawNodeInEffect = el.isConnected;
      });
      useRenderEffect(() => data());
      return el;
    };
    mount(() => boundary(Content));
    flushSync();
    d.resolve("x");
    await settle();
    // By the time the effect runs, the content is on the page: that is the point of holding it.
    expect(sawNodeInEffect).toBe(true);
  });

  it("[HLD-03] useEffect(deps, fn, { defer }) skips the first real run, not the held one", async () => {
    const d = deferred<string>();
    const [n, setN] = useSignal(1);
    const seen: number[] = [];
    const Content = (): unknown => {
      useEffect(
        n,
        (value) => {
          seen.push(value);
        },
        { defer: true },
      );
      const data = useResource(() => d.promise, { key: "d" });
      useRenderEffect(() => data());
      return "x";
    };
    mount(() => boundary(Content));
    flushSync();
    d.resolve("x");
    await settle();
    expect(seen).toEqual([]);
    flushSync(() => setN(2));
    expect(seen).toEqual([2]);
  });

  it("[HLD-04] a deps effect receives the value current at release, and cleanups run as usual", async () => {
    const d = deferred<string>();
    const [n, setN] = useSignal(1);
    const log: string[] = [];
    const Content = (): unknown => {
      useEffect(n, (value) => {
        log.push(`run ${value}`);
        return () => log.push(`clean ${value}`);
      });
      const data = useResource(() => d.promise, { key: "d" });
      useRenderEffect(() => data());
      return "x";
    };
    const { dispose } = mount(() => boundary(Content));
    flushSync();
    setN(5);
    flushSync();
    d.resolve("x");
    await settle();
    expect(log).toEqual(["run 5"]);
    flushSync(() => setN(6));
    expect(log).toEqual(["run 5", "clean 5", "run 6"]);
    dispose();
    expect(log).toEqual(["run 5", "clean 5", "run 6", "clean 6"]);
  });

  it("[HLD-05] a boundary that suspends again does not re-run or tear down effects that already ran", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const [more, setMore] = useSignal(false);
    const log: string[] = [];
    const Content = (): unknown => {
      useEffect(() => {
        log.push("effect");
        return () => log.push("cleanup");
      });
      const a = useResource(() => first.promise, { key: "a" });
      return [() => a() ?? "", () => (more() ? createComponent(Late, {}) : null)];
    };
    const Late = (): unknown => {
      const b = useResource(() => second.promise, { key: "b" });
      return () => b() ?? "";
    };
    mount(() => boundary(Content));
    flushSync();
    first.resolve("a");
    await settle();
    expect(log).toEqual(["effect"]);
    flushSync(() => setMore(true));
    await settle();
    expect(log).toEqual(["effect"]);
    second.resolve("b");
    await settle();
    expect(log).toEqual(["effect"]);
  });

  it("[HLD-06] effects outside any boundary, and in a boundary with nothing pending, run as before", async () => {
    const log: string[] = [];
    const Plain = (): unknown => {
      useEffect(() => {
        log.push("plain");
      });
      return "x";
    };
    mount(() => [createComponent(Plain, {}), boundary(Plain)]);
    flushSync();
    await settle();
    expect(log).toEqual(["plain", "plain"]);
  });
});
