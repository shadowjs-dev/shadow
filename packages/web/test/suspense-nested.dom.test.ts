import { flushSync } from "@shadow-js/core";
import { createComponent, render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/compile";

const SHARED = `
import { useResource } from "@shadow-js/core";
import { ErrorBoundary, lazy, Suspense } from "@shadow-js/web";

export const stats = { calls: 0, builds: 0 };
const fetchOk = () => {
  stats.calls += 1;
  return new Promise((resolve) => setTimeout(() => resolve([1, 2]), 0));
};
const fetchFails = () => {
  stats.calls += 1;
  return new Promise((_, reject) => setTimeout(() => reject(new Error("boom")), 0));
};
function Body() {
  stats.builds += 1;
  const data = useResource(() => fetchOk(), { name: "ok" });
  return <p>value:{data()?.length ?? "none"}</p>;
}
function FailingBody() {
  stats.builds += 1;
  const data = useResource(() => fetchFails(), { name: "fail" });
  return <p>value:{data()?.length ?? "none"}</p>;
}
export function Card(props) {
  return <section class="card">{props.children}</section>;
}
`;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

/** Turns after which a view that never settles fails the test, instead of waiting forever. */
const MAX_TURNS = 200;

/**
 * Renders `view` and returns the text once `settled` accepts it. Each turn flushes pending updates
 * and checks the text; between turns it yields one macrotask, because the fixtures' requests
 * resolve on timers. The wait ends on the observable state, not after a fixed number of ticks.
 */
async function run(view: () => unknown, settled: (text: string) => boolean): Promise<string> {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const dispose = render(view, host);
  try {
    for (let turn = 0; ; turn += 1) {
      flushSync();
      const text = host.textContent ?? "";
      if (settled(text)) return text;
      if (turn >= MAX_TURNS) throw new Error(`not settled after ${MAX_TURNS} turns: ${text}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    dispose();
  }
}

type Mod = { View: () => unknown; stats: { calls: number; builds: number } };

describe("Suspense and ErrorBoundary through component props", () => {
  it("[SUN-01] props.children passed through a Suspense inside a component builds the body once", async () => {
    const mod = await load<Mod>(`${SHARED}
      function FrameS(props) {
        return <Suspense fallback={<p>loading</p>}>{props.children}</Suspense>;
      }
      export function View() {
        return <Card><FrameS><Body /></FrameS></Card>;
      }`);
    const text = await run(
      () => createComponent(mod.View, {}),
      (t) => t === "value:2",
    );
    expect(mod.stats.builds).toBe(1);
    expect(text).toBe("value:2");
  });

  it("[SUN-02] a failing resource inside a lazy widget reaches its ErrorBoundary after one request", async () => {
    const mod = await load<Mod>(`${SHARED}
      function Widget() {
        return (
          <section class="card">
            <ErrorBoundary fallback={<p>boundary</p>}>
              <Suspense fallback={<p>loading</p>}>
                <FailingBody />
              </Suspense>
            </ErrorBoundary>
          </section>
        );
      }
      const LazyFailing = lazy(() => Promise.resolve({ default: Widget }));
      export function View() {
        return <Card><LazyFailing /></Card>;
      }`);
    const text = await run(
      () => createComponent(mod.View, {}),
      (t) => t.includes("boundary"),
    );
    expect(mod.stats.calls).toBe(1);
    expect(text).toContain("boundary");
  });

  it("[SUN-03] a failing resource under a Card with a bare Suspense reaches the nearest ErrorBoundary", async () => {
    const mod = await load<Mod>(`${SHARED}
      function Frame(props) {
        return (
          <ErrorBoundary fallback={<p>boundary</p>}>
            <Suspense fallback={<p>loading</p>}>{props.children}</Suspense>
          </ErrorBoundary>
        );
      }
      export function View() {
        return <Card><Frame><FailingBody /></Frame></Card>;
      }`);
    const text = await run(
      () => createComponent(mod.View, {}),
      (t) => t.includes("boundary"),
    );
    expect(mod.stats.calls).toBe(1);
    expect(text).toContain("boundary");
  });
});
