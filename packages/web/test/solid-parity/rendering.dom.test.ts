import {
  createContext,
  createRoot,
  flushSync,
  getOwner,
  isDev,
  isServer,
  onMount,
  useContext,
  useSignal,
} from "@shadow-js/core";
import { createComponent, hydrate, render } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "../support/compile";

const hosts: HTMLElement[] = [];
const disposers: Array<() => void> = [];

/** A container attached to the document; removed after the test. */
function container(html = ""): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  hosts.push(host);
  return host;
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const host of hosts.splice(0)) host.remove();
});

/** Names exported by a package entry that this audit expects but ShadowJS may not have. */
async function exportOf(entry: "web" | "core" | "server", name: string): Promise<unknown> {
  const mod: Record<string, unknown> =
    entry === "web"
      ? await import("@shadow-js/web")
      : entry === "core"
        ? await import("@shadow-js/core")
        : await import("@shadow-js/web/server");
  return mod[name];
}

/** The same JSX source compiled for both targets. */
async function both<T extends Record<string, unknown>>(
  source: string,
): Promise<{ dom: T; ssr: T }> {
  return { dom: await load<T>(source, "dom"), ssr: await load<T>(source, "ssr") };
}

describe("reference/rendering/render", () => {
  it("[SOLID-CF-200] rendering/render: render mounts the root into the element and returns a dispose function", async () => {
    const mod = await load<{ App: () => unknown }>(
      'export const App = () => <p id="app">Hello</p>;',
    );
    const host = container();
    const dispose = render(() => mod.App(), host);
    expect(typeof dispose).toBe("function");
    expect(host.innerHTML).toBe('<p id="app">Hello</p>');
    dispose();
    expect(host.innerHTML).toBe("");
  });

  it("[SOLID-CF-201] rendering/render: render appends to the container and dispose removes only what it inserted", async () => {
    const mod = await load<{ App: () => unknown }>("export const App = () => <p>mine</p>;");
    const host = container("<span>existing</span>");
    const dispose = render(() => mod.App(), host);
    expect(host.innerHTML).toBe("<span>existing</span><p>mine</p>");
    dispose();
    // Solid clears the whole container on dispose; ShadowJS leaves content it did not insert.
    expect(host.innerHTML).toBe("<span>existing</span>");
  });

  it("[SOLID-CF-202] rendering/render: the first argument must be a function", async () => {
    const host = container();
    const node = document.createElement("p");
    expect(() => render(node as unknown as () => unknown, host)).toThrow(TypeError);
  });

  it("[SOLID-CF-203] rendering/render: effects created by the root have run when render returns", async () => {
    const mod = await load<{ App: (props: { log: string[] }) => unknown }>(`
      import { onMount, useEffect } from "@shadow-js/core";
      export const App = (props) => {
        onMount(() => props.log.push("mount"));
        useEffect(() => { props.log.push("effect"); });
        return <p>x</p>;
      };
    `);
    const log: string[] = [];
    disposers.push(render(() => mod.App({ log }), container()));
    expect(log).toEqual(["mount", "effect"]);
  });

  it("[SOLID-CF-204] rendering/render: the returned dispose stops the reactive bindings and is safe to call twice", async () => {
    const mod = await load<{ App: (props: { n: () => number }) => unknown }>(
      "export const App = (props) => <p>{props.n()}</p>;",
    );
    const [n, setN] = useSignal(1);
    const host = container();
    const dispose = render(() => mod.App({ n }), host);
    dispose();
    dispose();
    flushSync(() => setN(2));
    expect(host.innerHTML).toBe("");
  });

  it("[SOLID-CF-205] rendering/render: ShadowJS can also mount into a DocumentFragment or shadow root", async () => {
    const mod = await load<{ App: () => unknown }>("export const App = () => <p>in shadow</p>;");
    const host = container();
    const root = host.attachShadow({ mode: "open" });
    disposers.push(render(() => mod.App(), root));
    expect(root.querySelector("p")?.textContent).toBe("in shadow");
  });

  it("[SOLID-CF-206] rendering/render: onMount in the root sees an already connected element", async () => {
    const seen: boolean[] = [];
    const mod = await load<{ App: (props: { seen: boolean[] }) => unknown }>(`
      import { onMount } from "@shadow-js/core";
      export const App = (props) => {
        let el;
        onMount(() => props.seen.push(el.isConnected));
        return <p ref={el}>x</p>;
      };
    `);
    disposers.push(render(() => mod.App({ seen }), container()));
    expect(seen).toEqual([true]);
  });
});

describe("reference/rendering/hydrate", () => {
  const APP = `
    import { Show } from "@shadow-js/web";
    export const App = (props) => (
      <section id="root">
        <h1>Hello {props.name()}</h1>
        <Show when={props.on()} fallback={<p>off</p>}><p class="on">on</p></Show>
        <button onClick={props.hit}>go</button>
      </section>
    );`;

  it("[SOLID-CF-207] rendering/hydrate: hydrate reuses the server DOM nodes and attaches behavior", async () => {
    const { dom, ssr } = await both<{ App: (props: Record<string, unknown>) => unknown }>(APP);
    const [name, setName] = useSignal("Ann");
    const [on] = useSignal(true);
    const clicks: number[] = [];
    const props = {
      name,
      on,
      hit: () => {
        clicks.push(1);
      },
    };
    const html = renderToString(() => createComponent(ssr.App as (p: object) => unknown, props));
    const host = container(html);
    const section = host.querySelector("section");
    const button = host.querySelector("button");
    disposers.push(hydrate(() => createComponent(dom.App as (p: object) => unknown, props), host));
    expect(host.querySelector("section")).toBe(section);
    expect(host.querySelector("button")).toBe(button);
    flushSync(() => setName("Bob"));
    expect(host.querySelector("h1")?.textContent).toBe("Hello Bob");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([1]);
  });

  it("[SOLID-CF-208] rendering/hydrate: renderId scopes the lookup and must equal the server's renderId", async () => {
    const { dom, ssr } = await both<{ App: (props: Record<string, unknown>) => unknown }>(APP);
    const [name] = useSignal("Ann");
    const [on] = useSignal(false);
    const props = { name, on, hit: () => undefined };
    const html = renderToString(() => createComponent(ssr.App as (p: object) => unknown, props), {
      renderId: "app1",
    });
    expect(html).toContain('data-hk="app1-');
    const host = container(html);
    const section = host.querySelector("section");
    disposers.push(
      hydrate(() => createComponent(dom.App as (p: object) => unknown, props), host, {
        renderId: "app1",
      }),
    );
    expect(host.querySelector("section")).toBe(section);
  });

  it("[SOLID-CF-209] rendering/hydrate: the returned function disposes the hydrated root", async () => {
    const { dom, ssr } = await both<{ App: (props: Record<string, unknown>) => unknown }>(APP);
    const [name, setName] = useSignal("Ann");
    const [on] = useSignal(true);
    const props = { name, on, hit: () => undefined };
    const host = container(
      renderToString(() => createComponent(ssr.App as (p: object) => unknown, props)),
    );
    const dispose = hydrate(() => createComponent(dom.App as (p: object) => unknown, props), host);
    dispose();
    flushSync(() => setName("Late"));
    expect(host.querySelector("h1")?.textContent ?? "").not.toContain("Late");
  });

  it("[SOLID-CF-210] rendering/hydrate: markup that does not match the client output is repaired, with a dev warning", async () => {
    const mod = await load<{ App: () => unknown }>("export const App = () => <p>client</p>;");
    const warn = console.warn as unknown as { mock: { calls: unknown[][] }; mockClear(): void };
    const host = container("");
    disposers.push(hydrate(() => mod.App(), host));
    expect(host.textContent).toBe("client");
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    warn.mockClear();
  });

  it("[SOLID-CF-211] rendering/hydrate: options.owner creates the hydration root under the given owner", async () => {
    const Theme = createContext<string>("none");
    const mod = await load<{ App: (props: { read: () => string }) => unknown }>(
      "export const App = (props) => <p>{props.read()}</p>;",
    );
    const host = container('<p data-hk="0-0-0"><!--[-->dark<!--]--></p>');
    let owner: ReturnType<typeof getOwner> = null;
    createRoot(() => {
      Theme({
        value: "dark",
        get children() {
          owner = getOwner();
          return null;
        },
      });
    });
    const options = { owner } as unknown as Parameters<typeof hydrate>[2];
    disposers.push(
      hydrate(
        () => createComponent(mod.App as (p: object) => unknown, { read: () => useContext(Theme) }),
        host,
        options,
      ),
    );
    expect(host.textContent).toBe("dark");
  });
});

describe("reference/rendering/is-server, is-dev and dev", () => {
  it("[SOLID-CF-212] rendering/is-server: isServer is false in the browser bundle", () => {
    expect(isServer).toBe(false);
  });

  it("[SOLID-CF-213] rendering/is-dev: isDev is true in the development bundle", () => {
    expect(isDev).toBe(true);
  });

  // GAP: isServer and isDev are exported by @shadow-js/core only; Solid imports them from "solid-js/web", and @shadow-js/web does not re-export them; packages/web/src/index.ts:1-14.
  it("[SOLID-CF-214] rendering/is-server: isServer and isDev can be imported from the web package", async () => {
    expect(typeof (await exportOf("web", "isServer"))).toBe("boolean");
    expect(typeof (await exportOf("web", "isDev"))).toBe("boolean");
  });

  // DIFFERENCE from Solid (by design): there is no DEV export (development hooks object) in @shadow-js/core; packages/core/src/index.ts.
  it("[SOLID-CF-215] rendering/dev: DEV is defined in the development bundle and exposes hooks (differs from Solid; ShadowJS: there is no DEV export)", async () => {
    expect(await exportOf("core", "DEV")).toBeUndefined();
  });

  it("[SOLID-CF-216] rendering/is-dev: isDev guards development-only branches (constant boolean)", () => {
    const branch = isDev ? "dev" : "prod";
    expect(branch).toBe("dev");
    expect(typeof isServer).toBe("boolean");
  });
});

describe("render lifecycle sanity (supporting the rendering pages)", () => {
  it("[SOLID-CF-217] rendering/render: onMount runs once on render and dispose empties the output", () => {
    const log: string[] = [];
    const host = container();
    const dispose = render(() => {
      onMount(() => {
        log.push("mounted");
      });
      return document.createElement("i");
    }, host);
    expect(log).toEqual(["mounted"]);
    dispose();
    expect(host.innerHTML).toBe("");
  });
});
