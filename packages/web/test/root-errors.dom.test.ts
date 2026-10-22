import { flushSync } from "@shadow-js/core";
import { hydrate, render } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "./support/compile";

let cases = 0;
function fresh<T>(source: string, target: "dom" | "ssr" = "dom"): Promise<T> {
  cases += 1;
  return load<T>(`${source}\n// case ${cases}`, target);
}

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});
function host(html = ""): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  hosts.push(el);
  return el;
}

const BROKEN = `
import { useEffect, useSignal } from "@shadow-js/core";
import { ErrorBoundary } from "@shadow-js/web";
export const state = {};
export function Thrower() {
  const [on, setOn] = useSignal(false);
  state.set = setOn;
  useEffect(() => { if (on()) throw new Error("effect boom"); });
  return <p>thrower</p>;
}
export function Plain() {
  const [on, setOn] = useSignal(false);
  state.plain = setOn;
  useEffect(() => { if (on()) throw new Error("plain boom"); });
  return <p>plain</p>;
}
export function Guarded() {
  return <ErrorBoundary fallback={<p class="caught">caught</p>}><Thrower /></ErrorBoundary>;
}
`;

describe("root error options (onUncaughtError, onCaughtError, onRecoverableError)", () => {
  it("[ROE-01] onUncaughtError receives an error that no boundary handled, and render does not throw", async () => {
    const mod = await fresh<{ Plain: () => unknown; state: { plain: (v: boolean) => void } }>(
      BROKEN,
    );
    const onUncaughtError = vi.fn();
    const target = host();
    render(() => mod.Plain(), target, { onUncaughtError });
    flushSync();
    mod.state.plain(true);
    flushSync();
    expect(onUncaughtError).toHaveBeenCalledTimes(1);
    const [caught] = onUncaughtError.mock.calls[0] ?? [];
    expect((caught as Error).message).toBe("plain boom");
  });

  it("[ROE-02] onCaughtError receives an error an ErrorBoundary took, and onUncaughtError is not called", async () => {
    const mod = await fresh<{ Guarded: () => unknown; state: { set: (v: boolean) => void } }>(
      BROKEN,
    );
    const onCaughtError = vi.fn();
    const onUncaughtError = vi.fn();
    const target = host();
    render(() => mod.Guarded(), target, { onCaughtError, onUncaughtError });
    flushSync();
    mod.state.set(true);
    flushSync();
    expect(target.querySelector(".caught")).not.toBeNull();
    expect(onCaughtError).toHaveBeenCalledTimes(1);
    const [reported] = onCaughtError.mock.calls[0] ?? [];
    expect((reported as Error).message).toBe("effect boom");
    expect(onUncaughtError).not.toHaveBeenCalled();
  });

  it("[ROE-03] onRecoverableError receives a hydration mismatch that was repaired", async () => {
    const server = await fresh<{ App: () => unknown }>(
      `export function App() { return <main><p>server</p></main>; }`,
      "ssr",
    );
    const dom = await fresh<{ App: () => unknown }>(
      `function Extra() { return <i>extra</i>; }
       export function App() { return <main><p class="k">client</p><Extra /></main>; }`,
    );
    const target = host(renderToString(() => server.App()));
    const onRecoverableError = vi.fn();
    hydrate(() => dom.App(), target, { onRecoverableError });
    flushSync();
    expect(onRecoverableError).toHaveBeenCalledTimes(1);
    // The child the server never rendered is created on the client; the adopted markup stays as it was.
    expect(target.querySelector("i")?.textContent).toBe("extra");
    expect(vi.mocked(console.warn).mock.calls.length).toBe(1);
    vi.mocked(console.warn).mockClear();
  });

  it("[ROE-04] without an option a root error still reaches the caller unchanged (no silent swallowing)", async () => {
    const mod = await fresh<{ Plain: () => unknown; state: { plain: (v: boolean) => void } }>(
      BROKEN,
    );
    const target = host();
    render(() => mod.Plain(), target);
    flushSync();
    mod.state.plain(true);
    expect(() => flushSync()).toThrow("plain boom");
  });

  it("[ROE-05] the server render does not need the options (they are a client concern)", async () => {
    const ssr = await fresh<{ App: () => unknown }>(
      `export function App() { return <main><p>server</p></main>; }`,
      "ssr",
    );
    expect(renderToString(() => ssr.App())).toContain("server");
  });
});
