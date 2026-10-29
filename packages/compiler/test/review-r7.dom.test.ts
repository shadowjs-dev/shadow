import { flushSync, useSignal } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "./support/load";

const containers: HTMLElement[] = [];
function mount(view: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  containers.push(host);
  render(view, host);
  return host;
}
afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_NS = "http://www.w3.org/1998/Math/MathML";
const HTML_NS = "http://www.w3.org/1999/xhtml";

describe("compiled output of round seven runs", () => {
  it("[CMP-R7-1] a value awaited or yielded in JSX is read where the JSX is written", async () => {
    const mod = await load<{
      generator: (p: { t: string; a: string }) => Generator<string, Element, string>;
    }>(`export function* generator(p) { return <div title={yield p.t}>{yield p.a}</div>; }`);
    const steps = mod.generator({ t: "title", a: "body" });
    expect(steps.next().value).toBe("title");
    expect(steps.next("T").value).toBe("body");
    const host = mount(() => steps.next("A").value);
    expect(host.innerHTML).toBe('<div title="T">A</div>');
  });

  it("[CMP-R7-1b] an async view resolves its awaited values into the markup", async () => {
    const mod = await load<{ view: (p: Record<string, Promise<string>>) => Promise<Element> }>(
      `export const view = async (p) => <p title={await p.t}>{await p.a}-{await p.b}</p>;`,
    );
    const node = await mod.view({
      t: Promise.resolve("T"),
      a: Promise.resolve("A"),
      b: Promise.resolve("B"),
    });
    // The bindings of a view built after an await have no owner (the framework says so): the test owns that warning.
    const warn = vi.mocked(console.warn);
    expect(warn.mock.calls.flat().join(" ")).toContain("NO_OWNER_EFFECT");
    warn.mockClear();
    const host = mount(() => node);
    expect(host.innerHTML).toBe('<p title="T">A-B</p>');
  });

  it("[CMP-R7-2] an indexed object literal in an expression renders and follows its signal", async () => {
    const [mode, setMode] = useSignal("light");
    const mod = await load<{ view: (p: { mode: string }) => unknown }>(
      `export const view = (p) => <div title={{ light: "l", dark: "d" }[p.mode]}>{{ light: "L", dark: "D" }[p.mode]}</div>;`,
    );
    const host = mount(() =>
      mod.view({
        get mode() {
          return mode();
        },
      }),
    );
    expect(host.innerHTML).toBe('<div title="l">L</div>');
    flushSync(() => setMode("dark"));
    expect(host.innerHTML).toBe('<div title="d">D</div>');
  });

  it("[CMP-R7-3] this in the props and children of a component is the method's object", async () => {
    const mod = await load<{
      o: { render(): unknown };
      args: (...values: string[]) => unknown;
    }>(
      [
        "const Show = (p) => <b title={p.title}>{p.children}</b>;",
        "export const o = { name: 'N', render() { return <Show title={this.name}>{this.name}</Show>; } };",
        "export function args() { return <Show title={arguments[0]}>{arguments[1]}</Show>; }",
      ].join("\n"),
    );
    expect(mount(() => mod.o.render()).innerHTML).toBe('<b title="N">N</b>');
    expect(mount(() => mod.args("a", "b")).innerHTML).toBe('<b title="a">b</b>');
  });

  it("[CMP-R7-9] a property that an element lacks is written as an attribute", async () => {
    const mod = await load<{ view: (p: Record<string, unknown>) => unknown }>(
      `export const view = (p) => <section><div disabled={p.d} selected={p.s} value={p.v} /><li value={p.v} /><input value={p.v} /></section>;`,
    );
    const host = mount(() => mod.view({ d: true, s: false, v: undefined }));
    const [div, item, input] = Array.from(host.querySelectorAll("div, li, input"));
    expect(div?.getAttribute("disabled")).toBe("");
    expect(div?.hasAttribute("selected")).toBe(false);
    expect(div?.hasAttribute("value")).toBe(false);
    expect("selected" in (div ?? {})).toBe(false);
    // `undefined` removes the attribute; the property would have written 0.
    expect(item?.hasAttribute("value")).toBe(false);
    expect((input as HTMLInputElement).value).toBe("");
    const withValue = mount(() => mod.view({ d: false, s: true, v: 3 }));
    expect(withValue.querySelector("li")?.getAttribute("value")).toBe("3");
    expect(withValue.querySelector("div")?.getAttribute("selected")).toBe("");
    expect((withValue.querySelector("input") as HTMLInputElement).value).toBe("3");
  });

  it("[CMP-R7-10] a hyphenated name on a custom element is an attribute", async () => {
    const mod = await load<{ view: (p: Record<string, unknown>) => unknown }>(
      `export const view = (p) => <my-el data-state={p.s} aria-label={p.l} items={p.i} />;`,
    );
    const items = [1, 2];
    const host = mount(() => mod.view({ s: "open", l: "Menu", i: items }));
    const el = host.querySelector("my-el") as HTMLElement;
    expect(el.getAttribute("data-state")).toBe("open");
    expect(el.getAttribute("aria-label")).toBe("Menu");
    expect(Reflect.has(el, "data-state")).toBe(false);
    expect(Reflect.get(el, "items")).toBe(items);
  });

  it("[CMP-R7-11] a function handed to a property is the value, not called", async () => {
    const mod = await load<{ view: (cb: () => string) => unknown }>(
      `export const view = (cb) => <my-el prop:renderItem={cb} cb={cb} />;`,
    );
    let calls = 0;
    const cb = (): string => {
      calls += 1;
      return "called";
    };
    const host = mount(() => mod.view(cb));
    const el = host.querySelector("my-el") as HTMLElement;
    expect(calls).toBe(0);
    expect(Reflect.get(el, "renderItem")).toBe(cb);
    expect(Reflect.get(el, "cb")).toBe(cb);
  });

  it("[CMP-R7-12] conditional JSX inside svg and math is built in that namespace", async () => {
    const mod = await load<{
      view: (c: boolean) => unknown;
      math: (c: boolean) => unknown;
      back: (c: boolean) => unknown;
    }>(
      [
        "export const view = (c) => <svg><text>{c ? <a href='#'><tspan>t</tspan></a> : null}</text>{c && <style />}{c && <title />}</svg>;",
        "export const math = (c) => <math>{c && <mrow><mi>x</mi></mrow>}</math>;",
        "export const back = (c) => <svg><foreignObject>{c && <div><span /></div>}</foreignObject></svg>;",
      ].join("\n"),
    );
    const svg = mount(() => mod.view(true));
    for (const name of ["a", "tspan", "style", "title"]) {
      expect(svg.querySelector(name)?.namespaceURI, name).toBe(SVG_NS);
    }
    const math = mount(() => mod.math(true));
    expect(math.querySelector("mrow")?.namespaceURI).toBe(MATH_NS);
    expect(math.querySelector("mi")?.namespaceURI).toBe(MATH_NS);
    const back = mount(() => mod.back(true));
    expect(back.querySelector("div")?.namespaceURI).toBe(HTML_NS);
    expect(back.querySelector("span")?.namespaceURI).toBe(HTML_NS);
  });

  it("[CMP-R7-6] server class: and style: directives on an element with a spread reach the markup", async () => {
    const mod = await load<{ view: (r: object, on: boolean, color: string) => unknown }>(
      `export const view = (r, on, color) => <div {...r} class:on={on} style:color={color} on:click={() => undefined} />;`,
      "ssr",
    );
    const html = renderToString(() => mod.view({ id: "x", class: "a" }, true, "red") as never);
    expect(html).toContain('class="a on"');
    expect(html).toContain('style="color:red"');
    expect(html).not.toContain("class:");
    expect(html).not.toContain("style:");
    expect(html).not.toContain("on:");
  });

  it("[CMP-R7-7] a static style and a style: directive are one style attribute on the server", async () => {
    const mod = await load<{ view: (color: string) => unknown }>(
      `export const view = (color) => <div style="margin:0" style:color={color} />;`,
      "ssr",
    );
    const html = renderToString(() => mod.view("red") as never);
    expect(html.match(/style=/g)?.length).toBe(1);
    expect(html).toContain('style="margin:0;color:red"');
  });

  it("[CMP-R7-8] a component sees on* and ref props on the server as on the client", async () => {
    const mod = await load<{ view: (f: () => void, r: () => void) => unknown }>(
      [
        "const Field = (p) => <i>{typeof p.onChange}/{typeof p.ref}/{typeof p.onBlur}</i>;",
        "export const view = (f, r) => <Field onChange={f} ref={r} onBlur={f} />;",
      ].join("\n"),
      "ssr",
    );
    const html = renderToString(
      () =>
        mod.view(
          () => undefined,
          () => undefined,
        ) as never,
    );
    expect(html).toContain("function");
    expect(html).not.toContain("undefined");
  });
});
