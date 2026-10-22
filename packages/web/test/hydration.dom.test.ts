import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { createComponent, hydrate } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/compile";

function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  hosts.push(el);
  return el;
}
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});
function comments(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let n = 0;
  while (walker.nextNode()) n += 1;
  return n;
}

describe("hydrate", () => {
  it("[HYD-01] claims the server element, keeps identity, binds reactivity, removes markers", async () => {
    const [name, setName] = useSignal("Ann");
    const mod = await load<{ App: (props: { name: () => string }) => unknown }>(
      'export const App = (props) => <p class="c">hello {props.name()} world</p>;',
    );
    const el = host('<p class="c" data-hk="0-0-0">hello <!--[-->Ann<!--]--> world</p>');
    const server = el.firstElementChild;
    const text = server?.childNodes[2];
    hydrate(() => createComponent(mod.App, { name }), el);
    expect(el.firstElementChild).toBe(server);
    expect(server?.hasAttribute("data-hk")).toBe(false);
    expect(comments(el)).toBe(0);
    expect(el.textContent).toBe("hello Ann world");
    expect(server?.childNodes[1]).toBe(text);
    flushSync(() => setName("Bob"));
    expect(el.textContent).toBe("hello Bob world");
    expect(el.firstElementChild).toBe(server);
  });

  it("[HYD-02] event handlers attach to server elements", async () => {
    const clicks: number[] = [];
    const mod = await load<{ App: (props: { hit: () => void }) => unknown }>(
      "export const App = (props) => <button onClick={props.hit}>go</button>;",
    );
    const el = host('<button data-hk="0-0-0">go</button>');
    const button = el.firstElementChild;
    hydrate(() => createComponent(mod.App, { hit: () => clicks.push(1) }), el);
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([1]);
    expect(el.firstElementChild).toBe(button);
  });

  it("[HYD-03] nested components and list items keep their server nodes", async () => {
    const [items, setItems] = useSignal(["a", "b"]);
    const mod = await load<{ App: (props: { items: () => string[] }) => unknown }>(
      `import { createComponent } from "@shadow-js/web";
       const Item = (props) => <li>{props.v}</li>;
       export const App = (props) => <ul>{props.items().map((v) => <Item v={v} />)}</ul>;`,
    );
    const el = host(
      '<ul data-hk="0-0-0"><!--[--><li data-hk="0-0-1-0"><!--[-->a<!--]--></li><li data-hk="0-0-2-0"><!--[-->b<!--]--></li><!--]--></ul>',
    );
    const lis = Array.from(el.querySelectorAll("li"));
    hydrate(() => createComponent(mod.App, { items }), el);
    expect(Array.from(el.querySelectorAll("li"))).toEqual(lis);
    expect(comments(el)).toBe(0);
    expect(el.textContent).toBe("ab");
    flushSync(() => setItems(["a", "b", "c"]));
    expect(el.querySelectorAll("li").length).toBe(3);
    expect(Array.from(el.querySelectorAll("li")).slice(0, 2)).toEqual(lis);
  });

  it("[HYD-04] a missing server key falls back to client creation without breaking siblings", async () => {
    const mod = await load<{ App: () => unknown }>("export const App = () => <p>client</p>;");
    const el = host("");
    const warn = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock;
    hydrate(() => createComponent(mod.App, {}), el);
    expect(el.textContent).toBe("client");
    expect(warn.calls.length).toBe(1);
    (console.warn as unknown as { mockClear(): void }).mockClear();
  });

  it("[HYD-05] empty regions and adjacent regions hydrate in order", async () => {
    const [a, setA] = useSignal<unknown>(null);
    const [b, setB] = useSignal<unknown>("b");
    const mod = await load<{ App: (props: { a: () => unknown; b: () => unknown }) => unknown }>(
      "export const App = (props) => <div>{props.a()}{props.b()}<i />tail</div>;",
    );
    const el = host('<div data-hk="0-0-0"><!--[--><!--]--><!--[-->b<!--]--><i></i>tail</div>');
    const div = el.firstElementChild;
    hydrate(() => createComponent(mod.App, { a, b }), el);
    expect(el.textContent).toBe("btail");
    flushSync(() => {
      setA("A");
      setB("B");
    });
    expect(el.textContent).toBe("ABtail");
    expect(el.firstElementChild).toBe(div);
    expect(comments(el)).toBe(0);
  });

  it("[HYD-06] dispose removes everything", async () => {
    const mod = await load<{ App: () => unknown }>("export const App = () => <p>x</p>;");
    const el = host('<p data-hk="0-0-0">x</p>');
    const dispose = hydrate(() => createComponent(mod.App, {}), el);
    dispose();
    expect(el.innerHTML).toBe("");
    createRoot(() => undefined);
  });
});
