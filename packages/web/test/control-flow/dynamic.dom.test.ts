import { batch, createRoot, flushSync, onCleanup, useSignal } from "@shadow-js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dynamic, type DynamicProps } from "../../src/control-flow/dynamic";
import { insert } from "../../src/insert";
import { resetWebWarningDedupe } from "../../src/internal/diagnostics";
import { cleanupDom, mount, quietFileLoading, SVG_NS } from "../support/dom";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

let disposers: Array<() => void> = [];

beforeEach(() => {
  resetWebWarningDedupe();
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  cleanupDom();
});

/** Messages printed through console.warn since the last call; clears them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.map(String).join(" "));
  spy.mockClear();
  return messages;
}

/** Mounts a Dynamic into a fresh host inside its own owner, then flushes the effects. */
function mountDynamic(props: DynamicProps): HTMLElement {
  const host = mount();
  disposers.push(
    createRoot((dispose) => {
      insert(host, Dynamic(props));
      return dispose;
    }),
  );
  flushSync();
  return host;
}

/** The single element child of a host, failing the test when there is not exactly one. */
function onlyChild(host: HTMLElement): Element {
  expect(host.childNodes.length).toBe(1);
  const child = host.firstElementChild;
  if (child === null) throw new Error("expected an element child");
  return child;
}

describe("Dynamic(): intrinsic elements", () => {
  it("[DYN-01] renders a string tag as one element and keeps its identity across reads", () => {
    const [tag] = useSignal("section");
    const host = mountDynamic({
      get component() {
        return tag();
      },
    });
    const first = onlyChild(host);
    expect(first.localName).toBe("section");
    flushSync();
    expect(onlyChild(host)).toBe(first);
  });

  it("[DYN-02] spreads the remaining props onto the element, children included", () => {
    const host = mountDynamic({ component: "button", id: "go", class: "primary", children: "Go" });
    const button = onlyChild(host);
    expect(button.id).toBe("go");
    expect(button.getAttribute("class")).toBe("primary");
    expect(button.textContent).toBe("Go");
  });

  it("[DYN-03] a reactive attribute rewrites only itself and keeps the element", () => {
    const [label, setLabel] = useSignal("one");
    const host = mountDynamic({
      component: "span",
      get title() {
        return label();
      },
    });
    const span = onlyChild(host);
    expect(span.getAttribute("title")).toBe("one");
    setLabel("two");
    flushSync();
    expect(onlyChild(host)).toBe(span);
    expect(span.getAttribute("title")).toBe("two");
  });

  it("[DYN-04] reactive children update the text of the same element", () => {
    const [count, setCount] = useSignal(1);
    const host = mountDynamic({
      component: "p",
      get children() {
        return `n=${count()}`;
      },
    });
    const paragraph = onlyChild(host);
    expect(paragraph.textContent).toBe("n=1");
    setCount(2);
    flushSync();
    expect(onlyChild(host)).toBe(paragraph);
    expect(paragraph.textContent).toBe("n=2");
  });

  it("[DYN-05] ref receives the created element exactly once", () => {
    const seen: Element[] = [];
    const host = mountDynamic({
      component: "div",
      ref: (el: Element) => {
        seen.push(el);
      },
    });
    flushSync();
    expect(seen).toEqual([onlyChild(host)]);
  });

  it("[DYN-06] an on-click handler is delegated and fires once per click", () => {
    const clicks: string[] = [];
    const host = mountDynamic({
      component: "button",
      onClick: () => {
        clicks.push("hit");
      },
    });
    onlyChild(host).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["hit"]);
  });

  it("[DYN-07] ordinary tags are created in the XHTML namespace", () => {
    const host = mountDynamic({ component: "article" });
    expect(onlyChild(host).namespaceURI).toBe(XHTML_NS);
  });

  it("[DYN-08] SVG-only tags are created in the SVG namespace", () => {
    const host = mountDynamic({ component: "circle", r: "3" });
    expect(onlyChild(host).namespaceURI).toBe(SVG_NS);
  });

  it("[DYN-09] svg, text and tspan are SVG elements as well", () => {
    for (const tag of ["svg", "text", "tspan"]) {
      const host = mountDynamic({ component: tag });
      expect(onlyChild(host).namespaceURI, tag).toBe(SVG_NS);
    }
  });

  it("[DYN-10] a hyphenated custom element name is accepted and is HTML", () => {
    const host = mountDynamic({ component: "my-widget", kind: "a" });
    const widget = onlyChild(host);
    expect(widget.localName).toBe("my-widget");
    expect(widget.namespaceURI).toBe(XHTML_NS);
  });

  it("[DYN-11] an upper-case tag name is accepted and lowered by HTML", () => {
    const host = mountDynamic({ component: "DIV" });
    expect(onlyChild(host).localName).toBe("div");
  });

  it("[DYN-12] an ordinary SVG child stays inside its SVG parent", () => {
    const host = mount("svg");
    disposers.push(
      createRoot((dispose) => {
        insert(host, Dynamic({ component: "rect", width: "2" }));
        return dispose;
      }),
    );
    flushSync();
    const rect = host.firstElementChild;
    expect(rect?.namespaceURI).toBe(SVG_NS);
  });
});

describe("Dynamic(): tag validation", () => {
  it("[DYN-13] the tag script is refused with the documented TypeError", () => {
    expect(() => mountDynamic({ component: "script" })).toThrow(
      new TypeError("ShadowJS Dynamic: invalid tag"),
    );
  });

  it("[DYN-14] script is refused in any letter case", () => {
    expect(() => mountDynamic({ component: "SCRIPT" })).toThrow(TypeError);
    expect(() => mountDynamic({ component: "ScRiPt" })).toThrow(TypeError);
  });

  it("[DYN-15] a tag that smuggles markup (script>) is refused", () => {
    expect(() => mountDynamic({ component: "script>" })).toThrow(TypeError);
  });

  it("[DYN-16] a tag containing a space is refused", () => {
    expect(() => mountDynamic({ component: "div onclick" })).toThrow(TypeError);
  });

  it("[DYN-17] a tag containing a quote is refused", () => {
    expect(() => mountDynamic({ component: 'img"onerror' })).toThrow(TypeError);
  });

  it("[DYN-18] a tag that starts with a digit or dash is refused", () => {
    expect(() => mountDynamic({ component: "1div" })).toThrow(TypeError);
    expect(() => mountDynamic({ component: "-div" })).toThrow(TypeError);
  });

  it("[DYN-19] a refused tag leaves the host empty", () => {
    const host = mount();
    expect(() => {
      createRoot((dispose) => {
        insert(host, Dynamic({ component: "script" }));
        return dispose;
      });
    }).toThrow(TypeError);
    expect(host.childNodes.length).toBe(0);
  });

  it("[DYN-20] a number as component is a TypeError", () => {
    expect(() => mountDynamic({ component: 5 as unknown as string })).toThrow(TypeError);
  });

  it("[DYN-21] a plain object as component is a TypeError", () => {
    expect(() => mountDynamic({ component: {} as unknown as string })).toThrow(TypeError);
  });
});

describe("Dynamic(): components", () => {
  it("[DYN-22] calls the component with the remaining props and inserts its result", () => {
    const received: unknown[] = [];
    const Probe = (props: { readonly label?: unknown; readonly component?: unknown }): unknown => {
      received.push(props.label, "component" in props);
      const el = document.createElement("em");
      el.textContent = String(props.label);
      return el;
    };
    const host = mountDynamic({ component: Probe, label: "hi" });
    expect(onlyChild(host).localName).toBe("em");
    expect(onlyChild(host).textContent).toBe("hi");
    expect(received).toEqual(["hi", false]);
  });

  it("[DYN-23] a reactive prop read inside the component updates it without rebuilding", () => {
    const [label, setLabel] = useSignal("a");
    let builds = 0;
    const Live = (props: { readonly label?: unknown }): unknown => {
      builds += 1;
      const el = document.createElement("i");
      insert(el, () => props.label);
      return el;
    };
    const host = mountDynamic({
      component: Live,
      get label() {
        return label();
      },
    });
    const node = onlyChild(host);
    setLabel("b");
    flushSync();
    expect(builds).toBe(1);
    expect(onlyChild(host)).toBe(node);
    expect(node.textContent).toBe("b");
  });

  it("[DYN-24] a signal read in the component body does not rebuild the component", () => {
    const [count, setCount] = useSignal(0);
    let builds = 0;
    const Quiet = (): unknown => {
      count();
      builds += 1;
      return document.createElement("b");
    };
    mountDynamic({ component: Quiet });
    setCount(1);
    flushSync();
    expect(builds).toBe(1);
  });

  it("[DYN-25] children are passed to the component as its children prop", () => {
    let seen: unknown;
    const Slot = (props: { readonly children?: unknown }): unknown => {
      seen = props.children;
      return document.createElement("main");
    };
    mountDynamic({ component: Slot, children: "body" });
    expect(seen).toBe("body");
  });

  it("[DYN-26] a component that returns an accessor stays reactive with one build", () => {
    const [value, setValue] = useSignal("x");
    let builds = 0;
    const Accessor = (): unknown => {
      builds += 1;
      return () => value();
    };
    const host = mountDynamic({ component: Accessor });
    expect(host.textContent).toBe("x");
    setValue("y");
    flushSync();
    expect(host.textContent).toBe("y");
    expect(builds).toBe(1);
  });

  it("[DYN-27] the cleanup of a swapped-out component runs before the next component", () => {
    const [current, setCurrent] = useSignal<"A" | "B">("A");
    const log: string[] = [];
    const A = (): unknown => {
      log.push("A");
      onCleanup(() => {
        log.push("A cleaned");
      });
      return null;
    };
    const B = (): unknown => {
      log.push("B");
      return null;
    };
    mountDynamic({
      get component() {
        return current() === "A" ? A : B;
      },
    });
    setCurrent("B");
    flushSync();
    expect(log).toEqual(["A", "A cleaned", "B"]);
  });

  it("[DYN-28] a cleanup registered by a swapped component runs exactly once", () => {
    const [current, setCurrent] = useSignal(true);
    let cleaned = 0;
    const Holder = (): unknown => {
      onCleanup(() => {
        cleaned += 1;
      });
      return null;
    };
    mountDynamic({
      get component() {
        return current() ? Holder : "p";
      },
    });
    setCurrent(false);
    flushSync();
    expect(cleaned).toBe(1);
    setCurrent(true);
    flushSync();
    expect(cleaned).toBe(1);
    setCurrent(false);
    flushSync();
    expect(cleaned).toBe(2);
  });

  it("[DYN-29] an error thrown by a component reaches the caller", () => {
    const Boom = (): unknown => {
      throw new Error("boom");
    };
    expect(() => mountDynamic({ component: Boom })).toThrow("boom");
  });

  it("[DYN-30] a component that returns null renders nothing", () => {
    const host = mountDynamic({
      component: (): unknown => null,
    });
    expect(host.childNodes.length).toBe(0);
  });

  it("[DYN-31] a component that returns a node inserts that node itself", () => {
    const made = document.createElement("q");
    const host = mountDynamic({ component: (): unknown => made });
    expect(onlyChild(host)).toBe(made);
  });
});

describe("Dynamic(): swapping", () => {
  it("[DYN-32] swapping tag A for tag B replaces the element with exactly one new element", () => {
    const [tag, setTag] = useSignal("p");
    const host = mountDynamic({
      get component() {
        return tag();
      },
    });
    const before = onlyChild(host);
    const spy = vi.spyOn(document, "createElement");
    setTag("section");
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onlyChild(host).localName).toBe("section");
    expect(onlyChild(host)).not.toBe(before);
    expect(before.isConnected).toBe(false);
  });

  it("[DYN-33] writing the same tag again does not rebuild the element", () => {
    const [tag, setTag] = useSignal("p");
    const host = mountDynamic({
      get component() {
        return tag();
      },
    });
    const before = onlyChild(host);
    const spy = vi.spyOn(document, "createElement");
    setTag("p");
    flushSync();
    expect(spy).not.toHaveBeenCalled();
    expect(onlyChild(host)).toBe(before);
  });

  it("[DYN-34] a swap that happens twice in one batch builds once", () => {
    const [tag, setTag] = useSignal("p");
    const host = mountDynamic({
      get component() {
        return tag();
      },
    });
    const spy = vi.spyOn(document, "createElement");
    batch(() => {
      setTag("a1");
      setTag("b2");
    });
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onlyChild(host).localName).toBe("b2");
  });

  it("[DYN-35] A to B to A builds the component fresh each time it is selected", () => {
    const [which, setWhich] = useSignal<"A" | "B">("A");
    let aBuilds = 0;
    const A = (): unknown => {
      aBuilds += 1;
      return document.createElement("a");
    };
    const B = (): unknown => document.createElement("b");
    const host = mountDynamic({
      get component() {
        return which() === "A" ? A : B;
      },
    });
    const firstA = onlyChild(host);
    setWhich("B");
    flushSync();
    setWhich("A");
    flushSync();
    expect(aBuilds).toBe(2);
    expect(onlyChild(host)).not.toBe(firstA);
  });

  it("[DYN-36] swapping to undefined removes the element and swapping back restores it", () => {
    const [tag, setTag] = useSignal<string | undefined>("p");
    const host = mountDynamic({
      get component() {
        return tag();
      },
    });
    setTag(undefined);
    flushSync();
    expect(host.childNodes.length).toBe(0);
    setTag("p");
    flushSync();
    expect(onlyChild(host).localName).toBe("p");
  });

  it("[DYN-37] swapping keeps the order of a following sibling", () => {
    const [tag, setTag] = useSignal("p");
    const host = mount();
    disposers.push(
      createRoot((dispose) => {
        insert(
          host,
          Dynamic({
            get component() {
              return tag();
            },
          }),
        );
        insert(host, document.createElement("hr"));
        return dispose;
      }),
    );
    flushSync();
    setTag("section");
    flushSync();
    expect(Array.from(host.children, (el) => el.localName)).toEqual(["section", "hr"]);
  });

  it("[DYN-38] listeners of the swapped-out element stop firing", () => {
    const [tag, setTag] = useSignal("button");
    let hits = 0;
    const host = mountDynamic({
      get component() {
        return tag();
      },
      onClick: () => {
        hits += 1;
      },
    });
    const old = onlyChild(host);
    setTag("a");
    flushSync();
    old.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(hits).toBe(0);
  });

  it("[DYN-39] moving from a tag to a component and back to a tag works", () => {
    const [kind, setKind] = useSignal<"tag" | "component">("tag");
    const Comp = (): unknown => document.createElement("u");
    const host = mountDynamic({
      get component() {
        return kind() === "tag" ? "i" : Comp;
      },
    });
    expect(onlyChild(host).localName).toBe("i");
    setKind("component");
    flushSync();
    expect(onlyChild(host).localName).toBe("u");
    setKind("tag");
    flushSync();
    expect(onlyChild(host).localName).toBe("i");
  });

  it("[DYN-40] a swap to a different namespace uses the new namespace", () => {
    const [tag, setTag] = useSignal("p");
    const host = mountDynamic({
      get component() {
        return tag();
      },
    });
    expect(onlyChild(host).namespaceURI).toBe(XHTML_NS);
    setTag("circle");
    flushSync();
    expect(onlyChild(host).namespaceURI).toBe(SVG_NS);
  });
});

describe("Dynamic(): falsy components and ownership", () => {
  it("[DYN-41] null renders nothing", () => {
    const host = mountDynamic({ component: null });
    expect(host.childNodes.length).toBe(0);
  });

  it("[DYN-42] false renders nothing", () => {
    const host = mountDynamic({ component: false });
    expect(host.childNodes.length).toBe(0);
  });

  it("[DYN-43] an empty string renders nothing rather than an invalid tag error", () => {
    const host = mountDynamic({ component: "" });
    expect(host.childNodes.length).toBe(0);
  });

  it("[DYN-44] undefined renders nothing, and a later tag appears once it is set", () => {
    const [tag, setTag] = useSignal<string | undefined>(undefined);
    const host = mountDynamic({
      get component() {
        return tag();
      },
    });
    expect(host.childNodes.length).toBe(0);
    setTag("span");
    flushSync();
    expect(onlyChild(host).localName).toBe("span");
  });

  it("[DYN-45] disposing the owner stops the element's reactive bindings", () => {
    const [text, setText] = useSignal("first");
    const host = mount();
    const dispose = createRoot((stop) => {
      insert(
        host,
        Dynamic({
          component: "p",
          get children() {
            return text();
          },
        }),
      );
      return stop;
    });
    flushSync();
    dispose();
    setText("second");
    flushSync();
    expect(onlyChild(host).textContent).toBe("first");
  });

  it("[DYN-46] Dynamic returns an accessor, and reading it twice gives the same node", () => {
    let view: (() => unknown) | undefined;
    createRoot((dispose) => {
      view = Dynamic({ component: "div" });
      disposers.push(dispose);
      return dispose;
    });
    expect(typeof view).toBe("function");
    const first = view?.();
    expect(first).toBeInstanceOf(Element);
    expect(view?.()).toBe(first);
  });
});

describe("Dynamic(): hostile props", () => {
  it("[DYN-47] an attribute name with a space is refused with a TypeError", () => {
    expect(() => mountDynamic({ component: "div", "data x": "1" })).toThrow(TypeError);
  });

  it("[DYN-48] an attribute name with quotes is refused", () => {
    expect(() => mountDynamic({ component: "div", 'a"b': "1" })).toThrow(TypeError);
  });

  it("[DYN-49] a javascript: href is not written and a warning is printed", () => {
    const host = mountDynamic({ component: "a", href: "javascript:alert(1)" });
    expect(onlyChild(host).hasAttribute("href")).toBe(false);
    const messages = takeWarnings();
    expect(messages.some((message) => message.includes("UNSAFE_URL_BLOCKED"))).toBe(true);
  });

  it("[DYN-50] control characters do not hide a javascript: href", () => {
    const host = mountDynamic({ component: "a", href: " java\tscript:alert(1)" });
    expect(onlyChild(host).hasAttribute("href")).toBe(false);
    takeWarnings();
  });

  it("[DYN-51] a data:text/html source is not written", () => {
    const restoreLoading = quietFileLoading();
    try {
      const host = mountDynamic({ component: "iframe", src: "data:text/html,<script>x</script>" });
      expect(onlyChild(host).hasAttribute("src")).toBe(false);
      takeWarnings();
    } finally {
      restoreLoading();
    }
  });

  it("[DYN-52] a __proto__ prop never reaches an attribute or the prototype chain", () => {
    const props: DynamicProps = { component: "div" };
    Object.defineProperty(props, "__proto__", { value: "x", enumerable: true });
    const host = mountDynamic(props);
    expect(onlyChild(host).hasAttribute("__proto__")).toBe(false);
    expect(Object.getPrototypeOf(Object.prototype)).toBeNull();
  });

  it("[DYN-53] a nested Dynamic inside a component renders in order", () => {
    const Outer = (): unknown => {
      const wrap = document.createElement("div");
      insert(wrap, Dynamic({ component: "span", children: "inner" }));
      return wrap;
    };
    const host = mountDynamic({ component: Outer });
    expect(host.textContent).toBe("inner");
  });
});
