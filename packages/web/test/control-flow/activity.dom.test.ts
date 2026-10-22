import { flushSync } from "@shadow-js/core";
import { hydrate, render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "../support/compile";

const SRC = `
import { onCleanup, useEffect, useSignal } from "@shadow-js/core";
import { Activity } from "@shadow-js/web";

export const log = { effects: [], cleanups: 0, renders: 0 };
export const api = {};

export function Panel() {
  const [count, setCount] = useSignal(0);
  api.inc = () => setCount(count() + 1);
  api.count = count;
  useEffect(() => {
    log.effects.push(count());
    return () => {
      log.cleanups += 1;
    };
  });
  return (
    <section class="panel">
      <p class="count">{count()}</p>
      <input class="name" />
      <div class="scroller" style="height: 20px; overflow: auto">
        <p>line</p>
      </div>
    </section>
  );
}

export function App(props) {
  const [mode, setMode] = useSignal(props.mode ?? "visible");
  api.setMode = setMode;
  return (
    <div class="app">
      <Activity mode={mode()}>
        <Panel />
      </Activity>
      <span class="after">after</span>
    </div>
  );
}
`;

type Mod = {
  App: (props: { mode?: string }) => unknown;
  log: { effects: number[]; cleanups: number; renders: number };
  api: { setMode: (mode: string) => void; inc: () => void; count: () => number };
};

/** A fresh module per case: the loader caches modules by source, and each case has its own state. */
let cases = 0;
function fresh<T>(target: "dom" | "ssr" = "dom"): Promise<T> {
  cases += 1;
  return load<T>(`${SRC}\n// case ${cases}`, target);
}

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mount(mod: Mod, mode?: string): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const dispose = render(() => mod.App(mode === undefined ? {} : { mode }), host);
  flushSync();
  return { host, dispose };
}

function panelOf(host: HTMLElement): HTMLElement {
  const panel = host.querySelector<HTMLElement>(".panel");
  if (panel === null) throw new Error("no panel");
  return panel;
}

describe("Activity: keep-alive", () => {
  it("[ACT-01] mode visible renders the children and nothing is hidden", async () => {
    const mod = await fresh<Mod>();
    const { host } = mount(mod);
    expect(host.querySelector(".count")?.textContent).toBe("0");
    expect(panelOf(host).style.display).not.toBe("none");
  });

  it("[ACT-02] hidden keeps the same DOM nodes; only the top-level content is display:none", async () => {
    const mod = await fresh<Mod>();
    const { host } = mount(mod);
    const panel = panelOf(host);
    mod.api.setMode("hidden");
    flushSync();
    expect(panelOf(host)).toBe(panel);
    expect(panel.style.display).toBe("none");
    expect(host.querySelector<HTMLElement>(".after")?.style.display).not.toBe("none");
    mod.api.setMode("visible");
    flushSync();
    expect(panel.style.display).toBe("");
  });

  it("[ACT-03] state survives hide and show", async () => {
    const mod = await fresh<Mod>();
    const { host } = mount(mod);
    mod.api.inc();
    flushSync();
    mod.api.setMode("hidden");
    flushSync();
    mod.api.setMode("visible");
    flushSync();
    expect(host.querySelector(".count")?.textContent).toBe("1");
    expect(mod.api.count()).toBe(1);
  });

  it("[ACT-04] effects are cleaned up on hide and run again once on show", async () => {
    const mod = await fresh<Mod>();
    mount(mod);
    expect(mod.log.effects).toEqual([0]);
    mod.api.setMode("hidden");
    flushSync();
    expect(mod.log.cleanups).toBe(1);
    mod.api.inc();
    flushSync();
    expect(mod.log.effects).toEqual([0]);
    mod.api.setMode("visible");
    flushSync();
    expect(mod.log.effects).toEqual([0, 1]);
  });

  it("[ACT-05] DOM bindings inside a hidden subtree do not update until it is shown", async () => {
    const mod = await fresh<Mod>();
    const { host } = mount(mod);
    mod.api.setMode("hidden");
    flushSync();
    mod.api.inc();
    flushSync();
    expect(host.querySelector(".count")?.textContent).toBe("0");
    mod.api.setMode("visible");
    flushSync();
    expect(host.querySelector(".count")?.textContent).toBe("1");
  });

  it("[ACT-06] several updates while hidden are coalesced into one effect run on show", async () => {
    const mod = await fresh<Mod>();
    mount(mod);
    mod.api.setMode("hidden");
    flushSync();
    mod.api.inc();
    mod.api.inc();
    mod.api.inc();
    flushSync();
    mod.api.setMode("visible");
    flushSync();
    expect(mod.log.effects).toEqual([0, 3]);
  });

  it("[ACT-07] focus and the scroll position of a hidden subtree come back when it is shown", async () => {
    const mod = await fresh<Mod>();
    const { host } = mount(mod);
    const input = host.querySelector<HTMLInputElement>(".name");
    const scroller = host.querySelector<HTMLElement>(".scroller");
    if (input === null || scroller === null) throw new Error("fixture");
    input.focus();
    scroller.scrollTop = 12;
    mod.api.setMode("hidden");
    flushSync();
    mod.api.setMode("visible");
    flushSync();
    expect(document.activeElement).toBe(input);
    expect(scroller.scrollTop).toBe(12);
  });

  it("[ACT-08] a subtree mounted hidden renders its DOM once and runs no effects until shown", async () => {
    const mod = await fresh<Mod>();
    const { host } = mount(mod, "hidden");
    expect(panelOf(host).style.display).toBe("none");
    expect(host.querySelector(".count")?.textContent).toBe("0");
    expect(mod.log.effects).toEqual([]);
    mod.api.setMode("visible");
    flushSync();
    expect(mod.log.effects).toEqual([0]);
    expect(panelOf(host).style.display).toBe("");
  });

  it("[ACT-09] disposing the app while hidden stops the effects for good", async () => {
    const mod = await fresh<Mod>();
    const { host, dispose } = mount(mod);
    mod.api.setMode("hidden");
    flushSync();
    dispose();
    host.remove();
    mod.api.inc();
    flushSync();
    expect(mod.log.effects).toEqual([0]);
  });

  it("[ACT-10] many toggles keep the number of nodes and runs bounded (no leak)", async () => {
    const mod = await fresh<Mod>();
    const { host } = mount(mod);
    const nodes = host.querySelectorAll("*").length;
    for (let i = 1; i <= 100; i += 1) {
      mod.api.setMode("hidden");
      flushSync();
      mod.api.setMode("visible");
      flushSync();
    }
    expect(host.querySelectorAll("*").length).toBe(nodes);
    expect(mod.log.effects.length).toBe(101);
    expect(mod.log.cleanups).toBe(100);
  });

  it("[ACT-11] hydrating the server markup of a hidden Activity keeps the nodes and wires the handlers", async () => {
    // Golden markup: what the server renders for this app with mode="hidden" (see activity.server.test.ts).
    const dom = await fresh<Mod>();
    const host = document.createElement("div");
    host.innerHTML =
      '<div data-hk="0-0" class="app"><!--[--><section data-hk="0-2-0" class="panel"><p class="count"><!--[-->0<!--]--></p><input class="name"><div class="scroller" style="height: 20px; overflow: auto"><p>line</p></div></section><!--]--><span class="after">after</span></div>';
    document.body.append(host);
    hosts.push(host);
    const before = panelOf(host);
    hydrate(() => dom.App({ mode: "hidden" }), host);
    flushSync();
    expect(panelOf(host)).toBe(before);
    expect(before.style.display).toBe("none");
    expect(dom.log.effects).toEqual([]);
    dom.api.setMode("visible");
    flushSync();
    expect(before.style.display).toBe("");
    expect(dom.log.effects).toEqual([0]);
  });
});
