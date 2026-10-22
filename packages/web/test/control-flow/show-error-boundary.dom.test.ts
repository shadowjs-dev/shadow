import { flushSync } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "../support/compile";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mount(view: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(view, host);
  flushSync();
  return host;
}

describe("ErrorBoundary around Show (STATUS: function child of Show)", () => {
  it("[SHB-01] an error thrown by a zero-argument function child of Show is caught by the enclosing ErrorBoundary", async () => {
    const mod = await load<{ App: () => unknown; state: { boom: (on: boolean) => void } }>(`
      import { useSignal } from "@shadow-js/core";
      import { ErrorBoundary, Show } from "@shadow-js/web";
      export const state = {};
      export function App() {
        const [explode, setExplode] = useSignal(false);
        state.boom = setExplode;
        return (
          <ErrorBoundary fallback={<p class="caught">caught</p>}>
            <Show when={explode()}>{() => { throw new Error("x"); }}</Show>
          </ErrorBoundary>
        );
      }
    `);
    const host = mount(() => mod.App());
    expect(host.textContent).toBe("");
    mod.state.boom(true);
    flushSync();
    expect(host.querySelector(".caught")).not.toBeNull();
    expect(host.textContent).toBe("caught");
  });

  it("[SHB-02] a function child of Show that reads a signal updates the DOM and still reports errors", async () => {
    const mod = await load<{ App: () => unknown; state: { set: (n: number) => void } }>(`
      import { useSignal } from "@shadow-js/core";
      import { ErrorBoundary, Show } from "@shadow-js/web";
      export const state = {};
      export function App() {
        const [n, setN] = useSignal(1);
        state.set = setN;
        return (
          <ErrorBoundary fallback={<p class="caught">caught</p>}>
            <Show when={n() > 0}>{() => { if (n() > 2) throw new Error("big"); return <p class="v">{n()}</p>; }}</Show>
          </ErrorBoundary>
        );
      }
    `);
    const host = mount(() => mod.App());
    expect(host.textContent).toBe("1");
    mod.state.set(2);
    flushSync();
    expect(host.textContent).toBe("2");
    mod.state.set(3);
    flushSync();
    expect(host.textContent).toBe("caught");
  });
});
