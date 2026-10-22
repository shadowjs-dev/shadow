import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync, useSignal } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { compile } from "../../../compiler/src/javascript";
import { load } from "../support/compile";

const generated = join(import.meta.dirname, "..", ".generated");

/** Like `load`, but compiles with `autoReactive: false`, the strict Solid-style reactivity rule. */
async function loadStrict<T>(source: string): Promise<T> {
  mkdirSync(generated, { recursive: true });
  const { code } = compile(source, {
    filename: "strict.tsx",
    generate: "dom",
    autoReactive: false,
  });
  const file = join(
    generated,
    `cf-strict-${createHash("sha1").update(source).digest("hex").slice(0, 12)}.ts`,
  );
  writeFileSync(file, code);
  return (await import(/* @vite-ignore */ file)) as T;
}

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
});

/** Presses an element the way a user would (bubbles to the document for delegated handlers). */
function press(el: Element | null | undefined): void {
  if (!el) throw new Error("press(): element not found");
  flushSync(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("concepts/components/basics", () => {
  it("[SOLID-CF-01] components/basics: a component is a function that returns JSX", async () => {
    const mod = await load<{ MyComponent: () => unknown }>(
      "export function MyComponent() { return <div>Hello World</div>; }",
    );
    const host = mountApp(() => mod.MyComponent());
    expect(host.innerHTML).toBe("<div>Hello World</div>");
  });

  it("[SOLID-CF-02] components/basics: components nest inside each other", async () => {
    const mod = await load<{ App: () => unknown }>(`
      function MyComponent() { return <div>Hello World</div>; }
      export function App() { return (<div><MyComponent /></div>); }
    `);
    const host = mountApp(() => mod.App());
    expect(host.innerHTML).toBe("<div><div>Hello World</div></div>");
  });

  it("[SOLID-CF-03] components/basics: a lowercase tag name is an element, not a component", async () => {
    const mod = await load<{ App: () => unknown }>(`
      function myComponent() { return <b>component</b>; }
      export function App() { return (<div><myComponent /></div>); }
    `);
    const host = mountApp(() => mod.App());
    // The lowercase tag becomes a (custom) element named "mycomponent"; the function is not called.
    expect(host.querySelector("b")).toBeNull();
    expect(host.firstElementChild?.firstElementChild?.localName).toBe("mycomponent");
  });

  it("[SOLID-CF-04] components/basics: the component body runs once, the JSX stays reactive", async () => {
    const mod = await load<{ Counter: (props: { log: number[] }) => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export function Counter(props) {
        const [count, setCount] = useSignal(0);
        props.log.push(count());
        return (
          <div>
            <p>Count: {count()}</p>
            <button onClick={() => setCount((prev) => prev + 1)}>Increment</button>
          </div>
        );
      }
    `);
    const log: number[] = [];
    const host = mountApp(() => mod.Counter({ log }));
    const button = host.querySelector("button");
    press(button);
    press(button);
    expect(host.querySelector("p")?.textContent).toBe("Count: 2");
    expect(log).toEqual([0]);
  });

  it("[SOLID-CF-05] components/basics: each component instance has its own state", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      function Counter() {
        const [count, setCount] = useSignal(0);
        return <button onClick={() => setCount(count() + 1)}>{count()}</button>;
      }
      export function App() { return <div><Counter /><Counter /></div>; }
    `);
    const host = mountApp(() => mod.App());
    const [first, second] = Array.from(host.querySelectorAll("button"));
    press(first);
    press(first);
    press(second);
    expect([first?.textContent, second?.textContent]).toEqual(["2", "1"]);
  });

  it("[SOLID-CF-06] components/basics: a ternary in the return statement swaps content reactively", async () => {
    const mod = await load<{ MyComponent: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export function MyComponent() {
        const [count, setCount] = useSignal(0);
        return (
          <div>
            {count() > 5 ? (
              <div>Count limit reached</div>
            ) : (
              <>
                <p>Count: {count()}</p>
                <button onClick={() => setCount((prev) => prev + 1)}>Increment</button>
              </>
            )}
          </div>
        );
      }
    `);
    const host = mountApp(() => mod.MyComponent());
    expect(host.querySelector("p")?.textContent).toBe("Count: 0");
    for (let i = 0; i < 6; i += 1) press(host.querySelector("button"));
    expect(host.textContent).toBe("Count limit reached");
    expect(host.querySelector("button")).toBeNull();
  });

  it("[SOLID-CF-07] components/basics: Show with a fallback expresses the same conditional", async () => {
    const mod = await load<{ MyComponent: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      import { Show } from "@shadow-js/web";
      export function MyComponent() {
        const [count, setCount] = useSignal(0);
        return (
          <div>
            <Show
              when={count() > 5}
              fallback={
                <>
                  <p>Count: {count()}</p>
                  <button onClick={() => setCount((prev) => prev + 1)}>Increment</button>
                </>
              }
            >
              <div>Count limit reached</div>
            </Show>
          </div>
        );
      }
    `);
    const host = mountApp(() => mod.MyComponent());
    expect(host.querySelector("p")?.textContent).toBe("Count: 0");
    for (let i = 0; i < 6; i += 1) press(host.querySelector("button"));
    expect(host.textContent).toBe("Count limit reached");
  });

  it("[SOLID-CF-08] components/basics: named exports (inline and export list) and a default export", async () => {
    const mod = await load<{
      Inline: () => unknown;
      Listed: () => unknown;
      default: () => unknown;
    }>(`
      export function Inline() { return <div>inline</div>; }
      function Listed() { return <div>listed</div>; }
      export { Listed };
      export default function Main() { return <div>main</div>; }
    `);
    const host = mountApp(() => [mod.Inline(), mod.Listed(), mod.default()]);
    expect(host.textContent).toBe("inlinelistedmain");
  });

  it("[SOLID-CF-09] components/basics: a default-imported component is used like a named one", async () => {
    const child = await load<{ default: () => unknown }>(
      "export default function MyComponent() { return <div>Hello World</div>; }",
    );
    const mod = await load<{ App: (props: { MyComponent: () => unknown }) => unknown }>(`
      export function App(props) { const MyComponent = props.MyComponent; return <div><MyComponent /></div>; }
    `);
    const host = mountApp(() => mod.App({ MyComponent: child.default }));
    expect(host.innerHTML).toBe("<div><div>Hello World</div></div>");
  });

  it("[SOLID-CF-10] components/basics: utilities come from the package entries (core, core/store, web)", async () => {
    const core = await import("@shadow-js/core");
    const store = await import("@shadow-js/core/store");
    const web = await import("@shadow-js/web");
    expect(typeof core.useSignal).toBe("function");
    expect(typeof store.useStore).toBe("function");
    expect(typeof web.Show).toBe("function");
  });
});

describe("concepts/components/props", () => {
  it("[SOLID-CF-11] components/props: attributes become props read through the props object", async () => {
    const mod = await load<{ App: () => unknown }>(`
      function MyComponent(props) { return <div>Hello {props.name}</div>; }
      export function App() { return <div><MyComponent name="Ryan Carniato" /></div>; }
    `);
    const host = mountApp(() => mod.App());
    expect(host.textContent).toBe("Hello Ryan Carniato");
  });

  it("[SOLID-CF-12] components/props: a prop passed from a signal updates the child without re-running it", async () => {
    const mod = await load<{
      App: (props: { name: () => string; runs: number[] }) => unknown;
    }>(`
      function MyComponent(props) { props.runs.push(1); return <div>Hello {props.name}</div>; }
      export function App(props) { return <MyComponent name={props.name()} runs={props.runs} />; }
    `);
    const [name, setName] = useSignal("Ann");
    const runs: number[] = [];
    const host = mountApp(() => mod.App({ name, runs }));
    flushSync(() => setName("Bob"));
    expect(host.textContent).toBe("Hello Bob");
    expect(runs.length).toBe(1);
  });

  it("[SOLID-CF-13] components/props: props are read-only", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      function Child(props) {
        try { props.name = "changed"; } catch (error) { return <p>{error instanceof TypeError ? "read-only" : "other"}</p>; }
        return <p>writable</p>;
      }
      export function App() {
        const [n] = useSignal("start");
        return <Child name={n()} />;
      }
    `);
    const host = mountApp(() => mod.App());
    expect(host.textContent).toBe("read-only");
  });

  it("[SOLID-CF-14] components/props: mergeProps supplies defaults and keeps them reactive", async () => {
    const mod = await load<{
      MyComponent: (props: { defaultName?: string }) => unknown;
      Wrapper: (props: { value: () => string | undefined }) => unknown;
    }>(`
      import { mergeProps } from "@shadow-js/core";
      export function MyComponent(props) {
        const finalProps = mergeProps({ defaultName: "Ryan Carniato" }, props);
        return <div>Hello {finalProps.defaultName}</div>;
      }
      export function Wrapper(props) { return <MyComponent defaultName={props.value()} />; }
    `);
    expect(mountApp(() => mod.MyComponent({})).textContent).toBe("Hello Ryan Carniato");
    const [value, setValue] = useSignal<string | undefined>(undefined);
    const host = mountApp(() => mod.Wrapper({ value }));
    expect(host.textContent).toBe("Hello Ryan Carniato");
    flushSync(() => setValue("Ada"));
    expect(host.textContent).toBe("Hello Ada");
    flushSync(() => setValue(undefined));
    expect(host.textContent).toBe("Hello Ryan Carniato");
  });

  it("[SOLID-CF-15] components/props: with autoReactive off, destructuring props breaks reactivity and a wrapping function keeps it", async () => {
    const mod = await loadStrict<{
      App: (props: { name: () => string }) => unknown;
    }>(`
      function Child(props) {
        const { name } = props;
        const alsoName = props.name;
        const live = () => props.name;
        return <p>{name}|{alsoName}|{live()}</p>;
      }
      export function App(props) { return <Child name={props.name()} />; }
    `);
    const [name, setName] = useSignal("one");
    const host = mountApp(() => mod.App({ name }));
    expect(host.textContent).toBe("one|one|one");
    flushSync(() => setName("two"));
    expect(host.textContent).toBe("one|one|two");
  });

  it("[SOLID-CF-44] components/props: by default the compiler's forgiving reactivity keeps destructured props live", async () => {
    const mod = await load<{
      App: (props: { name: () => string }) => unknown;
    }>(`
      function Child(props) {
        const { name } = props;
        const alsoName = props.name;
        return <p>{name}|{alsoName}</p>;
      }
      export function App(props) { return <Child name={props.name()} />; }
    `);
    const [name, setName] = useSignal("one");
    const host = mountApp(() => mod.App({ name }));
    expect(host.textContent).toBe("one|one");
    flushSync(() => setName("two"));
    expect(host.textContent).toBe("two|two");
  });

  it("[SOLID-CF-16] components/props: splitProps divides props into groups plus the rest, reactively", async () => {
    const mod = await load<{
      Parent: (props: { name: string; age: number; extra: string }) => unknown;
    }>(`
      import { splitProps } from "@shadow-js/core";
      const Greeting = (props) => <span class="g">{props.name}</span>;
      const PersonalInfo = (props) => <span class="a">{props.age}</span>;
      export function Parent(props) {
        const [greetingProps, personalInfoProps, restProps] = splitProps(props, ["name"], ["age"]);
        return (
          <div>
            <Greeting {...greetingProps} />
            <PersonalInfo {...personalInfoProps} />
            <i>{restProps.extra}</i>
          </div>
        );
      }
    `);
    const [name, setName] = useSignal("Ann");
    const [age, setAge] = useSignal(30);
    const host = mountApp(() =>
      mod.Parent({
        get name() {
          return name();
        },
        get age() {
          return age();
        },
        extra: "rest",
      }),
    );
    expect(host.textContent).toBe("Ann30rest");
    flushSync(() => {
      setName("Bo");
      setAge(31);
    });
    expect(host.textContent).toBe("Bo31rest");
  });

  it("[SOLID-CF-17] components/props: the children helper creates children once however often it is read", async () => {
    const mod = await load<{
      ColoredList: (props: { children: unknown }) => unknown;
      Raw: (props: { children: unknown }) => unknown;
    }>(`
      import { children } from "@shadow-js/core";
      export function ColoredList(props) {
        const safeChildren = children(() => props.children);
        safeChildren();
        safeChildren();
        return <>{safeChildren()}</>;
      }
      export function Raw(props) {
        return <div>{props.children}{props.children}</div>;
      }
    `);
    const created: string[] = [];
    const Item = () => {
      created.push("item");
      return document.createElement("i");
    };
    const host = mountApp(() =>
      mod.ColoredList({
        get children() {
          return Item();
        },
      }),
    );
    expect(host.querySelectorAll("i").length).toBe(1);
    expect(created.length).toBe(1);
    // Reading props.children directly more than once creates the child once per read.
    created.length = 0;
    mountApp(() =>
      mod.Raw({
        get children() {
          return Item();
        },
      }),
    );
    expect(created.length).toBe(2);
  });

  it("[SOLID-CF-18] components/props: context avoids prop drilling", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      const Theme = createContext("light");
      function Deep() { return <b>{useContext(Theme)}</b>; }
      function Middle() { return <div><Deep /></div>; }
      export function App() { return <Theme value="dark"><Middle /></Theme>; }
    `);
    const host = mountApp(() => mod.App());
    expect(host.textContent).toBe("dark");
  });
});

describe("concepts/components/class-style", () => {
  it("[SOLID-CF-19] components/class-style: style accepts a string", async () => {
    const mod = await load<{ App: () => unknown }>(
      'export const App = () => <div style="color: red;">This is a red div</div>;',
    );
    const host = mountApp(() => mod.App());
    expect(host.querySelector("div")?.style.color).toBe("red");
  });

  it("[SOLID-CF-20] components/class-style: style accepts an object with dash-case keys", async () => {
    const mod = await load<{ App: () => unknown }>(
      'export const App = () => <div style={{ color: "red", "background-color": "blue" }}>x</div>;',
    );
    const el = mountApp(() => mod.App()).querySelector("div");
    expect(el?.style.color).toBe("red");
    expect(el?.style.getPropertyValue("background-color")).toBe("blue");
  });

  it("[SOLID-CF-21] components/class-style: ShadowJS also accepts camelCase keys and numbers in style objects", async () => {
    const mod = await load<{ App: () => unknown }>(
      "export const App = () => <div style={{ backgroundColor: 'blue', opacity: 0.5 }}>x</div>;",
    );
    const el = mountApp(() => mod.App()).querySelector("div");
    expect(el?.style.getPropertyValue("background-color")).toBe("blue");
    expect(el?.style.opacity).toBe("0.5");
  });

  it("[SOLID-CF-22] components/class-style: class follows a signal (dynamic styling)", async () => {
    const mod = await load<{ App: (props: { theme: () => string }) => unknown }>(`
      export const App = (props) => (
        <div class={props.theme() === "light" ? "light-theme" : "dark-theme"}>themed</div>
      );
    `);
    const [theme, setTheme] = useSignal("light");
    const el = mountApp(() => mod.App({ theme })).querySelector("div");
    expect(el?.className).toBe("light-theme");
    flushSync(() => setTheme("dark"));
    expect(el?.className).toBe("dark-theme");
  });

  it("[SOLID-CF-23] components/class-style: props change styles (ThemedButton)", async () => {
    const mod = await load<{ ThemedButton: (props: { theme: string }) => unknown }>(`
      export function ThemedButton(props) {
        return (
          <button class={props.theme}>
            {props.theme === "light" ? "Light Button" : "Dark Button"}
          </button>
        );
      }
    `);
    const host = mountApp(() => mod.ThemedButton({ theme: "light" }));
    const button = host.querySelector("button");
    expect(button?.className).toBe("light");
    expect(button?.textContent).toBe("Light Button");
  });

  it("[SOLID-CF-24] components/class-style: classList toggles a class from a boolean", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export function App() {
        const [current, setCurrent] = useSignal("bar");
        return (
          <div>
            <button classList={{ selected: current() === "foo" }} onClick={() => setCurrent("foo")}>foo</button>
          </div>
        );
      }
    `);
    const button = mountApp(() => mod.App()).querySelector("button");
    expect(button?.classList.contains("selected")).toBe(false);
    press(button);
    expect(button?.classList.contains("selected")).toBe(true);
  });

  it("[SOLID-CF-25] components/class-style: classList toggles only the classes that changed", async () => {
    const mod = await load<{ App: (props: { on: () => boolean }) => unknown }>(`
      export const App = (props) => <p classList={{ a: true, b: props.on() }}>x</p>;
    `);
    const [on, setOn] = useSignal(false);
    const p = mountApp(() => mod.App({ on })).querySelector("p");
    p?.classList.add("foreign");
    flushSync(() => setOn(true));
    expect(Array.from(p?.classList ?? []).sort()).toEqual(["a", "b", "foreign"]);
    flushSync(() => setOn(false));
    expect(Array.from(p?.classList ?? []).sort()).toEqual(["a", "foreign"]);
  });

  it("[SOLID-CF-26] components/class-style: a reactive class rewrites the attribute and drops classList classes", async () => {
    const mod = await load<{ App: (props: { base: () => string }) => unknown }>(`
      export const App = (props) => <p class={props.base()} classList={{ picked: true }}>x</p>;
    `);
    const [base, setBase] = useSignal("one");
    const p = mountApp(() => mod.App({ base })).querySelector("p");
    expect(Array.from(p?.classList ?? []).sort()).toEqual(["one", "picked"]);
    flushSync(() => setBase("two"));
    expect(p?.className).toBe("two");
  });

  it("[SOLID-CF-27] components/class-style: classList also works through a prop spread", async () => {
    const mod = await load<{ App: (props: { on: () => boolean }) => unknown }>(`
      export const App = (props) => {
        const attrs = { get classList() { return { active: props.on() }; } };
        return <p {...attrs}>x</p>;
      };
    `);
    const [on, setOn] = useSignal(true);
    const p = mountApp(() => mod.App({ on })).querySelector("p");
    expect(p?.classList.contains("active")).toBe(true);
    flushSync(() => setOn(false));
    expect(p?.classList.contains("active")).toBe(false);
  });
});

describe("concepts/components/event-handlers", () => {
  it("[SOLID-CF-28] components/event-handlers: onClick adds a delegated handler", async () => {
    const mod = await load<{ App: (props: { handleClick: () => void }) => unknown }>(
      "export const App = (props) => <button onClick={props.handleClick}>Click me</button>;",
    );
    let clicks = 0;
    const host = mountApp(() =>
      mod.App({
        handleClick: () => {
          clicks += 1;
        },
      }),
    );
    press(host.querySelector("button"));
    expect(clicks).toBe(1);
  });

  it("[SOLID-CF-29] components/event-handlers: on:scroll adds a native listener to the element", async () => {
    const mod = await load<{ App: (props: { handleScroll: () => void }) => unknown }>(
      "export const App = (props) => <div on:scroll={props.handleScroll}>... very long text ...</div>;",
    );
    let scrolls = 0;
    const host = mountApp(() =>
      mod.App({
        handleScroll: () => {
          scrolls += 1;
        },
      }),
    );
    host.querySelector("div")?.dispatchEvent(new Event("scroll"));
    expect(scrolls).toBe(1);
  });

  it("[SOLID-CF-30] components/event-handlers: delegated names are case-insensitive (onclick equals onClick)", async () => {
    const mod = await load<{ App: (props: { handleClick: () => void }) => unknown }>(
      "export const App = (props) => <button onclick={props.handleClick}>Click me</button>;",
    );
    let clicks = 0;
    const host = mountApp(() =>
      mod.App({
        handleClick: () => {
          clicks += 1;
        },
      }),
    );
    press(host.querySelector("button"));
    expect(clicks).toBe(1);
  });

  it("[SOLID-CF-31] components/event-handlers: on: event names are case sensitive", async () => {
    const mod = await load<{ App: (props: { handleClick: (e: Event) => void }) => unknown }>(
      "export const App = (props) => <button on:Custom-Event={props.handleClick}>Click me</button>;",
    );
    const seen: string[] = [];
    const host = mountApp(() =>
      mod.App({
        handleClick: (event: Event) => {
          seen.push(event.type);
        },
      }),
    );
    const button = host.querySelector("button");
    button?.dispatchEvent(new Event("custom-event"));
    expect(seen).toEqual([]);
    button?.dispatchEvent(new Event("Custom-Event"));
    expect(seen).toEqual(["Custom-Event"]);
  });

  it("[SOLID-CF-32] components/event-handlers: [handler, data] passes data as the first argument and the event second", async () => {
    const mod = await load<{
      App: (props: { handler: (data: unknown, event: Event) => void }) => unknown;
    }>(
      `export const App = (props) => <button onClick={[props.handler, "Hello!"]}>Click Me</button>;`,
    );
    const calls: Array<[unknown, string]> = [];
    const host = mountApp(() =>
      mod.App({
        handler: (data: unknown, event: Event) => {
          calls.push([data, event.type]);
        },
      }),
    );
    press(host.querySelector("button"));
    expect(calls).toEqual([["Hello!", "click"]]);
  });

  it("[SOLID-CF-33] components/event-handlers: event bindings are not reactive (a changed handler is ignored)", async () => {
    const mod = await load<{
      App: (props: { handler: () => () => void }) => unknown;
    }>("export const App = (props) => <button onClick={props.handler()}>go</button>;");
    const calls: string[] = [];
    const [handler, setHandler] = useSignal(() => {
      calls.push("first");
    });
    const host = mountApp(() => mod.App({ handler: () => handler() }));
    flushSync(() =>
      setHandler(() => () => {
        calls.push("second");
      }),
    );
    press(host.querySelector("button"));
    expect(calls).toEqual(["first"]);
  });

  it("[SOLID-CF-34] components/event-handlers: a handler can call a reactive prop at event time", async () => {
    const mod = await load<{ App: (props: { handleClick?: (() => void) | undefined }) => unknown }>(
      "export const App = (props) => <div onClick={() => props.handleClick?.()}>x</div>;",
    );
    const calls: string[] = [];
    const [fn, setFn] = useSignal<(() => void) | undefined>(undefined);
    const host = mountApp(() =>
      mod.App({
        get handleClick() {
          return fn();
        },
      }),
    );
    press(host.querySelector("div"));
    expect(calls).toEqual([]);
    flushSync(() =>
      setFn(() => () => {
        calls.push("late");
      }),
    );
    press(host.querySelector("div"));
    expect(calls).toEqual(["late"]);
  });

  it("[SOLID-CF-35] components/event-handlers: the delegated listener is added once per event type, on the document", async () => {
    const added: string[] = [];
    const original = document.addEventListener.bind(document);
    document.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type);
      return (original as (...args: unknown[]) => void)(type, ...rest);
    }) as typeof document.addEventListener;
    try {
      const mod = await load<{ App: () => unknown }>(
        "export const App = () => <div><i onTouchMove={() => 1}>a</i><i onTouchMove={() => 2}>b</i></div>;",
      );
      mountApp(() => mod.App());
      mountApp(() => mod.App());
    } finally {
      document.addEventListener = original as typeof document.addEventListener;
    }
    expect(added.filter((type) => type === "touchmove").length).toBeLessThanOrEqual(1);
  });

  it("[SOLID-CF-36] components/event-handlers: a delegated handler sees currentTarget as the bound element", async () => {
    const mod = await load<{ App: (props: { seen: unknown[] }) => unknown }>(
      "export const App = (props) => <div onClick={(e) => props.seen.push(e.currentTarget)}><b>x</b></div>;",
    );
    const seen: unknown[] = [];
    const host = mountApp(() => mod.App({ seen }));
    press(host.querySelector("b"));
    expect(seen).toEqual([host.querySelector("div")]);
  });

  it("[SOLID-CF-37] components/event-handlers: stopPropagation in a delegated handler does not stop a native ancestor listener", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      import { onMount } from "@shadow-js/core";
      export const App = (props) => {
        let ref;
        onMount(() => { ref.addEventListener("click", () => props.log.push("div native")); });
        return (
          <div ref={ref}>
            <button onClick={(event) => { event.stopPropagation(); props.log.push("button"); }}>button</button>
          </div>
        );
      };
    `);
    const log: string[] = [];
    const host = mountApp(() => mod.App({ log }));
    flushSync();
    press(host.querySelector("button"));
    expect(log).toEqual(["div native", "button"]);
  });

  it("[SOLID-CF-38] components/event-handlers: on:click with stopPropagation does stop the ancestor", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      import { onMount } from "@shadow-js/core";
      export const App = (props) => {
        let ref;
        onMount(() => { ref.addEventListener("click", () => props.log.push("div native")); });
        return (
          <div ref={ref}>
            <button on:click={(event) => { event.stopPropagation(); props.log.push("button"); }}>button</button>
          </div>
        );
      };
    `);
    const log: string[] = [];
    const host = mountApp(() => mod.App({ log }));
    flushSync();
    press(host.querySelector("button"));
    expect(log).toEqual(["button"]);
  });

  // DIFFERENCE from Solid (by design): Portal wraps nothing and follows DOM-tree event flow (ADR-029 excludes logical bubbling through portals), packages/web/src/control-flow/portal.ts:78-80; Solid propagates through the component tree.
  it("[SOLID-CF-39] components/event-handlers: events in a Portal propagate through the component tree (differs from Solid; ShadowJS: events follow the DOM tree, not the component tree)", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      import { Portal } from "@shadow-js/web";
      export const App = (props) => (
        <div class="container" onInput={() => props.log.push("portal key press")}>
          <Portal mount={document.body}>
            <input onInput={() => props.log.push("input key press")} />
          </Portal>
        </div>
      );
    `);
    const log: string[] = [];
    mountApp(() => mod.App({ log }));
    const input = document.body.querySelector("input");
    flushSync(() => {
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(log).toEqual(["input key press"]);
    input?.remove();
  });

  it("[SOLID-CF-40] components/event-handlers: the React spelling onChange follows every edit of a text input; onchange is the native change event", async () => {
    // Deliberate difference from Solid, where onChange is the native change event: see the React guide.
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      export const App = (props) => (
        <input
          onInput={() => props.log.push("input")}
          onChange={() => props.log.push("react-change")}
          onchange={() => props.log.push("native-change")}
        />
      );
    `);
    const log: string[] = [];
    const host = mountApp(() => mod.App({ log }));
    const input = host.querySelector("input");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(log).toEqual(["input", "react-change"]);
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(log).toEqual(["input", "react-change", "native-change"]);
  });

  it("[SOLID-CF-41] components/event-handlers: Solid's delegated event list is delegated, except four over/out events", async () => {
    const events = [
      "beforeinput",
      "click",
      "dblclick",
      "contextmenu",
      "focusin",
      "focusout",
      "input",
      "keydown",
      "keyup",
      "mousedown",
      "mousemove",
      "mouseup",
      "pointerdown",
      "pointermove",
      "pointerup",
      "touchend",
      "touchmove",
      "touchstart",
    ];
    const attrs = events
      .map((name) => `on${name.charAt(0).toUpperCase()}${name.slice(1)}={() => 1}`)
      .join(" ");
    const mod = await load<{ App: () => unknown }>(
      `export const App = () => <div ${attrs}>x</div>;`,
    );
    const el = mountApp(() => mod.App()).querySelector("div");
    const delegated = events.filter(
      (name) => typeof Reflect.get(el ?? {}, `$$${name}`) === "function",
    );
    expect(delegated).toEqual(events);
  });

  it("[SOLID-CF-42] components/event-handlers: mouseover, mouseout, pointerover and pointerout are delegated", async () => {
    const events = ["mouseover", "mouseout", "pointerover", "pointerout"];
    const attrs = events
      .map((name) => `on${name.charAt(0).toUpperCase()}${name.slice(1)}={() => 1}`)
      .join(" ");
    const mod = await load<{ App: () => unknown }>(
      `export const App = () => <div ${attrs}>x</div>;`,
    );
    const el = mountApp(() => mod.App()).querySelector("div");
    const delegated = events.filter(
      (name) => typeof Reflect.get(el ?? {}, `$$${name}`) === "function",
    );
    expect(delegated).toEqual(events);
  });

  it("[SOLID-CF-43] components/event-handlers: delegated handlers of a removed element no longer run", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      import { Show } from "@shadow-js/web";
      export const App = (props) => (
        <Show when={props.on()}>
          <div onMouseMove={() => props.log.push("move")}>x</div>
        </Show>
      );
    `);
    const [on, setOn] = useSignal(true);
    const log: string[] = [];
    const host = mountApp(() => mod.App({ log, on } as unknown as { log: string[] }));
    const div = host.querySelector("div");
    div?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    flushSync(() => setOn(false));
    div?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(log).toEqual(["move"]);
  });
});
