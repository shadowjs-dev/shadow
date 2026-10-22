import { flushSync } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/compile";

/**
 * A page whose second branch reads a resource that is still loading. The fetch resolves after
 * `delay` ms. `api` exposes the setter, the transition starter and the isPending accessor.
 */
const SRC = `
import { useResource, useSignal, useTransition } from "@shadow-js/core";
import { ErrorBoundary, Show, Suspense } from "@shadow-js/web";

export const api = {};
export const slowLog = { reads: 0 };

export function Slow(props) {
  const data = useResource(() => new Promise((resolve, reject) => {
    setTimeout(() => (props.fail ? reject(new Error("net down")) : resolve("slow content")), props.delay);
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
        <Show when={page() === "home"} fallback={<Slow delay={props.delay} fail={props.fail} />}>
          <Home />
        </Show>
      </Suspense>
    </ErrorBoundary>
  );
}
`;

type Mod = {
  App: (props: { delay: number; fail?: boolean }) => unknown;
  api: {
    setPage: (page: string) => void;
    start: (fn: () => void) => Promise<void>;
    pending: () => boolean;
  };
};

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mount(mod: Mod, props: { delay: number; fail?: boolean }): { host: HTMLElement } {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(() => mod.App(props), host);
  flushSync();
  return { host };
}

const macrotask = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("transitions and Suspense", () => {
  it("[TSU-01] a transition that suspends keeps the shown content, reports pending, and reveals the new content when the data arrives", async () => {
    const mod = await load<Mod>(SRC);
    const { host } = mount(mod, { delay: 15 });
    expect(host.textContent).toBe("home");
    const done = mod.api.start(() => mod.api.setPage("other"));
    await macrotask();
    expect(host.querySelector(".loading")).toBeNull();
    expect(host.textContent).toBe("home");
    expect(mod.api.pending()).toBe(true);
    await done;
    expect(host.textContent).toBe("slow content");
    expect(mod.api.pending()).toBe(false);
  });

  it("[TSU-02] an urgent update that suspends still shows the fallback (no transition, unchanged)", async () => {
    const mod = await load<Mod>(SRC);
    const { host } = mount(mod, { delay: 15 });
    mod.api.setPage("other");
    flushSync();
    await macrotask();
    expect(host.querySelector(".loading")).not.toBeNull();
    expect(host.textContent).toBe("loading");
    await macrotask(40);
    flushSync();
    expect(host.textContent).toBe("slow content");
  });

  it("[TSU-03] a newer transition while the boundary holds wins: the content reveals the newest state", async () => {
    const mod = await load<Mod>(SRC);
    const { host } = mount(mod, { delay: 15 });
    const first = mod.api.start(() => mod.api.setPage("other"));
    await macrotask();
    expect(host.textContent).toBe("home");
    const second = mod.api.start(() => mod.api.setPage("home"));
    await Promise.all([first, second]);
    expect(host.textContent).toBe("home");
    expect(mod.api.pending()).toBe(false);
  });

  it("[TSU-04] a resource that fails while a transition holds surfaces through the nearest ErrorBoundary", async () => {
    const mod = await load<Mod>(SRC);
    const { host } = mount(mod, { delay: 5, fail: true });
    const done = mod.api.start(() => mod.api.setPage("other"));
    await done;
    flushSync();
    expect(host.querySelector(".failed")).not.toBeNull();
    expect(host.textContent).toBe("failed");
  });
});
