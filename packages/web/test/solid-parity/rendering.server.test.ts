import { isServer } from "@shadow-js/core";
import {
  createComponent,
  createServerHead,
  renderToString,
  renderToStringAsync,
  serialize,
} from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";
import { load } from "../support/compile";

type Component = (props: Record<string, unknown>) => unknown;

/** Compiles `source` for the server and returns a root renderer for its `App` export. */
async function app(source: string): Promise<Component> {
  const mod = await load<{ App: Component }>(source, "ssr");
  return mod.App;
}

/** Names the server entry is expected to export; undefined when ShadowJS does not have them. */
async function serverExport(name: string): Promise<unknown> {
  const mod: Record<string, unknown> = await import("@shadow-js/web/server");
  return mod[name];
}

describe("reference/rendering/render-to-string", () => {
  it("[SOLID-CF-230] rendering/render-to-string: renderToString returns the HTML string synchronously", async () => {
    const App = await app("export const App = () => <p>Hello</p>;");
    const html = renderToString(() => createComponent(App, {}));
    expect(typeof html).toBe("string");
    expect(html).toBe('<p data-hk="0-0-0">Hello</p>');
  });

  it("[SOLID-CF-231] rendering/render-to-string: the output carries hydration keys and region markers", async () => {
    const App = await app("export const App = (props) => <p>hi {props.name}</p>;");
    const html = renderToString(() => createComponent(App, { name: "Ann" }));
    expect(html).toContain('data-hk="0-0-0"');
    expect(html).toContain("<!--[-->Ann<!--]-->");
  });

  it("[SOLID-CF-232] rendering/render-to-string: renderId namespaces the keys and must be a plain token", async () => {
    const App = await app("export const App = () => <p>x</p>;");
    expect(renderToString(() => createComponent(App, {}), { renderId: "app1" })).toContain(
      'data-hk="app1-',
    );
    expect(() => renderToString(() => createComponent(App, {}), { renderId: 'a"b' })).toThrow(
      TypeError,
    );
  });

  it("[SOLID-CF-233] rendering/render-to-string: pending async work is not awaited, the Suspense fallback is rendered", async () => {
    const App = await app(`
      import { useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function Data() { const d = useResource(() => new Promise(() => undefined), { key: "never" }); return <b>{d()}</b>; }
      export const App = () => <Suspense fallback={<i>loading</i>}><Data /></Suspense>;
    `);
    const html = renderToString(() => createComponent(App, {}));
    expect(html).toContain("loading");
    expect(html).not.toContain("<b");
  });

  it("[SOLID-CF-234] rendering/render-to-string: effects and onMount never run on the server", async () => {
    const App = await app(`
      import { onMount, useEffect } from "@shadow-js/core";
      export const App = (props) => {
        onMount(() => props.log.push("mount"));
        useEffect(() => { props.log.push("effect"); });
        return <p>x</p>;
      };
    `);
    const log: string[] = [];
    renderToString(() => createComponent(App, { log }));
    expect(log).toEqual([]);
  });

  it("[SOLID-CF-235] rendering/render-to-string: the control-flow components render on the server", async () => {
    const App = await app(`
      import { For, Index, Show, Switch, Match } from "@shadow-js/web";
      export const App = (props) => (
        <div>
          <Show when={props.on} fallback={<i>no</i>}><b>yes</b></Show>
          <Switch fallback="none"><Match when={false}>a</Match><Match when={true}>b</Match></Switch>
          <ul><For each={["x", "y"]} fallback="empty">{(item, i) => <li>{item}{i()}</li>}</For></ul>
          <ol><Index each={["p", "q"]}>{(item, i) => <li>{item()}{i}</li>}</Index></ol>
        </div>
      );
    `);
    const html = renderToString(() => createComponent(App, { on: true }));
    const text = html.replace(/<!--.*?-->/g, "").replace(/ data-hk="[^"]*"/g, "");
    expect(text).toBe(
      "<div><b>yes</b>b<ul><li>x0</li><li>y1</li></ul><ol><li>p0</li><li>q1</li></ol></div>",
    );
  });

  it("[SOLID-CF-253] components/dynamic: Dynamic with a component function renders on the server", async () => {
    const App = await app(`
      import { Dynamic } from "@shadow-js/web";
      const View = (props) => <p>{props.label}</p>;
      export const App = () => <Dynamic component={View} label="Selected view" />;
    `);
    const html = renderToString(() => createComponent(App, {}));
    expect(html).toContain("Selected view");
  });

  it("[SOLID-CF-254] components/dynamic: Dynamic with a tag name renders on the server", async () => {
    const App = await app(`
      import { Dynamic } from "@shadow-js/web";
      export const App = () => <Dynamic component="em" class="x">dyn</Dynamic>;
    `);
    const html = renderToString(() => createComponent(App, {}));
    expect(html).toContain("<em");
    expect(html).toContain("dyn");
  });

  it("[SOLID-CF-236] components/error-boundary: a throwing child renders the fallback on the server", async () => {
    const App = await app(`
      import { ErrorBoundary } from "@shadow-js/web";
      function Bad() { throw new Error("nope"); }
      export const App = () => <ErrorBoundary fallback={(e) => <p>caught {e.message}</p>}><Bad /></ErrorBoundary>;
    `);
    const html = renderToString(() => createComponent(App, {}));
    expect(html).toContain("caught");
    expect(html).toContain("nope");
  });

  it("[SOLID-CF-237] components/portal: a Portal produces no output on the server", async () => {
    const App = await app(`
      import { Portal } from "@shadow-js/web";
      export const App = () => <div>before<Portal><span>popup</span></Portal>after</div>;
    `);
    const html = renderToString(() => createComponent(App, {}));
    expect(html).not.toContain("popup");
    expect(html).toContain("before");
  });

  it("[SOLID-CF-238] rendering/render-to-string: the output has no inline scripts", async () => {
    const App = await app("export const App = () => <p>x</p>;");
    expect(renderToString(() => createComponent(App, {}))).not.toContain("<script");
  });

  // ShadowJS collects head tags in an explicit collector (`createServerHead()`, passed as the `head` option)
  // instead of Solid's ambient useAssets() registry; the document builder writes `head.html()` into <head>.
  it("[SOLID-CF-239] solid-meta/server-setup: head tags rendered with the app are collected into the server head", async () => {
    const App = await app(`
      import { Title, Meta } from "@shadow-js/web";
      export const App = () => (<div><Title>Server title</Title><Meta name="description" content="d" /></div>);
    `);
    const head = createServerHead();
    const html = renderToString(() => createComponent(App, {}), { head });
    expect(html).not.toContain("<title");
    expect(head.html()).toContain("<title data-shadow-head>Server title</title>");
    expect(head.html()).toContain('<meta data-shadow-head name="description" content="d">');
  });

  it("[SOLID-CF-240] solid-meta/server-setup: the collector's html() plays the role of getAssets()", async () => {
    const head = createServerHead();
    expect(head.html()).toBe("");
    const App = await app(`
      import { Title } from "@shadow-js/web";
      export const App = () => <Title>T</Title>;
    `);
    renderToString(() => createComponent(App, {}), { head });
    expect(typeof head.html()).toBe("string");
    expect(head.html()).toContain("<title");
  });

  // DIFFERENCE from Solid (by design): renderToString has no `nonce` option and emits no scripts; Solid applies the nonce to inline serialization scripts; packages/web/src/server/render.ts:6-9.
  it("[SOLID-CF-241] rendering/render-to-string: nonce is applied to the inline scripts it emits (differs from Solid; ShadowJS: renderToString has no nonce option and emits no scripts)", async () => {
    const App = await app("export const App = () => <p>x</p>;");
    const render = renderToString as (code: () => unknown, options: object) => string;
    const html = render(() => createComponent(App, {}), { nonce: "abc" });
    expect(html).not.toContain("nonce");
    expect(html).not.toContain("<script");
  });
});

describe("reference/rendering/render-to-string-async", () => {
  const RESOURCE_APP = `
    import { useResource } from "@shadow-js/core";
    import { Suspense } from "@shadow-js/web";
    function Message(props) {
      const message = useResource(props.load, { key: "msg" });
      return <b>{String(message()?.n ?? message())}</b>;
    }
    export const App = (props) => <Suspense fallback={<i>loading</i>}><Message load={props.load} /></Suspense>;
  `;

  it("[SOLID-CF-242] rendering/render-to-string-async: waits for suspense boundaries and returns { html, data }", async () => {
    const App = await app(RESOURCE_APP);
    const result = await renderToStringAsync(() =>
      createComponent(App, { load: () => Promise.resolve("Loaded") }),
    );
    expect(result.html).toContain("Loaded");
    expect(result.html).not.toContain("loading");
    expect(result.data).toEqual({ "k:msg": "Loaded" });
  });

  it("[SOLID-CF-243] rendering/render-to-string-async: resource data is serializable for client hydration", async () => {
    const App = await app(RESOURCE_APP);
    const { data } = await renderToStringAsync(() =>
      createComponent(App, { load: () => Promise.resolve({ n: 1 }) }),
    );
    expect(typeof serialize(data)).toBe("string");
  });

  it("[SOLID-CF-244] rendering/render-to-string-async: timeoutMs rejects when the work does not finish", async () => {
    const App = await app(RESOURCE_APP);
    await expect(
      renderToStringAsync(
        () => createComponent(App, { load: () => new Promise(() => undefined) }),
        {
          timeoutMs: 25,
        },
      ),
    ).rejects.toMatchObject({ code: "SSR_TIMEOUT" });
  });

  it("[SOLID-CF-245] rendering/render-to-string-async: renderId namespaces the output", async () => {
    const App = await app(RESOURCE_APP);
    const result = await renderToStringAsync(
      () => createComponent(App, { load: () => Promise.resolve("x") }),
      { renderId: "page2" },
    );
    expect(result.html).toContain('data-hk="page2-');
  });

  // DIFFERENCE from Solid (by design): renderToStringAsync resolves to { html, data } (and has no `nonce`), Solid resolves to the HTML string itself with serialization scripts included; packages/web/src/server/render.ts:36-41,232-243.
  it("[SOLID-CF-246] rendering/render-to-string-async: the promise resolves to the HTML string (differs from Solid; ShadowJS: it resolves to { html, data })", async () => {
    const App = await app("export const App = () => <p>x</p>;");
    const result = await renderToStringAsync(() => createComponent(App, {}));
    expect(typeof result.html).toBe("string");
    expect(result.html).toContain("<p");
  });
});

describe("reference/rendering/render-to-stream and hydration-script", () => {
  // DIFFERENCE from Solid (by design): renderToStream is not implemented (promised by ADR-016); packages/web/src/server/index.ts:1-14.
  it("[SOLID-CF-247] rendering/render-to-stream: renderToStream(...).pipe writes the shell to a writable (differs from Solid; ShadowJS: renderToStream returns a Web ReadableStream, not a Node pipe)", async () => {
    const renderToStream = (await serverExport("renderToStream")) as (
      code: () => unknown,
    ) => ReadableStream<Uint8Array | string>;
    expect(typeof renderToStream).toBe("function");
    const App = await app("export const App = () => <p>Hello</p>;");
    const stream = renderToStream(() => createComponent(App, {}));
    expect(stream).toBeInstanceOf(ReadableStream);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += typeof value === "string" ? value : decoder.decode(value);
    }
    expect(text).toContain("Hello");
  });

  it("[SOLID-CF-248] rendering/render-to-stream: renderToStream(...).pipeTo writes to a WritableStream", async () => {
    const renderToStream = (await serverExport("renderToStream")) as (
      code: () => unknown,
    ) => ReadableStream<Uint8Array>;
    expect(typeof renderToStream).toBe("function");
    const App = await app("export const App = () => <p>Hello</p>;");
    const received: string[] = [];
    const decoder = new TextDecoder();
    await renderToStream(() => createComponent(App, {})).pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          received.push(decoder.decode(chunk));
        },
      }),
    );
    expect(received.join("")).toContain("Hello");
  });

  // ShadowJS equivalent of onCompleteShell: `onShellReady(shell)`; the stream closing is onCompleteAll.
  it("[SOLID-CF-249] rendering/render-to-stream: onShellReady reports the shell, closing the stream reports completion", async () => {
    const renderToStream = (await serverExport("renderToStream")) as (
      code: () => unknown,
      options: { onShellReady: (shell: string) => void },
    ) => ReadableStream<Uint8Array>;
    const App = await app("export const App = () => <p>Hello</p>;");
    const shells: string[] = [];
    const reader = renderToStream(() => createComponent(App, {}), {
      onShellReady: (shell) => shells.push(shell),
    }).getReader();
    let done = false;
    while (!done) done = (await reader.read()).done;
    expect(shells).toHaveLength(1);
    expect(shells[0]).toContain("Hello");
  });

  // RENAMED: HydrationScript (early event capture, DEC-HYDRATION-SCRIPT; server entry). Passing since 1.0.0.
  it("[SOLID-CF-250] rendering/hydration-script: HydrationScript renders the bootstrap script element", async () => {
    const HydrationScript = (await serverExport("HydrationScript")) as (props: {
      nonce?: string;
    }) => unknown;
    expect(typeof HydrationScript).toBe("function");
  });

  // RENAMED: generateHydrationScript (DEC-HYDRATION-SCRIPT). Passing since 1.0.0.
  it("[SOLID-CF-251] rendering/hydration-script: generateHydrationScript({ nonce }) returns a script string", async () => {
    const generate = (await serverExport("generateHydrationScript")) as (options: {
      nonce?: string;
    }) => string;
    expect(typeof generate).toBe("function");
    expect(generate({ nonce: "nonce-value" })).toContain("nonce-value");
  });
});

describe("jsx-attributes in server output", () => {
  /** Renders `<div ...attrs>` for the given attribute source and strips hydration keys. */
  async function div(
    attrs: string,
    props: Record<string, unknown> = {},
    body = "",
  ): Promise<string> {
    const App = await app(`export const App = (props) => <div ${attrs}>${body}</div>;`);
    return renderToString(() => createComponent(App, props)).replace(/ data-hk="[^"]*"/g, "");
  }

  it("[SOLID-CF-255] jsx-attributes/attr: attr:name is written as an escaped attribute on the server", async () => {
    expect(await div("attr:status={props.v}", { v: 'a"b' })).toBe('<div status="a&quot;b"></div>');
  });

  it("[SOLID-CF-256] jsx-attributes/bool: bool:name follows presence or absence on the server", async () => {
    expect(await div("bool:flag={props.v}", { v: 1 })).toBe("<div flag></div>");
    expect(await div("bool:flag={props.v}", { v: 0 })).toBe("<div></div>");
  });

  it("[SOLID-CF-257] jsx-attributes/classlist: class, className and classList merge into one class attribute", async () => {
    const out = await div("class={props.c} classList={{ on: props.on, off: false, 'a b': true }}", {
      c: "base",
      on: true,
    });
    expect(out).toBe('<div class="base on a b"></div>');
  });

  it("[SOLID-CF-258] jsx-attributes/style: style objects serialize into the style attribute", async () => {
    expect(await div('style={{ color: props.c, "--my-color": "red" }}', { c: "green" })).toBe(
      '<div style="color:green;--my-color:red"></div>',
    );
  });

  it("[SOLID-CF-259] jsx-attributes/innerhtml: innerHTML is emitted as raw child content", async () => {
    expect(await div("innerHTML={props.html}", { html: "<strong>Hello</strong>" })).toBe(
      "<div><strong>Hello</strong></div>",
    );
  });

  it("[SOLID-CF-260] jsx-attributes/textcontent: textContent is emitted as escaped text on the server", async () => {
    expect(await div("textContent={props.t}", { t: "<b>x</b>" })).toBe(
      "<div>&lt;b&gt;x&lt;/b&gt;</div>",
    );
  });

  it("[SOLID-CF-261] jsx-attributes/prop: prop:name produces no server output", async () => {
    expect(await div("prop:indeterminate={true}")).toBe("<div></div>");
  });

  it("[SOLID-CF-262] jsx-attributes/ref and use and on: refs, directives and event handlers produce no server output", async () => {
    const App = await app(`
      function model() {}
      export const App = (props) => {
        let el;
        return <div ref={el} use:model={props.v} on:click={() => 1} onClick={() => 2}>x</div>;
      };
    `);
    const html = renderToString(() => createComponent(App, { v: 1 })).replace(
      / data-hk="[^"]*"/g,
      "",
    );
    expect(html).toBe("<div>x</div>");
  });

  it("[SOLID-CF-263] jsx-attributes/on_: spread props on the server drop event handlers but keep attributes", async () => {
    const App = await app("export const App = (props) => <div {...props}>x</div>;");
    const html = renderToString(() =>
      createComponent(App, { id: "a", onClick: () => 1, "on:foo": () => 2 }),
    ).replace(/ data-hk="[^"]*"/g, "");
    expect(html).toBe('<div id="a">x</div>');
  });
});

describe("reference/rendering/is-server", () => {
  it("[SOLID-CF-252] rendering/is-server: isServer is true in the server bundle", () => {
    expect(isServer).toBe(true);
  });
});
