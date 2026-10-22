import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAttribute, setAttributeNS, setBoolAttribute } from "../src/index";
import { resetWebWarningDedupe } from "../src/internal/diagnostics";
import { cleanupDom, XLINK_NS } from "./support/dom";

beforeEach(() => {
  resetWebWarningDedupe();
});

afterEach(cleanupDom);

function el(): HTMLElement {
  return document.createElement("div");
}

describe("setAttribute(): value rules", () => {
  it("[ATT-01] null, undefined and false remove an ordinary attribute", () => {
    const node = el();
    for (const removal of [null, undefined, false]) {
      setAttribute(node, "title", "x");
      setAttribute(node, "title", removal);
      expect(node.hasAttribute("title")).toBe(false);
    }
  });

  it("[ATT-02] true writes an empty string for ordinary attributes", () => {
    const node = el();
    setAttribute(node, "hidden", true);
    expect(node.getAttribute("hidden")).toBe("");
  });

  it("[ATT-03] true writes 'true' for aria-, data- and the enumerated attributes", () => {
    const node = el();
    setAttribute(node, "aria-hidden", true);
    setAttribute(node, "data-flag", true);
    setAttribute(node, "draggable", true);
    expect(node.getAttribute("aria-hidden")).toBe("true");
    expect(node.getAttribute("data-flag")).toBe("true");
    expect(node.getAttribute("draggable")).toBe("true");
  });

  it("[ATT-04] false is written as 'false' for aria-, data- and enumerated attributes", () => {
    const node = el();
    setAttribute(node, "aria-expanded", false);
    setAttribute(node, "data-open", false);
    setAttribute(node, "draggable", false);
    setAttribute(node, "spellcheck", false);
    setAttribute(node, "contenteditable", false);
    expect(node.getAttribute("aria-expanded")).toBe("false");
    expect(node.getAttribute("data-open")).toBe("false");
    expect(node.getAttribute("draggable")).toBe("false");
    expect(node.getAttribute("spellcheck")).toBe("false");
    expect(node.getAttribute("contenteditable")).toBe("false");
  });

  it("[ATT-05] null and undefined remove aria- and data- attributes too", () => {
    const node = el();
    setAttribute(node, "aria-label", "x");
    setAttribute(node, "aria-label", null);
    setAttribute(node, "data-x", "y");
    setAttribute(node, "data-x", undefined);
    expect(node.hasAttribute("aria-label")).toBe(false);
    expect(node.hasAttribute("data-x")).toBe(false);
  });

  it("[ATT-06] any other value is written as String(value)", () => {
    const node = el();
    setAttribute(node, "tabindex", 3);
    expect(node.getAttribute("tabindex")).toBe("3");
    setAttribute(node, "title", "plain");
    expect(node.getAttribute("title")).toBe("plain");
  });

  it("[ATT-07] writing the same value again does not call setAttribute", () => {
    const node = el();
    setAttribute(node, "title", "same");
    const spy = vi.spyOn(Element.prototype, "setAttribute");
    setAttribute(node, "title", "same");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("setAttribute(): names", () => {
  it("[ATT-10] invalid XML names throw a TypeError that mentions the name", () => {
    const node = el();
    for (const bad of ["@click", "1abc", "a b", "", "a=b", 'x"y', "a/b", "-lead"]) {
      expect(() => setAttribute(node, bad, "x")).toThrow(TypeError);
      expect(() => setAttribute(node, bad, "x")).toThrow(bad);
    }
  });

  it("[ATT-11] valid names including hyphens, dots, underscores and colons are accepted", () => {
    const node = el();
    for (const good of ["data-x-y", "aria-busy", "A.b-c", "_x", "v:x", "xlink:href"]) {
      setAttribute(node, good, "1");
      expect(node.getAttribute(good)).toBe("1");
    }
  });

  it("[ATT-12] setBoolAttribute validates names as well", () => {
    expect(() => setBoolAttribute(el(), "@x", true)).toThrow(TypeError);
  });

  it("[ATT-13] setAttributeNS validates the qualified name", () => {
    expect(() => setAttributeNS(el(), XLINK_NS, "1bad", "x")).toThrow(TypeError);
  });
});

describe("setAttribute(): URL attributes", () => {
  it("[ATT-20] javascript: in href is not written and warns once with UNSAFE_URL_BLOCKED", () => {
    const node = document.createElement("a");
    setAttribute(node, "href", "javascript:alert(1)");
    expect(node.hasAttribute("href")).toBe(false);
    const warnings = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("UNSAFE_URL_BLOCKED");
    vi.mocked(console.warn).mockClear();
  });

  it("[ATT-21] obfuscated unsafe schemes are blocked (case, whitespace, control characters)", () => {
    const node = document.createElement("a");
    const variants = [
      "  JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "\u0000javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      " DATA:TEXT/HTML;base64,PHNjcmlwdD4=",
    ];
    for (const value of variants) {
      resetWebWarningDedupe();
      setAttribute(node, "href", value);
      expect(node.hasAttribute("href"), value).toBe(false);
      vi.mocked(console.warn).mockClear();
    }
  });

  it("[ATT-22] safe URLs are written, including data:image and mailto", () => {
    const node = document.createElement("a");
    for (const value of [
      "https://example.com/?next=javascript:x",
      "data:image/png;base64,AAAA",
      "/relative/path",
      "#fragment",
      "mailto:someone@example.com",
    ]) {
      setAttribute(node, "href", value);
      expect(node.getAttribute("href")).toBe(value);
    }
  });

  it("[ATT-23] every URL attribute is protected: href, src, action, formaction, srcdoc, poster, data", () => {
    const names = ["href", "src", "action", "formaction", "srcdoc", "poster", "data"];
    for (const name of names) {
      resetWebWarningDedupe();
      const node = el();
      setAttribute(node, name, "javascript:alert(1)");
      expect(node.hasAttribute(name), name).toBe(false);
      vi.mocked(console.warn).mockClear();
    }
  });

  it("[ATT-24] setAttributeNS blocks unsafe xlink:href", () => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "a");
    setAttributeNS(node, XLINK_NS, "xlink:href", "javascript:alert(1)");
    expect(node.getAttributeNS(XLINK_NS, "href")).toBeNull();
    vi.mocked(console.warn).mockClear();
  });

  it("[ATT-25] non-URL attributes may contain 'javascript:' text", () => {
    const node = el();
    setAttribute(node, "title", "javascript: is a language");
    expect(node.getAttribute("title")).toBe("javascript: is a language");
  });

  it("[ATT-26] a second blocked URL in the same run does not warn again (dedupe per code)", () => {
    const node = document.createElement("a");
    setAttribute(node, "href", "javascript:1");
    setAttribute(node, "src", "javascript:2");
    expect(vi.mocked(console.warn).mock.calls.length).toBe(1);
    vi.mocked(console.warn).mockClear();
  });
});

describe("setAttributeNS()", () => {
  it("[ATT-30] writes a namespaced attribute and removes it with null", () => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "use");
    setAttributeNS(node, XLINK_NS, "xlink:href", "#icon");
    expect(node.getAttributeNS(XLINK_NS, "href")).toBe("#icon");
    setAttributeNS(node, XLINK_NS, "xlink:href", null);
    expect(node.hasAttributeNS(XLINK_NS, "href")).toBe(false);
  });

  it("[ATT-31] without a namespace it behaves like setAttribute", () => {
    const node = el();
    setAttributeNS(node, "", "data-n", 2);
    expect(node.getAttribute("data-n")).toBe("2");
  });
});

describe("setBoolAttribute()", () => {
  it("[ATT-40] truthy values set the attribute to an empty string", () => {
    const node = document.createElement("button");
    setBoolAttribute(node, "disabled", true);
    expect(node.getAttribute("disabled")).toBe("");
    setBoolAttribute(node, "autofocus", "yes");
    expect(node.hasAttribute("autofocus")).toBe(true);
  });

  it("[ATT-41] falsy values remove the attribute", () => {
    const node = document.createElement("button");
    setBoolAttribute(node, "disabled", true);
    setBoolAttribute(node, "disabled", false);
    expect(node.hasAttribute("disabled")).toBe(false);
    setBoolAttribute(node, "disabled", true);
    setBoolAttribute(node, "disabled", undefined);
    expect(node.hasAttribute("disabled")).toBe(false);
  });
});
