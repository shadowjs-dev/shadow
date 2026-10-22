import { describe, expect, it } from "vitest";
import {
  createComponent,
  createServerPortals,
  renderToStream,
  renderToString,
  renderToStringAsync,
} from "../../src/server/index";
import { MAX_SERVER_PORTALS } from "../../src/server/portals";
import { load } from "../support/compile";

/** Compiled for the server: a portal with content, a nested portal, a portal whose content is async. */
const APP = `
import { Portal, Suspense } from "@shadow-js/web";
import { useResource } from "@shadow-js/core";

export const gate = { promise: null };
export function Dialog(props) {
  return <Portal><div class="dialog" role="dialog" data-id={props.id}>{props.text}</div></Portal>;
}
export function Nested(props) {
  return (
    <Portal>
      <section class="outer">
        <Portal><aside class="inner">{props.text}</aside></Portal>
      </section>
    </Portal>
  );
}
export function Slow(props) {
  const value = useResource(() => gate.promise, { key: "slow-" + props.id });
  return <Portal><p class="slow">{value() ?? "waiting"}</p></Portal>;
}
export function Streamed(props) {
  return <Suspense fallback={<i>loading</i>}><Slow id={props.id} /></Suspense>;
}
export function Page(props) {
  return <main><p class="inline">page</p>{props.children}</main>;
}
export function Item(props) {
  return <i>{props.n}</i>;
}
export function Crowd() {
  return <Portal><Item n="1" /><Item n="2" /><Item n="3" /></Portal>;
}
export function Empty() {
  return <Portal>{null}</Portal>;
}
export function Sibling() {
  return <p class="after">after</p>;
}
`;

interface App {
  readonly Crowd: () => unknown;
  readonly Empty: () => unknown;
  readonly Sibling: () => unknown;
  readonly Dialog: (props: { id: string; text: string }) => unknown;
  readonly Nested: (props: { text: string }) => unknown;
  readonly Slow: (props: { id: string }) => unknown;
  readonly Streamed: (props: { id: string }) => unknown;
  readonly Page: (props: { children?: unknown }) => unknown;
  readonly gate: { promise: Promise<string> | null };
}

async function app(): Promise<App> {
  return load<App>(APP, "ssr");
}

/** Markup without hydration keys and region markers, which carry no meaning for these assertions. */
function plain(html: string): string {
  return html.replace(/ data-hk="[^"]*"/g, "").replace(/<!--\[-->|<!--\]-->/g, "");
}

/** The portal blocks of the markup, in order: their keys and their content. */
function blocks(html: string): Array<{ key: string; content: string }> {
  const out: Array<{ key: string; content: string }> = [];
  const pattern = /<!--portal:([^>]*?)-->([\s\S]*?)<!--\/portal:\1-->/g;
  for (const match of html.matchAll(pattern)) {
    out.push({ key: match[1] ?? "", content: match[2] ?? "" });
  }
  return out;
}

describe("server render: portals", () => {
  it("[PORTAL-S1] a portal renders nothing in place and its content is collected as a block at the end", async () => {
    const mod = await app();
    const portals = createServerPortals();
    const html = renderToString(
      () =>
        createComponent(mod.Page, {
          children: createComponent(mod.Dialog, { id: "a", text: "hi" }),
        }),
      { portals },
    );
    expect(plain(html)).toBe('<main><p class="inline">page</p></main>');
    const [block] = blocks(portals.html());
    expect(block?.key).toMatch(/^0-[0-9-]+$/);
    expect(plain(portals.html())).toBe(
      `<!--portal:${block?.key}--><div class="dialog" role="dialog" data-id="a">hi</div><!--/portal:${block?.key}-->`,
    );
  });

  it("[PORTAL-S2] the content is escaped like any other output", async () => {
    const mod = await app();
    const portals = createServerPortals();
    renderToString(
      () => createComponent(mod.Dialog, { id: '"><b>', text: "<script>x</script> & y" }),
      {
        portals,
      },
    );
    const block = portals.html();
    expect(block).toContain('data-id="&quot;&gt;&lt;b&gt;"');
    expect(block).toContain("&lt;script&gt;x&lt;/script&gt; &amp; y");
    expect(block).not.toContain("<script>");
  });

  it("[PORTAL-S3] several portals each get their own block, in render order", async () => {
    const mod = await app();
    const portals = createServerPortals();
    renderToString(
      () => [
        createComponent(mod.Dialog, { id: "first", text: "1" }),
        createComponent(mod.Dialog, { id: "second", text: "2" }),
      ],
      { portals },
    );
    const found = blocks(portals.html());
    expect(found.map((block) => plain(block.content))).toEqual([
      '<div class="dialog" role="dialog" data-id="first">1</div>',
      '<div class="dialog" role="dialog" data-id="second">2</div>',
    ]);
    expect(new Set(found.map((block) => block.key)).size).toBe(2);
  });

  it("[PORTAL-S4] a portal nested in a portal is a block of its own, and the outer block does not repeat it", async () => {
    const mod = await app();
    const portals = createServerPortals();
    renderToString(() => createComponent(mod.Nested, { text: "deep" }), { portals });
    const found = blocks(portals.html());
    expect(found).toHaveLength(2);
    const outer = found.find((block) => plain(block.content).startsWith("<section"));
    expect(plain(outer?.content ?? "")).toBe('<section class="outer"></section>');
    expect(
      plain(found.find((block) => plain(block.content).startsWith("<aside"))?.content ?? ""),
    ).toBe('<aside class="inner">deep</aside>');
  });

  it("[PORTAL-S5] without a collector a portal renders nothing and the page is unchanged", async () => {
    const mod = await app();
    const html = renderToString(() => createComponent(mod.Dialog, { id: "a", text: "hi" }));
    expect(html).toBe("");
  });

  it("[PORTAL-S6] the keys of a sibling after a portal do not depend on what the portal rendered", async () => {
    const mod = await app();
    const siblingKey = (portal: () => unknown): string | undefined => {
      const html = renderToString(
        () => [createComponent(portal as () => unknown, {}), createComponent(mod.Sibling, {})],
        { portals: createServerPortals() },
      );
      return /<p data-hk="([^"]*)" class="after">/.exec(html)?.[1];
    };
    const crowded = siblingKey(mod.Crowd);
    expect(crowded).toBeDefined();
    expect(siblingKey(mod.Empty)).toBe(crowded);
  });

  it("[PORTAL-S7] renderToStringAsync keeps only the final pass, so an async portal is one block", async () => {
    const mod = await app();
    mod.gate.promise = Promise.resolve("loaded");
    const portals = createServerPortals();
    const result = await renderToStringAsync(() => createComponent(mod.Slow, { id: "s1" }), {
      portals,
    });
    expect(result.html).toBe("");
    const found = blocks(portals.html());
    expect(found).toHaveLength(1);
    expect(plain(found[0]?.content ?? "")).toBe('<p class="slow">loaded</p>');
  });

  it("[PORTAL-S8] renderToStream emits no portal in the stream; the collector holds it once the stream ends", async () => {
    const mod = await app();
    mod.gate.promise = Promise.resolve("streamed");
    const portals = createServerPortals();
    const stream = renderToStream(() => createComponent(mod.Streamed, { id: "b1" }), { portals });
    let text = "";
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      text += new TextDecoder().decode(chunk);
    }
    expect(text).not.toContain('<p class="slow">');
    const found = blocks(portals.html());
    expect(found.map((block) => plain(block.content))).toEqual(['<p class="slow">streamed</p>']);
  });

  it("[PORTAL-S9] the collector is bounded: a render with too many portals fails with SSR_PORTAL_LIMIT", async () => {
    const mod = await app();
    const items = Array.from({ length: MAX_SERVER_PORTALS + 1 }, (_, index) => index);
    expect(() =>
      renderToString(
        () => items.map((index) => createComponent(mod.Dialog, { id: String(index), text: "x" })),
        {
          portals: createServerPortals(),
        },
      ),
    ).toThrow(/SSR_PORTAL_LIMIT/);
  });

  it("[PORTAL-S10] a collector is reused safely: each render replaces what the previous one wrote", async () => {
    const mod = await app();
    const portals = createServerPortals();
    renderToString(() => createComponent(mod.Dialog, { id: "old", text: "old" }), { portals });
    renderToString(() => createComponent(mod.Dialog, { id: "new", text: "new" }), { portals });
    expect(blocks(portals.html()).map((block) => plain(block.content))).toEqual([
      '<div class="dialog" role="dialog" data-id="new">new</div>',
    ]);
  });
});
