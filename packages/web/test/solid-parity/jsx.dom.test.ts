import { flushSync, useSignal } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "../support/compile";

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

/** Presses an element the way a user would. */
function press(el: Element | null | undefined): void {
  if (!el) throw new Error("press(): element not found");
  flushSync(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("reference/jsx-attributes/attr", () => {
  it("[SOLID-CF-120] jsx-attributes/attr: attr:name writes an attribute, null and undefined remove it", async () => {
    const mod = await load<{ App: (props: { status: () => unknown }) => unknown }>(
      "export const App = (props) => <my-element attr:status={props.status()} />;",
    );
    const [status, setStatus] = useSignal<unknown>("ready");
    const el = mountApp(() => mod.App({ status })).querySelector("my-element");
    expect(el?.getAttribute("status")).toBe("ready");
    flushSync(() => setStatus(undefined));
    expect(el?.hasAttribute("status")).toBe(false);
    flushSync(() => setStatus("again"));
    expect(el?.getAttribute("status")).toBe("again");
    flushSync(() => setStatus(null));
    expect(el?.hasAttribute("status")).toBe(false);
  });

  it("[SOLID-CF-121] jsx-attributes/attr: attr: forces an attribute even where a property exists", async () => {
    const mod = await load<{ App: () => unknown }>(
      'export const App = () => <input attr:value="from-attribute" />;',
    );
    const input = mountApp(() => mod.App()).querySelector("input");
    expect(input?.getAttribute("value")).toBe("from-attribute");
  });
});

describe("reference/jsx-attributes/bool", () => {
  it('[SOLID-CF-122] jsx-attributes/bool: bool:name writes name="" for truthy values and removes it for falsy ones', async () => {
    const mod = await load<{ App: (props: { value: () => unknown }) => unknown }>(
      "export const App = (props) => <my-element bool:status={props.value()} />;",
    );
    const [value, setValue] = useSignal<unknown>("yes");
    const el = mountApp(() => mod.App({ value })).querySelector("my-element");
    expect(el?.getAttribute("status")).toBe("");
    for (const falsy of [0, "", null, undefined, false]) {
      flushSync(() => setValue(falsy));
      expect(el?.hasAttribute("status")).toBe(false);
      flushSync(() => setValue(1));
      expect(el?.getAttribute("status")).toBe("");
    }
  });
});

describe("reference/jsx-attributes/classlist and concepts class-style", () => {
  it("[SOLID-CF-123] jsx-attributes/classlist: keys with several space-separated names toggle each name", async () => {
    const mod = await load<{ App: (props: { on: () => boolean }) => unknown }>(
      'export const App = (props) => <div classList={{ "a b": props.on(), c: true }} />;',
    );
    const [on, setOn] = useSignal(true);
    const div = mountApp(() => mod.App({ on })).querySelector("div");
    expect(Array.from(div?.classList ?? []).sort()).toEqual(["a", "b", "c"]);
    flushSync(() => setOn(false));
    expect(Array.from(div?.classList ?? [])).toEqual(["c"]);
  });

  it("[SOLID-CF-124] jsx-attributes/classlist: a computed key follows a changing class name", async () => {
    const mod = await load<{ App: (props: { name: () => string; on: () => boolean }) => unknown }>(
      "export const App = (props) => <div classList={{ [props.name()]: props.on() }} />;",
    );
    const [name, setName] = useSignal("one");
    const [on] = useSignal(true);
    const div = mountApp(() => mod.App({ name, on })).querySelector("div");
    expect(div?.className).toBe("one");
    flushSync(() => setName("two"));
    expect(div?.className).toBe("two");
  });

  it("[SOLID-CF-125] jsx-attributes/classlist: classList passes through <Dynamic> for an intrinsic element", async () => {
    const mod = await load<{ App: (props: { on: () => boolean }) => unknown }>(`
      import { Dynamic } from "@shadow-js/web";
      export const App = (props) => <Dynamic component="div" classList={{ active: props.on() }} />;
    `);
    const [on, setOn] = useSignal(true);
    const div = mountApp(() => mod.App({ on })).querySelector("div");
    expect(div?.classList.contains("active")).toBe(true);
    flushSync(() => setOn(false));
    expect(div?.classList.contains("active")).toBe(false);
  });

  it("[SOLID-CF-126] jsx-attributes/classlist: the deprecated className alias still sets the class", async () => {
    const mod = await load<{ App: () => unknown }>(
      'export const App = () => <div className="legacy" />;',
    );
    expect(mountApp(() => mod.App()).querySelector("div")?.className).toBe("legacy");
  });

  it("[SOLID-CF-127] components/class-style: ShadowJS class also takes arrays and objects (clsx style)", async () => {
    const mod = await load<{ App: (props: { on: () => boolean }) => unknown }>(
      'export const App = (props) => <div class={["base", { active: props.on(), off: false }, null, ["nested"]]} />;',
    );
    const [on, setOn] = useSignal(true);
    const div = mountApp(() => mod.App({ on })).querySelector("div");
    expect(div?.className).toBe("base active nested");
    flushSync(() => setOn(false));
    expect(div?.className).toBe("base nested");
  });
});

describe("reference/jsx-attributes/innerhtml and textcontent", () => {
  it("[SOLID-CF-128] jsx-attributes/innerhtml: innerHTML parses markup and replaces the children", async () => {
    const mod = await load<{ App: (props: { html: () => string }) => unknown }>(
      "export const App = (props) => <div innerHTML={props.html()} />;",
    );
    const [html, setHtml] = useSignal("<strong>Hello</strong>");
    const div = mountApp(() => mod.App({ html })).querySelector("div");
    expect(div?.innerHTML).toBe("<strong>Hello</strong>");
    expect(div?.querySelector("strong")?.textContent).toBe("Hello");
    flushSync(() => setHtml("<em>Bye</em>"));
    expect(div?.innerHTML).toBe("<em>Bye</em>");
  });

  it("[SOLID-CF-129] jsx-attributes/textcontent: textContent inserts plain text without parsing markup", async () => {
    const mod = await load<{ App: (props: { text: () => string | number }) => unknown }>(
      "export const App = (props) => <div textContent={props.text()} />;",
    );
    const [text, setText] = useSignal<string | number>("<strong>Hello</strong>");
    const div = mountApp(() => mod.App({ text })).querySelector("div");
    expect(div?.textContent).toBe("<strong>Hello</strong>");
    expect(div?.querySelector("strong")).toBeNull();
    flushSync(() => setText(42));
    expect(div?.textContent).toBe("42");
  });
});

describe("reference/jsx-attributes/on (on:*) and on_ (on*)", () => {
  it("[SOLID-CF-130] jsx-attributes/on: on:MyEvent keeps the exact casing of a custom event", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export function App() {
        const [message, setMessage] = useSignal("Waiting");
        let el;
        return (
          <>
            <button onClick={() => el.dispatchEvent(new CustomEvent("MyEvent", { detail: "Hello" }))}>Dispatch event</button>
            <div on:MyEvent={(e) => setMessage(e.detail)} ref={el} />
            <p>{message()}</p>
          </>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    expect(host.querySelector("p")?.textContent).toBe("Waiting");
    press(host.querySelector("button"));
    expect(host.querySelector("p")?.textContent).toBe("Hello");
  });

  it("[SOLID-CF-131] jsx-attributes/on: an object listener with handleEvent and `once` is supported", async () => {
    const mod = await load<{ App: (props: { handler: object }) => unknown }>(
      "export const App = (props) => <button on:click={props.handler}>Click me</button>;",
    );
    let count = 0;
    const handler = {
      handleEvent() {
        count += 1;
      },
      once: true,
    };
    const host = mountApp(() => mod.App({ handler }));
    const button = host.querySelector("button");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(count).toBe(1);
  });

  // DIFFERENCE from Solid (by design): compiled on:name binds once (ADR-030); Solid removes the old listener and adds the new one when the value changes; packages/web/src/events.ts:106-136.
  it("[SOLID-CF-132] jsx-attributes/on: when the on: value changes the previous listener is replaced (differs from Solid; ShadowJS: on:name binds once; a new handler value is not rebound)", async () => {
    const mod = await load<{ App: (props: { handler: () => () => void }) => unknown }>(
      "export const App = (props) => <button on:click={props.handler()}>go</button>;",
    );
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
    host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toEqual(["first"]);
  });

  // GAP: oncapture:name is compiled with a capture flag (5th argument) that addEventListener() ignores, so the listener runs in the bubble phase; packages/web/src/events.ts:169-176.
  it("[SOLID-CF-133] jsx-attributes/on: oncapture:name listens in the capture phase", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      export const App = (props) => (
        <div oncapture:click={() => props.log.push("capture")} on:click={() => props.log.push("bubble")}>
          <button on:click={() => props.log.push("target")}>x</button>
        </div>
      );
    `);
    const log: string[] = [];
    const host = mountApp(() => mod.App({ log }));
    host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(log).toEqual(["capture", "target", "bubble"]);
  });

  it("[SOLID-CF-134] jsx-attributes/on_: onClick passes the event and onClick={(e) => e.currentTarget} sees the element", async () => {
    const mod = await load<{ App: (props: { seen: unknown[] }) => unknown }>(
      "export const App = (props) => <div onClick={(e) => props.seen.push(e.currentTarget)} />;",
    );
    const seen: unknown[] = [];
    const host = mountApp(() => mod.App({ seen }));
    press(host.querySelector("div"));
    expect(seen).toEqual([host.querySelector("div")]);
  });

  it("[SOLID-CF-135] jsx-attributes/on_: [handler, data] binds the item id in a For row", async () => {
    const mod = await load<{
      App: (props: {
        list: Array<{ id: number }>;
        handler: (id: number, e: Event) => void;
      }) => unknown;
    }>(`
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <ul><For each={props.list}>{(item) => <li onClick={[props.handler, item.id]}>{item.id}</li>}</For></ul>
      );
    `);
    const calls: Array<[number, string]> = [];
    const host = mountApp(() =>
      mod.App({
        list: [{ id: 7 }, { id: 9 }],
        handler: (id: number, e: Event) => {
          calls.push([id, e.type]);
        },
      }),
    );
    press(host.querySelectorAll("li")[1]);
    press(host.querySelectorAll("li")[0]);
    expect(calls).toEqual([
      [9, "click"],
      [7, "click"],
    ]);
  });

  it("[SOLID-CF-136] jsx-attributes/on_: non-delegated on* handlers (onScroll) attach directly; onFocus follows React and bubbles as focusin", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      export const App = (props) => (
        <div onScroll={() => props.log.push("scroll")}><input onFocus={() => props.log.push("focus")} /></div>
      );
    `);
    const log: string[] = [];
    const host = mountApp(() => mod.App({ log }));
    host.querySelector("div")?.dispatchEvent(new Event("scroll"));
    host.querySelector("input")?.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(log).toEqual(["scroll", "focus"]);
    expect(Reflect.get(host.querySelector("div") ?? {}, "$$scroll")).toBeUndefined();
  });

  it("[SOLID-CF-137] jsx-attributes/on_: on* handlers in a prop spread are bound and rebound when the handler changes", async () => {
    const mod = await load<{ App: (props: { handler: () => () => void }) => unknown }>(
      "export const App = (props) => <button {...{ get onClick() { return props.handler(); } }}>go</button>;",
    );
    const calls: string[] = [];
    const [handler, setHandler] = useSignal(() => {
      calls.push("first");
    });
    const host = mountApp(() => mod.App({ handler: () => handler() }));
    press(host.querySelector("button"));
    flushSync(() =>
      setHandler(() => () => {
        calls.push("second");
      }),
    );
    press(host.querySelector("button"));
    expect(calls).toEqual(["first", "second"]);
  });

  // DIFFERENCE from Solid (by design): the spread runtime maps every key starting with "on" to a lower-cased event name, so "on:Foo" becomes ":foo" and the namespace is not understood; packages/web/src/spread.ts:20-23,69-74.
  it("[SOLID-CF-138] jsx-attributes/on: on:Name works through a prop spread (differs from Solid; ShadowJS: on:Name through a spread is not understood)", async () => {
    const mod = await load<{ App: (props: object) => unknown }>(
      "export const App = (props) => <div {...props} />;",
    );
    const calls: string[] = [];
    const host = mountApp(() =>
      mod.App({
        "on:MyEvent": () => {
          calls.push("fired");
        },
      }),
    );
    host.querySelector("div")?.dispatchEvent(new Event("MyEvent"));
    expect(calls).toEqual([]);
  });
});

describe("reference/jsx-attributes/once", () => {
  it("[SOLID-CF-139] jsx-attributes/once: /*@once*/ on a prop value keeps it static", async () => {
    const mod = await load<{ App: (props: { value: () => string }) => unknown }>(`
      const Show = (props) => <p>{props.static}</p>;
      export const App = (props) => <Show static={/*@once*/ props.value()} />;
    `);
    const [value, setValue] = useSignal("first");
    const host = mountApp(() => mod.App({ value }));
    flushSync(() => setValue("second"));
    expect(host.textContent).toBe("first");
  });

  it("[SOLID-CF-140] jsx-attributes/once: /*@once*/ on a child expression keeps it static", async () => {
    const mod = await load<{ App: (props: { value: () => string }) => unknown }>(
      "export const App = (props) => <p>{/*@once*/ props.value()}</p>;",
    );
    const [value, setValue] = useSignal("first");
    const host = mountApp(() => mod.App({ value }));
    flushSync(() => setValue("second"));
    expect(host.textContent).toBe("first");
  });

  it("[SOLID-CF-141] jsx-attributes/once: ShadowJS spells the marker /*@static*/ and honors it in props and children", async () => {
    const mod = await load<{ App: (props: { value: () => string }) => unknown }>(`
      const Show = (props) => <p>{props.fixed}</p>;
      export const App = (props) => <div><Show fixed={/*@static*/ props.value()} /><b>{/*@static*/ props.value()}</b></div>;
    `);
    const [value, setValue] = useSignal("first");
    const host = mountApp(() => mod.App({ value }));
    flushSync(() => setValue("second"));
    expect(host.textContent).toBe("firstfirst");
  });
});

describe("reference/jsx-attributes/prop", () => {
  it("[SOLID-CF-142] jsx-attributes/prop: prop:name assigns the DOM property, not an attribute", async () => {
    const mod = await load<{ App: (props: { on: () => boolean }) => unknown }>(
      'export const App = (props) => <input type="checkbox" prop:indeterminate={props.on()} />;',
    );
    const [on, setOn] = useSignal(true);
    const input = mountApp(() => mod.App({ on })).querySelector("input");
    expect(input?.indeterminate).toBe(true);
    expect(input?.hasAttribute("indeterminate")).toBe(false);
    flushSync(() => setOn(false));
    expect(input?.indeterminate).toBe(false);
  });

  it("[SOLID-CF-143] jsx-attributes/prop: prop:scrollTop style properties are written straight to the element", async () => {
    const mod = await load<{ App: () => unknown }>(
      "export const App = () => <div prop:myCustomProp={{ a: 1 }} />;",
    );
    const div = mountApp(() => mod.App()).querySelector("div");
    expect(Reflect.get(div ?? {}, "myCustomProp")).toEqual({ a: 1 });
  });

  it("[SOLID-CF-144] jsx-attributes/prop: attr:, bool: and prop: namespaces also work through a prop spread", async () => {
    const mod = await load<{ App: (props: object) => unknown }>(
      "export const App = (props) => <input type='checkbox' {...props} />;",
    );
    const input = mountApp(() =>
      mod.App({ "attr:data-x": "1", "bool:data-flag": true, "prop:indeterminate": true }),
    ).querySelector("input");
    expect(input?.getAttribute("data-x")).toBe("1");
    expect(input?.getAttribute("data-flag")).toBe("");
    expect(input?.indeterminate).toBe(true);
  });
});

describe("reference/jsx-attributes/ref", () => {
  it("[SOLID-CF-145] jsx-attributes/ref: a variable ref receives the element and is usable in onMount", async () => {
    const mod = await load<{ App: (props: { log: unknown[] }) => unknown }>(`
      import { onMount } from "@shadow-js/core";
      export function App(props) {
        let myDiv;
        onMount(() => props.log.push(myDiv));
        return <div ref={myDiv} />;
      }
    `);
    const log: unknown[] = [];
    const host = mountApp(() => mod.App({ log }));
    flushSync();
    expect(log).toEqual([host.querySelector("div")]);
  });

  it("[SOLID-CF-146] jsx-attributes/ref: a callback ref is called with the element before it is connected", async () => {
    const mod = await load<{ App: (props: { grab: (el: Element) => void }) => unknown }>(
      "export const App = (props) => <div ref={(el) => props.grab(el)} />;",
    );
    const seen: Array<{ el: Element; connected: boolean }> = [];
    const host = mountApp(() =>
      mod.App({
        grab: (el: Element) => {
          seen.push({ el, connected: el.isConnected });
        },
      }),
    );
    expect(seen.length).toBe(1);
    expect(seen[0]?.el).toBe(host.querySelector("div"));
    expect(seen[0]?.connected).toBe(false);
  });

  it("[SOLID-CF-147] jsx-attributes/ref: a component forwards its ref prop to an element", async () => {
    const mod = await load<{ App: (props: { log: Array<string | undefined> }) => unknown }>(`
      import { onMount } from "@shadow-js/core";
      function MyComp(props) { return <div ref={props.ref} />; }
      export function App(props) {
        let myDiv;
        onMount(() => props.log.push(myDiv?.localName));
        return <MyComp ref={myDiv} />;
      }
    `);
    const log: Array<string | undefined> = [];
    mountApp(() => mod.App({ log }));
    flushSync();
    expect(log).toEqual(["div"]);
  });

  it("[SOLID-CF-148] jsx-attributes/ref: a callback ref passed through a component prop is called with the element", async () => {
    const mod = await load<{ App: (props: { grab: (el: Element) => void }) => unknown }>(`
      function MyComp(props) { return <div ref={props.ref} />; }
      export const App = (props) => <MyComp ref={(el) => props.grab(el)} />;
    `);
    const seen: Element[] = [];
    const host = mountApp(() =>
      mod.App({
        grab: (el: Element) => {
          seen.push(el);
        },
      }),
    );
    expect(seen).toEqual([host.querySelector("div") as Element]);
  });

  it("[SOLID-CF-149] jsx-attributes/ref: a functional ref coming through a spread is invoked by the spread handling", async () => {
    const mod = await load<{ App: (props: object) => unknown }>(
      "export const App = (props) => <div {...props} />;",
    );
    const seen: Element[] = [];
    const host = mountApp(() =>
      mod.App({
        ref: (el: Element) => {
          seen.push(el);
        },
      }),
    );
    expect(seen).toEqual([host.querySelector("div") as Element]);
  });
});

describe("reference/jsx-attributes/style", () => {
  it("[SOLID-CF-150] jsx-attributes/style: string values are written as inline CSS text", async () => {
    const mod = await load<{ App: (props: { height: () => number }) => unknown }>(
      'export const App = (props) => <div style={"color: green; height: " + props.height() + "px"} />;',
    );
    const [height, setHeight] = useSignal(10);
    const div = mountApp(() => mod.App({ height })).querySelector("div");
    expect(div?.style.color).toBe("green");
    expect(div?.style.height).toBe("10px");
    flushSync(() => setHeight(20));
    expect(div?.style.height).toBe("20px");
  });

  it("[SOLID-CF-151] jsx-attributes/style: an object is applied per property with dash-separated names", async () => {
    const mod = await load<{ App: (props: { color: () => string }) => unknown }>(`
      export const App = (props) => (
        <div style={{ color: "green", "background-color": props.color(), height: \`\${10}px\` }} />
      );
    `);
    const [color, setColor] = useSignal("red");
    const div = mountApp(() => mod.App({ color })).querySelector("div");
    expect(div?.style.getPropertyValue("background-color")).toBe("red");
    flushSync(() => setColor("blue"));
    expect(div?.style.getPropertyValue("background-color")).toBe("blue");
    expect(div?.style.color).toBe("green");
  });

  it("[SOLID-CF-152] jsx-attributes/style: CSS custom properties use `--name` keys", async () => {
    const mod = await load<{ App: (props: { color: () => string }) => unknown }>(
      'export const App = (props) => <div style={{ "--my-custom-color": props.color() }} />;',
    );
    const [color, setColor] = useSignal("red");
    const div = mountApp(() => mod.App({ color })).querySelector("div");
    expect(div?.style.getPropertyValue("--my-custom-color")).toBe("red");
    flushSync(() => setColor("blue"));
    expect(div?.style.getPropertyValue("--my-custom-color")).toBe("blue");
  });

  it("[SOLID-CF-153] jsx-attributes/style: nullish values remove a property and a falsy style removes the attribute", async () => {
    const mod = await load<{ App: (props: { value: () => unknown }) => unknown }>(
      "export const App = (props) => <div style={props.value()} />;",
    );
    const [value, setValue] = useSignal<unknown>({ color: "red", height: "5px" });
    const div = mountApp(() => mod.App({ value })).querySelector("div");
    expect(div?.style.color).toBe("red");
    flushSync(() => setValue({ color: null, height: "5px" }));
    expect(div?.style.color).toBe("");
    expect(div?.style.height).toBe("5px");
    flushSync(() => setValue(false));
    expect(div?.hasAttribute("style")).toBe(false);
  });
});

describe("reference/jsx-attributes/use", () => {
  it("[SOLID-CF-154] jsx-attributes/use: use:model receives the element and an accessor for its value", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { onCleanup, useRenderEffect, useSignal } from "@shadow-js/core";
      function model(element, value) {
        const [field, setField] = value();
        const onInput = ({ currentTarget }) => setField(currentTarget.value);
        useRenderEffect(() => (element.value = field()));
        element.addEventListener("input", onInput);
        onCleanup(() => element.removeEventListener("input", onInput));
      }
      export function App() {
        const [name, setName] = useSignal("");
        return (
          <div>
            <input type="text" use:model={[name, setName]} />
            <p>{name()}</p>
          </div>
        );
      }
    `);
    const host = mountApp(() => mod.App());
    const input = host.querySelector("input");
    if (!input) throw new Error("input missing");
    input.value = "Ada";
    flushSync(() => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("p")?.textContent).toBe("Ada");
  });

  it("[SOLID-CF-155] jsx-attributes/use: the accessor tracks the directive argument where the directive reads it reactively", async () => {
    const mod = await load<{ App: (props: { value: () => string }) => unknown }>(`
      import { useRenderEffect } from "@shadow-js/core";
      function note(element, accessor) { useRenderEffect(() => { element.dataset.note = accessor(); }); }
      export const App = (props) => <div use:note={props.value()} />;
    `);
    const [value, setValue] = useSignal("one");
    const div = mountApp(() => mod.App({ value })).querySelector("div");
    expect(div?.dataset["note"]).toBe("one");
    flushSync(() => setValue("two"));
    expect(div?.dataset["note"]).toBe("two");
  });

  it("[SOLID-CF-156] jsx-attributes/use: without a value the accessor returns true", async () => {
    const mod = await load<{ App: () => unknown }>(`
      function flag(element, accessor) { element.dataset.flag = String(accessor()); }
      export const App = () => <div use:flag />;
    `);
    const div = mountApp(() => mod.App()).querySelector("div");
    expect(div?.dataset["flag"]).toBe("true");
  });

  it("[SOLID-CF-157] jsx-attributes/use: the directive body is untracked (reading the accessor there does not re-run it)", async () => {
    const mod = await load<{ App: (props: { value: () => string }) => unknown }>(`
      function note(element, accessor) { element.dataset.note = accessor(); }
      export const App = (props) => <div use:note={props.value()} />;
    `);
    const [value, setValue] = useSignal("one");
    const div = mountApp(() => mod.App({ value })).querySelector("div");
    flushSync(() => setValue("two"));
    expect(div?.dataset["note"]).toBe("one");
  });

  it("[SOLID-CF-158] jsx-attributes/use: the directive runs before the element is connected and its cleanups follow the owner", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      import { onCleanup } from "@shadow-js/core";
      function track(element, accessor) {
        const log = accessor();
        log.push("connected:" + element.isConnected);
        onCleanup(() => log.push("cleanup"));
      }
      export const App = (props) => <div use:track={props.log} />;
    `);
    const log: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const dispose = render(() => mod.App({ log }), host);
    expect(log).toEqual(["connected:false"]);
    dispose();
    expect(log).toEqual(["connected:false", "cleanup"]);
  });

  it("[SOLID-CF-159] jsx-attributes/use: use:name on a component is not forwarded to its element", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      function mark(element, accessor) { accessor().push("directive"); }
      function Inner(props) { return <i>inner</i>; }
      export const App = (props) => <div use:mark={props.log}><Inner /></div>;
    `);
    const log: string[] = [];
    const host = mountApp(() => mod.App({ log }));
    expect(log).toEqual(["directive"]);
    expect(host.querySelector("i")?.textContent).toBe("inner");
  });
});

describe("prop spread of non-identifier expressions", () => {
  // GAP: the compiler lowers {...props.attrs} (a member or call expression) to spread(el, () => props.attrs) but spread() ignores a function argument, so nothing is applied; packages/compiler/src/internal/dom.ts:386-402 and packages/web/src/spread.ts:194.
  it("[SOLID-CF-160] jsx-attributes/ref: <div {...props.attrs} /> applies the attributes of a member expression", async () => {
    const mod = await load<{ App: (props: { attrs: object }) => unknown }>(
      "export const App = (props) => <div {...props.attrs} />;",
    );
    const div = mountApp(() => mod.App({ attrs: { id: "from-spread", class: "x" } })).querySelector(
      "div",
    );
    expect(div?.id).toBe("from-spread");
    expect(div?.className).toBe("x");
  });

  it("[SOLID-CF-161] concepts/props: <Child {...props.attrs} /> passes the members of a member expression as props", async () => {
    const mod = await load<{ App: (props: { attrs: object }) => unknown }>(`
      const Child = (props) => <p>{props.name}</p>;
      export const App = (props) => <Child {...props.attrs} />;
    `);
    const host = mountApp(() => mod.App({ attrs: { name: "Ada" } }));
    expect(host.textContent).toBe("Ada");
  });
});
