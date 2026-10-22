import { flushSync, useSignal } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "../support/compile";

const SVG_NS = "http://www.w3.org/2000/svg";
const hosts: HTMLElement[] = [];
const disposers: Array<() => void> = [];

/** Mounts `code` into a fresh container attached to the document. */
function mountApp(code: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  disposers.push(render(code, host));
  return host;
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const host of hosts.splice(0)) host.remove();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** Lets pending promises settle, then drains the effects. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  flushSync();
}

/** Presses an element the way a user would. */
function press(el: Element | null | undefined): void {
  if (!el) throw new Error("press(): element not found");
  flushSync(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Names exported by the web package that this audit expects but ShadowJS does not have yet. */
async function webExport(name: string): Promise<unknown> {
  const web: Record<string, unknown> = await import("@shadow-js/web");
  return web[name];
}

describe("concepts/control-flow/conditional-rendering and reference/components/show", () => {
  it("[SOLID-CF-50] conditional-rendering: Show renders its children when `when` is truthy", async () => {
    const mod = await load<{ App: (props: { on: () => boolean }) => unknown }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={props.on()}><div>Loading...</div></Show>
      );
    `);
    const [on, setOn] = useSignal(true);
    const host = mountApp(() => mod.App({ on }));
    expect(host.textContent).toBe("Loading...");
    flushSync(() => setOn(false));
    expect(host.textContent).toBe("");
    flushSync(() => setOn(true));
    expect(host.textContent).toBe("Loading...");
  });

  it("[SOLID-CF-51] conditional-rendering: Show renders `fallback` when `when` is falsy", async () => {
    const mod = await load<{ App: (props: { loading: () => boolean }) => unknown }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={!props.loading()} fallback={<div>Loading...</div>}>
          <h1>Hi, I am Ada.</h1>
        </Show>
      );
    `);
    const [loading, setLoading] = useSignal(true);
    const host = mountApp(() => mod.App({ loading }));
    expect(host.innerHTML).toBe("<div>Loading...</div>");
    flushSync(() => setLoading(false));
    expect(host.innerHTML).toBe("<h1>Hi, I am Ada.</h1>");
  });

  it("[SOLID-CF-52] conditional-rendering: Show components nest to handle several conditions", async () => {
    const mod = await load<{
      App: (props: { loading: () => boolean; error: () => string | undefined }) => unknown;
    }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={!props.loading()} fallback={<i>wait</i>}>
          <Show when={props.error()} fallback={<b>ok</b>}>
            <div>Error: {props.error()}</div>
          </Show>
        </Show>
      );
    `);
    const [loading, setLoading] = useSignal(true);
    const [error, setError] = useSignal<string | undefined>(undefined);
    const host = mountApp(() => mod.App({ loading, error }));
    expect(host.textContent).toBe("wait");
    flushSync(() => setLoading(false));
    expect(host.textContent).toBe("ok");
    flushSync(() => setError("boom"));
    expect(host.textContent).toBe("Error: boom");
  });

  it("[SOLID-CF-53] components/show: every falsy `when` value shows the fallback", async () => {
    const mod = await load<{ App: (props: { value: () => unknown }) => unknown }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={props.value()} fallback="fallback">shown</Show>
      );
    `);
    const [value, setValue] = useSignal<unknown>(1);
    const host = mountApp(() => mod.App({ value }));
    expect(host.textContent).toBe("shown");
    for (const falsy of [undefined, null, false, 0, ""]) {
      flushSync(() => setValue(falsy));
      expect(host.textContent).toBe("fallback");
      flushSync(() => setValue("again"));
      expect(host.textContent).toBe("shown");
    }
  });

  it("[SOLID-CF-54] components/show: a non-keyed Show keeps its child block while `when` stays truthy", async () => {
    const mod = await load<{
      App: (props: { user: () => { name: string } | undefined; made: string[] }) => unknown;
    }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={props.user()}>{(user) => { props.made.push("block"); return <div>{user().name}</div>; }}</Show>
      );
    `);
    const [user, setUser] = useSignal<{ name: string } | undefined>({ name: "Ada" });
    const made: string[] = [];
    const host = mountApp(() => mod.App({ user, made }));
    const div = host.querySelector("div");
    expect(div?.textContent).toBe("Ada");
    flushSync(() => setUser({ name: "Grace" }));
    expect(host.querySelector("div")).toBe(div);
    expect(host.textContent).toBe("Grace");
    expect(made.length).toBe(1);
  });

  it("[SOLID-CF-55] components/show: a function child of a non-keyed Show receives an accessor", async () => {
    const mod = await load<{ App: (props: { user: () => { name: string } }) => unknown }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => <Show when={props.user()}>{(user) => <div>{user().name}</div>}</Show>;
    `);
    const [user] = useSignal({ name: "Ada" });
    const host = mountApp(() => mod.App({ user }));
    expect(host.textContent).toBe("Ada");
  });

  it("[SOLID-CF-56] components/show: keyed Show rebuilds on a new truthy value and passes the value itself", async () => {
    const mod = await load<{
      App: (props: { user: () => { name: string } | undefined; made: string[] }) => unknown;
    }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={props.user()} keyed>{(user) => { props.made.push(user.name); return <div>{user.name}</div>; }}</Show>
      );
    `);
    const [user, setUser] = useSignal<{ name: string } | undefined>({ name: "Ada" });
    const made: string[] = [];
    const host = mountApp(() => mod.App({ user, made }));
    const first = host.querySelector("div");
    flushSync(() => setUser({ name: "Grace" }));
    expect(host.querySelector("div")).not.toBe(first);
    expect(host.textContent).toBe("Grace");
    expect(made).toEqual(["Ada", "Grace"]);
  });

  it("[SOLID-CF-57] components/show: function children run untracked", async () => {
    const mod = await load<{
      App: (props: {
        user: () => { name: string };
        other: () => string;
        runs: number[];
      }) => unknown;
    }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={props.user()} keyed>{(user) => { props.runs.push(1); return <div>{user.name}{props.other()}</div>; }}</Show>
      );
    `);
    const [user] = useSignal({ name: "Ada" });
    const [other, setOther] = useSignal("!");
    const runs: number[] = [];
    const host = mountApp(() => mod.App({ user, other, runs }));
    flushSync(() => setOther("?"));
    expect(host.textContent).toBe("Ada?");
    expect(runs.length).toBe(1);
  });

  it("[SOLID-CF-58] components/show: reading a non-keyed accessor after `when` went falsy throws", async () => {
    const mod = await load<{
      App: (props: {
        user: () => { name: string } | undefined;
        grab: (read: () => unknown) => void;
      }) => unknown;
    }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={props.user()}>{(user) => { props.grab(user); return <div>{user().name}</div>; }}</Show>
      );
    `);
    const [user, setUser] = useSignal<{ name: string } | undefined>({ name: "Ada" });
    let read: (() => unknown) | undefined;
    mountApp(() =>
      mod.App({
        user,
        grab: (accessor: () => unknown) => {
          read = accessor;
        },
      }),
    );
    flushSync(() => setUser(undefined));
    expect(() => read?.()).toThrow(TypeError);
  });

  it("[SOLID-CF-59] components/show: the fallback is read lazily, only when it is shown", async () => {
    const mod = await load<{ App: (props: { on: () => boolean; made: string[] }) => unknown }>(`
      import { Show } from "@shadow-js/web";
      const Fallback = (props) => { props.made.push("fallback"); return <i>fb</i>; };
      export const App = (props) => (
        <Show when={props.on()} fallback={<Fallback made={props.made} />}>content</Show>
      );
    `);
    const [on, setOn] = useSignal(true);
    const made: string[] = [];
    mountApp(() => mod.App({ on, made }));
    expect(made).toEqual([]);
    flushSync(() => setOn(false));
    expect(made).toEqual(["fallback"]);
  });

  it("[SOLID-CF-60] conditional-rendering: Switch renders the first Match whose `when` is truthy", async () => {
    const mod = await load<{ App: (props: { a: () => boolean; b: () => boolean }) => unknown }>(`
      import { Switch, Match } from "@shadow-js/web";
      export const App = (props) => (
        <Switch>
          <Match when={props.a()}><p>Outcome 1</p></Match>
          <Match when={props.b()}><p>Outcome 2</p></Match>
        </Switch>
      );
    `);
    const [a, setA] = useSignal(false);
    const [b, setB] = useSignal(true);
    const host = mountApp(() => mod.App({ a, b }));
    expect(host.textContent).toBe("Outcome 2");
    flushSync(() => setA(true));
    expect(host.textContent).toBe("Outcome 1");
    flushSync(() => {
      setA(false);
      setB(false);
    });
    expect(host.textContent).toBe("");
  });

  it("[SOLID-CF-61] conditional-rendering: Switch renders `fallback` when no Match is truthy", async () => {
    const mod = await load<{ App: (props: { a: () => boolean }) => unknown }>(`
      import { Switch, Match } from "@shadow-js/web";
      export const App = (props) => (
        <Switch fallback={<p>Fallback content</p>}>
          <Match when={props.a()}><p>Outcome 1</p></Match>
        </Switch>
      );
    `);
    const [a, setA] = useSignal(false);
    const host = mountApp(() => mod.App({ a }));
    expect(host.textContent).toBe("Fallback content");
    flushSync(() => setA(true));
    expect(host.textContent).toBe("Outcome 1");
  });

  it("[SOLID-CF-62] components/switch-and-match: status switch with three branches and a fallback", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      import { Switch, Match } from "@shadow-js/web";
      export function App() {
        const [status, setStatus] = useSignal("loading");
        return (
          <>
            <button onClick={() => setStatus("success")}>Success</button>
            <button onClick={() => setStatus("error")}>Error</button>
            <button onClick={() => setStatus("other")}>Other</button>
            <Switch fallback={<p>Unknown status</p>}>
              <Match when={status() === "loading"}><p>Loading...</p></Match>
              <Match when={status() === "success"}><p>Saved</p></Match>
              <Match when={status() === "error"}><p>Failed</p></Match>
            </Switch>
          </>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    const [success, error, other] = Array.from(host.querySelectorAll("button"));
    expect(host.querySelector("p")?.textContent).toBe("Loading...");
    press(success);
    expect(host.querySelector("p")?.textContent).toBe("Saved");
    press(error);
    expect(host.querySelector("p")?.textContent).toBe("Failed");
    press(other);
    expect(host.querySelector("p")?.textContent).toBe("Unknown status");
  });

  it("[SOLID-CF-63] components/switch-and-match: Match function children are untracked; keyed gets the value, non-keyed an accessor", async () => {
    const mod = await load<{
      App: (props: { value: () => { n: number } | undefined }) => unknown;
    }>(`
      import { Switch, Match } from "@shadow-js/web";
      export const App = (props) => (
        <Switch>
          <Match when={props.value()}>{(item) => <b>{item().n}</b>}</Match>
        </Switch>
      );
    `);
    const [value, setValue] = useSignal<{ n: number } | undefined>({ n: 1 });
    const host = mountApp(() => mod.App({ value }));
    const b = host.querySelector("b");
    flushSync(() => setValue({ n: 2 }));
    expect(host.querySelector("b")).toBe(b);
    expect(host.textContent).toBe("2");

    const keyed = await load<{ App: (props: { value: () => { n: number } }) => unknown }>(`
      import { Switch, Match } from "@shadow-js/web";
      export const App = (props) => (
        <Switch>
          <Match when={props.value()} keyed>{(item) => <b>{item.n}</b>}</Match>
        </Switch>
      );
    `);
    const [value2, setValue2] = useSignal({ n: 1 });
    const host2 = mountApp(() => keyed.App({ value: value2 }));
    const first = host2.querySelector("b");
    flushSync(() => setValue2({ n: 2 }));
    expect(host2.querySelector("b")).not.toBe(first);
    expect(host2.textContent).toBe("2");
  });

  it("[SOLID-CF-64] components/switch-and-match: a non-Match child of Switch is a TypeError", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Switch } from "@shadow-js/web";
      export const App = () => <Switch><p>not a match</p></Switch>;
    `);
    expect(() => mountApp(() => mod.App())).toThrow(TypeError);
  });
});

describe("concepts/control-flow/list-rendering, reference/components/for and index-component", () => {
  it("[SOLID-CF-65] list-rendering: For renders one row per item with (item, index())", async () => {
    const mod = await load<{ App: (props: { items: string[] }) => unknown }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <For each={props.items}>{(item, index) => <div>#{index()} {item}</div>}</For>
      );
    `);
    const host = mountApp(() => mod.App({ items: ["A", "B", "C"] }));
    expect(Array.from(host.children, (el) => el.textContent)).toEqual(["#0 A", "#1 B", "#2 C"]);
  });

  it("[SOLID-CF-66] components/for: fallback shows for empty, undefined, null and false lists", async () => {
    const mod = await load<{ App: (props: { list: () => unknown }) => unknown }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <For each={props.list()} fallback={<div>No items</div>}>{(item) => <b>{item}</b>}</For>
      );
    `);
    const [list, setList] = useSignal<unknown>(["A"]);
    const host = mountApp(() => mod.App({ list }));
    expect(host.textContent).toBe("A");
    for (const empty of [[], undefined, null, false]) {
      flushSync(() => setList(empty));
      expect(host.textContent).toBe("No items");
      flushSync(() => setList(["A"]));
      expect(host.textContent).toBe("A");
    }
  });

  it("[SOLID-CF-67] components/for: rows are matched by item identity and moved, not recreated", async () => {
    const mod = await load<{ App: (props: { items: () => Array<{ id: string }> }) => unknown }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <ul><For each={props.items()}>{(item) => <li>{item.id}</li>}</For></ul>
      );
    `);
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    const [items, setItems] = useSignal([a, b, c]);
    const host = mountApp(() => mod.App({ items }));
    const [la, lb, lc] = Array.from(host.querySelectorAll("li"));
    flushSync(() => setItems([c, a, b]));
    expect(Array.from(host.querySelectorAll("li"))).toEqual([lc, la, lb]);
    flushSync(() => setItems([c, a]));
    expect(Array.from(host.querySelectorAll("li"))).toEqual([lc, la]);
    expect(lb?.isConnected).toBe(false);
  });

  it("[SOLID-CF-68] components/for: the index argument is an accessor that follows moves", async () => {
    const mod = await load<{ App: (props: { items: () => string[] }) => unknown }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <For each={props.items()}>{(item, index) => <i>{item}{index()}</i>}</For>
      );
    `);
    const [items, setItems] = useSignal(["x", "y"]);
    const host = mountApp(() => mod.App({ items }));
    flushSync(() => setItems(["y", "x"]));
    expect(Array.from(host.children, (el) => el.textContent)).toEqual(["y0", "x1"]);
  });

  it("[SOLID-CF-69] list-rendering: For with objects converted by Object.entries and a styled row", async () => {
    const mod = await load<{ App: (props: { data: Record<string, string> }) => unknown }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <For each={Object.entries(props.data)}>
          {(entry, index) => <li style={{ color: index() % 2 === 0 ? "red" : "blue" }}>{entry[0]}={entry[1]}</li>}
        </For>
      );
    `);
    const host = mountApp(() => mod.App({ data: { a: "1", b: "2" } }));
    const lis = Array.from(host.querySelectorAll("li"));
    expect(lis.map((li) => li.textContent)).toEqual(["a=1", "b=2"]);
    expect(lis.map((li) => li.style.color)).toEqual(["red", "blue"]);
  });

  it("[SOLID-CF-70] components/for: the row callback is untracked and runs once per row", async () => {
    const mod = await load<{
      App: (props: { items: () => string[]; other: () => string; runs: string[] }) => unknown;
    }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <For each={props.items()}>{(item) => { props.runs.push(item + props.other()); return <i>{item}</i>; }}</For>
      );
    `);
    const [items, setItems] = useSignal(["a"]);
    const [other, setOther] = useSignal("1");
    const runs: string[] = [];
    mountApp(() => mod.App({ items, other, runs }));
    flushSync(() => setOther("2"));
    flushSync(() => setItems(["a", "b"]));
    expect(runs).toEqual(["a1", "b2"]);
  });

  // DIFFERENCE from Solid (by design): keyed <For key={...}> passes an item ACCESSOR (ADR-030), Solid passes the plain item to every For; packages/web/src/control-flow/for.ts:21-28.
  it("[SOLID-CF-71] components/for: the item argument is a plain value even when rows are keyed (differs from Solid; ShadowJS: a keyed row gets an item accessor)", async () => {
    const mod = await load<{
      App: (props: { items: Array<{ id: number; name: string }> }) => unknown;
    }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <For each={props.items} key={(item) => item.id}>{(item) => <li>{item().name}</li>}</For>
      );
    `);
    const host = mountApp(() => mod.App({ items: [{ id: 1, name: "Ada" }] }));
    expect(host.textContent).toBe("Ada");
  });

  it("[SOLID-CF-72] list-rendering: keyed For gives an item accessor that follows the object under the same key", async () => {
    const mod = await load<{
      App: (props: { items: () => Array<{ id: number; name: string }> }) => unknown;
    }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <For each={props.items()} key={(item) => item.id}>{(item) => <li>{item().name}</li>}</For>
      );
    `);
    const [items, setItems] = useSignal([{ id: 1, name: "Ada" }]);
    const host = mountApp(() => mod.App({ items }));
    const li = host.querySelector("li");
    flushSync(() => setItems([{ id: 1, name: "Grace" }]));
    expect(host.querySelector("li")).toBe(li);
    expect(li?.textContent).toBe("Grace");
  });

  it("[SOLID-CF-73] list-rendering: Index renders (item(), index) and updates the content at a position", async () => {
    const mod = await load<{
      App: (props: { items: () => Array<{ name: string; completed: boolean }> }) => unknown;
    }>(`
      import { Index } from "@shadow-js/web";
      export const App = (props) => (
        <Index each={props.items()}>
          {(item, index) => <li>{index}: {item().name} - {String(item().completed)}</li>}
        </Index>
      );
    `);
    const [items, setItems] = useSignal([
      { name: "a", completed: false },
      { name: "b", completed: true },
    ]);
    const host = mountApp(() => mod.App({ items }));
    const lis = Array.from(host.querySelectorAll("li"));
    expect(lis.map((li) => li.textContent)).toEqual(["0: a - false", "1: b - true"]);
    flushSync(() =>
      setItems([
        { name: "z", completed: true },
        { name: "b", completed: true },
      ]),
    );
    expect(Array.from(host.querySelectorAll("li"))).toEqual(lis);
    expect(lis.map((li) => li.textContent)).toEqual(["0: z - true", "1: b - true"]);
  });

  it("[SOLID-CF-74] components/index-component: positions stay when the array is reordered, item() follows", async () => {
    const mod = await load<{ App: (props: { items: () => string[] }) => unknown }>(`
      import { Index } from "@shadow-js/web";
      export const App = (props) => <Index each={props.items()}>{(item) => <div>{item()}</div>}</Index>;
    `);
    const [items, setItems] = useSignal(["A", "B", "C"]);
    const host = mountApp(() => mod.App({ items }));
    const nodes = Array.from(host.children);
    flushSync(() => setItems(["C", "A", "B"]));
    expect(Array.from(host.children)).toEqual(nodes);
    expect(Array.from(host.children, (el) => el.textContent)).toEqual(["C", "A", "B"]);
  });

  it("[SOLID-CF-75] components/index-component: rows are created and removed only when the length changes", async () => {
    const mod = await load<{ App: (props: { items: () => string[] }) => unknown }>(`
      import { Index } from "@shadow-js/web";
      export const App = (props) => <Index each={props.items()}>{(item) => <div>{item()}</div>}</Index>;
    `);
    const [items, setItems] = useSignal(["A", "B"]);
    const host = mountApp(() => mod.App({ items }));
    const [first, second] = Array.from(host.children);
    flushSync(() => setItems(["A", "B", "C"]));
    expect(host.children.length).toBe(3);
    expect(host.children[0]).toBe(first);
    flushSync(() => setItems(["A"]));
    expect(host.children.length).toBe(1);
    expect(second?.isConnected).toBe(false);
  });

  it("[SOLID-CF-76] components/index-component: fallback shows for empty, undefined, null and false", async () => {
    const mod = await load<{ App: (props: { list: () => unknown }) => unknown }>(`
      import { Index } from "@shadow-js/web";
      export const App = (props) => (
        <Index each={props.list()} fallback={<div>No items</div>}>{(item) => <b>{item()}</b>}</Index>
      );
    `);
    const [list, setList] = useSignal<unknown>(["A"]);
    const host = mountApp(() => mod.App({ list }));
    for (const empty of [[], undefined, null, false]) {
      flushSync(() => setList(empty));
      expect(host.textContent).toBe("No items");
      flushSync(() => setList(["A"]));
      expect(host.textContent).toBe("A");
    }
  });

  it("[SOLID-CF-77] list-rendering: Index over input fields keeps the focused input node while values change", async () => {
    const mod = await load<{ App: (props: { inputs: () => string[] }) => unknown }>(`
      import { Index } from "@shadow-js/web";
      export const App = (props) => (
        <form><Index each={props.inputs()}>{(input) => <input type="text" value={input()} />}</Index></form>
      );
    `);
    const [inputs, setInputs] = useSignal(["input1", "input2", "input3"]);
    const host = mountApp(() => mod.App({ inputs }));
    const nodes = Array.from(host.querySelectorAll("input"));
    flushSync(() => setInputs(["input1", "changed", "input3"]));
    expect(Array.from(host.querySelectorAll("input"))).toEqual(nodes);
    expect(nodes.map((n) => n.value)).toEqual(["input1", "changed", "input3"]);
  });

  it("[SOLID-CF-78] list-rendering: For with a text input adds an item from an input event (StringList; onChange is per edit, as in React)", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      import { For } from "@shadow-js/web";
      export function App() {
        const [items, setItems] = useSignal(["Item 1", "Item 2", "Item 3"]);
        return (
          <ul>
            <input type="text" onChange={(e) => setItems([...items(), e.currentTarget.value])} />
            <For each={items()}>{(item, index) => <li>{item} - {index()}</li>}</For>
          </ul>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    const input = host.querySelector("input");
    if (!input) throw new Error("input missing");
    input.value = "Item 4";
    flushSync(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(Array.from(host.querySelectorAll("li"), (li) => li.textContent)).toEqual([
      "Item 1 - 0",
      "Item 2 - 1",
      "Item 3 - 2",
      "Item 4 - 3",
    ]);
  });
});

describe("concepts/control-flow/dynamic and reference/components/dynamic, create-dynamic", () => {
  const OPTIONS = `
    import { useSignal } from "@shadow-js/core";
    import { Dynamic, For } from "@shadow-js/web";
    const RedDiv = () => <div style="color: red">Red</div>;
    const GreenDiv = () => <div style="color: green">Green</div>;
    const BlueDiv = () => <div style="color: blue">Blue</div>;
    const options = { red: RedDiv, green: GreenDiv, blue: BlueDiv };
  `;

  it("[SOLID-CF-79] control-flow/dynamic: the select example swaps the rendered component", async () => {
    const mod = await load<{ App: () => unknown }>(`${OPTIONS}
      export function App() {
        const [selected, setSelected] = useSignal("red");
        return (
          <>
            <select value={selected()} onInput={(e) => setSelected(e.currentTarget.value)}>
              <For each={Object.keys(options)}>{(color) => <option value={color}>{color}</option>}</For>
            </select>
            <Dynamic component={options[selected()]} />
          </>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    expect(host.querySelector("div")?.textContent).toBe("Red");
    const select = host.querySelector("select");
    if (!select) throw new Error("select missing");
    select.value = "green";
    flushSync(() => {
      select.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("div")?.textContent).toBe("Green");
    expect(host.querySelectorAll("div").length).toBe(1);
  });

  it("[SOLID-CF-80] control-flow/dynamic: Switch/Match renders the same result as Dynamic", async () => {
    const mod = await load<{ App: () => unknown }>(`${OPTIONS}
      import { Switch, Match } from "@shadow-js/web";
      export function App() {
        const [selected, setSelected] = useSignal("red");
        return (
          <>
            <button onClick={() => setSelected("green")}>g</button>
            <Switch fallback={<BlueDiv />}>
              <Match when={selected() === "red"}><RedDiv /></Match>
              <Match when={selected() === "green"}><GreenDiv /></Match>
            </Switch>
          </>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    expect(host.querySelector("div")?.textContent).toBe("Red");
    press(host.querySelector("button"));
    expect(host.querySelector("div")?.textContent).toBe("Green");
  });

  it("[SOLID-CF-81] components/dynamic: a tag name renders an intrinsic element with the remaining props", async () => {
    const mod = await load<{ App: (props: { tag: () => string }) => unknown }>(`
      import { Dynamic } from "@shadow-js/web";
      export const App = (props) => <Dynamic component={props.tag()} class="title" id="x">hello</Dynamic>;
    `);
    const [tag, setTag] = useSignal("h1");
    const host = mountApp(() => mod.App({ tag }));
    expect(host.innerHTML).toBe('<h1 class="title" id="x">hello</h1>');
    flushSync(() => setTag("h2"));
    expect(host.innerHTML).toBe('<h2 class="title" id="x">hello</h2>');
  });

  it("[SOLID-CF-82] components/dynamic: props are forwarded to a component and stay reactive", async () => {
    const mod = await load<{
      App: (props: { label: () => string; views: Record<string, unknown> }) => unknown;
    }>(`
      import { Dynamic } from "@shadow-js/web";
      const red = (props) => <p style={{ color: "red" }}>{props.label}</p>;
      export const App = (props) => <Dynamic component={red} label={props.label()} />;
    `);
    const [label, setLabel] = useSignal("Selected view");
    const host = mountApp(() => mod.App({ label, views: {} }));
    expect(host.textContent).toBe("Selected view");
    const p = host.querySelector("p");
    flushSync(() => setLabel("Changed"));
    expect(host.querySelector("p")).toBe(p);
    expect(host.textContent).toBe("Changed");
  });

  it("[SOLID-CF-83] components/dynamic: an undefined component renders nothing", async () => {
    const mod = await load<{ App: (props: { which: () => unknown }) => unknown }>(`
      import { Dynamic } from "@shadow-js/web";
      export const App = (props) => <Dynamic component={props.which()} />;
    `);
    const [which, setWhich] = useSignal<unknown>(undefined);
    const host = mountApp(() => mod.App({ which }));
    expect(host.innerHTML).toBe("");
    flushSync(() => setWhich("span"));
    expect(host.innerHTML).toBe("<span></span>");
    flushSync(() => setWhich(undefined));
    expect(host.innerHTML).toBe("");
  });

  it("[SOLID-CF-84] components/dynamic: the reference example switches between two view components", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      import { Dynamic } from "@shadow-js/web";
      const views = {
        red: (props) => <p style={{ color: "red" }}>{props.label}</p>,
        blue: (props) => <p style={{ color: "blue" }}>{props.label}</p>,
      };
      export function App() {
        const [selected, setSelected] = useSignal("red");
        return (
          <>
            <button onClick={() => setSelected("red")}>Red</button>
            <button onClick={() => setSelected("blue")}>Blue</button>
            <Dynamic component={views[selected()]} label="Selected view" />
          </>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    expect(host.querySelector("p")?.style.color).toBe("red");
    press(host.querySelectorAll("button")[1]);
    expect(host.querySelector("p")?.style.color).toBe("blue");
    expect(host.querySelector("p")?.textContent).toBe("Selected view");
  });

  it("[SOLID-CF-85] components/dynamic: SVG tag names are created in the SVG namespace", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Dynamic } from "@shadow-js/web";
      export const App = () => <svg><Dynamic component="circle" r="5" /></svg>;
    `);
    const host = mountApp(() => mod.App());
    expect(host.querySelector("circle")?.namespaceURI).toBe(SVG_NS);
  });

  it("[SOLID-CF-86] components/dynamic: ShadowJS refuses a script tag or a malformed tag name (ADR-015)", async () => {
    const mod = await load<{ App: (props: { tag: string }) => unknown }>(`
      import { Dynamic } from "@shadow-js/web";
      export const App = (props) => <Dynamic component={props.tag} />;
    `);
    expect(() => mountApp(() => mod.App({ tag: "script" }))).toThrow(TypeError);
    expect(() => mountApp(() => mod.App({ tag: "div onclick=x" }))).toThrow(TypeError);
  });

  it("[SOLID-CF-87] components/create-dynamic: createDynamic(component accessor, props) renders the chosen view", async () => {
    const createDynamic = (await webExport("createDynamic")) as (
      component: () => unknown,
      props: object,
    ) => unknown;
    expect(typeof createDynamic).toBe("function");
    const view = (props: { label: string }) => {
      const p = document.createElement("p");
      p.textContent = props.label;
      return p;
    };
    const host = mountApp(() => createDynamic(() => view, { label: "Selected view" }));
    expect(host.textContent).toBe("Selected view");
  });

  it("[SOLID-CF-88] components/create-dynamic: an undefined component accessor renders nothing", async () => {
    const createDynamic = (await webExport("createDynamic")) as (
      component: () => unknown,
      props: object,
    ) => unknown;
    expect(typeof createDynamic).toBe("function");
    const host = mountApp(() => createDynamic(() => undefined, {}));
    expect(host.innerHTML).toBe("");
  });
});

describe("concepts/control-flow/error-boundary and reference/components/error-boundary", () => {
  it("[SOLID-CF-89] control-flow/error-boundary: a throwing child shows the fallback with the error and reset", async () => {
    const mod = await load<{ App: (props: { fail: { value: boolean } }) => unknown }>(`
      import { ErrorBoundary } from "@shadow-js/web";
      function ErrorProne(props) {
        if (props.fail.value) throw new Error("Broken");
        return <p>fine</p>;
      }
      export function App(props) {
        return (
          <div>
            <ErrorBoundary
              fallback={(error, reset) => (
                <div>
                  <p>Something went wrong: {error.message}</p>
                  <button onClick={reset}>Try Again</button>
                </div>
              )}
            >
              <ErrorProne fail={props.fail} />
            </ErrorBoundary>
          </div>
        );
      }
    `);
    const fail = { value: true };
    const host = mountApp(() => mod.App({ fail }));
    expect(host.textContent).toBe("Something went wrong: BrokenTry Again");
    fail.value = false;
    press(host.querySelector("button"));
    expect(host.textContent).toBe("fine");
  });

  it("[SOLID-CF-90] components/error-boundary: a non-function fallback is rendered as is", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { ErrorBoundary } from "@shadow-js/web";
      function Bad() { throw new Error("x"); }
      export const App = () => <ErrorBoundary fallback={<span>static fallback</span>}><Bad /></ErrorBoundary>;
    `);
    const host = mountApp(() => mod.App());
    expect(host.innerHTML).toBe("<span>static fallback</span>");
  });

  it("[SOLID-CF-91] components/error-boundary: an error thrown while updating a reactive computation is caught", async () => {
    const mod = await load<{ App: (props: { n: () => number }) => unknown }>(`
      import { ErrorBoundary } from "@shadow-js/web";
      function Child(props) {
        return <p>{(() => { if (props.n() > 1) throw new Error("too big"); return props.n(); })()}</p>;
      }
      export const App = (props) => (
        <ErrorBoundary fallback={(e) => <em>{e.message}</em>}><Child n={props.n} /></ErrorBoundary>
      );
    `);
    const [n, setN] = useSignal(0);
    const host = mountApp(() => mod.App({ n }));
    expect(host.textContent).toBe("0");
    flushSync(() => setN(2));
    expect(host.innerHTML).toBe("<em>too big</em>");
  });

  it("[SOLID-CF-92] components/error-boundary: reset rebuilds the children from scratch", async () => {
    const mod = await load<{
      App: (props: { made: number[]; fail: { value: boolean } }) => unknown;
    }>(`
      import { ErrorBoundary } from "@shadow-js/web";
      function Child(props) {
        props.made.push(1);
        if (props.fail.value) throw new Error("x");
        return <p>ok</p>;
      }
      export const App = (props) => (
        <ErrorBoundary fallback={(e, reset) => <button onClick={reset}>retry</button>}>
          <Child made={props.made} fail={props.fail} />
        </ErrorBoundary>
      );
    `);
    const made: number[] = [];
    const fail = { value: true };
    const host = mountApp(() => mod.App({ made, fail }));
    expect(made.length).toBe(1);
    fail.value = false;
    press(host.querySelector("button"));
    expect(made.length).toBe(2);
    expect(host.textContent).toBe("ok");
  });

  it("[SOLID-CF-93] components/error-boundary: an error thrown by the fallback goes to the parent boundary", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { ErrorBoundary } from "@shadow-js/web";
      function Bad() { throw new Error("inner"); }
      export const App = () => (
        <ErrorBoundary fallback={(e) => <b>outer caught {e.message}</b>}>
          <ErrorBoundary fallback={() => { throw new Error("from fallback"); }}>
            <Bad />
          </ErrorBoundary>
        </ErrorBoundary>
      );
    `);
    const host = mountApp(() => mod.App());
    expect(host.textContent).toBe("outer caught from fallback");
  });

  it("[SOLID-CF-94] control-flow/error-boundary: errors thrown in event handlers are not caught by the boundary", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { ErrorBoundary } from "@shadow-js/web";
      export const App = () => (
        <ErrorBoundary fallback={<b>boundary</b>}>
          <button on:click={() => { throw new Error("in handler"); }}>go</button>
        </ErrorBoundary>
      );
    `);
    const host = mountApp(() => mod.App());
    const thrown: unknown[] = [];
    try {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    } catch (error) {
      thrown.push(error);
    }
    // happy-dom rethrows the listener error from dispatchEvent; browsers report it to window.onerror.
    expect((thrown[0] as Error | undefined)?.message).toBe("in handler");
    expect(host.textContent).toBe("go");
  });
});

describe("reference/components/suspense and suspense-list", () => {
  it("[SOLID-CF-95] components/suspense: the fallback shows while a resource is pending, then the content", async () => {
    let resolve: (value: string) => void = () => undefined;
    const mod = await load<{ App: (props: { fetchMessage: () => Promise<string> }) => unknown }>(`
      import { useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function AsyncMessage(props) {
        const message = useResource(props.fetchMessage);
        return <p>{message()}</p>;
      }
      export const App = (props) => (
        <Suspense fallback={<p>Loading...</p>}><AsyncMessage fetchMessage={props.fetchMessage} /></Suspense>
      );
    `);
    const host = mountApp(() =>
      mod.App({
        fetchMessage: () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      }),
    );
    expect(host.textContent).toBe("Loading...");
    resolve("Loaded");
    await settle();
    expect(host.textContent).toBe("Loaded");
  });

  it("[SOLID-CF-96] components/suspense: nested boundaries each handle the resources under them", async () => {
    const resolvers: Record<string, (value: string) => void> = {};
    const fetcher = (name: string) => () =>
      new Promise<string>((done) => {
        resolvers[name] = done;
      });
    const mod = await load<{
      App: (props: { title: () => Promise<string>; details: () => Promise<string> }) => unknown;
    }>(`
      import { useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function Title(props) { const title = useResource(props.load); return <h1>{title()}</h1>; }
      function Details(props) { const details = useResource(props.load); return <p>{details()}</p>; }
      export const App = (props) => (
        <Suspense fallback={<div>Loading page...</div>}>
          <Title load={props.title} />
          <Suspense fallback={<div>Loading details...</div>}>
            <Details load={props.details} />
          </Suspense>
        </Suspense>
      );
    `);
    const host = mountApp(() => mod.App({ title: fetcher("title"), details: fetcher("details") }));
    expect(host.textContent).toBe("Loading page...");
    resolvers["title"]?.("Profile");
    await settle();
    expect(host.textContent).toBe("ProfileLoading details...");
    resolvers["details"]?.("Details loaded");
    await settle();
    expect(host.textContent).toBe("ProfileDetails loaded");
  });

  it("[SOLID-CF-97] components/suspense: the subtree is created once and keeps its nodes while the fallback shows", async () => {
    let resolve: (value: string) => void = () => undefined;
    const mod = await load<{
      App: (props: { load: () => Promise<string>; made: number[] }) => unknown;
    }>(`
      import { useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function Child(props) {
        props.made.push(1);
        const data = useResource(props.load);
        return <p>{data()}</p>;
      }
      export const App = (props) => (
        <Suspense fallback={<i>wait</i>}><Child load={props.load} made={props.made} /></Suspense>
      );
    `);
    const made: number[] = [];
    mountApp(() =>
      mod.App({
        made,
        load: () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      }),
    );
    expect(made.length).toBe(1);
    resolve("x");
    await settle();
    expect(made.length).toBe(1);
  });

  it("[SOLID-CF-98] components/suspense: onMount and effects inside the suspended subtree run after the boundary resolves", async () => {
    let resolve: (value: string) => void = () => undefined;
    const mod = await load<{
      App: (props: { load: () => Promise<string>; log: string[] }) => unknown;
    }>(`
      import { onMount, useEffect, useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function Child(props) {
        const data = useResource(props.load);
        onMount(() => props.log.push("mount"));
        useEffect(() => { props.log.push("effect"); });
        return <p>{data()}</p>;
      }
      export const App = (props) => (
        <Suspense fallback={<i>wait</i>}><Child load={props.load} log={props.log} /></Suspense>
      );
    `);
    const log: string[] = [];
    mountApp(() =>
      mod.App({
        log,
        load: () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      }),
    );
    flushSync();
    expect(log).toEqual([]);
    resolve("x");
    await settle();
    expect(log).toEqual(["mount", "effect"]);
  });

  it('[SOLID-CF-99] components/suspense-list: revealOrder="forwards" reveals the boundaries from first to last', async () => {
    const SuspenseList = (await webExport("SuspenseList")) as (props: object) => unknown;
    expect(typeof SuspenseList).toBe("function");
    const resolvers: Array<(value: string) => void> = [];
    const mod = await load<{
      App: (props: { SuspenseList: unknown; load: (i: number) => Promise<string> }) => unknown;
    }>(`
      import { useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function Item(props) { const d = useResource(() => props.load(props.i)); return <h2>{d()}</h2>; }
      export const App = (props) => {
        const List = props.SuspenseList;
        return (
          <List revealOrder="forwards" tail="collapsed">
            <Suspense fallback={<h2>Loading 0</h2>}><Item i={0} load={props.load} /></Suspense>
            <Suspense fallback={<h2>Loading 1</h2>}><Item i={1} load={props.load} /></Suspense>
          </List>
        );
      };
    `);
    const host = mountApp(() =>
      mod.App({
        SuspenseList,
        load: (i: number) =>
          new Promise<string>((done) => {
            resolvers[i] = done;
          }),
      }),
    );
    resolvers[1]?.("second");
    await settle();
    // The second boundary is ready but must wait for the first one.
    expect(host.textContent).not.toContain("second");
    resolvers[0]?.("first");
    await settle();
    expect(host.textContent).toBe("firstsecond");
  });

  it('[SOLID-CF-100] components/suspense-list: revealOrder="together" reveals all boundaries at once', async () => {
    const SuspenseList = (await webExport("SuspenseList")) as (props: object) => unknown;
    expect(typeof SuspenseList).toBe("function");
    const resolvers: Array<(value: string) => void> = [];
    const mod = await load<{
      App: (props: { SuspenseList: unknown; load: (i: number) => Promise<string> }) => unknown;
    }>(`
      import { useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function Item(props) { const d = useResource(() => props.load(props.i)); return <h2>{d()}</h2>; }
      export const App = (props) => {
        const List = props.SuspenseList;
        return (
          <List revealOrder="together">
            <Suspense fallback={<h2>Loading 0</h2>}><Item i={0} load={props.load} /></Suspense>
            <Suspense fallback={<h2>Loading 1</h2>}><Item i={1} load={props.load} /></Suspense>
          </List>
        );
      };
    `);
    const host = mountApp(() =>
      mod.App({
        SuspenseList,
        load: (i: number) =>
          new Promise<string>((done) => {
            resolvers[i] = done;
          }),
      }),
    );
    resolvers[0]?.("first");
    await settle();
    expect(host.textContent).not.toContain("first");
    resolvers[1]?.("second");
    await settle();
    expect(host.textContent).toBe("firstsecond");
  });

  it("[SOLID-CF-101] components/no-hydration: in client-only rendering NoHydration renders its children normally", async () => {
    const NoHydration = (await webExport("NoHydration")) as (props: {
      children?: unknown;
    }) => unknown;
    expect(typeof NoHydration).toBe("function");
    const host = mountApp(() =>
      NoHydration({
        get children() {
          const strong = document.createElement("strong");
          strong.textContent = "Rendered on the server without hydration";
          return strong;
        },
      }),
    );
    expect(host.textContent).toBe("Rendered on the server without hydration");
  });

  it("[SOLID-CF-102] components/no-hydration: hydration leaves a NoHydration subtree untouched and inert", async () => {
    const NoHydration = (await webExport("NoHydration")) as (props: {
      children?: unknown;
    }) => unknown;
    expect(typeof NoHydration).toBe("function");
    const { hydrate } = await import("@shadow-js/web");
    const mod = await load<{ App: (props: { NoHydration: unknown; log: string[] }) => unknown }>(`
      export const App = (props) => {
        const Skip = props.NoHydration;
        return (
          <div>
            <button onClick={() => props.log.push("hydrated")}>Hydrated button</button>
            <Skip><div><button onClick={() => props.log.push("skipped")}>inert</button></div></Skip>
          </div>
        );
      };
    `);
    const host = document.createElement("div");
    host.innerHTML =
      '<div data-hk="0-0"><button>Hydrated button</button><div><button>inert</button></div></div>';
    document.body.append(host);
    hosts.push(host);
    const log: string[] = [];
    disposers.push(hydrate(() => mod.App({ NoHydration, log }), host));
    const buttons = host.querySelectorAll("button");
    press(buttons[0]);
    press(buttons[1]);
    expect(log).toEqual(["hydrated"]);
  });
});

describe("concepts/control-flow/portal and reference/components/portal", () => {
  it("[SOLID-CF-103] control-flow/portal: content renders at the end of document.body by default, without a wrapper (ADR-018)", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = () => <section><Portal><div class="popup">...</div></Portal></section>;
    `);
    const host = mountApp(() => mod.App());
    expect(host.querySelector(".popup")).toBeNull();
    const popup = document.body.querySelector(".popup");
    expect(popup?.parentElement).toBe(document.body);
    expect(document.body.lastElementChild).toBe(popup);
  });

  it("[SOLID-CF-104] control-flow/portal: the mount prop selects another element", async () => {
    const mod = await load<{ App: (props: { target: Element }) => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = (props) => <Portal mount={props.target}><div class="popup">...</div></Portal>;
    `);
    const main = document.createElement("main");
    document.body.append(main);
    mountApp(() => mod.App({ target: main }));
    expect(main.querySelector(".popup")?.parentElement).toBe(main);
  });

  it("[SOLID-CF-105] components/portal: the Show + Portal popup opens and closes", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      import { Portal, Show } from "@shadow-js/web";
      export function App() {
        const [open, setOpen] = useSignal(false);
        return (
          <>
            <button class="open" onClick={() => setOpen(true)}>Open</button>
            <Show when={open()}>
              <Portal>
                <div class="popup" style={{ position: "fixed", top: "2rem" }}>
                  <div>Popup</div>
                  <button class="close" onClick={() => setOpen(false)}>Close</button>
                </div>
              </Portal>
            </Show>
          </>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    expect(document.body.querySelector(".popup")).toBeNull();
    press(host.querySelector(".open"));
    expect(document.body.querySelector(".popup")?.textContent).toBe("PopupClose");
    press(document.body.querySelector(".close"));
    expect(document.body.querySelector(".popup")).toBeNull();
  });

  it("[SOLID-CF-106] components/portal: disposing the owner removes the portal content", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = () => <Portal><i class="gone">x</i></Portal>;
    `);
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const dispose = render(() => mod.App(), host);
    expect(document.body.querySelector(".gone")).not.toBeNull();
    dispose();
    expect(document.body.querySelector(".gone")).toBeNull();
  });

  it("[SOLID-CF-107] components/portal: mounting into document.head inserts the children without a container", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = () => <Portal mount={document.head}><style>{"p { color: red }"}</style></Portal>;
    `);
    mountApp(() => mod.App());
    const style = document.head.querySelector("style");
    expect(style?.parentElement).toBe(document.head);
    expect(document.head.querySelector("div")).toBeNull();
  });

  it("[SOLID-CF-108] components/portal: useShadow renders into a shadow root of the mount", async () => {
    const mod = await load<{ App: (props: { target: Element }) => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = (props) => <Portal mount={props.target} useShadow={true}><p>shadowed</p></Portal>;
    `);
    const target = document.createElement("section");
    document.body.append(target);
    mountApp(() => mod.App({ target }));
    expect(target.shadowRoot?.querySelector("p")?.textContent).toBe("shadowed");
    expect(target.querySelector("p")).toBeNull();
  });

  it("[SOLID-CF-109] components/portal: an SVG mount receives namespaced children (isSVG)", async () => {
    const mod = await load<{ App: (props: { target: Element }) => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = (props) => (
        <Portal mount={props.target} isSVG={true}>
          <rect fill="red" x="25" y="25" height="50" width="50" />
        </Portal>
      );
    `);
    const svg = document.createElementNS(SVG_NS, "svg");
    document.body.append(svg);
    mountApp(() => mod.App({ target: svg }));
    const rect = svg.querySelector("rect");
    expect(rect?.parentElement).toBe(svg);
    expect(rect?.namespaceURI).toBe(SVG_NS);
  });

  // DIFFERENCE from Solid (by design): Portal ignores `ref`; there is no container element to receive it (wrapper-less, ADR-018), packages/web/src/control-flow/portal.ts:5-24.
  it("[SOLID-CF-110] components/portal: the ref prop receives the created container element (differs from Solid; ShadowJS: Portal has no container, so ref is not called)", async () => {
    const mod = await load<{ App: (props: { grab: (el: unknown) => void }) => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = (props) => <Portal ref={props.grab}><p>x</p></Portal>;
    `);
    const received: unknown[] = [];
    mountApp(() =>
      mod.App({
        grab: (el: unknown) => {
          received.push(el);
        },
      }),
    );
    expect(received.length).toBe(0);
  });

  // DIFFERENCE from Solid (by design): Portal is wrapper-less by decision (ADR-018) but Solid wraps the content in a <div> (or <g>) container; packages/web/src/control-flow/portal.ts:78-80.
  it("[SOLID-CF-111] components/portal: the content is wrapped in a container <div> (differs from Solid; ShadowJS: Portal adds no wrapper element)", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = () => <Portal><span class="in">x</span></Portal>;
    `);
    mountApp(() => mod.App());
    expect(document.body.querySelector(".in")?.parentElement?.localName).toBe("body");
  });

  it("[SOLID-CF-112] components/portal: a missing mount target renders nothing and warns once", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = () => <Portal mount={null}><span class="in">x</span></Portal>;
    `);
    const warn = vi.mocked(console.warn);
    mountApp(() => mod.App());
    expect(document.body.querySelector(".in")).toBeNull();
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "PORTAL_TARGET_MISSING",
    );
    warn.mockClear();
  });

  it("[SOLID-CF-113] components/portal: a reactive mount moves the content to the new target", async () => {
    const mod = await load<{ App: (props: { target: () => Element }) => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = (props) => <Portal mount={props.target()}><b class="moved">x</b></Portal>;
    `);
    const one = document.createElement("div");
    const two = document.createElement("div");
    document.body.append(one, two);
    const [target, setTarget] = useSignal<Element>(one);
    mountApp(() => mod.App({ target }));
    expect(one.querySelectorAll(".moved").length).toBe(1);
    flushSync(() => setTarget(two));
    expect(two.querySelectorAll(".moved").length).toBe(1);
    expect(one.querySelector(".moved")).toBeNull();
  });
});
