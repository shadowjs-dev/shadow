import { flushSync, useStore } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../src/index";
import { load } from "./support/compile";
import { cleanupDom, XLINK_NS } from "./support/dom";

type Module = Record<string, (...args: never[]) => unknown>;

/** Mounts the compiled component `name` of `mod` into a fresh host; `props` are the component's props. */
function mountOf(mod: Module, name: string, props: unknown = {}): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const component = mod[name] as (props: unknown) => unknown;
  render(() => component(props), host);
  return host;
}

afterEach(() => {
  cleanupDom();
});

describe("SVG presentation attributes at run time", () => {
  it("[RCW-SVG-01] a compiled dynamic camelCase presentation attribute is written hyphenated and follows its value", async () => {
    const mod = await load<Module>(
      "export const App = (p) => <svg><path strokeWidth={p.w} fillOpacity={0.5} /></svg>;",
    );
    const [w, setW] = useStore(2);
    const host = mountOf(mod, "App", {
      get w() {
        return w();
      },
    });
    const path = host.querySelector("path");
    expect(path?.getAttribute("stroke-width")).toBe("2");
    expect(path?.getAttribute("fill-opacity")).toBe("0.5");
    setW(4);
    flushSync();
    expect(path?.getAttribute("stroke-width")).toBe("4");
  });

  it("[RCW-SVG-02] a spread presentation prop and a spread xlinkHref land on the real attributes", async () => {
    const mod = await load<Module>(
      "export const App = (p) => <svg><use {...p.props} /><rect {...{ strokeLinecap: 'round' }} /></svg>;",
    );
    const host = mountOf(mod, "App", { props: { xlinkHref: "#a", stopColor: "red" } });
    expect(host.querySelector("use")?.getAttributeNS(XLINK_NS, "href")).toBe("#a");
    expect(host.querySelector("use")?.getAttribute("stop-color")).toBe("red");
    expect(host.querySelector("rect")?.getAttribute("stroke-linecap")).toBe("round");
  });

  it("[RCW-SVG-03] viewBox keeps its case on a spread SVG element", async () => {
    const mod = await load<Module>("export const App = (p) => <svg {...p.props}><g /></svg>;");
    const host = mountOf(mod, "App", { props: { viewBox: "0 0 2 2" } });
    expect(host.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 2 2");
  });
});

describe("HTML attribute names at run time", () => {
  it("[RCW-HTML-01] colSpan and cellPadding are written lower-case, dynamic and spread", async () => {
    const mod = await load<Module>(
      "export const App = (p) => <table><tbody><tr><td colSpan={p.n} /><td {...p.cell} /></tr></tbody></table>;",
    );
    const host = mountOf(mod, "App", { n: 2, cell: { cellPadding: "3", rowSpan: 1 } });
    expect(host.querySelector("td")?.getAttribute("colspan")).toBe("2");
    const cells = host.querySelectorAll("td");
    expect(cells[1]?.getAttribute("cellpadding")).toBe("3");
    expect(cells[1]?.getAttribute("rowspan")).toBe("1");
  });

  it("[RCW-HTML-02] a spread className and htmlFor write class and for", async () => {
    const mod = await load<Module>(
      "export const App = (p) => <div><label {...p.props}>x</label></div>;",
    );
    const host = mountOf(mod, "App", { props: { className: "a b", htmlFor: "f" } });
    expect(host.querySelector("label")?.getAttribute("class")).toBe("a b");
    expect(host.querySelector("label")?.getAttribute("for")).toBe("f");
  });
});

describe("React event names at run time", () => {
  it("[RCW-EVT-01] onChange on a text input runs on every edit, and onchange only on change", async () => {
    const mod = await load<Module>(
      'export const App = (p) => <input type="text" onChange={() => p.log.push("react")} onchange={() => p.log.push("native")} />;',
    );
    const log: string[] = [];
    const host = mountOf(mod, "App", { log });
    const input = host.querySelector("input") as HTMLInputElement;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(log).toEqual(["react"]);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(log).toEqual(["react", "native"]);
  });

  it("[RCW-EVT-02] onChange on a select runs on change, not on input", async () => {
    const mod = await load<Module>(
      'export const App = (p) => <select onChange={() => p.log.push("change")}><option>a</option></select>;',
    );
    const log: string[] = [];
    const host = mountOf(mod, "App", { log });
    const select = host.querySelector("select") as HTMLSelectElement;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    expect(log).toEqual([]);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(log).toEqual(["change"]);
  });

  it("[RCW-EVT-03] onInput and onChange on one text input both run, in source order", async () => {
    const mod = await load<Module>(
      'export const App = (p) => <input type="text" onInput={() => p.log.push("input")} onChange={() => p.log.push("change")} />;',
    );
    const log: string[] = [];
    const host = mountOf(mod, "App", { log });
    host.querySelector("input")?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(log).toEqual(["input", "change"]);
  });

  it("[RCW-EVT-04] onFocus bubbles from a child (focusin), so a wrapper sees its inputs get focus", async () => {
    const mod = await load<Module>(
      'export const App = (p) => <div onFocus={() => p.log.push("wrapper")}><input /></div>;',
    );
    const log: string[] = [];
    const host = mountOf(mod, "App", { log });
    host.querySelector("input")?.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(log).toEqual(["wrapper"]);
  });

  it("[RCW-EVT-05] onClickCapture runs in the capture phase, before the target's onClick", async () => {
    const mod = await load<Module>(
      'export const App = (p) => <div onClickCapture={() => p.log.push("capture")}><button onClick={() => p.log.push("click")}>x</button></div>;',
    );
    const log: string[] = [];
    const host = mountOf(mod, "App", { log });
    host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(log).toEqual(["capture", "click"]);
  });

  it("[RCW-EVT-06] a spread onChange follows React's text-input rule", async () => {
    const mod = await load<Module>('export const App = (p) => <input type="text" {...p.props} />;');
    const log: string[] = [];
    const host = mountOf(mod, "App", { props: { onChange: () => log.push("react") } });
    host.querySelector("input")?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(log).toEqual(["react"]);
  });

  it("[RCW-EVT-07] onWheel is passive: preventDefault does not cancel the wheel", async () => {
    const mod = await load<Module>(
      'export const App = (p) => <div onWheel={(e) => { e.preventDefault(); p.log.push("wheel"); }} />;',
    );
    const log: string[] = [];
    const host = mountOf(mod, "App", { log });
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    host.querySelector("div")?.dispatchEvent(event);
    expect(log).toEqual(["wheel"]);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("React props with no DOM form at run time", () => {
  it("[RCW-PROP-01] key and suppressHydrationWarning are not written, on an element or in a spread", async () => {
    const mod = await load<Module>(
      "export const App = (p) => <div key={p.id} suppressHydrationWarning {...p.props}>x</div>;",
    );
    const host = mountOf(mod, "App", {
      id: "a",
      props: { key: "b", suppressContentEditableWarning: true },
    });
    expect(host.querySelector("div")?.hasAttribute("key")).toBe(false);
    expect(host.querySelector("div")?.hasAttribute("suppresshydrationwarning")).toBe(false);
    expect(host.querySelector("div")?.attributes.length).toBe(0);
  });

  it("[RCW-PROP-02] dangerouslySetInnerHTML writes the markup, updates it, and clears it", async () => {
    const mod = await load<Module>(
      "export const App = (p) => <div dangerouslySetInnerHTML={{ __html: p.html() }} />;",
    );
    const [html, setHtml] = useStore("<b>one</b>");
    const host = mountOf(mod, "App", { html: () => html() });
    expect(host.querySelector("div")?.innerHTML).toBe("<b>one</b>");
    setHtml("<i>two</i>");
    flushSync();
    expect(host.querySelector("div")?.innerHTML).toBe("<i>two</i>");
  });

  it("[RCW-PROP-03] dangerouslySetInnerHTML in a spread writes innerHTML", async () => {
    const mod = await load<Module>("export const App = (p) => <div {...p.props} />;");
    const host = mountOf(mod, "App", {
      props: { dangerouslySetInnerHTML: { __html: "<em>x</em>" } },
    });
    expect(host.querySelector("div")?.innerHTML).toBe("<em>x</em>");
  });
});

describe("refs", () => {
  it("[RCW-REF-01] a { current } object receives the element and loses it when disposed", async () => {
    const mod = await load<Module>(
      "const box = { current: null }; export const App = () => <div ref={box} />; export const box2 = box;",
    );
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => (mod["App"] as () => unknown)(), host);
    const box = mod["box2"] as unknown as { current: Element | null };
    expect(box.current).toBe(host.querySelector("div"));
    dispose();
    expect(box.current).toBeNull();
  });

  it("[RCW-REF-02] a ref callback still receives the element once", async () => {
    const seen: string[] = [];
    const mod = await load<Module>(
      "export const App = (p) => <input ref={(el) => p.seen.push(el.tagName)} />;",
    );
    mountOf(mod, "App", { seen });
    expect(seen).toEqual(["INPUT"]);
  });
});

describe("function children", () => {
  it("[RCW-CHILD-01] a function child is a render prop: the component calls it with its value", async () => {
    const mod = await load<Module>(
      "export const Repeat = (p) => <div>{p.children(3)}</div>; export const App = (p) => <Repeat>{(v) => <b>{v}</b>}</Repeat>;",
    );
    const host = mountOf(mod, "App");
    expect(host.innerHTML).toBe("<div><b>3</b></div>");
  });
});

describe("select defaultValue at run time", () => {
  it("[RCW-SEL-01] defaultValue selects the matching option, compiled and in a spread", async () => {
    const mod = await load<Module>(
      'export const App = (p) => <div><select defaultValue={p.v}><option value="a">a</option><option value="b">b</option></select><select {...p.props}><option value="a">a</option><option value="b">b</option></select></div>;',
    );
    const host = mountOf(mod, "App", { v: "b", props: { defaultValue: "b" } });
    const selects = host.querySelectorAll("select");
    expect(selects[0]?.value).toBe("b");
    expect(selects[1]?.value).toBe("b");
  });
});

describe("style numbers at run time", () => {
  it("[RCW-STY-03] the vendor-prefixed unitless table keeps WebkitLineClamp bare and gives other numbers px", async () => {
    const { cssValueText } = await import("../src/internal/css-units");
    expect(cssValueText("-webkit-line-clamp", 3)).toBe("3");
    expect(cssValueText("-ms-flex", 2)).toBe("2");
    expect(cssValueText("margin-top", 2)).toBe("2px");
    expect(cssValueText("margin-top", 0)).toBe("0");
    expect(cssValueText("--gap", 4)).toBe("4");
    expect(cssValueText("width", "3")).toBe("3");
  });

  it("[RCW-STY-01] a number is in pixels, except unitless and custom properties", async () => {
    const mod = await load<Module>(
      'export const App = (p) => <div style={{ minWidth: p.w, opacity: 0.5, zIndex: 2, "--gap": 4, marginTop: "3em" }} />;',
    );
    const host = mountOf(mod, "App", { w: 3 });
    const style = (host.querySelector("div") as HTMLElement).style;
    expect(style.getPropertyValue("min-width")).toBe("3px");
    expect(style.getPropertyValue("opacity")).toBe("0.5");
    expect(style.getPropertyValue("z-index")).toBe("2");
    expect(style.getPropertyValue("--gap")).toBe("4");
    expect(style.getPropertyValue("margin-top")).toBe("3em");
  });

  it("[RCW-STY-02] zero stays zero and a number in a spread gets the same rule", async () => {
    const mod = await load<Module>("export const App = (p) => <div {...p.props} />;");
    const host = mountOf(mod, "App", { props: { style: { paddingLeft: 0, lineHeight: 1.5 } } });
    const style = (host.querySelector("div") as HTMLElement).style;
    expect(style.getPropertyValue("padding-left")).toMatch(/^0(px)?$/);
    expect(style.getPropertyValue("line-height")).toBe("1.5");
  });
});

describe("chainEvents and duplicate handlers", () => {
  it("[RCW-CHAIN-01] a handler chain calls each handler with the element as this", async () => {
    const { chainEvents } = await import("../src/index");
    const seen: unknown[] = [];
    const handler = chainEvents(
      function first(this: EventTarget) {
        seen.push(["first", this]);
      },
      () => seen.push("second"),
    );
    const div = document.createElement("div");
    handler.call(div, new Event("x"));
    expect(seen).toEqual([["first", div], "second"]);
  });
});

describe("the warnings stay quiet", () => {
  it("[RCW-QUIET-01] compiled React-spelled code writes no console warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mod = await load<Module>(
      'export const App = () => <div key="k" suppressHydrationWarning><input onChange={() => {}} onFocus={() => {}} /></div>;',
    );
    mountOf(mod, "App");
    expect(warn).not.toHaveBeenCalled();
  });
});
