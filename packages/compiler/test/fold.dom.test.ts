import { flushSync, useSignal } from "@shadow-js/core";
import { createComponent, hydrate, render } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/load";

const hosts: HTMLElement[] = [];
function host(html = ""): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  hosts.push(el);
  return el;
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});
function comments(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let n = 0;
  while (walker.nextNode()) n += 1;
  return n;
}
/** The hydration comment markers are the only difference a folded literal makes to the server markup. */
const withoutMarkers = (html: string): string => html.replace(/<!--[[\]]-->/g, "");

/**
 * The same markup twice: with literal children (folded by the compiler) and with the same values
 * read through a member expression (never folded, so each one is a real insert).
 */
const VALUES = [2026, " ", "!", null, false, "<&>", 3, ""];
const LITERAL = `export const view = () => (
  <p class="a">Copyright {2026} <b>x</b>{" "}y{"!"}{null}{false}{'<&>'}{1 + 2}{""}</p>
);`;
const OPAQUE = `export const view = (v) => () => (
  <p class="a">Copyright {v[0]} <b>x</b>{v[1]}y{v[2]}{v[3]}{v[4]}{v[5]}{v[6]}{v[7]}</p>
);`;

describe("folded literal children behave like inserted ones", () => {
  it("[OPT-FOLD-30] client render: same markup, fewer nodes, no comments", async () => {
    const literal = await load<{ view: () => unknown }>(LITERAL);
    const opaque = await load<{ view: (v: unknown[]) => () => unknown }>(OPAQUE);
    const a = host();
    const b = host();
    render(literal.view, a);
    render(opaque.view(VALUES), b);
    expect(a.innerHTML).toBe('<p class="a">Copyright 2026 <b>x</b> y!&lt;&amp;&gt;3</p>');
    expect(a.innerHTML).toBe(b.innerHTML);
    expect(a.textContent).toBe(b.textContent);
    // Three nodes in the folded paragraph: the text before <b>, <b>, and the text after it.
    expect(a.querySelector("p")?.childNodes.length).toBe(3);
    expect(comments(a)).toBe(0);
  });

  it("[OPT-FOLD-31] server render: same markup apart from the hydration markers", async () => {
    const literal = await load<{ view: () => unknown }>(LITERAL, "ssr");
    const opaque = await load<{ view: (v: unknown[]) => () => unknown }>(OPAQUE, "ssr");
    const folded = renderToString(() => literal.view());
    const reference = renderToString(() => opaque.view(VALUES)());
    expect(withoutMarkers(reference)).toBe(folded);
    expect(folded).not.toContain("<!--[-->");
    expect(reference).toContain("<!--[-->");
    expect(folded).toContain("Copyright 2026 <b>x</b> y!&lt;&amp;&gt;3");
  });

  it("[OPT-FOLD-32] hydrating the folded server markup keeps every node and equals a client render", async () => {
    const dom = await load<{ view: () => unknown }>(LITERAL);
    const ssr = await load<{ view: () => unknown }>(LITERAL, "ssr");
    const target = host(renderToString(() => ssr.view()));
    const serverNodes = Array.from(target.querySelectorAll("*"));
    hydrate(dom.view, target);
    const rendered = host();
    render(dom.view, rendered);
    expect(target.innerHTML.replace(/ data-hk="[^"]*"/g, "")).toBe(rendered.innerHTML);
    for (const [i, node] of Array.from(target.querySelectorAll("*")).entries()) {
      expect(node).toBe(serverNodes[i]);
    }
    expect(comments(target)).toBe(0);
  });

  it("[OPT-FOLD-33] a dynamic slot between folded literals still updates in place", async () => {
    const [n, setN] = useSignal(1);
    const mod = await load<{ make: (n: () => number) => () => unknown }>(
      `export const make = (n) => () => <p>a{"b"}{n()}{"c"}d</p>;`,
    );
    const target = host();
    render(mod.make(n), target);
    expect(target.textContent).toBe("ab1cd");
    flushSync(() => setN(2));
    expect(target.textContent).toBe("ab2cd");
    expect(comments(target)).toBe(0);
  });

  it("[OPT-FOLD-34] parents where parsing differs keep the inserted text exactly", async () => {
    const mod = await load<{ view: () => unknown }>(
      `export const view = () => (
        <div>
          <pre>{"\\nkept"}</pre>
          <textarea>{"\\nalso"}</textarea>
          <table><tbody><tr>{"cell"}</tr></tbody></table>
        </div>
      );`,
    );
    const target = host();
    render(mod.view, target);
    expect(target.querySelector("pre")?.textContent).toBe("\nkept");
    expect((target.querySelector("textarea") as HTMLTextAreaElement).value).toBe("\nalso");
    expect(target.querySelector("tr")?.textContent).toBe("cell");
  });

  it("[OPT-FOLD-35] text with a carriage return or NUL arrives unchanged", async () => {
    const mod = await load<{ view: () => unknown }>(
      `export const view = () => <p>{"a\\r\\nb"}{"c\\u0000d"}</p>;`,
    );
    const target = host();
    render(mod.view, target);
    expect(target.querySelector("p")?.textContent).toBe("a\r\nbc\u0000d");
  });

  it("[OPT-FOLD-36] a component sees its children as written", async () => {
    const mod = await load<{ view: () => unknown }>(
      `const Count = (props) => <i>{Array.isArray(props.children) ? props.children.length : "single"}</i>;
       export const view = () => (
         <div>
           <Count>a{"b"}</Count>
           <Count>{"b"}</Count>
           <Count><>{"a"}x</></Count>
         </div>
       );`,
    );
    const target = host();
    render(() => createComponent(mod.view, {}), target);
    expect(Array.from(target.querySelectorAll("i"), (i) => i.textContent)).toEqual([
      "2",
      "single",
      "2",
    ]);
  });
});

describe("constant folding of attribute values keeps the written meaning", () => {
  it("[OPT-FOLD-40] folded attributes and props equal the computed ones", async () => {
    const mod = await load<{ view: () => unknown }>(
      `const Tag = (props) => <u data-n={props.n} data-s={props.s}>{props.n + 1}</u>;
       export const view = () => (
         <div>
           <img alt={"a" + "b"} width={1 + 2} data-n={-1} />
           <Tag n={2 * 3} s={"x" + 1 + 2} />
         </div>
       );`,
    );
    const target = host();
    render(mod.view, target);
    const img = target.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("ab");
    expect(img?.getAttribute("width")).toBe("3");
    expect(img?.getAttribute("data-n")).toBe("-1");
    const u = target.querySelector("u");
    expect(u?.getAttribute("data-n")).toBe("6");
    expect(u?.getAttribute("data-s")).toBe("x12");
    expect(u?.textContent).toBe("7");
  });
});
