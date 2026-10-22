import v8 from "node:v8";
import vm from "node:vm";
import {
  createContext,
  createRoot,
  flushSync,
  onCleanup,
  useContext,
  useSignal,
} from "@shadow-js/core";
import { createComponent, For, Index, render, Show } from "@shadow-js/web";
import { describe, expect, it } from "vitest";
import { load } from "./support/compile";

function mount(view: () => unknown): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(view, host);
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

describe("scale: runtime limits", () => {
  // 200 levels: nested components are built by recursion, so the depth that fits depends on the stack of the Node.js version. Node 22.12, the
  // oldest supported, overflows near 245 levels; the test stays well inside that.
  it("[SCR-01] 200 levels of nested Show build, update and dispose without overflow", () => {
    const [on, setOn] = useSignal(true);
    let built = 0;
    let cleaned = 0;
    const Level = (props: { depth: number }): unknown => {
      built += 1;
      onCleanup(() => {
        cleaned += 1;
      });
      if (props.depth === 0) return "leaf";
      return createComponent(Show, {
        get when() {
          return on();
        },
        get children() {
          return createComponent(Level, { depth: props.depth - 1 }) as never;
        },
      });
    };
    const { host, dispose } = mount(() => createComponent(Level, { depth: 200 }));
    expect(host.textContent).toBe("leaf");
    expect(built).toBe(201);
    flushSync(() => setOn(false));
    expect(host.textContent).toBe("");
    expect(cleaned).toBe(200);
    flushSync(() => setOn(true));
    expect(host.textContent).toBe("leaf");
    dispose();
    expect(cleaned).toBe(201 + 200);
  });

  it("[SCR-02] For inside For inside For (20x20x20) renders and updates fine-grained", async () => {
    const [grid, setGrid] = useSignal<number[][][]>(
      Array.from({ length: 20 }, (_, a) =>
        Array.from({ length: 20 }, (_, b) =>
          Array.from({ length: 20 }, (_, c) => a * 400 + b * 20 + c),
        ),
      ),
    );
    const mod = await load<{ make: (g: () => number[][][]) => () => unknown }>(`
      import { For } from "@shadow-js/web";
      export const make = (grid) => () => (
        <div>
          <For each={grid()}>{(plane) => <section><For each={plane}>{(row) => <p><For each={row}>{(cell) => <b>{cell}</b>}</For></p>}</For></section>}</For>
        </div>
      );`);
    const start = performance.now();
    const { host, dispose } = mount(mod.make(grid));
    const elapsed = performance.now() - start;
    expect(host.querySelectorAll("b").length).toBe(8000);
    expect(elapsed).toBeLessThan(5000);
    const firstB = host.querySelector("b");
    // Replace one plane only: the other 19 planes keep their nodes (reference-keyed rows).
    flushSync(() => setGrid((g) => [g[0] as number[][], ...g.slice(1, 19), [[1, 2, 3]]]));
    expect(host.querySelector("b")).toBe(firstB);
    expect(host.querySelectorAll("section").length).toBe(20);
    dispose();
  });

  it("[SCR-03] a 20,000 row list: reverse, shuffle and halving move nodes, never recreate them", () => {
    const initial = Array.from({ length: 20_000 }, (_, i) => ({ id: i }));
    const [rows, setRows] = useSignal(initial);
    const { host, dispose } = mount(() =>
      createComponent(For<{ id: number }>, {
        get each() {
          return rows();
        },
        children: (row: { id: number }) => {
          const li = document.createElement("li");
          li.textContent = String(row.id);
          return li;
        },
      }),
    );
    const nodes = Array.from(host.children);
    expect(nodes.length).toBe(20_000);
    flushSync(() => setRows((r) => [...r].reverse()));
    expect(host.firstElementChild).toBe(nodes[19_999]);
    const shuffled = [...initial].sort(
      (a, b) => ((a.id * 7919) % 20_011) - ((b.id * 7919) % 20_011),
    );
    flushSync(() => setRows(shuffled));
    expect(Array.from(host.children).map((n) => n.textContent)).toEqual(
      shuffled.map((r) => String(r.id)),
    );
    const kept = shuffled.filter((_, i) => i % 2 === 0);
    flushSync(() => setRows(kept));
    expect(host.children.length).toBe(10_000);
    // Every surviving node is one of the original nodes.
    const original = new Set<Element>(nodes);
    expect(Array.from(host.children).every((n) => original.has(n))).toBe(true);
    dispose();
  });

  it("[SCR-04] 400 nested context providers resolve the nearest value quickly", () => {
    const Ctx = createContext(-1);
    const start = performance.now();
    let seen = -2;
    const nest = (depth: number): unknown =>
      depth === 400
        ? (() => {
            seen = useContext(Ctx);
            return "x";
          })()
        : Ctx({
            value: depth,
            get children() {
              return nest(depth + 1);
            },
          });
    createRoot((dispose) => {
      nest(0);
      dispose();
    });
    expect(seen).toBe(399);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it("[SCR-05] Index over 5,000 items updates item accessors without recreating rows", () => {
    const [items, setItems] = useSignal(Array.from({ length: 5000 }, (_, i) => i));
    let created = 0;
    const { host, dispose } = mount(() =>
      createComponent(Index, {
        get each() {
          return items();
        },
        children: (item: () => number) => {
          created += 1;
          const li = document.createElement("li");
          // The accessor is read inside a binding, so the row text follows the item.
          return createComponent(
            (props: { item: () => number }) => () => {
              li.textContent = String(props.item());
              return li;
            },
            { item },
          );
        },
      }),
    );
    expect(created).toBe(5000);
    flushSync(() => setItems((list) => list.map((n) => n + 1)));
    expect(created).toBe(5000);
    expect(host.firstElementChild?.textContent).toBe("1");
    dispose();
  });

  it("[SCR-06] 1,000 mount/unmount cycles of a compiled app leave no DOM behind and heap stays bounded", async () => {
    v8.setFlagsFromString("--expose_gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const mod = await load<{ App: (p: { items: () => number[] }) => unknown }>(`
      import { For, Show } from "@shadow-js/web";
      export const App = (props) => (
        <main>
          <Show when={props.items().length > 0} fallback={<i>none</i>}>
            <ul><For each={props.items()}>{(n) => <li onClick={() => n}>{n}<span class={"c" + n}>x</span></li>}</For></ul>
          </Show>
        </main>
      );`);
    const [items] = useSignal([1, 2, 3, 4, 5, 6, 7, 8]);
    // Sanity check once, outside the measured loop: querySelectorAll caches results in happy-dom,
    // which would be mistaken for a leak if called every cycle.
    const probe = mount(() => createComponent(mod.App, { items }));
    expect(probe.host.querySelectorAll("li").length).toBe(8);
    probe.dispose();
    const baseline = document.body.childNodes.length;
    const cycle = (): void => {
      const { host, dispose } = mount(() => createComponent(mod.App, { items }));
      if (host.children.length !== 1) throw new Error("render failed");
      dispose();
      if (host.childNodes.length !== 0) throw new Error("dispose left nodes");
    };
    for (let i = 0; i < 100; i += 1) cycle();
    gc();
    const before = process.memoryUsage().heapUsed;
    const samples: number[] = [];
    for (let block = 0; block < 4; block += 1) {
      for (let i = 0; i < 500; i += 1) cycle();
      gc();
      gc();
      samples.push(process.memoryUsage().heapUsed - before);
    }
    const growth = process.memoryUsage().heapUsed - before;
    expect(document.body.childNodes.length).toBe(baseline);
    expect(samples.at(-1) ?? 0).toBeLessThan(10 * 1024 * 1024);
    expect(growth).toBeLessThan(10 * 1024 * 1024);
  }, 120_000);
});
