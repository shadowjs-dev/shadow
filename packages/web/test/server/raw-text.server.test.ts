import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../../../compiler/src/javascript";
import { Dynamic } from "../../src/control-flow/dynamic";
import { element } from "../../src/element";
import {
  createComponent,
  renderToString,
  ssrElement,
  ssrRaw,
  ssrRawText,
} from "../../src/server/index";

type Component = (props: Record<string, unknown>) => unknown;

const dir = join(import.meta.dirname, ".generated");

/** Compiles JSX with the real SSR generator and imports the module, the way user code runs. */
async function load(source: string): Promise<Record<string, Component>> {
  mkdirSync(dir, { recursive: true });
  const { code } = compile(source, { filename: "case.tsx", generate: "ssr" });
  const name = `${createHash("sha1").update(`raw-text:${source}`).digest("hex").slice(0, 12)}.ts`;
  writeFileSync(join(dir, name), code);
  return (await import(/* @vite-ignore */ join(dir, name))) as Record<string, Component>;
}

function page(mod: Record<string, Component>, props: Record<string, unknown> = {}): string {
  const component = mod["App"];
  if (component === undefined) throw new Error("no export App");
  return renderToString(() => createComponent(component, props));
}

describe("raw text elements on the server: style and script", () => {
  it("[WEB-R2-1] ssrRawText writes the text as it is, and keeps a closing tag from ending the element", () => {
    expect(ssrRawText("style", "a > b { content: '&' }").t).toBe("a > b { content: '&' }");
    expect(ssrRawText("script", "if (a < b && c) go()").t).toBe("if (a < b && c) go()");
    // The closing tag, in any case, with or without what follows, is neutralized for CSS and JavaScript alike.
    expect(ssrRawText("style", "x</style><b>y").t).toBe("x<\\/style><b>y");
    expect(ssrRawText("style", "x</STYLE >y</Style").t).toBe("x<\\/STYLE >y<\\/Style");
    expect(ssrRawText("script", "x</script>y</SCRIPT").t).toBe("x<\\/script>y<\\/SCRIPT");
    // Only the element's own closing tag, and only `<!--` for a script.
    expect(ssrRawText("style", "a</script>b<!--c").t).toBe("a</script>b<!--c");
    expect(ssrRawText("script", "a<!--b").t).toBe("a<\\u0021--b");
    expect(ssrRawText("script", "<!-- <script> ... </script>").t).toBe(
      "<\\u0021-- <script> ... <\\/script>",
    );
  });

  it("[WEB-R2-2] ssrRawText takes anything a child can be: arrays, accessors, numbers, nothing", () => {
    expect(ssrRawText("style", ["a", () => "b", 3, null, undefined, false, [">"]]).t).toBe("ab3>");
    expect(ssrRawText("style", () => () => "x > y").t).toBe("x > y");
    expect(ssrRawText("style", null).t).toBe("");
    // A closing tag split over two pieces is still one closing tag once they are joined.
    expect(ssrRawText("style", ["</sty", "le>"]).t).toBe("<\\/style>");
    // Trusted markup passes through the same check: raw text has no markup to trust.
    expect(ssrRawText("script", ssrRaw("</script>")).t).toBe("<\\/script>");
    expect(() => ssrRawText("style", Symbol("x"))).toThrow(TypeError);
  });

  it("[WEB-R2-3] ssrRawText refuses a tag that is not a raw text element", () => {
    expect(() => ssrRawText("div" as "style", "x")).toThrow(/INVALID_RAW_TEXT_TAG/);
    expect(() => ssrRawText("textarea" as "style", "x")).toThrow(/INVALID_RAW_TEXT_TAG/);
    expect(() => ssrRawText(1 as unknown as "style", "x")).toThrow(/INVALID_RAW_TEXT_TAG/);
  });

  it("[WEB-R2-4] ssrElement writes the content of style and script raw, and neutralizes a closing tag", () => {
    expect(ssrElement("style", { children: "a > b {}" }).t).toBe("<style>a > b {}</style>");
    expect(ssrElement("STYLE", { children: "x</style>" }).t).toBe("<STYLE>x<\\/style></STYLE>");
    expect(ssrElement("script", { children: "a < b && c" }).t).toBe("<script>a < b && c</script>");
    expect(ssrElement("script", { children: "<!-- x </SCRIPT>" }).t).toBe(
      "<script><\\u0021-- x <\\/SCRIPT></script>",
    );
    expect(ssrElement("style", null, "a > b").t).toBe("<style>a > b</style>");
    // Content the compiler built is trusted markup and is not touched.
    expect(ssrElement("style", {}, ssrRaw("a > b")).t).toBe("<style>a > b</style>");
  });

  it("[WEB-R2-5] title and textarea content is escaped text, and SVG style stays an ordinary element", () => {
    expect(ssrElement("title", { children: "a > b & c" }).t).toBe(
      "<title>a &gt; b &amp; c</title>",
    );
    expect(ssrElement("textarea", { children: "a > b" }).t).toBe("<textarea>a &gt; b</textarea>");
    expect(ssrElement("style", { children: "a > b" }, undefined, false, true).t).toBe(
      "<style>a &gt; b</style>",
    );
  });

  it("[WEB-R2-6] element() and Dynamic write no region markers inside style, title and textarea", () => {
    const html = (build: () => unknown): string => renderToString(build);
    expect(html(() => element("style", { children: "a > b {}" }))).toBe(
      '<style data-hk="0-0">a > b {}</style>',
    );
    expect(html(() => element("title", { children: "a & b" }))).toBe(
      '<title data-hk="0-0">a &amp; b</title>',
    );
    expect(html(() => element("textarea", { children: "a" }))).toBe(
      '<textarea data-hk="0-0">a</textarea>',
    );
    expect(
      html(() => createComponent(Dynamic, { component: "style", children: "x</style>" })),
    ).toBe('<style data-hk="0-0-0">x<\\/style></style>');
    expect(html(() => createComponent(Dynamic, { component: "title", children: "t" }))).toBe(
      '<title data-hk="0-0-0">t</title>',
    );
    // Other elements keep their markers: their children are regions the client adopts.
    expect(html(() => element("div", { children: "a" }))).toBe(
      '<div data-hk="0-0"><!--[-->a<!--]--></div>',
    );
    expect(html(() => createComponent(Dynamic, { component: "p", children: "a" }))).toBe(
      '<p data-hk="0-0-0"><!--[-->a<!--]--></p>',
    );
  });

  it("[WEB-R2-7] compiled style, script and title children are written raw or escaped, with no markers", async () => {
    const mod = await load(`
      export function App(props) {
        return (
          <div>
            <style>{props.css}</style>
            <script>{props.js}</script>
            <title>{props.title}</title>
            <p>{props.text}</p>
          </div>
        );
      }`);
    const out = page(mod, {
      css: "a > b { color: red }",
      js: "if (a < b && c) x()",
      title: "a > b & c",
      text: "a > b",
    });
    expect(out).toContain("<style>a > b { color: red }</style>");
    expect(out).toContain("<script>if (a < b && c) x()</script>");
    expect(out).toContain("<title>a &gt; b &amp; c</title>");
    expect(out).toContain("<p><!--[-->a &gt; b<!--]--></p>");
    expect(out.match(/<!--\[-->/g)?.length).toBe(1);
  });

  it("[WEB-R2-8] a value cannot end its style or script element early, in any letter case", async () => {
    const mod = await load(`
      export function App(props) {
        return (
          <section>
            <style>{props.css}</style>
            <script>{props.js}</script>
          </section>
        );
      }`);
    const out = page(mod, {
      css: "a{}</STYLE><img src=x onerror=alert(1)>",
      js: "x</Script><img src=x onerror=alert(1)><!--",
    });
    expect(out).not.toMatch(/<\/STYLE|<\/Script|<!--(?!\[|\])/);
    expect(out).toContain("<style>a{}<\\/STYLE><img src=x onerror=alert(1)></style>");
    expect(out).toContain("<script>x<\\/Script><img src=x onerror=alert(1)><\\u0021--</script>");
    // Exactly one closing tag of each: the element's own.
    expect(out.match(/<\/style>/gi)?.length).toBe(1);
    expect(out.match(/<\/script>/gi)?.length).toBe(1);
  });

  it("[WEB-R2-9] text and expressions mixed in one style are one run of text", async () => {
    const mod = await load(
      "export function App(props) { return <style>{'a{'} color: {props.color}; {'}'}</style>; }",
    );
    expect(page(mod, { color: "red" })).toBe('<style data-hk="0-0-0">a{ color: red; }</style>');
    const empty = await load(
      "export function App(props) { return <style>{props.a}{props.b}</style>; }",
    );
    expect(page(empty, { a: "x > y", b: null })).toBe('<style data-hk="0-0-0">x > y</style>');
  });

  it("[WEB-R2-10] SVG style keeps its markers and its escaping, as the SVG parser reads it", async () => {
    const mod = await load(
      "export function App(props) { return <svg><style>{props.css}</style></svg>; }",
    );
    expect(page(mod, { css: "a > b" })).toBe(
      '<svg data-hk="0-0-0"><style><!--[-->a &gt; b<!--]--></style></svg>',
    );
  });
});
