import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { createComponent, render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/load";

const hosts: HTMLElement[] = [];
function mount(view: () => unknown): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  hosts.push(el);
  render(view, el);
  return el;
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

describe("flattened element roots run like the wrapped ones", () => {
  it("[OPT-ROOT-20] a component with several returns builds and updates each branch", async () => {
    const [mode, setMode] = useSignal("a");
    const [n, setN] = useSignal(1);
    const mod = await load<{ Pick: (p: { mode: () => string; n: () => number }) => unknown }>(
      `export function Pick(p) {
        if (p.mode() === "a") return <i class={"a" + p.n()}>{p.n()}</i>;
        else if (p.mode() === "b") return (
          <b>{p.n() * 2}</b>
        );
        return <u>other</u>;
      }`,
    );
    const a = mount(() => createComponent(mod.Pick, { mode, n }));
    expect(a.innerHTML).toBe('<i class="a1">1</i>');
    flushSync(() => setN(2));
    expect(a.innerHTML).toBe('<i class="a2">2</i>');
    const b = mount(() => createComponent(mod.Pick, { mode: () => "b", n }));
    expect(b.innerHTML).toBe("<b>4</b>");
    flushSync(() => setN(5));
    expect(b.innerHTML).toBe("<b>10</b>");
    const c = mount(() => createComponent(mod.Pick, { mode: () => "z", n }));
    expect(c.innerHTML).toBe("<u>other</u>");
    setMode("b");
  });

  it("[OPT-ROOT-21] expression-bodied arrows, render callbacks and getters", async () => {
    const [items, setItems] = useSignal([1, 2]);
    const [fallback, setFallback] = useSignal("none");
    const mod = await load<{
      App: (p: { items: () => number[]; fallback: () => string }) => unknown;
    }>(
      `import { For, Show } from "@shadow-js/web";
       const Box = (props) => <section>{props.children}</section>;
       export const App = (p) => (
         <Box>
           <ul>
             <For each={p.items()}>{(item) => <li class={"n" + item}>{item}</li>}</For>
           </ul>
           <Show when={p.items().length === 0} fallback={<p>{p.items().length} left</p>}>
             <em>{p.fallback()}</em>
           </Show>
         </Box>
       );`,
    );
    const host = mount(() => createComponent(mod.App, { items, fallback }));
    expect(host.innerHTML).toBe(
      '<section><ul><li class="n1">1</li><li class="n2">2</li></ul><p>2 left</p></section>',
    );
    flushSync(() => setItems([3]));
    expect(host.innerHTML).toBe('<section><ul><li class="n3">3</li></ul><p>1 left</p></section>');
    flushSync(() => setItems([]));
    expect(host.innerHTML).toBe("<section><ul></ul><em>none</em></section>");
    flushSync(() => setFallback("empty"));
    expect(host.textContent).toBe("empty");
  });

  it("[OPT-ROOT-22] this, arguments, async and generator functions keep their meaning", async () => {
    const mod = await load<{
      obj: { name: string; view: () => HTMLElement };
      first: (...args: string[]) => HTMLElement;
      later: () => Promise<HTMLElement>;
      gen: () => Generator<number, HTMLElement>;
    }>(
      `export const obj = {
         name: "me",
         view() { return <b>{this.name}</b>; },
       };
       export function first() { return <i>{arguments[0]}</i>; }
       export const later = async () => <u>{"x" + 1}</u>;
       export function* gen() { yield 1; return <s class={"k"}>done</s>; }`,
    );
    const html = createRoot((dispose) => {
      const out = [mod.obj.view().outerHTML, mod.first("arg").outerHTML];
      const g = mod.gen();
      out.push(String(g.next().value), (g.next().value as HTMLElement).outerHTML);
      dispose();
      return out;
    });
    expect(html).toEqual(["<b>me</b>", "<i>arg</i>", "1", '<s class="k">done</s>']);
    expect((await mod.later()).outerHTML).toBe("<u>x1</u>");
  });

  it("[OPT-ROOT-23] try/finally and loops around a return still run", async () => {
    const log: string[] = [];
    const mod = await load<{ view: (log: string[], list: string[]) => HTMLElement | null }>(
      `export function view(log, list) {
         for (const x of list) {
           if (x === "stop") break;
           if (x === "hit") return <p>{x}</p>;
         }
         try { return <hr data-k={list.length} />; } finally { log.push("finally"); }
       }`,
    );
    const html = createRoot((dispose) => {
      const out = [mod.view(log, ["hit"])?.outerHTML, mod.view(log, ["stop"])?.outerHTML];
      dispose();
      return out;
    });
    expect(html).toEqual(["<p>hit</p>", '<hr data-k="1">']);
    expect(log).toEqual(["finally"]);
  });
});
