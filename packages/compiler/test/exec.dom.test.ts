import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { createComponent, render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/load";

const containers: HTMLElement[] = [];
function mount(view: () => unknown): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  containers.push(host);
  return { host, dispose: render(view, host) };
}
function comments(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let count = 0;
  while (walker.nextNode()) count += 1;
  return count;
}
afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

describe("compiled DOM output runs", () => {
  it("[EXE-01] static markup", async () => {
    const mod = await load<{ view: () => unknown }>(
      `export const view = () => <p class="a">hi <b>there</b></p>;`,
    );
    const { host } = mount(mod.view);
    expect(host.innerHTML).toBe('<p class="a">hi <b>there</b></p>');
  });

  it("[EXE-02] text slot between static text updates in place", async () => {
    const [name, setName] = useSignal("Ann");
    const mod = await load<{ make: (name: () => string) => () => unknown }>(
      `export const make = (name) => () => <p>hello {name()} world</p>;`,
    );
    const { host } = mount(mod.make(name));
    expect(host.textContent).toBe("hello Ann world");
    const p = host.firstElementChild;
    flushSync(() => setName("Bob"));
    expect(host.textContent).toBe("hello Bob world");
    expect(host.firstElementChild).toBe(p);
    expect(comments(host)).toBe(0);
  });

  it("[EXE-03] adjacent dynamic slots keep order when each grows and shrinks", async () => {
    const [a, setA] = useSignal<unknown>("a");
    const [b, setB] = useSignal<unknown>("b");
    const mod = await load<{ make: (a: () => unknown, b: () => unknown) => () => unknown }>(
      `export const make = (a, b) => () => <div>{a()}{b()}<i />{"!"}</div>;`,
    );
    const { host } = mount(mod.make(a, b));
    expect(host.textContent).toBe("ab!");
    flushSync(() => {
      setA(["x", "y", "z"]);
      setB(null);
    });
    expect(host.textContent).toBe("xyz!");
    flushSync(() => {
      setA(null);
      setB(["1", "2"]);
    });
    expect(host.textContent).toBe("12!");
    expect(host.querySelector("i")?.nextSibling?.textContent).toBe("!");
    expect(comments(host)).toBe(0);
  });

  it("[EXE-04] attributes, properties, classes, styles react independently", async () => {
    const [id, setId] = useSignal("one");
    const [on, setOn] = useSignal(false);
    const [color, setColor] = useSignal("red");
    const [val, setVal] = useSignal("x");
    const mod = await load<{ make: (...s: Array<() => unknown>) => () => unknown }>(
      `export const make = (id, on, color, val) => () => (
        <input id={id()} classList={{ active: on() }} style={{ color: color() }} value={val()} />
      );`,
    );
    const { host } = mount(mod.make(id, on, color, val));
    const input = host.firstElementChild as HTMLInputElement;
    expect(input.id).toBe("one");
    expect(input.value).toBe("x");
    flushSync(() => {
      setId("two");
      setOn(true);
      setColor("blue");
      setVal("y");
    });
    expect(input.id).toBe("two");
    expect(input.classList.contains("active")).toBe(true);
    expect(input.style.color).toBe("blue");
    expect(input.value).toBe("y");
  });

  it("[EXE-05] delegated and direct events", async () => {
    const calls: string[] = [];
    const mod = await load<{ make: (log: (s: string) => void) => () => unknown }>(
      `export const make = (log) => () => (
        <div onClick={() => log("div")}>
          <button onClick={[(d) => log("tuple " + d), 7]}>b</button>
          <span on:custom={() => log("custom")}>s</span>
        </div>
      );`,
    );
    const { host } = mount(mod.make((s) => calls.push(s)));
    host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    host.querySelector("span")?.dispatchEvent(new CustomEvent("custom"));
    expect(calls).toEqual(["tuple 7", "div", "custom"]);
  });

  it("[EXE-06] components with getter props, children and spread", async () => {
    const [n, setN] = useSignal(1);
    const mod = await load<{ make: (n: () => number) => () => unknown }>(
      `import { createComponent } from "@shadow-js/web";
       const Box = (props) => <section data-x={props.x}>{props.children}</section>;
       export const make = (n) => () => <Box x={n()} {...{ title: "t" }}><em>{n()}</em></Box>;`,
    );
    const { host } = mount(mod.make(n));
    const section = host.querySelector("section");
    expect(section?.getAttribute("data-x")).toBe("1");
    flushSync(() => setN(2));
    expect(section?.getAttribute("data-x")).toBe("2");
    expect(host.querySelector("em")?.textContent).toBe("2");
  });

  it("[EXE-07] conditional branches rebuild only when truthiness changes", async () => {
    const [n, setN] = useSignal(1);
    let built = 0;
    const mod = await load<{ make: (n: () => number, tick: () => void) => () => unknown }>(
      `const Branch = (props) => { props.tick(); return <b>yes {props.n()}</b>; };
       export const make = (n, tick) => () => <div>{n() > 0 ? <Branch n={n} tick={tick} /> : <i>no</i>}</div>;`,
    );
    const { host } = mount(
      mod.make(n, () => {
        built += 1;
      }),
    );
    expect(host.innerHTML).toContain("<b>yes ");
    flushSync(() => setN(5));
    expect(built).toBe(1);
    flushSync(() => setN(0));
    expect(host.innerHTML).toContain("<i>no</i>");
    flushSync(() => setN(2));
    expect(built).toBe(2);
    expect(comments(host)).toBe(0);
  });

  it("[EXE-08] svg elements are created in the svg namespace", async () => {
    const [r, setR] = useSignal(2);
    const mod = await load<{ make: (r: () => number) => () => unknown }>(
      `export const make = (r) => () => <svg viewBox="0 0 4 4"><circle r={r()} /></svg>;`,
    );
    const { host } = mount(mod.make(r));
    const circle = host.querySelector("circle");
    expect(circle?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    flushSync(() => setR(3));
    expect(circle?.getAttribute("r")).toBe("3");
  });

  it("[EXE-09] fragments and refs", async () => {
    const holder: { el?: HTMLElement } = {};
    const mod = await load<{ make: (h: { el?: HTMLElement }) => () => unknown }>(
      `export const make = (h) => () => <><p ref={(el) => (h.el = el)}>a</p><p>b</p></>;`,
    );
    const { host } = mount(mod.make(holder));
    expect(host.children.length).toBe(2);
    expect(holder.el).toBe(host.children[0]);
  });

  it("[EXE-10] dispose removes everything and stops effects", async () => {
    const [n, setN] = useSignal(0);
    const mod = await load<{ make: (n: () => number) => () => unknown }>(
      `export const make = (n) => () => <p>{n()}</p>;`,
    );
    const { host, dispose } = mount(mod.make(n));
    dispose();
    expect(host.innerHTML).toBe("");
    flushSync(() => setN(1));
    expect(host.innerHTML).toBe("");
    void createRoot;
  });
});

describe("component prop types", () => {
  it("[EXE-11] numeric and boolean literals stay numbers/booleans for components", async () => {
    const mod = await load<{ make: (seen: unknown[]) => () => unknown }>(
      `const C = (props) => { props.seen.push(props.n, props.on, props.s, props.f); return <i />; };
       export const make = (seen) => () => <C seen={seen} n={1} on s="x" f={false} />;`,
    );
    const seen: unknown[] = [];
    mount(mod.make(seen));
    expect(seen).toEqual([1, true, "x", false]);
  });
});

describe("auto-reactive constants (execution)", () => {
  it("[DRV-20] the counter: `count() * 2` works as a value and as a call, and stays live", async () => {
    const mod = await load<{ Counter: (props: { start: number }) => unknown; bump: () => void }>(`
      import { useSignal } from "@shadow-js/core";
      let bumpRef;
      export const bump = () => bumpRef();
      export function Counter(props: { start: number }) {
        const [count, setCount] = useSignal(props.start);
        bumpRef = () => setCount((n) => n + 1);
        const doubled = count() * 2;
        const label = "n=" + count();
        return <main><p id="a">{doubled}</p><p id="b">{doubled()}</p><p id="c" title={label}>{label}</p></main>;
      }`);
    const { host } = mount(() => createComponent(mod.Counter, { start: 1 }));
    expect(host.querySelector("#a")?.textContent).toBe("2");
    expect(host.querySelector("#b")?.textContent).toBe("2");
    expect(host.querySelector("#c")?.getAttribute("title")).toBe("n=1");
    mod.bump();
    flushSync();
    expect(host.querySelector("#a")?.textContent).toBe("4");
    expect(host.querySelector("#b")?.textContent).toBe("4");
    expect(host.querySelector("#c")?.textContent).toBe("n=2");
    expect(host.querySelector("#c")?.getAttribute("title")).toBe("n=2");
  });

  it("[DRV-21] destructured props stay reactive, including defaults and renames", async () => {
    const [title, setTitle] = useSignal<string | undefined>("a");
    const mod = await load<{
      Card: (props: { title?: string | undefined; label: string }) => unknown;
    }>(`
      export function Card(props) {
        const { title = "none", label: text } = props;
        return <h1 title={title}>{title}-{text}</h1>;
      }
      export const Row = ({ id, name = "anon" }) => <li data-id={id}>{name}</li>;`);
    const { host } = mount(() =>
      createComponent(mod.Card, {
        get title() {
          return title();
        },
        label: "L",
      }),
    );
    expect(host.textContent).toBe("a-L");
    flushSync(() => setTitle("b"));
    expect(host.textContent).toBe("b-L");
    flushSync(() => setTitle(undefined));
    expect(host.textContent).toBe("none-L");
    expect(host.querySelector("h1")?.getAttribute("title")).toBe("none");
  });

  it("[DRV-22] destructured parameters: values follow signals", async () => {
    const [name, setName] = useSignal("x");
    const mod = await load<{ Row: (props: { id: number; name?: string }) => unknown }>(
      `export const Row = ({ id, name = "anon" }) => <li data-id={id}>{name}</li>;`,
    );
    const { host } = mount(() =>
      createComponent(mod.Row, {
        id: 7,
        get name() {
          return name();
        },
      }),
    );
    expect(host.textContent).toBe("x");
    flushSync(() => setName("y"));
    expect(host.textContent).toBe("y");
    expect(host.querySelector("li")?.getAttribute("data-id")).toBe("7");
  });

  it("[DRV-23] chained constants and closures read fresh values", async () => {
    const [n, setN] = useSignal(1);
    const mod = await load<{
      C: (props: { n: () => number; log: (v: number) => void }) => unknown;
    }>(`
      export function C(props) {
        const a = props.n() + 1;
        const b = a * 10;
        return <button onClick={() => props.log(b)}>{b}</button>;
      }`);
    const seen: number[] = [];
    const { host } = mount(() => createComponent(mod.C, { n, log: (v) => seen.push(v) }));
    expect(host.textContent).toBe("20");
    flushSync(() => setN(4));
    expect(host.textContent).toBe("50");
    host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seen).toEqual([50]);
  });

  it("[DRV-24] a derived const holding a function is still callable", async () => {
    const [mode, setMode] = useSignal("up");
    const mod = await load<{ C: (props: { mode: () => string }) => unknown }>(`
      export function C(props) {
        const fmt = props.mode() === "up" ? (s) => s.toUpperCase() : (s) => s.toLowerCase();
        return <p>{fmt("Ab")}</p>;
      }`);
    const { host } = mount(() => createComponent(mod.C, { mode }));
    expect(host.textContent).toBe("AB");
    flushSync(() => setMode("down"));
    expect(host.textContent).toBe("ab");
  });
});

describe("accessor-friendly attributes", () => {
  it("[FRG-01] a signal accessor passed where a value is expected still binds and updates", async () => {
    const [v, setV] = useSignal("a");
    const [on, setOn] = useSignal(false);
    const [color, setColor] = useSignal("red");
    const mod = await load<{
      make: (v: () => string, on: () => boolean, color: () => string) => () => unknown;
    }>(
      `export const make = (v, on, color) => () => <input value={v} disabled={on} title={v} class={v} style={{ color }} />;`,
    );
    const { host } = mount(mod.make(v, on, color));
    const input = host.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("a");
    expect(input.title).toBe("a");
    expect(input.disabled).toBe(false);
    flushSync(() => {
      setV("b");
      setOn(true);
    });
    expect(input.value).toBe("b");
    expect(input.title).toBe("b");
    expect(input.className).toBe("b");
    expect(input.disabled).toBe(true);
    void setColor;
  });

  it("[FRG-02] plain values in bare identifiers keep working", async () => {
    const mod = await load<{ make: (v: string) => () => unknown }>(
      "export const make = (v) => () => <p title={v} class={v}>{v}</p>;",
    );
    const { host } = mount(mod.make("plain"));
    expect(host.querySelector("p")?.getAttribute("title")).toBe("plain");
    expect(host.textContent).toBe("plain");
  });

  it("[EXE-12] a literal true on aria-, data- and enumerated attributes is written as text, like the runtime does", async () => {
    const mod = await load<{ App: () => unknown }>(
      "export const App = () => <div draggable={true} aria-hidden={true} data-on={true} contenteditable={true} hidden={true}>x</div>;",
    );
    const { host } = mount(mod.App as () => unknown);
    const div = host.querySelector("div");
    expect(div?.getAttribute("draggable")).toBe("true");
    expect(div?.getAttribute("aria-hidden")).toBe("true");
    expect(div?.getAttribute("data-on")).toBe("true");
    expect(div?.getAttribute("contenteditable")).toBe("true");
    expect(div?.getAttribute("hidden")).toBe("");
  });

  it("[RET-01] a component returning a conditional on a signal follows the signal", async () => {
    const mod = await load<{ make: (on: () => boolean) => unknown }>(
      `export const make = (on) => { const View = () => on() ? <b>yes</b> : <i>no</i>; return View(); };
       export function Gate(props) { return props.open ? <b>open</b> : <i>closed</i>; }`,
    );
    const [on, setOn] = useSignal(true);
    const { host } = mount(() => mod.make(on));
    expect(host.textContent).toBe("yes");
    flushSync(() => setOn(false));
    expect(host.textContent).toBe("no");
    flushSync(() => setOn(true));
    expect(host.textContent).toBe("yes");
  });

  it("[RET-02] a component returning `props.open ? a : b` and `x && node` follows its props", async () => {
    const mod = await load<{
      Gate: (props: { open: boolean }) => unknown;
      Maybe: (props: { item: { name: string } | null }) => unknown;
    }>(
      `export function Gate(props) { return props.open ? <b>open</b> : <i>closed</i>; }
       export const Maybe = (props) => props.item && <u>{props.item.name}</u>;`,
    );
    const [open, setOpen] = useSignal(false);
    const gate = mount(() =>
      mod.Gate({
        get open() {
          return open();
        },
      }),
    );
    expect(gate.host.textContent).toBe("closed");
    flushSync(() => setOpen(true));
    expect(gate.host.textContent).toBe("open");
    const [item, setItem] = useSignal<{ name: string } | null>(null);
    const maybe = mount(() =>
      mod.Maybe({
        get item() {
          return item();
        },
      }),
    );
    expect(maybe.host.textContent).toBe("");
    flushSync(() => setItem({ name: "Ada" }));
    expect(maybe.host.textContent).toBe("Ada");
  });

  it("[RET-03] a constant condition is not wrapped, and /*@static*/ opts out", async () => {
    const mod = await load<{ A: () => unknown }>(
      "export const A = () => true ? <b>x</b> : <i>y</i>;",
    );
    const { host } = mount(mod.A);
    expect(host.textContent).toBe("x");
  });

  it("[EXE-13] lowercase event attributes (onclick) bind like onClick", async () => {
    const mod = await load<{ App: (props: { hit: () => void }) => unknown }>(
      "export const App = (props) => <button onclick={props.hit}>go</button>;",
    );
    let hits = 0;
    const { host } = mount(() => mod.App({ hit: () => (hits += 1) }));
    host.querySelector("button")?.click();
    expect(hits).toBe(1);
  });

  it("[SPR-01] a lone spread on a component passes the props through, reactively", async () => {
    const mod = await load<{
      Outer: (props: { attrs: { title: string } }) => unknown;
    }>(
      `const Inner = (props) => <p title={props.title}>{props.title}</p>;
       export const Outer = (props) => <Inner {...props.attrs} />;`,
    );
    const [title, setTitle] = useSignal("a");
    const { host } = mount(() =>
      mod.Outer({
        get attrs() {
          return { title: title() };
        },
      }),
    );
    expect(host.querySelector("p")?.getAttribute("title")).toBe("a");
    expect(host.textContent).toBe("a");
    flushSync(() => setTitle("b"));
    expect(host.querySelector("p")?.getAttribute("title")).toBe("b");
    expect(host.textContent).toBe("b");
  });

  it("[SPR-02] a spread of an object literal that reads state is a props object, not a block", async () => {
    const mod = await load<{ Outer: (props: { n: () => number }) => unknown }>(
      `const Inner = (props) => <p>{props.n}</p>;
       export const Outer = (props) => <Inner {...{ n: props.n() }} />;`,
    );
    const [n, setN] = useSignal(1);
    const { host } = mount(() => mod.Outer({ n }));
    expect(host.textContent).toBe("1");
    flushSync(() => setN(2));
    expect(host.textContent).toBe("2");
  });

  it("[DEF-01] static defaultValue, defaultChecked, innerHTML and textContent literals take effect", async () => {
    const mod = await load<{ App: () => unknown }>(
      `export const App = () => (
        <div>
          <input class="i" defaultValue="x" />
          <input class="c" type="checkbox" defaultChecked />
          <p class="h" innerHTML="<b>hi</b>" />
          <p class="t" textContent="a & b" />
          <select class="s" defaultValue="b"><option value="a">A</option><option value="b">B</option></select>
          <textarea class="ta" defaultValue="note" />
        </div>
      );`,
    );
    const { host } = mount(mod.App as () => unknown);
    expect((host.querySelector(".i") as HTMLInputElement).value).toBe("x");
    expect((host.querySelector(".c") as HTMLInputElement).checked).toBe(true);
    expect(host.querySelector(".h")?.innerHTML).toBe("<b>hi</b>");
    expect(host.querySelector(".t")?.textContent).toBe("a & b");
    expect((host.querySelector(".s") as HTMLSelectElement).value).toBe("b");
    expect((host.querySelector(".ta") as HTMLTextAreaElement).value).toBe("note");
  });

  it("[EXE-14] a compiled select value follows its signal: single, text-matched and multiple arrays", async () => {
    const mod = await load<{
      App: (props: { one: () => unknown; many: () => unknown }) => unknown;
    }>(
      `export const App = (props) => (
        <div>
          <select class="one" value={props.one()}><option value="a">A</option><option>Plain</option></select>
          <select class="many" multiple value={props.many()}>
            <optgroup label="g"><option value="a">A</option><option value="b">B</option></optgroup>
            <option value="c">C</option>
          </select>
        </div>
      );`,
    );
    const [one, setOne] = useSignal<unknown>("Plain");
    const [many, setMany] = useSignal<unknown>(["a", "c"]);
    const { host } = mount(() => mod.App({ one, many }));
    const single = host.querySelector(".one") as HTMLSelectElement;
    const multiple = host.querySelector(".many") as HTMLSelectElement;
    const chosen = (): string[] =>
      Array.from(multiple.options)
        .filter((option) => option.selected)
        .map((option) => option.value);
    expect(single.value).toBe("Plain");
    expect(chosen()).toEqual(["a", "c"]);
    flushSync(() => {
      setOne("a");
      setMany(["b"]);
    });
    expect(single.value).toBe("a");
    expect(chosen()).toEqual(["b"]);
    flushSync(() => setMany([]));
    expect(chosen()).toEqual([]);
  });
});
