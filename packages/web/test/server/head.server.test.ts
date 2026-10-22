import { useResource, useSignal } from "@shadow-js/core";
import { describe, expect, it, vi } from "vitest";
import { Base, Link, Meta, Style, Title, useHead } from "../../src/head/index";
import { resetWebWarningDedupe } from "../../src/internal/diagnostics";
import {
  createComponent,
  createServerHead,
  renderToStream,
  renderToString,
  renderToStringAsync,
} from "../../src/server/index";

const App = (props: { title: string }): unknown => {
  useHead({ tag: "title", children: props.title });
  useHead([
    { tag: "meta", props: { name: "description", content: "A page" } },
    { tag: "link", props: { rel: "canonical", href: "/page" } },
  ]);
  return "body";
};

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value);
  }
}

describe("server head", () => {
  it("[HSV-01] tags registered while rendering are collected with the adoption marker", () => {
    const head = createServerHead();
    const html = renderToString(() => createComponent(App, { title: "Home" }), { head });
    expect(html).toBe("body");
    expect(head.html()).toBe(
      "<title data-shadow-head>Home</title>" +
        '<meta data-shadow-head name="description" content="A page">' +
        '<link data-shadow-head rel="canonical" href="/page">',
    );
  });

  it("[HSV-02] the last registration of an identity wins, like in the browser", () => {
    const head = createServerHead();
    const Layout = (): unknown => {
      useHead({ tag: "title", children: "Layout" });
      return createComponent(Page, {});
    };
    const Page = (): unknown => {
      useHead({ tag: "title", children: "Page" });
      useHead({ tag: "meta", props: { name: "robots", content: "noindex" } });
      return null;
    };
    renderToString(() => createComponent(Layout, {}), { head });
    expect(head.html()).toBe(
      '<title data-shadow-head>Page</title><meta data-shadow-head name="robots" content="noindex">',
    );
    expect(head.tags()).toHaveLength(2);
  });

  it("[HSV-03] the head components register on the server", () => {
    const head = createServerHead();
    const View = (): unknown => [
      createComponent(Title, { children: "T & U" }),
      createComponent(Meta, { name: "theme-color", content: "#fff" }),
      createComponent(Link, { rel: "icon", href: "/f.ico" }),
      createComponent(Base, { href: "/app/" }),
      createComponent(Style, { key: "k", children: "a{color:red}" }),
    ];
    renderToString(() => createComponent(View, {}), { head });
    const html = head.html();
    expect(html).toContain("<title data-shadow-head>T &amp; U</title>");
    expect(html).toContain('<meta data-shadow-head name="theme-color" content="#fff">');
    expect(html).toContain('<link data-shadow-head rel="icon" href="/f.ico">');
    expect(html).toContain('<base data-shadow-head href="/app/">');
    expect(html).toContain('<style data-shadow-head data-shadow-key="k">a{color:red}</style>');
  });

  it("[HSV-04] text and attribute values are escaped; hostile input cannot break out of the head", () => {
    const head = createServerHead();
    renderToString(
      () => {
        useHead({ tag: "title", children: "</title><script>alert(1)</script>" });
        useHead({ tag: "meta", props: { name: 'x" onload="alert(1)', content: '"><b>' } });
        return null;
      },
      { head },
    );
    const html = head.html();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('"><b>');
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;");
    expect(html).toContain("&quot;");
  });

  it("[HSV-05] an unsafe URL attribute is dropped, and event attributes are rejected", () => {
    resetWebWarningDedupe();
    const head = createServerHead();
    expect(() =>
      renderToString(
        () => {
          useHead({ tag: "link", props: { rel: "stylesheet", href: "javascript:alert(1)" } });
          return null;
        },
        { head },
      ),
    ).not.toThrow();
    expect(head.html()).not.toContain("javascript:");
    const warnings = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(warnings.some((text) => text.includes("UNSAFE_URL_BLOCKED"))).toBe(true);
    vi.mocked(console.warn).mockClear();
    expect(() =>
      renderToString(
        () => {
          useHead({ tag: "meta", props: { onload: "x" } });
          return null;
        },
        { head: createServerHead() },
      ),
    ).toThrow(TypeError);
  });

  it("[HSV-06] a style that could close its own element is refused", () => {
    const head = createServerHead();
    renderToString(
      () => {
        useHead({ tag: "style", key: "k", children: "a{}</style><script>1</script>" });
        return null;
      },
      { head },
    );
    expect(() => head.html()).toThrow(TypeError);
  });

  it("[HSV-07] without a collector nothing is registered and nothing throws", () => {
    expect(renderToString(() => createComponent(App, { title: "x" }))).toBe("body");
  });

  it("[HSV-08] a function input is evaluated once, untracked", () => {
    const head = createServerHead();
    const [title] = useSignal("a");
    let calls = 0;
    renderToString(
      () => {
        useHead(() => {
          calls += 1;
          return { tag: "title", children: title() };
        });
        return null;
      },
      { head },
    );
    expect(calls).toBe(1);
    expect(head.html()).toBe("<title data-shadow-head>a</title>");
  });

  it("[HSV-09] a multi-pass async render keeps only the last pass's tags", async () => {
    const head = createServerHead();
    const Page = (): unknown => {
      const data = useResource(() => Promise.resolve("loaded"), { key: "d" });
      useHead({ tag: "title", children: data() ?? "loading" });
      useHead({ tag: "meta", props: { name: "x", content: "1" } });
      return null;
    };
    await renderToStringAsync(() => createComponent(Page, {}), { head });
    expect(head.html()).toBe(
      '<title data-shadow-head>loaded</title><meta data-shadow-head name="x" content="1">',
    );
  });

  it("[HSV-10] a stream hands the shell's head over before the shell is enqueued", async () => {
    const head = createServerHead();
    let atShell = "";
    const out = await readAll(
      renderToStream(() => createComponent(App, { title: "Streamed" }), {
        head,
        onShellReady: () => {
          atShell = head.html();
        },
      }),
    );
    expect(out).toBe("body");
    expect(atShell).toContain("<title data-shadow-head>Streamed</title>");
  });

  it("[HSV-11] useHead outside an owner on the server registers nothing and does not throw", () => {
    expect(() => useHead({ tag: "title", children: "x" })).not.toThrow();
  });

  it("[HSV-12] a collector can be cleared and reused", () => {
    const head = createServerHead();
    renderToString(() => createComponent(App, { title: "One" }), { head });
    head.clear();
    expect(head.html()).toBe("");
    renderToString(() => createComponent(App, { title: "Two" }), { head });
    expect(head.html()).toContain("Two");
  });

  it("[HSV-13] a nonce is written on styles only, and escaped", () => {
    const head = createServerHead();
    renderToString(
      () => [
        createComponent(Style, { key: "a", children: "a{color:red}" }),
        createComponent(Meta, { name: "x", content: "y" }),
      ],
      { head },
    );
    const html = head.html({ nonce: 'n"1' });
    expect(html).toContain('<style data-shadow-head data-shadow-key="a" nonce="n&quot;1">');
    expect(html).not.toContain('<meta data-shadow-head name="x" content="y" nonce');
  });
});
