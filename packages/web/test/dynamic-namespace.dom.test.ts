import { createRoot, flushSync } from "@shadow-js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dynamic } from "../src/control-flow/dynamic";
import { insert } from "../src/insert";
import { resetWebWarningDedupe } from "../src/internal/diagnostics";
import { cleanupDom, mount, SVG_NS } from "./support/dom";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const spies: Array<{ mockRestore(): void }> = [];

beforeEach(() => {
  resetWebWarningDedupe();
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  cleanupDom();
});

/** The warnings printed since the last call, taken out of the spy so the test setup does not fail on them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.join(" "));
  spy.mockClear();
  return messages;
}

/** Spies on `document.createElementNS`; the spy is restored after the test. */
function spyOnNamespaced() {
  const spy = vi.spyOn(document, "createElementNS");
  spies.push(spy);
  return spy;
}

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

/** Spies on the `innerHTML` setter of every element: the HTML sink a Trusted Types page forbids. */
function spyOnInnerHtml() {
  const spy = vi.spyOn(Element.prototype, "innerHTML", "set");
  spies.push(spy);
  return spy;
}

describe("Dynamic: the platform decides the namespace", () => {
  it("[DYN-NS-1] a name HTML knows is an HTML element and costs no parse", () => {
    const spy = spyOnInnerHtml();
    for (const tag of ["div", "a", "style", "title", "button", "my-element"]) {
      const element = dynamicElement(tag);
      expect(element.namespaceURI, tag).toBe("http://www.w3.org/1999/xhtml");
      expect(element.localName, tag).toBe(tag);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("[DYN-NS-2] a name only SVG defines gets the SVG namespace, as written; a name nobody defines stays an HTML element", () => {
    expect(dynamicElement("circle")).toBeInstanceOf(SVGElement);
    // The canonical case is not derived: the caller's spelling is kept (and warned about in development).
    const written = dynamicElement("clippath");
    expect(written.namespaceURI).toBe(SVG_NS);
    expect(written.localName).toBe("clippath");
    expect(takeWarnings()).toHaveLength(1);
    const unknown = dynamicElement("nosuchthing");
    expect(unknown.namespaceURI).toBe(HTML_NS);
    expect(unknown).not.toBeInstanceOf(SVGElement);
    expect(takeWarnings()).toEqual([]);
  });

  it("[DYN-NS-3] no HTML is parsed for any name, and a repeated name gets the same decision from the same work", () => {
    const sink = spyOnInnerHtml();
    const fragment = vi.spyOn(Range.prototype, "createContextualFragment");
    spies.push(fragment);
    const spy = spyOnNamespaced();
    for (const tag of ["ellipse", "ELLIPSE", "nosuchthing", "clipPath", "my-element"]) {
      const first = spy.mock.calls.length;
      const one = dynamicElement(tag);
      const work = spy.mock.calls.length - first;
      const again = dynamicElement(tag);
      expect(spy.mock.calls.length - first - work, tag).toBe(work);
      expect(again.namespaceURI, tag).toBe(one.namespaceURI);
      expect(again.localName, tag).toBe(one.localName);
    }
    expect(sink).not.toHaveBeenCalled();
    expect(fragment).not.toHaveBeenCalled();
    takeWarnings();
  });

  it("[DYN-NS-4] the platform's interfaces are never scanned: any number of names ends in the same answers", () => {
    const names = vi.spyOn(Object, "getOwnPropertyNames");
    spies.push(names);
    for (let index = 0; index < 200; index += 1) {
      expect(dynamicElement(`unknown${index}`).namespaceURI).toBe(HTML_NS);
    }
    expect(dynamicElement("rect").namespaceURI).toBe(SVG_NS);
    expect(names.mock.calls.filter(([target]) => target === globalThis)).toEqual([]);
  });

  it("[DYN-NS-5] [WEB-R5-1] no name, camelCase written in lowercase included, ever sets innerHTML; the written name is kept", () => {
    // innerHTML is an HTML sink: a page that enforces Trusted Types throws on it.
    const spy = spyOnInnerHtml();
    for (const tag of [
      "circle",
      "path",
      "g",
      "rect",
      "image",
      "clipPath",
      "linearGradient",
      "feGaussianBlur",
      "clippath",
      "lineargradient",
      "radialgradient",
      "fegaussianblur",
      "foreignobject",
      "textpath",
      "animatemotion",
      "FEDROPSHADOW",
      "nosuchthing",
    ]) {
      const element = dynamicElement(tag);
      expect(element.localName, tag).toBe(tag);
      expect(element.namespaceURI, tag).toBe(tag === "nosuchthing" ? HTML_NS : SVG_NS);
    }
    expect(spy).not.toHaveBeenCalled();
    takeWarnings();
  });

  it("[DYN-SVG-CASE-1] a miscased SVG name warns DYNAMIC_SVG_CASE once per name, naming the canonical spelling", () => {
    dynamicElement("circle");
    dynamicElement("clipPath");
    dynamicElement("CIRCLE");
    expect(takeWarnings()).toEqual([]);
    for (const tag of ["clippath", "CLIPPATH", "clippath"]) {
      expect(dynamicElement(tag).localName).toBe(tag);
    }
    const clip = takeWarnings();
    expect(clip).toHaveLength(1);
    expect(clip[0]).toContain("[shadow DYNAMIC_SVG_CASE]");
    expect(clip[0]).toContain('"clippath"');
    expect(clip[0]).toContain('"clipPath"');
    dynamicElement("lineargradient");
    dynamicElement("fegaussianblur");
    const more = takeWarnings();
    expect(more).toHaveLength(2);
    expect(more[0]).toContain('"linearGradient"');
    expect(more[1]).toContain('"feGaussianBlur"');
  });

  it("[DYN-REVIEW-1] `image` is SVG even where createElement calls it a plain HTMLElement (Firefox)", () => {
    const create = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((name: string) => {
      const made = create(name);
      return name.toLowerCase() === "image" ? create("abbr") : made;
    });
    spies.push(spy);
    const element = dynamicElement("image");
    expect(element.namespaceURI).toBe(SVG_NS);
    expect(element.localName).toBe("image");
  });
});
