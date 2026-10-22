import { afterEach, describe, expect, it, vi } from "vitest";
import { anchor, template } from "../src/index";
import { cleanupDom, hasComment, MATHML_NS, mount, SVG_NS, shape } from "./support/dom";

afterEach(cleanupDom);

describe("template()", () => {
  it("[TPL-01] a single root returns that element, tag and content from the markup", () => {
    const make = template("<p class='x'>hi</p>");
    const node = make();
    expect(node.nodeName).toBe("P");
    expect(node instanceof Element && node.getAttribute("class")).toBe("x");
    expect(node.textContent).toBe("hi");
  });

  it("[TPL-02] every call returns a fresh, detached clone that is independent of the others", () => {
    const make = template("<div><span>a</span></div>");
    const first = make();
    const second = make();
    expect(first).not.toBe(second);
    expect(first.parentNode).toBeNull();
    first.firstChild?.remove();
    expect(second.childNodes.length).toBe(1);
    expect(first.childNodes.length).toBe(0);
  });

  it("[TPL-06] in development the parsed roots are held weakly, so a replaced module keeps no parsed copy", () => {
    // Asserted through the constructor: the roots are wrapped in a WeakRef, nothing else holds them. A subclass counts the
    // constructions; a spy on the global constructor recurses on vitest 5.0.5, which wraps constructors differently.
    const NativeWeakRef = globalThis.WeakRef;
    let made = 0;
    class CountingWeakRef<T extends WeakKey> extends NativeWeakRef<T> {
      constructor(target: T) {
        super(target);
        made += 1;
      }
    }
    globalThis.WeakRef = CountingWeakRef as typeof WeakRef;
    try {
      const make = template("<p>kept</p>");
      make();
    } finally {
      globalThis.WeakRef = NativeWeakRef;
    }
    expect(made).toBe(1);
  });

  it("[TPL-03] several roots return a DocumentFragment with the roots in order", () => {
    const fragment = template("<i>1</i><b>2</b>")();
    expect(fragment.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
    expect(shape(fragment)).toEqual(["i", "b"]);
  });

  it("[TPL-04] the SVG flag builds the subtree in the SVG namespace", () => {
    const node = template("<circle r='1'></circle>", 1)();
    expect(node instanceof Element && node.namespaceURI).toBe(SVG_NS);
    expect(node instanceof Element && node.localName).toBe("circle");
  });

  it("[TPL-05] the SVG flag with several roots returns a fragment of SVG elements", () => {
    const fragment = template("<circle r='1'></circle><rect width='2'></rect>", 1)();
    expect(fragment.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
    const namespaces = Array.from(fragment.childNodes, (node) =>
      node instanceof Element ? node.namespaceURI : "",
    );
    expect(namespaces).toEqual([SVG_NS, SVG_NS]);
  });

  it("[TPL-06] the MathML flag builds the subtree in the MathML namespace", () => {
    const node = template("<mi>x</mi>", 2)();
    expect(node instanceof Element && node.namespaceURI).toBe(MATHML_NS);
    expect(node.textContent).toBe("x");
  });

  it("[TPL-07] the importNode flag clones through document.importNode", () => {
    const importNode = vi.spyOn(document, "importNode");
    const node = template("<x-card></x-card>", 4)();
    expect(importNode).toHaveBeenCalled();
    expect(node instanceof Element && node.localName).toBe("x-card");
  });

  it("[TPL-08] markup is parsed once; later calls only clone", () => {
    const create = vi.spyOn(document, "createElement");
    const make = template("<em>x</em>");
    make();
    make();
    make();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("[TPL-09] a comment-free template clones into a tree with no comment nodes", () => {
    const clean = template("<div><span>a</span><b>c</b></div>")();
    expect(hasComment(clean)).toBe(false);
  });

  it("[TPL-10] nested children are cloned, not shared", () => {
    const make = template("<ul><li>a</li></ul>");
    const first = make();
    const second = make();
    expect(first.firstChild).not.toBe(second.firstChild);
    expect(first.textContent).toBe(second.textContent);
  });

  it("[TPL-11] without flags the markup is HTML in the XHTML namespace", () => {
    const node = template("<em>x</em>")();
    expect(node instanceof Element && node.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
  });

  it("[TPL-12] the template function touches no DOM until it is first called", () => {
    const create = vi.spyOn(document, "createElement");
    template("<b>lazy</b>");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("anchor()", () => {
  it("[ANC-01] inserts an empty Text node before the given node", () => {
    const parent = mount();
    const after = document.createElement("span");
    parent.appendChild(after);
    const placeholder = anchor(parent, after);
    expect(placeholder).toBeInstanceOf(Text);
    expect(placeholder.data).toBe("");
    expect(parent.firstChild).toBe(placeholder);
    expect(parent.lastChild).toBe(after);
  });

  it("[ANC-02] a null reference appends the anchor at the end", () => {
    const parent = mount();
    parent.appendChild(document.createElement("i"));
    const placeholder = anchor(parent, null);
    expect(parent.lastChild).toBe(placeholder);
  });

  it("[ANC-03] every call creates a distinct node", () => {
    const parent = mount();
    expect(anchor(parent, null)).not.toBe(anchor(parent, null));
  });

  it("[ANC-04] the anchor node is a Text node, so the subtree has no comments", () => {
    const parent = mount();
    anchor(parent, null);
    expect(hasComment(parent)).toBe(false);
  });
});
