import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, flushSync } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dynamic } from "../src/control-flow/dynamic";
import { style } from "../src/index";
import { insert } from "../src/insert";
import { replayEarlyEvents } from "../src/internal/early-events";
import { generateHydrationScript, ssrStyle } from "../src/server/index";
import { cleanupDom, mount, SVG_NS } from "./support/dom";

afterEach(() => {
  cleanupDom();
  document.body.innerHTML = "";
});

/** Renders `<Dynamic component={tag}>` into a fresh host and returns the element it made. */
function dynamicElement(tag: string): Element {
  const host = mount();
  const dispose = createRoot((disposeRoot) => {
    insert(host, Dynamic({ component: tag }));
    return disposeRoot;
  });
  flushSync();
  const element = host.firstElementChild;
  dispose();
  if (element === null) throw new Error(`Dynamic made no element for ${tag}`);
  return element;
}

/** The names of the compiler's list of SVG-only tags, read from its source. */
function compilerSvgTags(): string[] {
  const source = readFileSync(
    resolve(process.cwd(), "packages/compiler/src/internal/lower.ts"),
    "utf8",
  );
  const block = /const SVG_ONLY_TAGS = new Set\(\[([\s\S]*?)\]\);/.exec(source)?.[1];
  if (block === undefined) throw new Error("SVG_ONLY_TAGS not found in the compiler's lower.ts");
  return Array.from(block.matchAll(/"([A-Za-z]+)"/g), (match) => match[1] ?? "");
}

describe("review of web, round two: Dynamic and SVG", () => {
  it("[WEB-R2-6] every SVG-only tag the compiler knows is created in the SVG namespace, in any letter case", () => {
    const tags = compilerSvgTags();
    expect(tags.length).toBeGreaterThan(50);
    // [WEB-R5-1] None of them reaches an HTML sink (Trusted Types pages throw on innerHTML).
    const sink = vi.spyOn(Element.prototype, "innerHTML", "set");
    try {
      for (const tag of tags) {
        // The namespace does not depend on the letter case; the name is kept as written.
        for (const written of [tag, tag.toLowerCase(), tag.toUpperCase()]) {
          const element = dynamicElement(written);
          expect(element.namespaceURI, written).toBe(SVG_NS);
          expect(element.localName, written).toBe(written);
        }
      }
      expect(sink).not.toHaveBeenCalled();
      vi.mocked(console.warn).mockClear();
    } finally {
      sink.mockRestore();
    }
  });

  it("[WEB-R2-6] title, style and a stay HTML elements: they exist in HTML too", () => {
    for (const tag of ["title", "style", "a", "textarea", "mark", "section"]) {
      expect(dynamicElement(tag).namespaceURI, tag).not.toBe(SVG_NS);
    }
  });
});

describe("review of web, round two: style() shapes", () => {
  /** What the server writes for `value`, applied to a second element so both sides are normalized the same way. */
  function serverCssText(value: unknown): string {
    const markup = ssrStyle(value);
    const probe = document.createElement("div");
    const holder = document.createElement("div");
    holder.innerHTML = `<div${markup}></div>`;
    probe.setAttribute("style", holder.firstElementChild?.getAttribute("style") ?? "");
    return probe.style.cssText;
  }

  const shapes: Array<[string, unknown]> = [
    ["objects and strings, later wins", [{ color: "red" }, "color: blue"]],
    ["a string then an object", ["color: red; width: 5px", { width: 10, height: "2px" }]],
    [
      "skipped items",
      [null, undefined, false, "", { opacity: 0.5, marginTop: 8 }, { "--gap": "4px" }],
    ],
    ["an empty array", []],
    ["the same property twice", [{ color: "red" }, { color: "green" }]],
  ];

  for (const [name, value] of shapes) {
    it(`[WEB-R2-7] client and server write the same style for an array (${name})`, () => {
      const el = document.createElement("div");
      style(el, value);
      expect(el.style.cssText).toBe(serverCssText(value));
    });
  }

  it("[WEB-R2-7] an array is written again when it changes, and an object after it starts from a clean style", () => {
    const el = document.createElement("div");
    let prev = style(el, [{ color: "red" }, "width: 5px"]);
    prev = style(el, [{ color: "blue" }], prev);
    expect(el.style.cssText).toBe(serverCssText([{ color: "blue" }]));
    prev = style(el, { height: "3px" }, prev);
    expect(el.style.cssText).toBe("height: 3px;");
    style(el, null, prev);
    expect(el.hasAttribute("style")).toBe(false);
  });

  it("[WEB-R2-7] a nested array or a non-style item throws, as on the server", () => {
    const el = document.createElement("div");
    expect(() => style(el, [[{ color: "red" }]])).toThrow(TypeError);
    expect(() => style(el, [5])).toThrow(TypeError);
    expect(() => ssrStyle([[{ color: "red" }]])).toThrow(TypeError);
    expect(() => ssrStyle([5])).toThrow(TypeError);
  });
});

describe("review of web, round two: early events", () => {
  it("[WEB-R2-8] replaying a captured click on a link does not follow the link a second time", () => {
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(generateHydrationScript({}))?.[1] ?? "";
    new Function(script)();
    const link = document.createElement("a");
    link.href = "#early-replay";
    document.body.append(link);
    const seen: boolean[] = [];
    document.addEventListener("click", (event) => seen.push(event.defaultPrevented), {
      once: false,
    });
    // The real click follows the link on its own.
    link.click();
    expect(window.location.hash).toBe("#early-replay");
    // The page moved on since (a router, a reload of the hash): a replay that followed the link again
    // would move it back.
    window.location.hash = "#elsewhere";
    seen.length = 0;
    replayEarlyEvents();
    expect(seen).toEqual([false]);
    expect(window.location.hash).toBe("#elsewhere");
  });

  it("[WEB-R2-8] a replayed click still reaches the page's handlers, and a handler can prevent it as usual", () => {
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(generateHydrationScript({}))?.[1] ?? "";
    new Function(script)();
    const button = document.createElement("button");
    document.body.append(button);
    button.click();
    const observed: boolean[] = [];
    button.addEventListener("click", (event) => {
      observed.push(event.defaultPrevented);
      event.preventDefault();
      observed.push(event.defaultPrevented);
    });
    document.addEventListener("click", (event) => observed.push(event.defaultPrevented));
    replayEarlyEvents();
    expect(observed).toEqual([false, true, true]);
  });
});
