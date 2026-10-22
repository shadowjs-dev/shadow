import {
  children,
  createContext,
  createRoot,
  flushSync,
  indexArray,
  mapArray,
  onCleanup,
  type Resource,
  useContext,
  useEffect,
  useId,
  useResource,
  useSignal,
} from "@shadow-js/core";
import { useStore } from "@shadow-js/core/store";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "../support/compile";

const disposers: Array<() => void> = [];
const hosts: HTMLElement[] = [];

/** Runs `fn` in a root that the afterEach hook disposes. */
function inRoot<T>(fn: () => T): T {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return fn();
  });
}

/** Renders `view` into a fresh host that the afterEach hook cleans up. */
function mountApp(view: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  disposers.push(render(view, host));
  return host;
}

/** Lets promise callbacks run, then drains effects. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  flushSync();
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function logOf(mod: object, name = "log"): string[] {
  const value: unknown = Reflect.get(mod, name);
  if (!Array.isArray(value)) throw new TypeError(`module export ${name} is not an array`);
  return value as string[];
}

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  for (const host of hosts.splice(0)) host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("component-apis/children", () => {
  it("[SOLID-UT-119] component-apis/children: Wrapper renders the resolved children (basic usage, JSX)", async () => {
    const mod = await load<{ Example: () => unknown }>(`
      import { children } from "@shadow-js/core";
      function Wrapper(props) {
        const resolved = children(() => props.children);
        return <div>{resolved()}</div>;
      }
      export function Example() {
        return <Wrapper><span>First</span><span>Second</span></Wrapper>;
      }
    `);
    const host = mountApp(() => mod.Example());
    expect(host.innerHTML).toBe("<div><span>First</span><span>Second</span></div>");
  });

  it("[SOLID-UT-120] component-apis/children: toArray() flattens the children into an array (List example, JSX)", async () => {
    const mod = await load<{ Example: () => unknown }>(`
      import { children } from "@shadow-js/core";
      function List(props) {
        const resolved = children(() => props.children);
        return <ul>{resolved.toArray().map((child) => <li>{child}</li>)}</ul>;
      }
      export function Example() {
        return <List><span>Alpha</span><span>Beta</span></List>;
      }
    `);
    const host = mountApp(() => mod.Example());
    expect(host.innerHTML).toBe("<ul><li><span>Alpha</span></li><li><span>Beta</span></li></ul>");
  });

  it("[SOLID-UT-121] component-apis/children: the accessor is memoized, children are created once", async () => {
    const mod = await load<{ Example: () => unknown; log: string[] }>(`
      import { children } from "@shadow-js/core";
      export const log = [];
      function Probe() { log.push("created"); return <b>probe</b>; }
      function Wrapper(props) {
        const resolved = children(() => props.children);
        resolved(); resolved(); resolved.toArray();
        return <div>{resolved()}</div>;
      }
      export function Example() { return <Wrapper><Probe /></Wrapper>; }
    `);
    mountApp(() => mod.Example());
    expect(logOf(mod)).toEqual(["created"]);
  });

  it("[SOLID-UT-122] component-apis/children: resolves nested arrays and zero-argument accessors; drops null, undefined and booleans", () => {
    inRoot(() => {
      const resolved = children(() => [
        ["a", () => "b"],
        null,
        false,
        undefined,
        [() => () => "c"],
      ]);
      expect(resolved.toArray()).toEqual(["a", "b", "c"]);
      expect(resolved()).toEqual(["a", "b", "c"]);
    });
  });

  it("[SOLID-UT-123] component-apis/children: toArray() is [] for null or undefined, and the accessor is undefined", () => {
    inRoot(() => {
      const none = children(() => undefined);
      const empty = children(() => null);
      expect(none.toArray()).toEqual([]);
      expect(empty.toArray()).toEqual([]);
      expect(none()).toBeUndefined();
    });
  });

  it("[SOLID-UT-124] component-apis/children: a single child is returned as itself, several as an array", () => {
    inRoot(() => {
      expect(children(() => "only")()).toBe("only");
      expect(children(() => ["x", "y"])()).toEqual(["x", "y"]);
    });
  });

  it("[SOLID-UT-125] component-apis/children: re-resolves when a signal read inside the children accessor changes", () => {
    const [which, setWhich] = useSignal("a");
    inRoot(() => {
      const resolved = children(() => (which() === "a" ? ["a1", "a2"] : ["b1"]));
      expect(resolved.toArray()).toEqual(["a1", "a2"]);
      setWhich("b");
      expect(resolved.toArray()).toEqual(["b1"]);
    });
  });
});

describe("component-apis/create-context and use-context", () => {
  it("[SOLID-UT-126] component-apis/create-context: defaultValue is returned when there is no provider", () => {
    const ThemeContext = createContext<"light" | "dark">("light");
    inRoot(() => {
      expect(useContext(ThemeContext)).toBe("light");
    });
    expect(ThemeContext.defaultValue).toBe("light");
    expect(typeof ThemeContext.id).toBe("symbol");
  });

  // GAP: Solid's context object has a `.Provider` component (`<CounterContext.Provider value=...>`). In ShadowJS the
  // context object is itself the provider and has no `Provider` member (packages/core/src/context.ts:25-52).
  it("[SOLID-UT-127] component-apis/create-context: Context.Provider passes value to descendants (CounterProvider, JSX)", async () => {
    const mod = await load<{ CounterProvider: (props: { children?: unknown }) => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      const CounterContext = createContext({ count: 0 });
      function Reader() { return <span>{useContext(CounterContext).count}</span>; }
      export function CounterProvider() {
        return <CounterContext.Provider value={{ count: 1 }}><Reader /></CounterContext.Provider>;
      }
    `);
    const host = mountApp(() => mod.CounterProvider({}));
    expect(host.textContent).toBe("1");
  });

  it("[SOLID-UT-128] component-apis/create-context: the context component itself provides the value (ShadowJS form of Provider, JSX)", async () => {
    const mod = await load<{ CounterProvider: () => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      const CounterContext = createContext({ count: 0 });
      function Reader() { return <span>{useContext(CounterContext).count}</span>; }
      export function CounterProvider() {
        return <CounterContext value={{ count: 1 }}><Reader /></CounterContext>;
      }
    `);
    const host = mountApp(() => mod.CounterProvider());
    expect(host.textContent).toBe("1");
  });

  it("[SOLID-UT-129] component-apis/use-context: reads the nearest provider in the owner tree", () => {
    const Theme = createContext("none");
    let seen: string[] = [];
    inRoot(() => {
      Theme({
        value: "outer",
        get children() {
          const outer = useContext(Theme);
          const inner = Theme({
            value: "inner",
            get children() {
              return useContext(Theme);
            },
          }) as () => unknown;
          seen = [outer, String(inner())];
          return null;
        },
      });
    });
    expect(seen).toEqual(["outer", "inner"]);
  });

  it("[SOLID-UT-130] component-apis/create-context: options.name labels the context id", () => {
    const Named = createContext(1, { name: "Counter" });
    expect(Named.id.description).toBe("Counter");
  });

  it("[SOLID-UT-131] component-apis/use-context: with no provider and no default, useContext throws (ShadowJS decision)", () => {
    const CounterContext = createContext<number>();
    inRoot(() => {
      expect(() => useContext(CounterContext)).toThrow(/CONTEXT_MISSING/);
    });
  });

  // DIFFERENCE from Solid (by design): Solid returns undefined from useContext when there is no provider and no default value. ShadowJS throws
  // ShadowError CONTEXT_MISSING (packages/core/src/context.ts:63).
  it("[SOLID-UT-132] component-apis/use-context: without a provider or default value, useContext returns undefined (differs from Solid; ShadowJS: throws CONTEXT_MISSING)", () => {
    const CounterContext = createContext<number>();
    inRoot(() => {
      let error: unknown;
      try {
        useContext(CounterContext);
      } catch (thrown) {
        error = thrown;
      }
      expect((error as { code?: string } | undefined)?.code).toBe("CONTEXT_MISSING");
    });
  });

  it("[SOLID-UT-133] component-apis/use-context: a useCounterContext helper that throws when the provider is missing (doc example)", () => {
    const CounterContext = createContext<number>();
    function useCounterContext() {
      const context = useContext(CounterContext);
      if (context === undefined) {
        throw new Error("CounterContext is missing");
      }
      return context;
    }
    inRoot(() => {
      expect(() => useCounterContext()).toThrow();
      const value = CounterContext({
        value: 3,
        get children() {
          return useCounterContext();
        },
      }) as () => unknown;
      expect(value()).toBe(3);
    });
  });

  // DIFFERENCE from Solid (by design): Solid treats a provider value of undefined like a missing provider and returns the default. ShadowJS returns
  // the provided undefined (packages/core/src/context.ts:62, `context.id in map`).
  it("[SOLID-UT-134] component-apis/use-context: a provider value of undefined falls back to the default value (differs from Solid; ShadowJS: a provided undefined is the value)", () => {
    const CounterContext = createContext<number | undefined>(5);
    inRoot(() => {
      const value = CounterContext({
        value: undefined,
        get children() {
          return useContext(CounterContext);
        },
      }) as () => unknown;
      expect(value()).toBeUndefined();
    });
  });

  it("[SOLID-UT-135] component-apis/create-context: the provider value is read once; provide an accessor for reactive state", () => {
    const [count, setCount] = useSignal(1);
    const CountContext = createContext<() => number>(() => 0);
    inRoot(() => {
      const provided = CountContext({
        value: count,
        get children() {
          return useContext(CountContext);
        },
      }) as () => () => number;
      expect(provided()()).toBe(1);
      setCount(2);
      expect(provided()()).toBe(2);
    });
  });
});

describe("component-apis/create-unique-id", () => {
  it("[SOLID-UT-136] component-apis/create-unique-id: Input uses props.id ?? useId() for label and input (doc example, JSX)", async () => {
    const mod = await load<{ Input: (props: { id?: string; label: string }) => unknown }>(`
      import { useId } from "@shadow-js/core";
      export function Input(props) {
        const inputId = props.id ?? useId();
        return (
          <>
            <label for={inputId}>{props.label}</label>
            <input id={inputId} />
          </>
        );
      }
    `);
    const generated = mountApp(() => mod.Input({ label: "Name" }));
    const label = generated.querySelector("label");
    const input = generated.querySelector("input");
    expect(input?.id).not.toBe("");
    expect(label?.getAttribute("for")).toBe(input?.id);
    const explicit = mountApp(() => mod.Input({ id: "mine", label: "Other" }));
    expect(explicit.querySelector("input")?.id).toBe("mine");
  });

  it("[SOLID-UT-137] component-apis/create-unique-id: every call returns a different string", () => {
    inRoot(() => {
      const ids = [useId(), useId(), useId()];
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(typeof id).toBe("string");
    });
  });

  it("[SOLID-UT-138] component-apis/create-unique-id: ids differ between sibling owners", () => {
    inRoot(() => {
      const a = createRoot(() => useId());
      const b = createRoot(() => useId());
      expect(a).not.toBe(b);
    });
  });

  it("[SOLID-UT-139] component-apis/create-unique-id: the same call order yields the same ids in separate renders (hydration match)", () => {
    const collect = (): string[] => {
      const ids: string[] = [];
      const dispose = render(() => {
        ids.push(useId(), useId());
        return null;
      }, document.createElement("div"));
      dispose();
      return ids;
    };
    expect(collect()).toEqual(collect());
  });

  it("[SOLID-UT-140] component-apis/create-unique-id: useId outside an owner throws (ShadowJS decision)", () => {
    expect(() => useId()).toThrow(/NO_OWNER_ID/);
  });
});

describe("component-apis/lazy", () => {
  async function appFor(loader: () => Promise<{ default: unknown }>) {
    const mod = await load<{
      makeApp: (loader: () => Promise<{ default: unknown }>) => {
        App: (props: { title: string }) => unknown;
        Lazy: { preload: () => Promise<unknown> };
      };
      Loaded: (props: { title: string }) => unknown;
    }>(`
      import { lazy, Suspense } from "@shadow-js/web";
      export function Loaded(props) { return <h1>{props.title}</h1>; }
      export function makeApp(loader) {
        const Lazy = lazy(loader);
        function App(props) {
          return <Suspense fallback={<p>Loading...</p>}><Lazy title={props.title} /></Suspense>;
        }
        return { App, Lazy };
      }
    `);
    return { ...mod.makeApp(loader), Loaded: mod.Loaded };
  }

  it("[SOLID-UT-141] component-apis/lazy: Suspense shows the fallback while loading, then the component with its props", async () => {
    const gate = deferred<{ default: unknown }>();
    const { App, Loaded } = await appFor(() => gate.promise);
    const host = mountApp(() => App({ title: "Hello" }));
    expect(host.innerHTML).toBe("<p>Loading...</p>");
    gate.resolve({ default: Loaded });
    await settle();
    expect(host.innerHTML).toBe("<h1>Hello</h1>");
  });

  it("[SOLID-UT-142] component-apis/lazy: without a Suspense boundary the lazy component renders nothing until it resolves", async () => {
    const gate = deferred<{ default: unknown }>();
    const { Lazy, Loaded } = await appFor(() => gate.promise);
    const host = mountApp(() =>
      (Lazy as unknown as (props: { title: string }) => unknown)({ title: "Bare" }),
    );
    expect(host.textContent).toBe("");
    gate.resolve({ default: Loaded });
    await settle();
    expect(host.textContent).toBe("Bare");
  });

  it("[SOLID-UT-143] component-apis/lazy: preload() starts loading without rendering and the loader runs once", async () => {
    let calls = 0;
    const gate = deferred<{ default: unknown }>();
    const { App, Lazy, Loaded } = await appFor(() => {
      calls += 1;
      return gate.promise;
    });
    void Lazy.preload();
    expect(calls).toBe(1);
    gate.resolve({ default: Loaded });
    await settle();
    const host = mountApp(() => App({ title: "After preload" }));
    await settle();
    expect(host.innerHTML).toBe("<h1>After preload</h1>");
    expect(calls).toBe(1);
  });

  // DIFFERENCE from Solid (by design): Solid's preload() resolves to the loaded module ({ default: Component }). ShadowJS preload() resolves to the
  // component function itself (packages/web/src/control-flow/lazy.ts:8, `Promise<ComponentFunction<P>>`).
  it("[SOLID-UT-144] component-apis/lazy: preload() resolves to the module object (differs from Solid; ShadowJS: preload() resolves to the component)", async () => {
    function Preloaded(props: { title: string }) {
      return props.title;
    }
    const { Lazy } = await appFor(() => Promise.resolve({ default: Preloaded }));
    expect(await Lazy.preload()).toBe(Preloaded);
  });

  it("[SOLID-UT-145] component-apis/lazy: preloading nested lazy components on hover, shown on click (doc example, JSX)", async () => {
    const mod = await load<{
      make: (loader: () => Promise<{ default: unknown }>) => () => unknown;
      Nested: () => unknown;
    }>(`
      import { lazy, Suspense, Show } from "@shadow-js/web";
      import { useSignal } from "@shadow-js/core";
      export function Nested() { return <em>nested loaded</em>; }
      export function make(loader) {
        const LazyNested = lazy(loader);
        return function ComponentWithPreload() {
          const [showNested, setShowNested] = useSignal(false);
          return (
            <div>
              <button on:mouseenter={() => LazyNested.preload()} onClick={() => setShowNested(true)}>
                Preload Nested Component
              </button>
              <Show when={showNested()}>
                <Suspense fallback={<p>Loading nested component...</p>}>
                  <LazyNested />
                </Suspense>
              </Show>
            </div>
          );
        };
      }
    `);
    let calls = 0;
    const gate = deferred<{ default: unknown }>();
    const Component = mod.make(() => {
      calls += 1;
      return gate.promise;
    });
    const host = mountApp(() => Component());
    const button = host.querySelector("button");
    button?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(calls).toBe(1);
    gate.resolve({ default: mod.Nested });
    await settle();
    button?.click();
    await settle();
    expect(host.querySelector("em")?.textContent).toBe("nested loaded");
    expect(calls).toBe(1);
  });

  it("[SOLID-UT-146] component-apis/lazy: a lazy component keeps receiving reactive props after it loads", async () => {
    const gate = deferred<{ default: unknown }>();
    const { App, Loaded } = await appFor(() => gate.promise);
    const [title, setTitle] = useSignal("one");
    const host = mountApp(() =>
      App({
        get title() {
          return title();
        },
      }),
    );
    gate.resolve({ default: Loaded });
    await settle();
    expect(host.textContent).toBe("one");
    setTitle("two");
    flushSync();
    expect(host.textContent).toBe("two");
  });
});

describe("guides/state-management", () => {
  it("[SOLID-UT-147] guides/state-management: Counter increments through the setter updater and re-renders only the text (JSX)", async () => {
    const mod = await load<{ Counter: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export function Counter() {
        const [count, setCount] = useSignal(0);
        const increment = () => { setCount((prev) => prev + 1); };
        return (
          <>
            <div>Current count: {count()}</div>
            <button onClick={increment}>Increment</button>
          </>
        );
      }
    `);
    const host = mountApp(() => mod.Counter());
    const div = host.querySelector("div");
    expect(div?.textContent).toBe("Current count: 0");
    host.querySelector("button")?.click();
    flushSync();
    expect(host.querySelector("div")).toBe(div);
    expect(div?.textContent).toBe("Current count: 1");
  });

  it("[SOLID-UT-148] guides/state-management: a signal getter returns the current value and the updater sets the next (code snippets)", () => {
    const [count, setCount] = useSignal(0);
    expect(count()).toBe(0);
    setCount((prev) => prev + 1);
    expect(count()).toBe(1);
  });

  it("[SOLID-UT-149] guides/state-management: an effect keeps doubleCount in sync with count (JSX)", async () => {
    const mod = await load<{ Counter: () => unknown }>(`
      import { useSignal, useEffect } from "@shadow-js/core";
      export function Counter() {
        const [count, setCount] = useSignal(0);
        const [doubleCount, setDoubleCount] = useSignal(0);
        const increment = () => { setCount((prev) => prev + 1); };
        useEffect(() => { setDoubleCount(count() * 2); });
        return (
          <>
            <div>Current count: {count()}</div>
            <div>Doubled count: {doubleCount()}</div>
            <button onClick={increment}>Increment</button>
          </>
        );
      }
    `);
    const host = mountApp(() => mod.Counter());
    flushSync();
    expect(host.textContent).toContain("Current count: 0Doubled count: 0");
    host.querySelector("button")?.click();
    flushSync();
    expect(host.textContent).toContain("Current count: 1Doubled count: 2");
  });

  it("[SOLID-UT-150] guides/state-management: a derived signal re-evaluates per use while a memo evaluates once (JSX)", async () => {
    const mod = await load<{ Counter: () => unknown; log: string[] }>(`
      import { useSignal, useMemo } from "@shadow-js/core";
      export const log = [];
      export function Counter() {
        const [count, setCount] = useSignal(0);
        const increment = () => { setCount((prev) => prev + 1); };
        const doubleCount = () => { log.push("doubleCount called"); return count() * 2; };
        const doubleCountMemo = useMemo(() => { log.push("doubleCountMemo called"); return count() * 2; });
        return (
          <>
            <div>{count()}</div>
            <div>{doubleCount()}</div>
            <div>{doubleCount()}</div>
            <div>{doubleCount()}</div>
            <div>{doubleCountMemo()}</div>
            <div>{doubleCountMemo()}</div>
            <div>{doubleCountMemo()}</div>
            <button onClick={increment}>Increment</button>
          </>
        );
      }
    `);
    const host = mountApp(() => mod.Counter());
    flushSync();
    const log = logOf(mod);
    expect(log.filter((entry) => entry === "doubleCountMemo called")).toHaveLength(1);
    expect(log.filter((entry) => entry === "doubleCount called")).toHaveLength(3);
    log.length = 0;
    host.querySelector("button")?.click();
    flushSync();
    expect(log.filter((entry) => entry === "doubleCountMemo called")).toHaveLength(1);
    expect(log.filter((entry) => entry === "doubleCount called")).toHaveLength(3);
    expect(host.querySelectorAll("div")[6]?.textContent).toBe("2");
  });

  it("[SOLID-UT-151] guides/state-management: lifting state, children read props and call the parent's setter (JSX)", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal, useEffect, useMemo } from "@shadow-js/core";
      export function App() {
        const [count, setCount] = useSignal(0);
        const [doubleCount, setDoubleCount] = useSignal(0);
        const squaredCount = useMemo(() => count() * count());
        useEffect(() => { setDoubleCount(count() * 2); });
        return (
          <>
            <Counter count={count()} setCount={setCount} />
            <DisplayCounts count={count()} doubleCount={doubleCount()} squaredCount={squaredCount()} />
          </>
        );
      }
      function Counter(props) {
        const increment = () => { props.setCount((prev) => prev + 1); };
        return <button onClick={increment}>Increment</button>;
      }
      function DisplayCounts(props) {
        return (
          <div>
            <div>Current count: {props.count}</div>
            <div>Doubled count: {props.doubleCount}</div>
            <div>Squared count: {props.squaredCount}</div>
          </div>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    flushSync();
    host.querySelector("button")?.click();
    flushSync();
    host.querySelector("button")?.click();
    flushSync();
    const lines = Array.from(host.querySelector("div")?.children ?? [], (node) => node.textContent);
    expect(lines).toEqual(["Current count: 2", "Doubled count: 4", "Squared count: 4"]);
  });
});

describe("guides/complex-state-management", () => {
  async function signalTaskList() {
    return load<{ default: () => unknown; log: string[] }>(`
      import { For } from "@shadow-js/web";
      import { useSignal, useMemo } from "@shadow-js/core";
      export const log = [];
      const App = () => {
        const [tasks, setTasks] = useSignal([]);
        const [numberOfTasks, setNumberOfTasks] = useSignal(0);
        const completedTasks = useMemo(() => tasks().filter((task) => task.completed));
        let input;
        const addTask = (text) => {
          setTasks([...tasks(), { id: tasks().length, text, completed: false }]);
          setNumberOfTasks(numberOfTasks() + 1);
        };
        const toggleTask = (id) => {
          setTasks(tasks().map((task) => task.id !== id ? task : { ...task, completed: !task.completed }));
        };
        return (
          <>
            <h1>My list</h1>
            <span>You have {numberOfTasks()} task(s) today!</span>
            <div>
              <input ref={input} />
              <button onClick={(e) => {
                if (!input.value.trim()) return;
                addTask(input.value);
                input.value = "";
              }}>Add Task</button>
            </div>
            <p>done: {completedTasks().length}</p>
            <For each={tasks()}>
              {(task) => {
                const { id, text } = task;
                log.push("Creating " + text);
                return (
                  <div class="task">
                    <input type="checkbox" checked={task.completed} onChange={[toggleTask, id]} />
                    <span style={{ "text-decoration": task.completed ? "line-through" : "none" }}>{text}</span>
                  </div>
                );
              }}
            </For>
          </>
        );
      };
      export default App;
    `);
  }

  it("[SOLID-UT-152] guides/complex-state-management: the signal-based task list adds and toggles tasks (JSX)", async () => {
    const mod = await signalTaskList();
    const host = mountApp(() => mod.default());
    const input = host.querySelector("input");
    const add = host.querySelector("button");
    if (input === null || add === null) throw new Error("task list did not render");
    input.value = "write docs";
    add.click();
    flushSync();
    expect(host.querySelector("span")?.textContent).toBe("You have 1 task(s) today!");
    expect(host.querySelectorAll(".task")).toHaveLength(1);
    const box = host.querySelector<HTMLInputElement>(".task input");
    if (box === null) throw new Error("checkbox missing");
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(host.querySelector(".task span")?.getAttribute("style")).toContain("line-through");
    expect(host.querySelector("p")?.textContent).toBe("done: 1");
    expect(logOf(mod)).toEqual(["Creating write docs", "Creating write docs"]);
  });

  async function storeTaskList(each: string) {
    return load<{ default: () => unknown }>(
      `
      import { For } from "@shadow-js/web";
      import { useEffect } from "@shadow-js/core";
      import { useStore } from "@shadow-js/core/store";
      const App = () => {
        let input;
        const [state, setState] = useStore({ tasks: [], numberOfTasks: 0 });
        const addTask = (text) => {
          setState((draft) => { draft.tasks.push({ id: state.tasks.length, text, completed: false }); });
        };
        const toggleTask = (id) => {
          setState((draft) => {
            const task = draft.tasks.find((candidate) => candidate.id === id);
            task.completed = !task.completed;
          });
        };
        useEffect(() => {
          const length = state.tasks.length;
          setState((draft) => { draft.numberOfTasks = length; });
        });
        return (
          <>
            <div>
              <h1>My Task List for Today</h1>
              <span>You have {state.numberOfTasks} task(s) for today!</span>
            </div>
            <input ref={input} />
            <button onClick={(e) => {
              if (!input.value.trim()) return;
              addTask(input.value);
              input.value = "";
            }}>Add Task</button>
            <For each={EACH}>
              {(task) => {
                const { id, text } = task;
                return (
                  <div class="task">
                    <input type="checkbox" checked={task.completed} onChange={() => toggleTask(task.id)} />
                    <span>{text}</span>
                  </div>
                );
              }}
            </For>
          </>
        );
      };
      export default App;
    `.replace("EACH", each),
    );
  }

  async function exerciseStoreTaskList(each: string): Promise<void> {
    const mod = await storeTaskList(each);
    const host = mountApp(() => mod.default());
    flushSync();
    const input = host.querySelector("input");
    const add = host.querySelector("button");
    if (input === null || add === null) throw new Error("task list did not render");
    for (const text of ["one", "two"]) {
      input.value = text;
      add.click();
      flushSync();
    }
    expect(host.querySelector("span")?.textContent).toBe("You have 2 task(s) for today!");
    expect(Array.from(host.querySelectorAll(".task span"), (node) => node.textContent)).toEqual([
      "one",
      "two",
    ]);
    const second = host.querySelectorAll<HTMLInputElement>(".task input")[1];
    if (second === undefined) throw new Error("second checkbox missing");
    const row = second.parentElement;
    second.checked = true;
    second.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(host.querySelectorAll(".task")[1]).toBe(row);
    expect(host.querySelectorAll<HTMLInputElement>(".task input")[1]?.checked).toBe(true);
  }

  // GAP: <For each={state.tasks}> does not re-render when the store array is mutated in place (push). mapArray/For read
  // the list inside an untracked toEntries() (packages/core/src/list.ts, `untrack(() => toEntries(items, keying))`), so
  // only the "tasks" property is tracked, never the array's length or indices.
  // GAP: <For each={state.tasks}> does not re-render when the store array is mutated in place (push). mapArray/For read
  // the list inside an untracked toEntries() (packages/core/src/list.ts, `untrack(() => toEntries(items, keying))`), so
  // only the "tasks" property is tracked, never the array's length or indices.
  it("[SOLID-UT-153] guides/complex-state-management: the store-based task list renders rows with <For each={state.tasks}> (JSX)", async () => {
    await exerciseStoreTaskList("state.tasks");
  });

  it("[SOLID-UT-168] guides/complex-state-management: the same task list works when the array is read through a spread, each={[...state.tasks]} (JSX)", async () => {
    await exerciseStoreTaskList("[...state.tasks]");
  });

  it("[SOLID-UT-154] guides/complex-state-management: setting a store value in the component body works without a tracking scope", () => {
    const [state, setState] = useStore({
      tasks: [{ id: 0, text: "a", completed: false }],
      numberOfTasks: 0,
    });
    setState((draft) => {
      draft.numberOfTasks = state.tasks.length;
    });
    expect(state.numberOfTasks).toBe(1);
  });

  type Task = { id: number; text: string; completed: boolean };

  // GAP: the guide appends and toggles with path syntax: setState("tasks", state.tasks.length, {...}) and
  // setState("tasks", (task) => task.id === id, "completed", true). ShadowJS setStore accepts only a draft function or a
  // reconcile() result and throws TypeError otherwise (packages/core/src/store/use-store.ts:42-46).
  it("[SOLID-UT-155] guides/complex-state-management: path-syntax setState appends by index and toggles by predicate", () => {
    const [state, setState] = useStore<{ tasks: Task[]; numberOfTasks: number }>({
      tasks: [],
      numberOfTasks: 0,
    });
    const setPath = setState as unknown as (...path: unknown[]) => void;
    setPath("tasks", state.tasks.length, { id: 0, text: "a", completed: false });
    setPath("tasks", (task: Task) => task.id === 0, "completed", true);
    expect(state.tasks[0]?.completed).toBe(true);
  });

  it("[SOLID-UT-156] guides/complex-state-management: store plus context shares state without prop drilling (JSX)", async () => {
    const mod = await load<{ TaskApp: () => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      import { useStore } from "@shadow-js/core/store";
      const TaskContext = createContext();
      const TaskList = () => {
        const { state, setState } = useContext(TaskContext);
        return (
          <div>
            <span>{state.numberOfTasks}</span>
            <button onClick={() => setState((draft) => { draft.numberOfTasks += 1; })}>more</button>
          </div>
        );
      };
      export const TaskApp = () => {
        const [state, setState] = useStore({ tasks: [], numberOfTasks: 0 });
        return <TaskContext value={{ state, setState }}><TaskList /></TaskContext>;
      };
    `);
    const host = mountApp(() => mod.TaskApp());
    expect(host.querySelector("span")?.textContent).toBe("0");
    host.querySelector("button")?.click();
    flushSync();
    expect(host.querySelector("span")?.textContent).toBe("1");
  });
});

describe("guides/fetching-data", () => {
  function stubFetch(handler: (url: string) => Promise<unknown>) {
    const fetchMock = vi.fn((url: string) =>
      handler(url).then((body) => ({ json: () => Promise.resolve(body) })),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function userApp() {
    return load<{ App: () => unknown }>(`
      import { useSignal, useResource } from "@shadow-js/core";
      import { Switch, Match, Show } from "@shadow-js/web";
      const fetchUser = async (id) => {
        const response = await fetch("https://swapi.dev/api/people/" + id + "/");
        return response.json();
      };
      export function App() {
        const [userId, setUserId] = useSignal();
        const user = useResource(userId, fetchUser);
        return (
          <div>
            <input type="number" min="1" placeholder="Enter Numeric Id"
              onInput={(e) => setUserId(e.currentTarget.value)} />
            <Show when={user.loading}><p>Loading...</p></Show>
            <Switch>
              <Match when={user.error}><span>Error: {String(user.error)}</span></Match>
              <Match when={user()}><div class="out">{JSON.stringify(user())}</div></Match>
            </Switch>
          </div>
        );
      }
    `);
  }

  function typeId(host: HTMLElement, value: string): void {
    const input = host.querySelector("input");
    if (input === null) throw new Error("input missing");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  }

  it("[SOLID-UT-157] guides/fetching-data: resource driven by a source signal shows loading, then the data (Show + Switch/Match, JSX)", async () => {
    const gate = deferred<unknown>();
    const fetchMock = stubFetch(() => gate.promise);
    const mod = await userApp();
    const host = mountApp(() => mod.App());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector("p")).toBeNull();
    typeId(host, "1");
    expect(fetchMock).toHaveBeenCalledWith("https://swapi.dev/api/people/1/");
    expect(host.querySelector("p")?.textContent).toBe("Loading...");
    gate.resolve({ name: "Luke" });
    await settle();
    expect(host.querySelector("p")).toBeNull();
    expect(host.querySelector(".out")?.textContent).toBe('{"name":"Luke"}');
  });

  it("[SOLID-UT-158] guides/fetching-data: a failing fetch is shown through user.error (JSX)", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    const mod = await userApp();
    const host = mountApp(() => mod.App());
    typeId(host, "2");
    await settle();
    expect(host.querySelector("span")?.textContent).toBe("Error: Error: offline");
    expect(host.querySelector("p")).toBeNull();
  });

  it("[SOLID-UT-159] guides/fetching-data: Suspense shows its fallback for a resource read inside it (JSX)", async () => {
    const gate = deferred<unknown>();
    stubFetch(() => gate.promise);
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal, useResource } from "@shadow-js/core";
      import { Switch, Match, Suspense } from "@shadow-js/web";
      const fetchUser = async (id) => {
        const response = await fetch("https://swapi.dev/api/people/" + id + "/");
        return response.json();
      };
      export function App() {
        const [userId, setUserId] = useSignal();
        const user = useResource(userId, fetchUser);
        return (
          <div>
            <input type="number" onInput={(e) => setUserId(e.currentTarget.value)} />
            <Suspense fallback={<div class="fb">Loading...</div>}>
              <Switch>
                <Match when={user.error}><span>Error: {user.error.message}</span></Match>
                <Match when={user()}><div class="out">{JSON.stringify(user())}</div></Match>
              </Switch>
            </Suspense>
          </div>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    expect(host.querySelector(".fb")).toBeNull();
    typeId(host, "3");
    expect(host.querySelector(".fb")?.textContent).toBe("Loading...");
    gate.resolve({ name: "Leia" });
    await settle();
    expect(host.querySelector(".fb")).toBeNull();
    expect(host.querySelector(".out")?.textContent).toBe('{"name":"Leia"}');
  });

  it("[SOLID-UT-160] guides/fetching-data: resource fields state, loading, error and latest", async () => {
    const gate = deferred<string>();
    const [id, setId] = useSignal<number | undefined>(undefined);
    let user!: Resource<string>;
    inRoot(() => {
      user = useResource(id, () => gate.promise);
    });
    expect(user.state).toBe("unresolved");
    expect(user.loading).toBe(false);
    setId(1);
    flushSync();
    expect(user.state).toBe("pending");
    expect(user.loading).toBe(true);
    gate.resolve("Luke");
    await settle();
    expect(user.state).toBe("ready");
    expect(user.latest).toBe("Luke");
    expect(user()).toBe("Luke");
    expect(user.error).toBeUndefined();
  });

  it("[SOLID-UT-161] guides/fetching-data: mutate gives an optimistic update (TodoList, JSX)", async () => {
    const mod = await load<{
      TodoList: (props: { fetchTasksFromServer: () => unknown }) => unknown;
    }>(`
      import { useResource } from "@shadow-js/core";
      import { For } from "@shadow-js/web";
      export function TodoList(props) {
        const tasks = useResource(props.fetchTasksFromServer);
        return (
          <>
            <ul><For each={tasks()}>{(task) => <li>{task.name}</li>}</For></ul>
            <button onClick={() => { tasks.mutate((todos) => [...todos, { name: "do new task" }]); }}>Add Task</button>
          </>
        );
      }
    `);
    const host = mountApp(() =>
      mod.TodoList({ fetchTasksFromServer: () => [{ name: "existing" }] }),
    );
    await settle();
    expect(Array.from(host.querySelectorAll("li"), (li) => li.textContent)).toEqual(["existing"]);
    host.querySelector("button")?.click();
    flushSync();
    expect(Array.from(host.querySelectorAll("li"), (li) => li.textContent)).toEqual([
      "existing",
      "do new task",
    ]);
  });

  // DIFFERENCE from Solid (by design): Solid's createResource returns a tuple, `const [tasks, { mutate, refetch }] = createResource(...)`. ShadowJS
  // useResource returns a single accessor object carrying mutate/refetch (packages/core/src/resource.ts:208-236), which is
  // not iterable.
  it("[SOLID-UT-162] guides/fetching-data: the resource can be destructured as [tasks, { mutate, refetch }] (differs from Solid; ShadowJS: the resource is one accessor that carries mutate and refetch)", () => {
    inRoot(() => {
      const tasks = useResource(() => ["a"]) as unknown as (() => string[]) & {
        mutate: (value: string[]) => void;
        refetch: () => unknown;
      };
      expect(typeof tasks.refetch).toBe("function");
      tasks.mutate(["b"]);
      expect(tasks()).toEqual(["b"]);
    });
  });

  it("[SOLID-UT-163] guides/fetching-data: refetch on an interval reloads the data and onCleanup stops the timer (StockPriceTicker)", () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchStockPrices = (): number => {
      calls += 1;
      return calls;
    };
    let prices!: Resource<number>;
    const dispose = createRoot((d) => {
      prices = useResource(fetchStockPrices);
      const timer = setInterval(() => {
        prices.refetch();
      }, 1000);
      onCleanup(() => {
        clearInterval(timer);
      });
      return d;
    });
    flushSync();
    expect(calls).toBe(1);
    vi.advanceTimersByTime(3000);
    flushSync();
    expect(calls).toBe(4);
    expect(prices.latest).toBe(4);
    dispose();
    vi.advanceTimersByTime(3000);
    expect(calls).toBe(4);
  });

  it("[SOLID-UT-164] guides/fetching-data: wrapping a failing resource in an ErrorBoundary shows its fallback (tip, JSX)", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useResource } from "@shadow-js/core";
      import { ErrorBoundary } from "@shadow-js/web";
      function Profile() {
        const user = useResource(() => Promise.reject(new Error("no user")));
        return <p>{user()}</p>;
      }
      export function App() {
        return <ErrorBoundary fallback={(err) => <b>caught: {err.message}</b>}><Profile /></ErrorBoundary>;
      }
    `);
    const host = mountApp(() => mod.App());
    await settle();
    expect(host.querySelector("b")?.textContent).toBe("caught: no user");
  });

  it("[SOLID-UT-165] guides/fetching-data: an effect can read the latest value of a resource without suspending", async () => {
    const gate = deferred<number>();
    const seen: Array<number | undefined> = [];
    inRoot(() => {
      const value = useResource(() => gate.promise);
      useEffect(() => {
        seen.push(value.latest);
      });
    });
    flushSync();
    gate.resolve(7);
    await settle();
    expect(seen).toEqual([undefined, 7]);
  });
});

describe("guides/fetching-data (ShadowJS Suspense scoping)", () => {
  it("[SOLID-UT-166] guides/fetching-data: a resource created inside Suspense shows the fallback, then the data (JSX)", async () => {
    const gate = deferred<unknown>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => gate.promise.then((body) => ({ json: () => Promise.resolve(body) }))),
    );
    const mod = await load<{ App: () => unknown }>(`
      import { useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function Profile() {
        const user = useResource(async () => (await fetch("/api/user")).json());
        return <div class="out">{JSON.stringify(user())}</div>;
      }
      export function App() {
        return <Suspense fallback={<div class="fb">Loading...</div>}><Profile /></Suspense>;
      }
    `);
    const host = mountApp(() => mod.App());
    expect(host.querySelector(".fb")?.textContent).toBe("Loading...");
    gate.resolve({ name: "Leia" });
    await settle();
    expect(host.querySelector(".fb")).toBeNull();
    expect(host.querySelector(".out")?.textContent).toBe('{"name":"Leia"}');
  });
});

describe("store-utilities/create-store (guide pitfalls)", () => {
  it("[SOLID-UT-167] guides/complex-state-management: store reads inside the setStore callback are untracked, so read first for an effect", () => {
    const [state, setState] = useStore({ tasks: [] as string[], numberOfTasks: 0 });
    inRoot(() => {
      useEffect(() => {
        setState((draft) => {
          draft.numberOfTasks = state.tasks.length;
        });
      });
    });
    flushSync();
    setState((draft) => {
      draft.tasks.push("a");
    });
    flushSync();
    expect(state.numberOfTasks).toBe(0);
    inRoot(() => {
      useEffect(() => {
        const length = state.tasks.length;
        setState((draft) => {
          draft.numberOfTasks = length;
        });
      });
    });
    flushSync();
    setState((draft) => {
      draft.tasks.push("b");
    });
    flushSync();
    expect(state.numberOfTasks).toBe(2);
  });
});

describe("store arrays with list primitives", () => {
  // GAP: mapArray over a store array does not see in-place mutation (push). The list memo reads the array untracked
  // (packages/core/src/list.ts, `untrack(() => toEntries(items, keying))`), so it depends only on the property holding
  // the array, never on its length or indices.
  it("[SOLID-UT-169] reactive-utilities/map-array: mapping a store array reflects push() on it", () => {
    const [state, setState] = useStore({ tasks: [] as Array<{ id: number }> });
    inRoot(() => {
      const mapped = mapArray(
        () => state.tasks,
        (task) => task.id,
      );
      expect(mapped()).toEqual([]);
      setState((draft) => {
        draft.tasks.push({ id: 1 });
      });
      expect(mapped()).toEqual([1]);
    });
  });

  // GAP: same cause as UT-169, for indexArray.
  it("[SOLID-UT-170] reactive-utilities/index-array: indexing a store array reflects push() on it", () => {
    const [state, setState] = useStore({ tasks: [] as Array<{ id: number }> });
    inRoot(() => {
      const mapped = indexArray(
        () => state.tasks,
        (task) => task().id,
      );
      expect(mapped()).toEqual([]);
      setState((draft) => {
        draft.tasks.push({ id: 1 });
      });
      expect(mapped()).toEqual([1]);
    });
  });

  it("[SOLID-UT-171] reactive-utilities/map-array: mapping a copy of a store array ([...state.tasks]) reflects push()", () => {
    const [state, setState] = useStore({ tasks: [] as Array<{ id: number }> });
    inRoot(() => {
      const mapped = mapArray(
        () => [...state.tasks],
        (task) => task.id,
      );
      expect(mapped()).toEqual([]);
      setState((draft) => {
        draft.tasks.push({ id: 1 });
      });
      expect(mapped()).toEqual([1]);
    });
  });
});
