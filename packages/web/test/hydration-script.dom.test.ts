import { flushSync } from "@shadow-js/core";
import { hydrate } from "@shadow-js/web";
import { generateHydrationScript, HydrationScript, renderToString } from "@shadow-js/web/server";
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

const APP = `
export const log = { clicks: 0 };
export function App() {
  return <main><button class="go" onClick={() => { log.clicks += 1; }}>go</button></main>;
}
`;

function scriptBody(html: string): string {
  const match = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (match === null || match[1] === undefined) throw new Error("no script");
  return match[1];
}

describe("HydrationScript (early event capture, GAP-CF-13)", () => {
  it("[HSC-01] generateHydrationScript({ nonce }) returns a <script> carrying the nonce and the capture code", () => {
    const html = generateHydrationScript({ nonce: "abc123" });
    expect(html.startsWith('<script nonce="abc123">')).toBe(true);
    expect(html).toContain("__SHADOWJS_EARLY__");
    expect(html.endsWith("</script>")).toBe(true);
  });

  it("[HSC-02] generateHydrationScript rejects a nonce with characters outside the token alphabet", () => {
    const html = generateHydrationScript({ nonce: 'x"><img>' });
    expect(html).not.toContain("<img>");
    expect(html.startsWith("<script>")).toBe(true);
  });

  it("[HSC-03] <HydrationScript /> renders the same script on the server", () => {
    const html = renderToString(() => HydrationScript({ nonce: "n1" }));
    expect(html).toContain('<script nonce="n1">');
  });

  it("[HSC-04] a click made before hydration is replayed once the app hydrates", async () => {
    const ssr = await fresh<{ App: () => unknown }>(APP, "ssr");
    const dom = await fresh<{ App: () => unknown; log: { clicks: number } }>(APP);
    const html = renderToString(() => ssr.App());
    const target = document.createElement("div");
    target.innerHTML = html;
    document.body.append(target);
    hosts.push(target);
    // The script runs before the bundle: it records events on the document.
    const early = generateHydrationScript({});
    new Function(scriptBody(early))();
    target.querySelector<HTMLButtonElement>(".go")?.click();
    expect(dom.log.clicks).toBe(0);
    hydrate(() => dom.App(), target);
    flushSync();
    expect(dom.log.clicks).toBe(1);
    target.querySelector<HTMLButtonElement>(".go")?.click();
    expect(dom.log.clicks).toBe(2);
  });

  it("[HSC-06] a click whose event lost its target (dispatched inside a shadow root) is replayed on the recorded target", async () => {
    const ssr = await fresh<{ App: () => unknown }>(APP, "ssr");
    const dom = await fresh<{ App: () => unknown; log: { clicks: number } }>(APP);
    const target = document.createElement("div");
    target.innerHTML = renderToString(() => ssr.App());
    document.body.append(target);
    hosts.push(target);
    // The platform clears `event.target` once the dispatch of an event from a shadow tree is over: an
    // event that was never dispatched has the same empty target.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(event.target).toBeNull();
    Reflect.set(globalThis, "__SHADOWJS_EARLY__", {
      queue: [event],
      targets: [target.querySelector(".go")],
      names: ["click"],
      listener: () => undefined,
    });
    hydrate(() => dom.App(), target);
    flushSync();
    expect(dom.log.clicks).toBe(1);
  });

  it("[HSC-07] the capture script records the innermost node of an event that starts in an open shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const inner = document.createElement("button");
    host.attachShadow({ mode: "open" }).append(inner);
    new Function(scriptBody(generateHydrationScript({})))();
    const capture = Reflect.get(globalThis, "__SHADOWJS_EARLY__") as {
      queue: Event[];
      targets: unknown[];
      names: string[];
      listener: (event: Event) => void;
    };
    try {
      inner.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      expect(capture.queue).toHaveLength(1);
      expect(capture.targets).toEqual([inner]);
    } finally {
      for (const name of capture.names) document.removeEventListener(name, capture.listener, true);
      Reflect.deleteProperty(globalThis, "__SHADOWJS_EARLY__");
    }
  });

  it("[HSC-05] a page without the capture script hydrates and replays nothing", async () => {
    const dom = await fresh<{ App: () => unknown; log: { clicks: number } }>(APP);
    const target = document.createElement("div");
    target.innerHTML = '<main data-hk="0-0"><button class="go">go</button></main>';
    document.body.append(target);
    hosts.push(target);
    target.querySelector<HTMLButtonElement>(".go")?.click();
    hydrate(() => dom.App(), target);
    flushSync();
    expect(dom.log.clicks).toBe(0);
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
  });
});
