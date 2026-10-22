import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Portal, type PortalProps } from "../../src/control-flow/portal";
import { addEventListener } from "../../src/events";
import { insert } from "../../src/insert";
import { resetWebWarningDedupe } from "../../src/internal/diagnostics";
import { cleanupDom, hasComment, installMoveBefore, mount, shape, texts } from "../support/dom";

let disposers: Array<() => void> = [];
let uninstall: Array<() => void> = [];

beforeEach(() => {
  resetWebWarningDedupe();
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  for (const undo of uninstall) undo();
  uninstall = [];
  cleanupDom();
});

/** Messages printed through console.warn since the last call; clears them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.map(String).join(" "));
  spy.mockClear();
  return messages;
}

/** A paragraph carrying `text`. */
function node(text: string): HTMLElement {
  const el = document.createElement("p");
  el.textContent = text;
  return el;
}

/** Mounts a Portal at a call site inside its own owner; returns the call site and the disposer. */
function renderPortal(props: PortalProps, callSite: HTMLElement = mount()): () => void {
  const stop = createRoot((dispose) => {
    insert(callSite, Portal(props));
    return dispose;
  });
  flushSync();
  disposers.push(stop);
  return stop;
}

/** Element children of an element, as local names. */
function names(parent: Node): string[] {
  return Array.from(parent.childNodes, (child) =>
    child instanceof Element ? child.localName : `#${child.nodeType}`,
  );
}

describe("Portal(): mounting", () => {
  it("[PTL-01] the default mount is document.body", () => {
    const child = node("a");
    renderPortal({ children: child });
    expect(child.parentNode).toBe(document.body);
  });

  it("[PTL-02] an explicit mount receives the children and body does not", () => {
    const target = mount("section");
    const child = node("a");
    renderPortal({ mount: target, children: child });
    expect(child.parentNode).toBe(target);
    expect(document.body.contains(child)).toBe(true);
    expect(target.childNodes.length).toBe(1);
  });

  it("[PTL-03] a mount function is called and its element receives the content", () => {
    const target = mount("main");
    const resolve = vi.fn(() => target);
    const child = node("a");
    renderPortal({ mount: resolve, children: child });
    expect(resolve).toHaveBeenCalled();
    expect(child.parentNode).toBe(target);
  });

  it("[PTL-04] Portal returns nothing at its call site", () => {
    const callSite = mount("div");
    let returned: unknown = "unset";
    disposers.push(
      createRoot((dispose) => {
        returned = Portal({ mount: mount("aside"), children: node("a") });
        return dispose;
      }),
    );
    expect(returned).toBeNull();
    expect(callSite.childNodes.length).toBe(0);
  });

  it("[PTL-05] no comment nodes are created in the call site or the mount", () => {
    const target = mount("div");
    const callSite = mount("div");
    renderPortal({ mount: target, children: [node("a"), node("b")] }, callSite);
    expect(hasComment(target)).toBe(false);
    expect(hasComment(callSite)).toBe(false);
    expect(hasComment(document.body)).toBe(false);
  });

  it("[PTL-06] disposing removes its own nodes and leaves foreign nodes in the mount", () => {
    const target = mount("div");
    const foreign = node("foreign");
    target.appendChild(foreign);
    const stop = renderPortal({ mount: target, children: node("owned") });
    expect(target.childNodes.length).toBe(2);
    stop();
    expect(shape(target)).toEqual(["p"]);
    expect(target.firstChild).toBe(foreign);
  });

  it("[PTL-07] portal content is appended after nodes already in the mount, in order", () => {
    const target = mount("div");
    target.appendChild(node("first"));
    renderPortal({ mount: target, children: [node("second"), node("third")] });
    expect(Array.from(target.children, (el) => el.textContent)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("[PTL-08] a static node keeps its identity when the mount changes", () => {
    const first = mount("div");
    const second = mount("div");
    const [target, setTarget] = useSignal<Element>(first);
    const child = node("moved");
    renderPortal({ mount: () => target(), children: child });
    expect(child.parentNode).toBe(first);
    setTarget(second);
    flushSync();
    expect(child.parentNode).toBe(second);
    expect(first.childNodes.length).toBe(0);
    expect(second.childNodes.length).toBe(1);
  });

  it("[PTL-09] a reactive child is rebuilt in the new mount and the old nodes leave", () => {
    const first = mount("div");
    const second = mount("div");
    const [target, setTarget] = useSignal<Element>(first);
    const [label, setLabel] = useSignal("one");
    renderPortal({
      mount: () => target(),
      get children() {
        return node(label());
      },
    });
    const before = first.firstElementChild;
    setTarget(second);
    flushSync();
    expect(first.childNodes.length).toBe(0);
    expect(second.textContent).toBe("one");
    expect(second.firstElementChild).not.toBe(before);
    setLabel("two");
    flushSync();
    expect(second.textContent).toBe("two");
  });

  it("[PTL-10] text children stay reactive after the mount moved", () => {
    const first = mount("div");
    const second = mount("div");
    const [target, setTarget] = useSignal<Element>(first);
    const [count, setCount] = useSignal(1);
    renderPortal({
      mount: () => target(),
      get children() {
        return `c${count()}`;
      },
    });
    setTarget(second);
    flushSync();
    setCount(2);
    flushSync();
    expect(second.textContent).toBe("c2");
    expect(first.textContent).toBe("");
  });

  it("[PTL-11] a mount that is set to null removes the content and warns once", () => {
    const target = mount("div");
    const [current, setCurrent] = useSignal<Element | null>(target);
    const child = node("a");
    renderPortal({ mount: () => current(), children: child });
    setCurrent(null);
    flushSync();
    expect(child.isConnected).toBe(false);
    const messages = takeWarnings().filter((m) => m.includes("PORTAL_TARGET_MISSING"));
    expect(messages.length).toBe(1);
  });

  it("[PTL-12] a mount that comes back after null shows the content again", () => {
    const target = mount("div");
    const [current, setCurrent] = useSignal<Element | null>(null);
    const child = node("back");
    renderPortal({ mount: () => current(), children: child });
    takeWarnings();
    setCurrent(target);
    flushSync();
    expect(child.parentNode).toBe(target);
  });

  it("[PTL-13] a mount function that is null at creation renders nothing and warns once", () => {
    const child = node("a");
    renderPortal({ mount: () => null, children: child });
    expect(child.isConnected).toBe(false);
    const messages = takeWarnings().filter((m) => m.includes("PORTAL_TARGET_MISSING"));
    expect(messages.length).toBe(1);
  });

  it("[PTL-14] an explicit null mount renders nothing and warns once", () => {
    const child = node("a");
    renderPortal({ mount: null, children: child });
    expect(child.isConnected).toBe(false);
    const messages = takeWarnings().filter((m) => m.includes("PORTAL_TARGET_MISSING"));
    expect(messages.length).toBe(1);
  });

  it("[PTL-15] repeated null transitions warn only once per portal instance", () => {
    const target = mount("div");
    const [current, setCurrent] = useSignal<Element | null>(target);
    renderPortal({ mount: () => current(), children: node("a") });
    setCurrent(null);
    flushSync();
    setCurrent(target);
    flushSync();
    setCurrent(null);
    flushSync();
    const messages = takeWarnings().filter((m) => m.includes("PORTAL_TARGET_MISSING"));
    expect(messages.length).toBe(1);
  });

  it("[PTL-16] a portal with no children and a valid mount leaves the mount empty", () => {
    const target = mount("div");
    renderPortal({ mount: target });
    expect(target.childNodes.length).toBe(0);
  });

  it("[PTL-17] null and false children render nothing in the mount", () => {
    const target = mount("div");
    renderPortal({ mount: target, children: [null, false, undefined] });
    expect(target.childNodes.length).toBe(0);
  });

  it("[PTL-18] a text child becomes one Text node in the mount", () => {
    const target = mount("div");
    renderPortal({ mount: target, children: "hello" });
    expect(shape(target)).toEqual(["#t:hello"]);
    expect(texts("hello")).toEqual(["#t:hello"]);
  });

  it("[PTL-19] a node already inside another parent is moved into the mount", () => {
    const elsewhere = mount("div");
    const child = node("moved");
    elsewhere.appendChild(child);
    const target = mount("div");
    renderPortal({ mount: target, children: child });
    expect(child.parentNode).toBe(target);
    expect(elsewhere.childNodes.length).toBe(0);
  });

  it("[PTL-20] a getter child that swaps nodes removes the old node from the mount", () => {
    const target = mount("div");
    const [which, setWhich] = useSignal<"a" | "b">("a");
    const a = node("a");
    const b = node("b");
    renderPortal({
      mount: target,
      get children() {
        return which() === "a" ? a : b;
      },
    });
    setWhich("b");
    flushSync();
    expect(target.childNodes.length).toBe(1);
    expect(target.firstChild).toBe(b);
    expect(a.isConnected).toBe(false);
  });

  it("[PTL-21] an array of children keeps its order when one of them changes", () => {
    const target = mount("div");
    const [middle, setMiddle] = useSignal("m1");
    renderPortal({
      mount: target,
      get children() {
        return [node("first"), node(middle()), node("last")];
      },
    });
    setMiddle("m2");
    flushSync();
    expect(Array.from(target.children, (el) => el.textContent)).toEqual(["first", "m2", "last"]);
  });

  it("[PTL-22] an empty array of children leaves nothing behind after content was rendered", () => {
    const target = mount("div");
    const [items, setItems] = useSignal<HTMLElement[]>([node("x")]);
    renderPortal({
      mount: target,
      get children() {
        return items();
      },
    });
    setItems([]);
    flushSync();
    expect(target.childNodes.length).toBe(0);
  });
});

describe("Portal(): shadow roots", () => {
  it("[PTL-23] useShadow puts the content inside a shadow root of the mount", () => {
    const host = mount("div");
    const child = node("in shadow");
    renderPortal({ mount: host, useShadow: true, children: child });
    expect(host.shadowRoot).not.toBeNull();
    expect(child.parentNode).toBe(host.shadowRoot);
    expect(host.childNodes.length).toBe(0);
  });

  it("[PTL-24] the shadow root is created once and reused on later mounts to the same host", () => {
    const host = mount("div");
    const [target, setTarget] = useSignal<Element | null>(host);
    renderPortal({ mount: () => target(), useShadow: true, children: node("a") });
    const first = host.shadowRoot;
    setTarget(null);
    flushSync();
    expect(takeWarnings().filter((m) => m.includes("PORTAL_TARGET_MISSING"))).toHaveLength(1);
    setTarget(host);
    flushSync();
    expect(host.shadowRoot).toBe(first);
  });

  it("[PTL-25] an existing open shadow root is reused, not attached a second time", () => {
    const host = mount("div");
    const existing = host.attachShadow({ mode: "open" });
    const child = node("reused");
    renderPortal({ mount: host, useShadow: true, children: child });
    expect(host.shadowRoot).toBe(existing);
    expect(child.parentNode).toBe(existing);
  });

  it("[PTL-26] disposing a shadow portal removes only its nodes from the shadow root", () => {
    const host = mount("div");
    const root = host.attachShadow({ mode: "open" });
    const foreign = node("foreign");
    root.appendChild(foreign);
    const stop = renderPortal({ mount: host, useShadow: true, children: node("owned") });
    expect(root.childNodes.length).toBe(2);
    stop();
    expect(root.childNodes.length).toBe(1);
    expect(root.firstChild).toBe(foreign);
  });

  it("[PTL-27] a light-DOM mount without useShadow keeps content as direct children", () => {
    const host = mount("div");
    renderPortal({ mount: host, children: node("light") });
    expect(host.shadowRoot).toBeNull();
    expect(host.firstElementChild?.textContent).toBe("light");
  });

  it("[PTL-28] moving a shadow portal to another host leaves the old root empty", () => {
    const shadowHost = mount("div");
    const otherHost = mount("div");
    const [target, setTarget] = useSignal<Element>(shadowHost);
    const child = node("moved");
    renderPortal({ mount: () => target(), useShadow: true, children: child });
    expect(child.parentNode).toBe(shadowHost.shadowRoot);
    setTarget(otherHost);
    flushSync();
    expect(shadowHost.shadowRoot?.childNodes.length).toBe(0);
    expect(child.parentNode).toBe(otherHost.shadowRoot);
    expect(otherHost.childNodes.length).toBe(0);
  });
});

describe("Portal(): events and ownership", () => {
  it("[PTL-29] a delegated click on portal content reaches its handler once", () => {
    const target = mount("div");
    const clicks: string[] = [];
    const button = document.createElement("button");
    addEventListener(
      button,
      "click",
      () => {
        clicks.push("hit");
      },
      true,
    );
    renderPortal({ mount: target, children: button });
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(clicks).toEqual(["hit"]);
  });

  it("[PTL-30] a delegated input event on portal content in the body reaches its handler", () => {
    const seen: string[] = [];
    const field = document.createElement("input");
    addEventListener(
      field,
      "input",
      () => {
        seen.push("typed");
      },
      true,
    );
    renderPortal({ children: field });
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen).toEqual(["typed"]);
  });

  it("[PTL-31] a composed click inside a shadow root reaches the document delegation", () => {
    const host = mount("div");
    const clicks: string[] = [];
    const button = document.createElement("button");
    addEventListener(
      button,
      "click",
      () => {
        clicks.push("shadow");
      },
      true,
    );
    renderPortal({ mount: host, useShadow: true, children: button });
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(clicks).toEqual(["shadow"]);
  });

  it("[PTL-32] a non-composed event inside a shadow root does not leave the shadow tree", () => {
    const host = mount("div");
    const seen: string[] = [];
    const button = document.createElement("button");
    addEventListener(
      button,
      "click",
      () => {
        seen.push("hit");
      },
      true,
    );
    renderPortal({ mount: host, useShadow: true, children: button });
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: false }));
    expect(seen).toEqual([]);
  });

  it("[PTL-33] events follow the DOM tree: a handler on the call-site ancestor does not fire", () => {
    const callSite = mount("div");
    const ancestorClicks: string[] = [];
    addEventListener(
      callSite,
      "click",
      () => {
        ancestorClicks.push("call-site");
      },
      true,
    );
    const target = mount("section");
    const button = document.createElement("button");
    renderPortal({ mount: target, children: button }, callSite);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(ancestorClicks).toEqual([]);
  });

  it("[PTL-34] a native listener on portal content is bound and fires", () => {
    const target = mount("div");
    const child = node("native");
    const seen: string[] = [];
    addEventListener(
      child,
      "customthing",
      () => {
        seen.push("native");
      },
      false,
    );
    renderPortal({ mount: target, children: child });
    child.dispatchEvent(new Event("customthing"));
    expect(seen).toEqual(["native"]);
  });

  it("[PTL-35] disposing twice is safe", () => {
    const target = mount("div");
    const stop = renderPortal({ mount: target, children: node("a") });
    stop();
    expect(() => {
      stop();
    }).not.toThrow();
    expect(target.childNodes.length).toBe(0);
  });

  it("[PTL-36] a mount change after disposal does nothing", () => {
    const first = mount("div");
    const second = mount("div");
    const [target, setTarget] = useSignal<Element>(first);
    const stop = renderPortal({ mount: () => target(), children: node("a") });
    stop();
    setTarget(second);
    flushSync();
    expect(second.childNodes.length).toBe(0);
  });

  it("[PTL-37] two portals in one mount each remove only their own nodes", () => {
    const target = mount("div");
    const keepChild = node("keep");
    const dropChild = node("drop");
    renderPortal({ mount: target, children: keepChild });
    const stop = renderPortal({ mount: target, children: dropChild });
    stop();
    expect(target.childNodes.length).toBe(1);
    expect(target.firstChild).toBe(keepChild);
  });

  it("[PTL-38] a portal inside a component is removed when that owner is disposed", () => {
    const target = mount("div");
    const child = node("owned by component");
    const stop = createRoot((dispose) => {
      const Component = (): null => {
        Portal({ mount: target, children: child });
        return null;
      };
      Component();
      return dispose;
    });
    flushSync();
    expect(child.parentNode).toBe(target);
    stop();
    expect(child.parentNode).toBe(null);
  });

  it("[PTL-39] a nested portal inside portal content mounts into its own target", () => {
    const outer = mount("div");
    const inner = mount("span");
    const deepChild = node("deep");
    renderPortal({
      mount: outer,
      children: () => {
        Portal({ mount: inner, children: deepChild });
        return null;
      },
    });
    expect(deepChild.parentNode).toBe(inner);
    expect(outer.childNodes.length).toBe(0);
  });

  it("[PTL-40] a mount detached from the document still lets dispose run without throwing", () => {
    const detached = document.createElement("div");
    const child = node("detached");
    const stop = renderPortal({ mount: detached, children: child });
    detached.remove();
    expect(() => {
      stop();
    }).not.toThrow();
    expect(child.isConnected).toBe(false);
  });
});

describe("Portal(): moving and DOM writes", () => {
  it("[PTL-41] a moved node uses moveBefore when the mount supports it", () => {
    uninstall.push(installMoveBefore());
    const first = mount("div");
    const second = mount("div");
    const [target, setTarget] = useSignal<Element>(first);
    const spy = vi.spyOn(second, "moveBefore");
    renderPortal({ mount: () => target(), children: node("moved") });
    setTarget(second);
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("[PTL-42] without moveBefore a move still lands the node in the new mount", () => {
    const first = mount("div");
    const second = mount("div");
    const [target, setTarget] = useSignal<Element>(first);
    const child = node("plain");
    renderPortal({ mount: () => target(), children: child });
    setTarget(second);
    flushSync();
    expect(child.parentNode).toBe(second);
  });

  it("[PTL-43] setting the same mount again performs no DOM moves", () => {
    const target = mount("div");
    const [current, setCurrent] = useSignal<Element>(target);
    const child = node("still");
    renderPortal({ mount: () => current(), children: child });
    const spy = vi.spyOn(target, "appendChild");
    setCurrent(target);
    flushSync();
    expect(spy).not.toHaveBeenCalled();
    expect(child.parentNode).toBe(target);
  });

  it("[PTL-44] a moved group of several static nodes keeps their order", () => {
    const first = mount("div");
    const second = mount("div");
    const [target, setTarget] = useSignal<Element>(first);
    const a = node("a");
    const b = node("b");
    renderPortal({ mount: () => target(), children: [a, b] });
    setTarget(second);
    flushSync();
    expect(Array.from(second.children, (el) => el.textContent)).toEqual(["a", "b"]);
    expect(first.childNodes.length).toBe(0);
  });

  it("[PTL-45] isSVG is accepted and does not change where the content goes", () => {
    const target = mount("div");
    const child = node("svg flag");
    renderPortal({ mount: target, isSVG: true, children: child });
    expect(child.parentNode).toBe(target);
    expect(names(target)).toEqual(["p"]);
  });
});
