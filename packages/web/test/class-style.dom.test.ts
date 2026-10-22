import { afterEach, describe, expect, it, vi } from "vitest";
import { classList, className, setStyleProperty, style } from "../src/index";
import { cleanupDom, SVG_NS } from "./support/dom";

afterEach(cleanupDom);

function el(): HTMLElement {
  return document.createElement("div");
}

describe("className()", () => {
  it("[CLS-01] a string is set as is", () => {
    const node = el();
    className(node, "a b");
    expect(node.getAttribute("class")).toBe("a b");
  });

  it("[CLS-02] arrays are clsx-joined: nested, falsy entries dropped, objects use truthy keys", () => {
    const node = el();
    className(node, ["a", false, ["b", null, { c: true, d: false }], "", 0, "e"]);
    expect(node.getAttribute("class")).toBe("a b c e");
  });

  it("[CLS-03] an object uses its truthy keys, including keys with several names", () => {
    const node = el();
    className(node, { x: true, y: 0, "p q": 1 });
    expect(node.getAttribute("class")).toBe("x p q");
  });

  it("[CLS-04] null, undefined and false remove the class attribute", () => {
    const node = el();
    for (const removal of [null, undefined, false]) {
      className(node, "on");
      className(node, removal);
      expect(node.hasAttribute("class")).toBe(false);
    }
  });

  it("[CLS-05] SVG elements receive the class through the attribute", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    className(svg, ["icon", { large: true }]);
    expect(svg.getAttribute("class")).toBe("icon large");
  });

  it("[CLS-06] a cyclic array throws a TypeError", () => {
    const node = el();
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => className(node, cycle)).toThrow(TypeError);
  });

  it("[CLS-07] arrays nested 5000 deep are joined without recursion", () => {
    const node = el();
    let value: unknown = "deep";
    for (let depth = 0; depth < 5000; depth += 1) value = [value];
    className(node, value);
    expect(node.getAttribute("class")).toBe("deep");
  });

  it("[CLS-08] numbers are stringified and an empty array writes an empty class", () => {
    const node = el();
    className(node, 5);
    expect(node.getAttribute("class")).toBe("5");
    className(node, []);
    expect(node.getAttribute("class")).toBe("");
  });
});

describe("classList()", () => {
  it("[CLS-10] adds truthy keys and leaves falsy ones alone, returning the object", () => {
    const node = el();
    const value = { a: true, b: false };
    expect(classList(node, value)).toBe(value);
    expect(node.classList.contains("a")).toBe(true);
    expect(node.classList.contains("b")).toBe(false);
  });

  it("[CLS-11] toggles only keys whose truthiness changed, leaving manual classes alone", () => {
    const node = el();
    node.classList.add("manual");
    const first = classList(node, { a: true, b: true });
    node.classList.add("manual2");
    const next = classList(node, { a: false, b: true }, first);
    expect(node.classList.contains("a")).toBe(false);
    expect(node.classList.contains("b")).toBe(true);
    expect(node.classList.contains("manual")).toBe(true);
    expect(node.classList.contains("manual2")).toBe(true);
    expect(next).toEqual({ a: false, b: true });
  });

  it("[CLS-12] a key may hold several space-separated class names", () => {
    const node = el();
    classList(node, { "x  y": true });
    expect(node.classList.contains("x")).toBe(true);
    expect(node.classList.contains("y")).toBe(true);
  });

  it("[CLS-13] keys that disappeared from the object are removed", () => {
    const node = el();
    const first = classList(node, { gone: true, kept: true });
    classList(node, { kept: true }, first);
    expect(node.classList.contains("gone")).toBe(false);
    expect(node.classList.contains("kept")).toBe(true);
  });

  it("[CLS-14] a falsy key without a previous value does not strip a static class", () => {
    const node = el();
    node.classList.add("static");
    classList(node, { static: false });
    expect(node.classList.contains("static")).toBe(true);
  });

  it("[CLS-15] undefined removes the previous keys and returns an empty object", () => {
    const node = el();
    const first = classList(node, { a: true });
    expect(classList(node, undefined, first)).toEqual({});
    expect(node.classList.contains("a")).toBe(false);
  });

  it("[CLS-16] toggles use the classList API for each changed name", () => {
    const node = el();
    const spy = vi.spyOn(node.classList, "toggle");
    classList(node, { one: true, two: true });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("style(): values", () => {
  it("[STY-01] a string becomes the cssText and is returned", () => {
    const node = el();
    expect(style(node, "color: red")).toBe("color: red");
    expect(node.style.color).toBe("red");
  });

  it("[STY-02] an object sets each property, camelCase becoming kebab-case, and custom properties", () => {
    const node = el();
    style(node, { backgroundColor: "red", "--accent": "#123" });
    expect(node.style.backgroundColor).toBe("red");
    expect(node.style.getPropertyValue("--accent")).toBe("#123");
  });

  it("[STY-03] only changed keys are written on later updates", () => {
    const node = el();
    const first = style(node, { color: "red", width: "1px" });
    const spy = vi.spyOn(node.style, "setProperty");
    style(node, { color: "red", width: "2px" }, first);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(node.style.width).toBe("2px");
    spy.mockRestore();
  });

  it("[STY-04] keys that disappeared are removed", () => {
    const node = el();
    const first = style(node, { color: "red", width: "1px" });
    style(node, { color: "red" }, first);
    expect(node.style.width).toBe("");
    expect(node.style.color).toBe("red");
  });

  it("[STY-05] null, undefined and false remove the style attribute", () => {
    const node = el();
    for (const removal of [null, undefined, false]) {
      style(node, { color: "red" });
      style(node, removal);
      expect(node.hasAttribute("style")).toBe(false);
    }
  });

  it("[STY-06] the returned value is a snapshot equal to the input", () => {
    const node = el();
    const input = { color: "red" };
    const result = style(node, input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("[STY-07] switching from a string to an object clears the old cssText", () => {
    const node = el();
    const first = style(node, "color: red");
    style(node, { width: "1px" }, first);
    expect(node.style.color).toBe("");
    expect(node.style.width).toBe("1px");
  });

  it("[STY-08] null, undefined and false in an object remove the property", () => {
    const node = el();
    const first = style(node, { color: "red", width: "1px", height: "2px" });
    style(node, { color: null, width: undefined, height: false }, first);
    expect(node.style.color).toBe("");
    expect(node.style.width).toBe("");
    expect(node.style.height).toBe("");
  });

  it("[STY-09] numbers are written as is, zero included, with no unit added", () => {
    const node = el();
    style(node, { opacity: 0 });
    expect(node.style.opacity).toBe("0");
  });

  it("[STY-10] a non-object, non-string value is returned unchanged", () => {
    const node = el();
    expect(style(node, 12)).toBe(12);
  });
});

describe("setStyleProperty()", () => {
  it("[STY-20] writes custom properties verbatim", () => {
    const node = el();
    setStyleProperty(node, "--brand", "#f00");
    expect(node.style.getPropertyValue("--brand")).toBe("#f00");
  });

  it("[STY-21] null, undefined and false remove the property", () => {
    const node = el();
    for (const removal of [null, undefined, false]) {
      setStyleProperty(node, "color", "red");
      setStyleProperty(node, "color", removal);
      expect(node.style.color).toBe("");
    }
  });

  it("[STY-22] camelCase names are converted to kebab-case", () => {
    const node = el();
    setStyleProperty(node, "fontSize", "10px");
    expect(node.style.getPropertyValue("font-size")).toBe("10px");
  });

  it("[STY-23] vendor prefixes map to -webkit- and -ms- names", () => {
    const node = el();
    const spy = vi.spyOn(node.style, "setProperty");
    setStyleProperty(node, "WebkitTransition", "none");
    setStyleProperty(node, "msTransform", "none");
    expect(spy.mock.calls.map((call) => call[0])).toEqual(["-webkit-transition", "-ms-transform"]);
    spy.mockRestore();
  });

  it("[STY-24] works on SVG elements", () => {
    const svg = document.createElementNS(SVG_NS, "rect");
    setStyleProperty(svg, "fill", "blue");
    expect(svg.getAttribute("style")).toContain("fill: blue");
  });
});
