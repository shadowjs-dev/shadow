import { describe, expect, it } from "vitest";
import {
  createComponent,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
  escape,
  memo,
  mergeProps,
  ssr,
  ssrElement,
  ssrHydrationKey,
  ssrRaw,
} from "../../src/server/index";

describe("ssr and ssrRaw", () => {
  it("[SSR-56] ssr concatenates parts and string holes", () => {
    expect(ssr(["<p>", "</p>"], "x").t).toBe("<p>x</p>");
    expect(ssr(["a"]).t).toBe("a");
  });

  it("[SSR-57] ssr rejects a hole count that does not match the parts", () => {
    expect(() => ssr(["a"], "x")).toThrow(TypeError);
    expect(() => ssr(["a", "b", "c"], "x")).toThrow(TypeError);
  });

  it("[SSR-58] ssr inserts nodes and rejects holes that are neither strings nor nodes", () => {
    expect(ssr(["<p>", "</p>"], ssrRaw("<i>x</i>")).t).toBe("<p><i>x</i></p>");
    expect(() => ssr(["a", "b"], 1)).toThrow(TypeError);
    expect(() => ssr(["a", "b"], JSON.parse('{"t":"<x>"}'))).toThrow(TypeError);
  });

  it("[SSR-59] ssrRaw passes trusted markup through and rejects non-strings", () => {
    expect(ssrRaw("<b>x</b>").t).toBe("<b>x</b>");
    expect(() => ssrRaw(42 as unknown as string)).toThrow(TypeError);
  });
});

describe("ssrElement", () => {
  it("[SSR-60] props become attributes", () => {
    expect(ssrElement("div", { id: "a", title: "<t>" }, undefined, false).t).toBe(
      '<div id="a" title="&lt;t&gt;"></div>',
    );
  });

  it("[SSR-61] ref, on*, on:, use:, prop: and forbidden keys are skipped, children is never an attribute", () => {
    const props = JSON.parse(
      '{"__proto__":{"x":1},"constructor":"c","prototype":"p","id":"a"}',
    ) as object;
    const out = ssrElement(
      "div",
      {
        ...props,
        ref: () => undefined,
        children: "x",
        onClick: () => 1,
        "on:click": 1,
        "use:x": 1,
        "prop:value": 2,
      },
      undefined,
      false,
    );
    // `children` is content, not an attribute (see SSR-171).
    expect(out.t).toBe('<div id="a">x</div>');
  });

  it("[SSR-62] attr: and bool: namespaces write attributes", () => {
    expect(
      ssrElement(
        "div",
        { "attr:data-x": "1", "bool:disabled": true, "bool:hidden": false },
        undefined,
        false,
      ).t,
    ).toBe('<div data-x="1" disabled></div>');
  });

  it("[SSR-63] void elements never get children or a closing tag", () => {
    expect(ssrElement("br", {}, ssr(["x"]), false).t).toBe("<br>");
    expect(ssrElement("input", { type: "text", disabled: true }, undefined, false).t).toBe(
      '<input type="text" disabled>',
    );
  });

  it("[SSR-64] children are escaped unless they are nodes", () => {
    expect(ssrElement("p", {}, "<x>", false).t).toBe("<p>&lt;x&gt;</p>");
    expect(ssrElement("p", {}, ssrRaw("<b>y</b>"), false).t).toBe("<p><b>y</b></p>");
  });

  it("[SSR-171] a spread children prop supplies the content, like the DOM spread", () => {
    expect(ssrElement("div", { class: "a", children: "hi <b>" }, undefined, false).t).toBe(
      '<div class="a">hi &lt;b&gt;</div>',
    );
    expect(ssrElement("div", { children: () => ssr(["<i>x</i>"]) }, undefined, false).t).toBe(
      "<div><i>x</i></div>",
    );
    // Explicit children written on the element win over the prop.
    expect(ssrElement("div", { children: "prop" }, "own", false).t).toBe("<div>own</div>");
  });

  it("[SSR-65] tag names are validated, so no markup can be injected through the tag", () => {
    for (const tag of ["script><img onerror=x", "div onclick", "", "1x", "a:b", "a/b", "div>"]) {
      expect(() => ssrElement(tag, {}, undefined, false), tag).toThrow(TypeError);
    }
  });

  it("[SSR-66] custom element names are accepted", () => {
    expect(ssrElement("my-el", {}, "x", false).t).toBe("<my-el>x</my-el>");
  });

  it("[SSR-67] class and classList merge into a single class attribute", () => {
    expect(
      ssrElement("div", { class: "a", classList: { b: true, c: false } }, undefined, false).t,
    ).toBe('<div class="a b"></div>');
  });

  it("[SSR-68] a style prop is rendered through ssrStyle", () => {
    expect(ssrElement("div", { style: { color: "red" } }, undefined, false).t).toBe(
      '<div style="color:red"></div>',
    );
  });

  it("[SSR-69] innerHTML is written raw and replaces the children", () => {
    expect(ssrElement("div", { innerHTML: "<b>raw</b>" }, "x", false).t).toBe(
      "<div><b>raw</b></div>",
    );
  });

  it("[SSR-70] each getter prop is read exactly once", () => {
    let reads = 0;
    const props = {
      get id() {
        reads += 1;
        return "a";
      },
    };
    expect(ssrElement("div", props, undefined, false).t).toBe('<div id="a"></div>');
    expect(reads).toBe(1);
  });

  it("[SSR-71] needsKey outside any render writes no key", () => {
    expect(ssrElement("div", {}, undefined, true).t).toBe("<div></div>");
  });

  it("[SSR-72] a data-hk prop is kept when needsKey is false", () => {
    expect(ssrElement("div", { "data-hk": "x" }, undefined, false).t).toBe(
      '<div data-hk="x"></div>',
    );
  });

  it("[SSR-73] null or undefined props render a bare element", () => {
    expect(ssrElement("span", null, "x", false).t).toBe("<span>x</span>");
    expect(ssrElement("span", undefined, undefined, false).t).toBe("<span></span>");
  });

  it("[SSR-74] an invalid prop name throws a TypeError", () => {
    expect(() => ssrElement("div", { "a b": 1 }, undefined, false)).toThrow(TypeError);
  });

  it("[SSR-75] ssrElement output for hostile values stays inside its attributes", () => {
    const out = ssrElement(
      "div",
      { title: '"><script>alert(1)</script>', class: '" onload="x' },
      undefined,
      false,
    ).t;
    expect(out).not.toMatch(/<script/);
    expect(out).not.toMatch(/" onload/);
  });
});

describe("hydration key outside a render", () => {
  it("[SSR-76] ssrHydrationKey writes nothing when no scope is active", () => {
    expect(ssrHydrationKey()).toBe("");
  });
});

describe("createComponent, memo and mergeProps", () => {
  it("[SSR-77] createComponent calls the component with its props and returns the result", () => {
    const received: unknown[] = [];
    const out = createComponent(
      (props: { name: string }) => {
        received.push(props);
        return escape(props.name);
      },
      { name: "<n>" },
    );
    expect(out).toBe("&lt;n&gt;");
    expect(received).toEqual([{ name: "<n>" }]);
  });

  it("[SSR-78] createComponent rejects a non-function component", () => {
    expect(() => createComponent(42 as unknown as (props: object) => unknown, {})).toThrow(
      TypeError,
    );
  });

  it("[SSR-79] memo evaluates lazily and only once", () => {
    let calls = 0;
    const value = memo(() => {
      calls += 1;
      return "v";
    });
    expect(calls).toBe(0);
    expect(value()).toBe("v");
    expect(value()).toBe("v");
    expect(calls).toBe(1);
  });

  it("[SSR-80] memo does not cache a throw; the next read runs again", () => {
    let attempts = 0;
    const value = memo(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("first");
      return "ok";
    });
    expect(() => value()).toThrow("first");
    expect(value()).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("[SSR-81] memo that reads itself throws instead of recursing", () => {
    const value: () => unknown = memo(() => value());
    expect(() => value()).toThrow(Error);
  });

  it("[SSR-82] mergeProps is core's: later sources win and undefined keeps earlier values", () => {
    const merged = mergeProps({ a: 1, b: 1 }, { a: 2 }, { b: undefined });
    expect(merged.a).toBe(2);
    expect(merged.b).toBe(1);
  });
});
