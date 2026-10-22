import { flushSync, useId, useSignal } from "@shadow-js/core";
import { type HeadInput, render, useHead } from "@shadow-js/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

beforeEach(() => {
  document.head.innerHTML = "";
  document.title = "";
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  flushSync();
  for (const host of hosts.splice(0)) host.remove();
  document.head.innerHTML = "";
});

/** Names exported by the web package that this audit expects but ShadowJS does not have yet. */
async function webExport(name: string): Promise<unknown> {
  const web: Record<string, unknown> = await import("@shadow-js/web");
  return web[name];
}

describe("solid-meta/getting-started (client setup and installation)", () => {
  it("[SOLID-CF-170] getting-started/client-setup: Title, Link and Meta inject tags into the head", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Title, Link, Meta } from "@shadow-js/web";
      export const App = () => (
        <div class="Home">
          <Title>Title of page</Title>
          <Link rel="canonical" href="http://solidjs.com/" />
          <Meta name="example" content="whatever" />
        </div>
      );
    `);
    const host = mountApp(() => mod.App());
    expect(document.title).toBe("Title of page");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "http://solidjs.com/",
    );
    expect(document.head.querySelector('meta[name="example"]')?.getAttribute("content")).toBe(
      "whatever",
    );
    // The head components render nothing in place.
    expect(host.querySelector(".Home")?.childElementCount).toBe(0);
  });

  // DIFFERENCE from Solid (by design): MetaProvider is not exported; Solid apps wrap their tree in <MetaProvider> and ShadowJS has neither the component nor a need for it (document-scoped registry); packages/web/src/head/index.ts:1-12.
  it("[SOLID-CF-171] metaprovider: MetaProvider wraps the application and renders its children (differs from Solid; ShadowJS: there is no MetaProvider; the registry is document scoped)", async () => {
    expect(await webExport("MetaProvider")).toBeUndefined();
  });

  it("[SOLID-CF-172] metaprovider: head components work without any provider in the tree", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Title, Meta } from "@shadow-js/web";
      export const App = () => (<><Title>No provider</Title><Meta name="description" content="Solid documentation" /></>);
    `);
    mountApp(() => mod.App());
    expect(document.title).toBe("No provider");
    expect(document.head.querySelector('meta[name="description"]')).not.toBeNull();
  });

  it("[SOLID-CF-173] metaprovider: tags are removed from the head when the component is disposed", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { Title, Meta } from "@shadow-js/web";
      export const App = () => (<><Title>Gone</Title><Meta name="description" content="x" /></>);
    `);
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const dispose = render(() => mod.App(), host);
    expect(document.head.querySelector('meta[name="description"]')).not.toBeNull();
    dispose();
    flushSync();
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  });

  it("[SOLID-CF-174] getting-started/installation: head tags already in index.html are not overwritten", async () => {
    document.head.innerHTML =
      '<meta name="description" content="static"><link rel="icon" href="/a.ico">';
    const mod = await load<{ App: () => unknown }>(`
      import { Meta } from "@shadow-js/web";
      export const App = () => <Meta name="description" content="dynamic" />;
    `);
    mountApp(() => mod.App());
    const metas = Array.from(document.head.querySelectorAll('meta[name="description"]'));
    expect(metas.map((meta) => meta.getAttribute("content"))).toEqual(["static", "dynamic"]);
    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/a.ico");
  });

  // DIFFERENCE from Solid (by design): ShadowJS adopts only elements it marked itself (data-shadow-head) and the page title; Solid lets a plain `data-sm` attribute mark an index.html tag as overwritable; packages/web/src/head/sink.ts:35-45.
  it("[SOLID-CF-175] getting-started/installation: an empty data-sm attribute marks an existing tag as overwritable (differs from Solid; ShadowJS: only tags ShadowJS wrote itself are adopted; a page tag stays)", async () => {
    document.head.innerHTML = '<meta data-sm="" name="description" content="static">';
    const mod = await load<{ App: () => unknown }>(`
      import { Meta } from "@shadow-js/web";
      export const App = () => <Meta name="description" content="dynamic" />;
    `);
    mountApp(() => mod.App());
    const metas = Array.from(document.head.querySelectorAll('meta[name="description"]'));
    expect(metas.map((meta) => meta.getAttribute("content"))).toEqual(["static", "dynamic"]);
  });

  it("[SOLID-CF-176] getting-started/installation: server-generated tags are replaced by the client's (ShadowJS adopts the marked element)", async () => {
    document.head.innerHTML =
      '<title data-shadow-head>From server</title><meta data-shadow-head name="description" content="server">';
    const serverTitle = document.head.querySelector("title");
    const serverMeta = document.head.querySelector("meta");
    const mod = await load<{ App: () => unknown }>(`
      import { Title, Meta } from "@shadow-js/web";
      export const App = () => (<><Title>From client</Title><Meta name="description" content="client" /></>);
    `);
    mountApp(() => mod.App());
    expect(document.head.querySelectorAll("title").length).toBe(1);
    expect(document.head.querySelector("title")).toBe(serverTitle);
    expect(document.head.querySelector("meta")).toBe(serverMeta);
    expect(serverTitle?.textContent).toBe("From client");
    expect(serverMeta?.getAttribute("content")).toBe("client");
  });
});

describe("solid-meta/reference/meta (Title, Meta, Link, Style, Base)", () => {
  it("[SOLID-CF-177] meta/title: Title sets the document title and follows a signal", async () => {
    const mod = await load<{ Root: (props: { text: () => string }) => unknown }>(`
      import { Title } from "@shadow-js/web";
      export const Root = (props) => <Title>{props.text()}</Title>;
    `);
    const [text, setText] = useSignal("Solid Docs");
    mountApp(() => mod.Root({ text }));
    expect(document.title).toBe("Solid Docs");
    flushSync(() => setText("Updated"));
    expect(document.title).toBe("Updated");
    expect(document.head.querySelectorAll("title").length).toBe(1);
  });

  it("[SOLID-CF-178] meta/title: cascading keeps the latest Title and restores the previous one when it is removed", async () => {
    const mod = await load<{ Root: (props: { show: () => boolean }) => unknown }>(`
      import { Show } from "@shadow-js/web";
      import { Title } from "@shadow-js/web";
      export const Root = (props) => (
        <>
          <Title>Base title</Title>
          <Show when={props.show()}><Title>Nested title</Title></Show>
        </>
      );
    `);
    const [show, setShow] = useSignal(true);
    mountApp(() => mod.Root({ show }));
    expect(document.title).toBe("Nested title");
    flushSync(() => setShow(false));
    expect(document.title).toBe("Base title");
    expect(document.head.querySelectorAll("title").length).toBe(1);
  });

  it("[SOLID-CF-179] meta/meta: the documented Root example registers charset, viewport and description", async () => {
    const mod = await load<{ Root: () => unknown }>(`
      import { Meta } from "@shadow-js/web";
      export default function Root() {
        return (
          <>
            <Meta charset="utf-8" />
            <Meta name="viewport" content="width=device-width, initial-scale=1" />
            <Meta name="description" content="Hacker News Clone built with Solid" />
          </>
        );
      }
    `);
    mountApp(() => (mod as unknown as { default: () => unknown }).default());
    expect(document.head.querySelector("meta[charset]")?.getAttribute("charset")).toBe("utf-8");
    expect(document.head.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
      "width=device-width, initial-scale=1",
    );
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Hacker News Clone built with Solid",
    );
  });

  it("[SOLID-CF-180] meta/meta: a later Meta with the same name replaces the earlier one and the earlier returns on removal", async () => {
    const mod = await load<{ Root: (props: { show: () => boolean }) => unknown }>(`
      import { Show, Meta } from "@shadow-js/web";
      export const Root = (props) => (
        <>
          <Meta name="description" content="first" />
          <Show when={props.show()}><Meta name="description" content="second" /></Show>
        </>
      );
    `);
    const [show, setShow] = useSignal(true);
    mountApp(() => mod.Root({ show }));
    const content = () =>
      Array.from(document.head.querySelectorAll('meta[name="description"]'), (meta) =>
        meta.getAttribute("content"),
      );
    expect(content()).toEqual(["second"]);
    flushSync(() => setShow(false));
    expect(content()).toEqual(["first"]);
  });

  // DIFFERENCE from Solid (by design): ShadowJS keys a meta by its first present field of name, property, http-equiv, charset, so name="x" and property="x" are two different tags; Solid treats property as name when it builds the key; packages/web/src/head/validate.ts:156-166.
  it("[SOLID-CF-181] meta/meta: property is treated as name when building the tag key (differs from Solid; ShadowJS: name and property make two different tags)", async () => {
    const mod = await load<{ Root: () => unknown }>(`
      import { Meta } from "@shadow-js/web";
      export const Root = () => (
        <>
          <Meta name="og:title" content="by name" />
          <Meta property="og:title" content="by property" />
        </>
      );
    `);
    mountApp(() => mod.Root());
    expect(document.head.querySelectorAll("meta").length).toBe(2);
  });

  it("[SOLID-CF-182] meta/meta: Meta props are attributes and reactive getters are tracked", async () => {
    const mod = await load<{ Root: (props: { content: () => string }) => unknown }>(`
      import { Meta } from "@shadow-js/web";
      export const Root = (props) => <Meta name="theme-color" content={props.content()} />;
    `);
    const [content, setContent] = useSignal("#fff");
    mountApp(() => mod.Root({ content }));
    const meta = document.head.querySelector('meta[name="theme-color"]');
    expect(meta?.getAttribute("content")).toBe("#fff");
    flushSync(() => setContent("#000"));
    expect(document.head.querySelector('meta[name="theme-color"]')).toBe(meta);
    expect(meta?.getAttribute("content")).toBe("#000");
  });

  it("[SOLID-CF-183] meta/link: Link adds a link element with its attributes", async () => {
    const mod = await load<{ Root: () => unknown }>(`
      import { Link } from "@shadow-js/web";
      export default function Root() { return <Link rel="icon" href="/favicon.ico" />; }
    `);
    mountApp(() => (mod as unknown as { default: () => unknown }).default());
    const link = document.head.querySelector("link");
    expect(link?.getAttribute("rel")).toBe("icon");
    expect(link?.getAttribute("href")).toBe("/favicon.ico");
  });

  it("[SOLID-CF-184] meta/link: several non-cascading links can coexist, one element per active instance", async () => {
    const mod = await load<{ Root: () => unknown }>(`
      import { Link } from "@shadow-js/web";
      export const Root = () => (
        <>
          <Link rel="canonical" href="https://a.example/" />
          <Link rel="alternate" href="/rss.xml" />
          <Link rel="alternate" href="/atom.xml" />
        </>
      );
    `);
    mountApp(() => mod.Root());
    expect(document.head.querySelectorAll("link").length).toBe(3);
  });

  it("[SOLID-CF-185] meta/style: Style puts its text children in a style element", async () => {
    const mod = await load<{ Root: () => unknown }>(`
      import { Style } from "@shadow-js/web";
      export default function Root() {
        return <Style>{\`p { color: #26b72b; }\`}</Style>;
      }
    `);
    mountApp(() => (mod as unknown as { default: () => unknown }).default());
    expect(document.head.querySelector("style")?.textContent).toBe("p { color: #26b72b; }");
  });

  it("[SOLID-CF-186] meta/style: styles without a key are all kept; a key replaces an earlier style with that key", async () => {
    const mod = await load<{ Root: () => unknown }>(`
      import { Style } from "@shadow-js/web";
      export const Root = () => (
        <>
          <Style>{"a {}"}</Style>
          <Style>{"b {}"}</Style>
          <Style key="theme">{"c {}"}</Style>
          <Style key="theme">{"d {}"}</Style>
        </>
      );
    `);
    mountApp(() => mod.Root());
    expect(
      Array.from(document.head.querySelectorAll("style"), (style) => style.textContent),
    ).toEqual(["a {}", "b {}", "d {}"]);
  });

  it("[SOLID-CF-187] meta/base: Base sets the base URL and is placed first in the head", async () => {
    document.head.innerHTML = "<meta charset='utf-8'>";
    const mod = await load<{ Root: () => unknown }>(`
      import { Base } from "@shadow-js/web";
      export default function Root() { return <Base href="https://docs.solidjs.com/" />; }
    `);
    mountApp(() => (mod as unknown as { default: () => unknown }).default());
    const first = document.head.firstElementChild;
    expect(first?.localName).toBe("base");
    expect(first?.getAttribute("href")).toBe("https://docs.solidjs.com/");
  });
});

describe("solid-meta/reference/meta/use-head", () => {
  it("[SOLID-CF-188] meta/use-head: useHead registers a custom link tag (RSS example, Solid-shaped description)", async () => {
    const mod = await load<{ Root: (props: { useHead: unknown; id: () => string }) => unknown }>(`
      function RssLink(props) {
        props.useHead({
          tag: "link",
          id: props.id(),
          props: { rel: "alternate", type: "application/rss+xml", title: "Solid RSS", href: "/rss.xml" },
        });
      }
      export const Root = (props) => <RssLink {...props} />;
    `);
    mountApp(() => mod.Root({ useHead, id: () => useId() }));
    const link = document.head.querySelector("link");
    expect(link?.getAttribute("rel")).toBe("alternate");
    expect(link?.getAttribute("type")).toBe("application/rss+xml");
    expect(link?.getAttribute("title")).toBe("Solid RSS");
    expect(link?.getAttribute("href")).toBe("/rss.xml");
  });

  it("[SOLID-CF-189] meta/use-head: useHead removes its tag when the owner is disposed", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const dispose = render(() => {
      const tag: HeadInput = { tag: "meta", props: { name: "robots", content: "noindex" } };
      useHead(tag);
      return null;
    }, host);
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeNull();
    dispose();
    flushSync();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("[SOLID-CF-190] meta/use-head: useHead registers a reactive description via a function", () => {
    const [content, setContent] = useSignal("one");
    mountApp(() => {
      useHead(() => ({ tag: "meta", props: { name: "x", content: content() } }));
      return null;
    });
    expect(document.head.querySelector('meta[name="x"]')?.getAttribute("content")).toBe("one");
    flushSync(() => setContent("two"));
    expect(document.head.querySelector('meta[name="x"]')?.getAttribute("content")).toBe("two");
  });

  it("[SOLID-CF-191] meta/use-head: useHead with setting.close renders text content in a style", () => {
    mountApp(() => {
      useHead({ tag: "style", children: "body { margin: 0 }" });
      return null;
    });
    expect(document.head.querySelector("style")?.textContent).toBe("body { margin: 0 }");
  });

  // DIFFERENCE from Solid (by design): useHead refuses tag "script" (security decision, a head-registered script would bypass CSP nonces); the documented JSON-LD example cannot be expressed; packages/web/src/head/validate.ts:6-9,214.
  it("[SOLID-CF-192] meta/use-head: a script tag with application/ld+json contents (JSON-LD example) (differs from Solid; ShadowJS: a script tag is refused)", () => {
    const jsonLD = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Docs",
    });
    expect(() =>
      mountApp(() => {
        useHead({
          tag: "script",
          setting: { close: true, escape: false },
          id: useId(),
          props: { type: "application/ld+json", children: jsonLD },
        } as unknown as HeadInput);
        return null;
      }),
    ).toThrow();
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it("[SOLID-CF-193] meta/use-head: useHead needs no provider and, outside an owner, warns and registers nothing", () => {
    const warn = console.warn as unknown as { mock: { calls: unknown[][] }; mockClear(): void };
    useHead({ tag: "meta", props: { name: "orphan", content: "x" } });
    flushSync();
    expect(document.head.querySelector('meta[name="orphan"]')).toBeNull();
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "HEAD_OUTSIDE_OWNER",
    );
    warn.mockClear();
  });

  it("[SOLID-CF-194] meta/use-head: an invalid tag description is a TypeError", () => {
    expect(() =>
      mountApp(() => {
        useHead({ tag: "div" } as unknown as HeadInput);
        return null;
      }),
    ).toThrow(TypeError);
  });
});
