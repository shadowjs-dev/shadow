import { flushSync } from "@shadow-js/core";
import { hydrate } from "@shadow-js/web";
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

/** The server snapshot is "server"; the browser's store says "client". */
const APP = `
import { useExternalStore } from "@shadow-js/core";
export const store = { value: "client", listeners: [] };
export function App(props) {
  const label = useExternalStore(
    (notify) => { store.listeners.push(notify); return () => {}; },
    () => store.value,
    props.withServer ? { getServerSnapshot: () => "server" } : {},
  );
  return <main><p class="label">{label()}</p></main>;
}
`;

const GOLDEN_SERVER = '<main data-hk="0-0"><p class="label"><!--[-->server<!--]--></p></main>';

describe("useExternalStore hydration (server snapshot vs client snapshot)", () => {
  it("[EXT-H01] with getServerSnapshot the hydrating render matches the server markup, then the client snapshot is applied after subscribing", async () => {
    // Golden markup: the server renders getServerSnapshot() ("server") (see external-store.server.test.ts).
    const dom = await fresh<{ App: (props: { withServer: boolean }) => unknown }>(APP);
    const target = document.createElement("div");
    target.innerHTML = GOLDEN_SERVER;
    document.body.append(target);
    hosts.push(target);
    const label = target.querySelector(".label");
    hydrate(() => dom.App({ withServer: true }), target);
    flushSync();
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
    expect(target.querySelector(".label")).toBe(label);
    expect(label?.textContent).toBe("client");
  });

  it("[EXT-H02] without getServerSnapshot the hydrating render reads getSnapshot (documented: keep the two equal)", async () => {
    const ssr = await fresh<{ App: (props: { withServer: boolean }) => unknown }>(APP, "ssr");
    const dom = await fresh<{ App: (props: { withServer: boolean }) => unknown }>(APP);
    const html = renderToString(() => ssr.App({ withServer: false }));
    expect(html).toContain("client");
    const target = document.createElement("div");
    target.innerHTML = html;
    document.body.append(target);
    hosts.push(target);
    hydrate(() => dom.App({ withServer: false }), target);
    flushSync();
    expect(target.querySelector(".label")?.textContent).toBe("client");
  });
});
