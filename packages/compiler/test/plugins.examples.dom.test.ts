import { flushSync, useSignal } from "@shadow-js/core";
import { createComponent, hydrate, render } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it } from "vitest";
import { sortClassNames, stripTestIds } from "./support/example-plugins";
import { load } from "./support/load";

const hosts: HTMLElement[] = [];
function host(html = ""): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  hosts.push(el);
  return el;
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

const WITH_PLUGINS = `
export const View = (props) => (
  <section data-testid="root" class="wide box">
    <h2 data-testid={props.id} class={"title big"}>{props.title()}</h2>
    <button data-testid="inc" class="z a" onClick={props.inc}>+</button>
  </section>
);`;

const BY_HAND = `
export const View = (props) => (
  <section class="box wide">
    <h2 class={"big title"}>{props.title()}</h2>
    <button class="a z" onClick={props.inc}>+</button>
  </section>
);`;

const plugins = [stripTestIds(), sortClassNames()];

describe("compiled modules built with plugins run like hand-written ones", () => {
  it("[PLG-EX-20] the client DOM equals the DOM of the module written without the removed parts", async () => {
    const [title, setTitle] = useSignal("one");
    let clicks = 0;
    const props = { id: "x", title, inc: () => (clicks += 1) };
    const withPlugins = await load<{ View: (p: typeof props) => unknown }>(
      WITH_PLUGINS,
      "dom",
      plugins,
    );
    const byHand = await load<{ View: (p: typeof props) => unknown }>(BY_HAND);
    const a = host();
    const b = host();
    render(() => createComponent(withPlugins.View, props), a);
    render(() => createComponent(byHand.View, props), b);
    expect(a.innerHTML).toBe(b.innerHTML);
    expect(a.innerHTML).not.toContain("data-testid");
    expect(a.querySelector("section")?.className).toBe("box wide");
    a.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toBe(1);
    flushSync(() => setTitle("two"));
    expect(a.querySelector("h2")?.textContent).toBe("two");
    expect(a.innerHTML).toBe(b.innerHTML);
  });

  it("[PLG-EX-21] the server markup equals that of the module written by hand, and hydrates", async () => {
    const [title] = useSignal("one");
    const props = { id: "x", title, inc: () => undefined };
    const ssr = await load<{ View: (p: typeof props) => unknown }>(WITH_PLUGINS, "ssr", plugins);
    const ssrByHand = await load<{ View: (p: typeof props) => unknown }>(BY_HAND, "ssr");
    const html = renderToString(() => createComponent(ssr.View, props));
    expect(html).toBe(renderToString(() => createComponent(ssrByHand.View, props)));
    expect(html).not.toContain("data-testid");
    const dom = await load<{ View: (p: typeof props) => unknown }>(WITH_PLUGINS, "dom", plugins);
    const target = host(html);
    const nodes = Array.from(target.querySelectorAll("*"));
    hydrate(() => createComponent(dom.View, props), target);
    Array.from(target.querySelectorAll("*")).forEach((node, i) => {
      expect(node).toBe(nodes[i]);
    });
  });
});
