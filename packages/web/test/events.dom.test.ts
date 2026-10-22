import { afterEach, describe, expect, it, vi } from "vitest";
import { addEventListener, delegateEvents } from "../src/index";
import { cleanupDom, getExpando, mount, setExpando } from "./support/dom";

delegateEvents(["click", "input"]);

afterEach(cleanupDom);

function click(target: EventTarget, composed = false): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed }));
}

describe("delegateEvents()", () => {
  it("[EVT-01] installs one listener per event name on the document, idempotently", () => {
    const doc = document.implementation.createHTMLDocument("delegated");
    const spy = vi.spyOn(doc, "addEventListener");
    delegateEvents(["click", "input"], doc);
    delegateEvents(["click"], doc);
    const names = spy.mock.calls.map((call) => call[0]);
    expect(names).toEqual(["click", "input"]);
    spy.mockRestore();
  });

  it("[EVT-02] delegates on the document it is given, not the global one", () => {
    const doc = document.implementation.createHTMLDocument("delegated");
    delegateEvents(["click"], doc);
    const host = doc.createElement("button");
    doc.body.appendChild(host);
    const handler = vi.fn();
    setExpando(host, "$$click", handler);
    host.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("delegated handlers", () => {
  it("[EVT-10] the handler is called with this = element, the data tuple value, and the event", () => {
    const button = mount("button");
    const calls: unknown[][] = [];
    const seenThis: unknown[] = [];
    setExpando(button, "$$click", function (this: unknown, data: unknown, event: unknown) {
      seenThis.push(this);
      calls.push([event, data]);
    });
    setExpando(button, "$$clickData", "payload");
    click(button);
    expect(seenThis[0]).toBe(button);
    const [event, data] = calls[0] ?? [];
    expect(event).toBeInstanceOf(Event);
    expect((event as Event).type).toBe("click");
    expect(data).toBe("payload");
  });

  it("[EVT-11] without data the handler receives only the event", () => {
    const button = mount("button");
    const args: unknown[][] = [];
    setExpando(button, "$$click", (...all: unknown[]) => {
      args.push(all);
    });
    click(button);
    expect(args[0]?.length).toBe(1);
  });

  it("[EVT-12] nested delegated handlers run from the target outward", () => {
    const outer = mount("section");
    const inner = document.createElement("button");
    outer.appendChild(inner);
    const order: string[] = [];
    setExpando(outer, "$$click", () => order.push("outer"));
    setExpando(inner, "$$click", () => order.push("inner"));
    click(inner);
    expect(order).toEqual(["inner", "outer"]);
  });

  it("[EVT-13] stopPropagation inside a handler stops the walk to ancestors", () => {
    const outer = mount("section");
    const inner = document.createElement("button");
    outer.appendChild(inner);
    const outerHandler = vi.fn();
    setExpando(outer, "$$click", outerHandler);
    setExpando(inner, "$$click", (event: Event) => event.stopPropagation());
    click(inner);
    expect(outerHandler).not.toHaveBeenCalled();
  });

  it("[EVT-14] after stopPropagation, event.cancelBubble reads true and the walk stops", () => {
    const outer = mount("section");
    const inner = document.createElement("button");
    outer.appendChild(inner);
    const outerHandler = vi.fn();
    const seen: boolean[] = [];
    setExpando(outer, "$$click", outerHandler);
    setExpando(inner, "$$click", (event: Event) => {
      event.stopPropagation();
      seen.push(event.cancelBubble);
    });
    click(inner);
    expect(seen).toEqual([true]);
    expect(outerHandler).not.toHaveBeenCalled();
  });

  it("[EVT-15] currentTarget is the handler's node during its call and restored afterward", () => {
    const outer = mount("section");
    const inner = document.createElement("button");
    outer.appendChild(inner);
    const seen: EventTarget[] = [];
    let captured: Event | undefined;
    setExpando(inner, "$$click", (event: Event) => {
      captured = event;
      seen.push(event.currentTarget ?? outer);
    });
    setExpando(outer, "$$click", (event: Event) => {
      seen.push(event.currentTarget ?? outer);
    });
    click(inner);
    expect(seen).toEqual([inner, outer]);
    expect(captured?.currentTarget).toBeNull();
  });

  it("[EVT-16] event.target is the element that was clicked", () => {
    const outer = mount("section");
    const inner = document.createElement("span");
    outer.appendChild(inner);
    let target: EventTarget | null = null;
    setExpando(outer, "$$click", (event: Event) => {
      target = event.target;
    });
    click(inner);
    expect(target).toBe(inner);
  });

  it("[EVT-17] replacing the expando replaces the handler; the old one is no longer called", () => {
    const button = mount("button");
    const first = vi.fn();
    const second = vi.fn();
    setExpando(button, "$$click", first);
    setExpando(button, "$$click", second);
    click(button);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("[EVT-18] a removed element no longer reaches the document handler", () => {
    const outer = mount("section");
    const button = document.createElement("button");
    outer.appendChild(button);
    const handler = vi.fn();
    setExpando(button, "$$click", handler);
    button.remove();
    click(button);
    expect(handler).not.toHaveBeenCalled();
  });

  it("[EVT-19] delegated events reach handlers inside a shadow root when composed", () => {
    const host = mount("div");
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    shadow.appendChild(inner);
    const handler = vi.fn();
    setExpando(inner, "$$click", handler);
    click(inner, true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.contexts[0]).toBe(inner);
  });

  it("[EVT-20] a throwing handler does not stop later handlers, and the error is rethrown", () => {
    const outer = mount("section");
    const inner = document.createElement("button");
    outer.appendChild(inner);
    const outerHandler = vi.fn();
    setExpando(outer, "$$click", outerHandler);
    setExpando(inner, "$$click", () => {
      throw new Error("handler failed");
    });
    expect(() => click(inner)).toThrow("handler failed");
    expect(outerHandler).toHaveBeenCalledTimes(1);
  });

  it("[EVT-21] a null handler adds nothing", () => {
    const button = mount("button");
    addEventListener(button, "custom-null", null);
    expect(() => button.dispatchEvent(new Event("custom-null"))).not.toThrow();
  });
});

describe("addEventListener()", () => {
  it("[EVT-30] a non-delegated function is bound once and called with this = element", () => {
    const button = mount("button");
    const handler = vi.fn();
    addEventListener(button, "custom-once", handler);
    button.dispatchEvent(new Event("custom-once"));
    button.dispatchEvent(new Event("custom-once"));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.contexts[0]).toBe(button);
  });

  it("[EVT-31] a [fn, data] tuple passes the data as the first argument", () => {
    const button = mount("button");
    const handler = vi.fn();
    addEventListener(button, "custom-tuple", [handler, "d"]);
    button.dispatchEvent(new Event("custom-tuple"));
    expect(handler.mock.calls[0]?.[0]).toBe("d");
    expect(handler.mock.calls[0]?.[1]).toBeInstanceOf(Event);
  });

  it("[EVT-32] delegate true with an allow-listed name stores the handler as an expando", () => {
    const button = mount("button");
    const handler = vi.fn();
    addEventListener(button, "click", handler, true);
    expect(getExpando(button, "$$click")).toBe(handler);
    click(button);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("[EVT-33] delegate true with a name outside the allow-list falls back to a native listener", () => {
    const button = mount("button");
    const handler = vi.fn();
    addEventListener(button, "custom-native", handler, true);
    button.dispatchEvent(new Event("custom-native", { bubbles: false }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(getExpando(button, "$$custom-native")).toBeUndefined();
  });

  it("[EVT-34] a delegated [fn, data] tuple stores the data expando", () => {
    const button = mount("button");
    const handler = vi.fn();
    addEventListener(button, "click", [handler, 7], true);
    click(button);
    expect(handler.mock.calls[0]?.[0]).toBe(7);
  });

  it("[EVT-35] a value that is neither function nor tuple is rejected with a TypeError", () => {
    const button = mount("button");
    expect(() => addEventListener(button, "custom-bad", "not a handler")).toThrow(TypeError);
  });
});

describe("listener cleanup with the owner", () => {
  it("[EVT-CLN] native listeners bound through addEventListener() and spread() are removed when the owner is disposed", async () => {
    const { createRoot } = await import("@shadow-js/core");
    const { spread } = await import("../src/spread");
    const { addEventListener } = await import("../src/events");
    const button = document.createElement("button");
    document.body.append(button);
    let hits = 0;
    const dispose = createRoot((stop) => {
      addEventListener(button, "focus", () => {
        hits += 1;
      });
      spread(button, {
        onBlur: () => {
          hits += 10;
        },
      });
      return stop;
    });
    button.dispatchEvent(new Event("focus"));
    // React's onBlur is focusout (bubbling), so the spread listens for focusout.
    button.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(hits).toBe(11);
    dispose();
    button.dispatchEvent(new Event("focus"));
    button.dispatchEvent(new Event("blur"));
    expect(hits).toBe(11);
    button.remove();
  });
});

describe("delegation on an element from an inert document", () => {
  it("[EVT-INERT] a handler bound before the element reaches the page is still delegated on the page's document", () => {
    // `template.content.cloneNode(true)` (what the compiler's templates do) yields elements owned
    // by the template's inert document, which has no window and never receives an event. The
    // document that must carry the listener is the one the element is going to live in.
    const inert = document.implementation.createHTMLDocument("inert");
    const spy = vi.spyOn(inert, "addEventListener");
    const target = inert.createElement("div");
    const handler = vi.fn();
    addEventListener(target, "contextmenu", handler, true);
    document.body.appendChild(target);
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    target.remove();
    spy.mockRestore();
  });
});

describe("non-composed events", () => {
  it("[EVT-NC] change is bound on its element, so a change that does not bubble still reaches the handler", () => {
    // `change` is not composed: inside a shadow root it never reaches the document, so a delegated
    // listener would miss it. Only composed events (click, input, ...) may be delegated.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const input = document.createElement("input");
    host.appendChild(input);
    const handler = vi.fn();
    addEventListener(input, "change", handler, true);
    expect(getExpando(input, "$$change")).toBeUndefined();
    input.dispatchEvent(new Event("change"));
    expect(handler).toHaveBeenCalledTimes(1);
    host.remove();
  });
});
