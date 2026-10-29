import { flushSync } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/compile";

/**
 * A page whose second branch reads a resource that is still loading. Every request in flight settles when the test
 * calls `api.settle()`, never on a timer, so a loaded machine cannot settle one before the test has looked. `api`
 * also exposes the setter, the transition starter and the isPending accessor.
 */
const SRC = `
import { useResource, useSignal, useTransition } from "@shadow-js/core";
import { ErrorBoundary, Show, Suspense } from "@shadow-js/web";

const waiting = [];
export const api = {
  settle() {
    for (const settle of waiting.splice(0)) settle();
  },
};
export const slowLog = { reads: 0 };

export function Slow(props) {
  const data = useResource(() => new Promise((resolve, reject) => {
    const settle = () => (props.fail ? reject(new Error("net down")) : resolve("slow content"));
    waiting.push(settle);
  }), { name: "slow" });
  slowLog.reads += 1;
  return <p class="slow">{data()}</p>;
}

export function Home() {
  return <p class="home">home</p>;
}

export function App(props) {
  const [page, setPage] = useSignal("home");
  const [pending, start] = useTransition();
  api.setPage = setPage;
  api.start = start;
  api.pending = pending;
  return (
    <ErrorBoundary fallback={<p class="failed">failed</p>}>
      <Suspense fallback={<p class="loading">loading</p>}>
        <Show when={page() === "home"} fallback={<Slow fail={props.fail} />}>
          <Home />
        </Show>
      </Suspense>
    </ErrorBoundary>
  );
}
`;

type Mod = {
  App: (props: { fail?: boolean }) => unknown;
  api: {
    settle: () => void;
    setPage: (page: string) => void;
    start: (fn: () => void) => Promise<void>;
    pending: () => boolean;
  };
};

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mount(mod: Mod, props: { fail?: boolean }): { host: HTMLElement } {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(() => mod.App(props), host);
  flushSync();
  return { host };
}

/** Lets every queued task run once: the resource's request is in flight after it, and never settled by it. */
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("transitions and Suspense", () => {
  it("[TSU-01] a transition that suspends keeps the shown content, reports pending, and reveals the new content when the data arrives", async () => {
    const mod = await load<Mod>(SRC);
    const { host } = mount(mod, {});
    expect(host.textContent).toBe("home");
    const done = mod.api.start(() => mod.api.setPage("other"));
    await macrotask();
    expect(host.querySelector(".loading")).toBeNull();
    expect(host.textContent).toBe("home");
    expect(mod.api.pending()).toBe(true);
    mod.api.settle();
    await done;
    expect(host.textContent).toBe("slow content");
    expect(mod.api.pending()).toBe(false);
  });

  it("[TSU-02] an urgent update that suspends still shows the fallback (no transition, unchanged)", async () => {
    const mod = await load<Mod>(SRC);
    const { host } = mount(mod, {});
    mod.api.setPage("other");
    flushSync();
    await macrotask();
    expect(host.querySelector(".loading")).not.toBeNull();
    expect(host.textContent).toBe("loading");
    mod.api.settle();
    await macrotask();
    flushSync();
    expect(host.textContent).toBe("slow content");
  });

  it("[TSU-03] a newer transition while the boundary holds wins: the content reveals the newest state", async () => {
    const mod = await load<Mod>(SRC);
    const { host } = mount(mod, {});
    const first = mod.api.start(() => mod.api.setPage("other"));
    await macrotask();
    expect(host.textContent).toBe("home");
    const second = mod.api.start(() => mod.api.setPage("home"));
    mod.api.settle();
    await Promise.all([first, second]);
    expect(host.textContent).toBe("home");
    expect(mod.api.pending()).toBe(false);
  });

  it("[TSU-04] a resource that fails while a transition holds surfaces through the nearest ErrorBoundary", async () => {
    const mod = await load<Mod>(SRC);
    const { host } = mount(mod, { fail: true });
    const done = mod.api.start(() => mod.api.setPage("other"));
    await macrotask();
    mod.api.settle();
    await done;
    flushSync();
    expect(host.querySelector(".failed")).not.toBeNull();
    expect(host.textContent).toBe("failed");
  });
});
