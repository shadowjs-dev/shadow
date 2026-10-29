import { createRoot, flushSync } from "@shadow-js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dynamic } from "../src/control-flow/dynamic";
import { insert } from "../src/insert";
import { resetWebWarningDedupe } from "../src/internal/diagnostics";
import { cleanupDom, mount, SVG_NS } from "./support/dom";

beforeEach(() => {
  resetWebWarningDedupe();
});

afterEach(() => {
  cleanupDom();
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

describe("Dynamic: a DOM without per-element SVG interfaces (jsdom)", () => {
  it("[DYN-JSDOM-1] known SVG names are SVG elements even when every SVG element is a plain SVGElement", () => {
    // jsdom has no `SVGCircleElement`: every element of the SVG namespace is a plain `SVGElement`, so the
    // platform cannot say which names SVG defines. The stub reproduces that for this DOM, in `finally`-restored form.
    const create = Document.prototype.createElementNS;
    const plain = vi.spyOn(document, "createElementNS").mockImplementation(function (
      this: Document,
      ...args: Parameters<Document["createElementNS"]>
    ) {
      const element = create.apply(this, args);
      if (args[0] === SVG_NS) Object.defineProperty(element, "constructor", { value: SVGElement });
      return element;
    } as Document["createElementNS"]);
    try {
      for (const tag of ["circle", "path", "g", "rect", "clippath", "clipPath", "linearGradient"]) {
        const element = dynamicElement(tag);
        expect(element.namespaceURI, tag).toBe(SVG_NS);
        // The name stays as the caller wrote it, in every DOM.
        expect(element.localName, tag).toBe(tag);
      }
      // Only the miscased `clippath` is reported.
      const warnings = vi.mocked(console.warn).mock.calls.map((args) => args.join(" "));
      vi.mocked(console.warn).mockClear();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("DYNAMIC_SVG_CASE");
      for (const tag of ["div", "button", "my-element", "nobody"]) {
        expect(dynamicElement(tag).namespaceURI, tag).toBe("http://www.w3.org/1999/xhtml");
      }
    } finally {
      plain.mockRestore();
    }
  });
});
