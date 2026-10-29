import { createRoot, flushSync } from "@shadow-js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dynamic } from "../src/control-flow/dynamic";
import { insert } from "../src/insert";
import { resetWebWarningDedupe } from "../src/internal/diagnostics";
import { cleanupDom, MATHML_NS, mount, SVG_NS } from "./support/dom";

beforeEach(() => {
  resetWebWarningDedupe();
});

afterEach(() => {
  cleanupDom();
});

/** The warnings printed since the last call, taken out of the spy so the test setup does not fail on them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.join(" "));
  spy.mockClear();
  return messages;
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

/** The SVG names whose canonical spelling has a capital letter (the HTML parser's adjustment table). */
const CAMEL_SVG = [
  "animateMotion",
  "animateTransform",
  "clipPath",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "linearGradient",
  "radialGradient",
  "textPath",
];

/** Every SVG-only tag the compiler knows (`SVG_ONLY_TAGS` of the Rust lowering), in its canonical spelling. */
const SVG_ONLY = [
  "animate",
  "desc",
  "metadata",
  "mpath",
  "set",
  "switch",
  "view",
  "image",
  "text",
  "tspan",
  "marker",
  "mask",
  "pattern",
  "symbol",
  "use",
  "filter",
  "stop",
  "line",
  "polygon",
  "polyline",
  "ellipse",
  "rect",
  "path",
  "g",
  "svg",
  "defs",
  ...CAMEL_SVG,
];

const MATHML = [
  "math",
  "mi",
  "mo",
  "mn",
  "ms",
  "mtext",
  "mspace",
  "mrow",
  "mfrac",
  "msqrt",
  "mroot",
  "mstyle",
  "merror",
  "mpadded",
  "mphantom",
  "menclose",
  "msub",
  "msup",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mmultiscripts",
  "mprescripts",
  "none",
  "mtable",
  "mtr",
  "mtd",
  "mlabeledtr",
  "maction",
  "semantics",
  "annotation",
  "annotation-xml",
];

describe("review of web, round three: Dynamic tag names", () => {
  it("[WEB-R3-2] [WEB-R5-1] an SVG tag keeps the spelling it was written in, with no HTML sink; each canonical name warns once, for its first miscased spelling", () => {
    const sink = vi.spyOn(Element.prototype, "innerHTML", "set");
    try {
      for (const canonical of CAMEL_SVG) {
        for (const written of [canonical, canonical.toLowerCase(), canonical.toUpperCase()]) {
          const element = dynamicElement(written);
          expect(element.namespaceURI, written).toBe(SVG_NS);
          expect(element.localName, written).toBe(written);
        }
      }
      expect(sink).not.toHaveBeenCalled();
    } finally {
      sink.mockRestore();
    }
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(CAMEL_SVG.length);
    CAMEL_SVG.forEach((canonical, index) => {
      expect(warnings[index], canonical).toContain("[shadow DYNAMIC_SVG_CASE]");
      expect(warnings[index], canonical).toContain(`"${canonical}"`);
    });
  });

  it("[WEB-R3-2] every SVG-only name the compiler knows, written canonically, is an SVG element and warns nothing", () => {
    for (const tag of SVG_ONLY) {
      const element = dynamicElement(tag);
      expect(element.namespaceURI, tag).toBe(SVG_NS);
      expect(element.localName, tag).toBe(tag);
    }
    expect(takeWarnings()).toEqual([]);
  });

  it("[WEB-R3-2] SVG names that have no capital stay as written, in any case, and do not warn", () => {
    for (const tag of ["svg", "circle", "path", "g", "defs", "mask", "stop"]) {
      const element = dynamicElement(tag.toUpperCase());
      expect(element.namespaceURI, tag).toBe(SVG_NS);
      expect(element.localName, tag).toBe(tag.toUpperCase());
    }
    expect(takeWarnings()).toEqual([]);
  });

  it("[WEB-R3-2] every MathML element name is created in the MathML namespace", () => {
    for (const tag of MATHML) {
      for (const written of [tag, tag.toUpperCase()]) {
        const element = dynamicElement(written);
        expect(element.namespaceURI, written).toBe(MATHML_NS);
        expect(element.localName, written).toBe(tag);
      }
    }
  });

  it("[WEB-R3-2] names that look like MathML but are not stay HTML elements", () => {
    for (const tag of [
      "mark",
      "menu",
      "meter",
      "main",
      "map",
      "mathematics",
      "mi2",
      "annotation-",
    ]) {
      expect(dynamicElement(tag).namespaceURI, tag).not.toBe(MATHML_NS);
    }
  });

  it("[WEB-R3-2] a MathML element takes its children and attributes", () => {
    const host = mount();
    const dispose = createRoot((disposeRoot) => {
      insert(host, Dynamic({ component: "mfrac", displaystyle: "true", children: "1/2" }));
      return disposeRoot;
    });
    flushSync();
    const element = host.firstElementChild;
    expect(element?.getAttribute("displaystyle")).toBe("true");
    expect(element?.textContent).toBe("1/2");
    dispose();
  });
});
