import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spread } from "../src/index";
import { cleanupDom, getExpando, mount, SVG_NS } from "./support/dom";

afterEach(cleanupDom);

/** Runs `spread` inside a root so its effects are owned, then returns the element. */
function spreadOn(el: Element, props: object, isSVG = false, skipChildren = false): void {
  createRoot(() => {
    spread(el, props, isSVG, skipChildren);
  });
}

describe("spread(): attributes and classes", () => {
  it("[SPR-01] sets attributes and removes the ones that disappear", () => {
    const el = mount();
    const [id, setId] = useSignal("a");
    const [title, setTitle] = useSignal<string | undefined>("t");
    spreadOn(el, {
      get id() {
        return id();
      },
      get title() {
        return title();
      },
    });
    expect(el.id).toBe("a");
    expect(el.getAttribute("title")).toBe("t");
    setTitle(undefined);
    flushSync();
    expect(el.hasAttribute("title")).toBe(false);
    setId("b");
    flushSync();
    expect(el.id).toBe("b");
  });

  it("[SPR-02] class, classList and style are applied through their helpers", () => {
    const el = mount();
    spreadOn(el, { class: ["x", { y: true }], classList: { z: true }, style: { color: "red" } });
    expect(el.getAttribute("class")).toBe("x y z");
    expect(el.classList.contains("z")).toBe(true);
    expect(el.style.color).toBe("red");
  });

  it("[SPR-03] className and classList react to changes of their own key only", () => {
    const el = mount();
    const [klass, setKlass] = useSignal<string>("one");
    const [other, setOther] = useSignal("static");
    spreadOn(el, {
      get className() {
        return klass();
      },
      get "data-other"() {
        return other();
      },
    });
    setKlass("two");
    flushSync();
    expect(el.className).toBe("two");
    setOther("changed");
    flushSync();
    expect(el.getAttribute("data-other")).toBe("changed");
  });

  it("[SPR-04] a classList that changes toggles only the changed keys", () => {
    const el = mount();
    el.classList.add("manual");
    const [flags, setFlags] = useSignal<Record<string, boolean>>({ a: true, b: false });
    spreadOn(el, {
      get classList() {
        return flags();
      },
    });
    setFlags({ a: false, b: true });
    flushSync();
    expect(el.classList.contains("a")).toBe(false);
    expect(el.classList.contains("b")).toBe(true);
    expect(el.classList.contains("manual")).toBe(true);
  });

  it("[SPR-05] a style object updates only the changed properties", () => {
    const el = mount();
    const [style, setStyle] = useSignal<Record<string, string>>({ color: "red", width: "1px" });
    spreadOn(el, {
      get style() {
        return style();
      },
    });
    const spy = vi.spyOn(el.style, "setProperty");
    setStyle({ color: "red", width: "2px" });
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(el.style.width).toBe("2px");
    spy.mockRestore();
  });

  it("[SPR-06] a changed prop writes only that attribute", () => {
    const el = mount();
    const attributes = vi.spyOn(Element.prototype, "setAttribute");
    const [value, setValue] = useSignal("a");
    spreadOn(el, {
      "data-static": "s",
      get "data-value"() {
        return value();
      },
    });
    attributes.mockClear();
    setValue("b");
    flushSync();
    expect(attributes).toHaveBeenCalledTimes(1);
    expect(el.getAttribute("data-value")).toBe("b");
    attributes.mockRestore();
  });

  it("[SPR-07] SVG elements get class through the attribute path", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    spreadOn(svg, { class: "s" }, true);
    expect(svg.getAttribute("class")).toBe("s");
  });
});

describe("spread(): events", () => {
  it("[SPR-10] a delegated on* handler is stored on the element and replaced on change", () => {
    const el = mount("button");
    const first = vi.fn();
    const second = vi.fn();
    const [handler, setHandler] = useSignal<() => void>(first);
    spreadOn(el, {
      get onClick() {
        return handler();
      },
    });
    expect(getExpando(el, "$$click")).toBe(first);
    setHandler(() => second);
    flushSync();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("[SPR-11] a native on* handler is bound once and replaced without leaving the old one bound", () => {
    const el = mount("button");
    const first = vi.fn();
    const second = vi.fn();
    const [handler, setHandler] = useSignal<() => void>(first);
    spreadOn(el, {
      get onCustomThing() {
        return handler();
      },
    });
    el.dispatchEvent(new Event("customthing"));
    setHandler(() => second);
    flushSync();
    el.dispatchEvent(new Event("customthing"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("[SPR-12] removing an on* key unbinds the handler", () => {
    const el = mount("button");
    const handler = vi.fn();
    const [present, setPresent] = useSignal<(() => void) | undefined>(handler);
    spreadOn(el, {
      get onCustomGone() {
        return present();
      },
    });
    setPresent(undefined);
    flushSync();
    el.dispatchEvent(new Event("customgone"));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("spread(): ref and namespaces", () => {
  it("[SPR-20] ref is called once with the element and not again for unrelated updates", () => {
    const el = mount();
    const ref = vi.fn();
    const [label, setLabel] = useSignal("a");
    spreadOn(el, {
      ref,
      get title() {
        return label();
      },
    });
    setLabel("b");
    flushSync();
    expect(ref).toHaveBeenCalledTimes(1);
    expect(ref).toHaveBeenCalledWith(el);
  });

  it("[SPR-21] a new ref function is called with the element again", () => {
    const el = mount();
    const first = vi.fn();
    const second = vi.fn();
    const [ref, setRef] = useSignal<(node: Element) => void>(first);
    spreadOn(el, {
      get ref() {
        return ref();
      },
    });
    setRef(() => second);
    flushSync();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(el);
  });

  it("[SPR-22] prop:, attr: and bool: namespaces set properties, attributes and booleans", () => {
    const input = document.createElement("input");
    const [checked, setChecked] = useSignal(true);
    spreadOn(input, {
      "prop:value": "typed",
      "attr:data-x": 5,
      get "bool:disabled"() {
        return checked();
      },
    });
    expect(input.value).toBe("typed");
    expect(input.getAttribute("data-x")).toBe("5");
    expect(input.hasAttribute("disabled")).toBe(true);
    setChecked(false);
    flushSync();
    expect(input.hasAttribute("disabled")).toBe(false);
  });

  it("[SPR-23] innerHTML and textContent are plain properties", () => {
    const el = mount();
    spreadOn(el, { innerHTML: "<b>x</b>" });
    expect(el.querySelector("b")?.textContent).toBe("x");
    const other = mount();
    spreadOn(other, { textContent: "<i>plain</i>" });
    expect(other.querySelector("i")).toBeNull();
    expect(other.textContent).toBe("<i>plain</i>");
  });
});

describe("spread(): children and key safety", () => {
  it("[SPR-30] children are inserted, and reactive children update the element", () => {
    const el = mount();
    const [text, setText] = useSignal("one");
    spreadOn(el, {
      get children() {
        return text();
      },
    });
    expect(el.textContent).toBe("one");
    setText("two");
    flushSync();
    expect(el.textContent).toBe("two");
  });

  it("[SPR-31] skipChildren ignores the children key", () => {
    const el = mount();
    spreadOn(el, { children: "ignored" }, false, true);
    expect(el.childNodes.length).toBe(0);
  });

  it("[SPR-32] __proto__, constructor and prototype keys are ignored, including prefixed forms", () => {
    const el = mount();
    const props: object = JSON.parse(
      '{"__proto__": {"polluted": 1}, "constructor": "x", "prototype": "y", "id": "k", "prop:__proto__": {"a": 1}}',
    );
    const before = Object.getPrototypeOf(el);
    spreadOn(el, props);
    expect(el.id).toBe("k");
    expect(el.hasAttribute("constructor")).toBe(false);
    expect(el.hasAttribute("prototype")).toBe(false);
    expect(Object.getPrototypeOf(el)).toBe(before);
    expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined();
  });

  it("[SPR-33] an invalid attribute name in props throws a TypeError", () => {
    const el = mount();
    expect(() => spreadOn(el, { "@click": "x" })).toThrow(TypeError);
  });

  it("[SPR-34] null or non-object props are a no-op", () => {
    const el = mount();
    expect(() => {
      createRoot(() => spread(el, null));
    }).not.toThrow();
    expect(el.attributes.length).toBe(0);
  });

  it("[SPR-35] a key removed from props is removed from the element", () => {
    const el = mount();
    const [key, setKey] = useSignal<string | undefined>("v");
    spreadOn(el, {
      get "data-k"() {
        return key();
      },
    });
    setKey(undefined);
    flushSync();
    expect(el.hasAttribute("data-k")).toBe(false);
  });

  it("[SPR-36] an unchanged value is written again when the user changed the live property", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const [title, setTitle] = useSignal("a");
    spreadOn(input, {
      value: "fixed",
      get title() {
        return title();
      },
    });
    expect(input.value).toBe("fixed");
    input.value = "typed";
    // Another key changes, the effect runs again: the unchanged value follows the data once more.
    setTitle("b");
    flushSync();
    expect(input.value).toBe("fixed");
    input.remove();
  });

  it("[SPR-46] a value the live property already holds is not written again (a partly typed number keeps its text)", () => {
    const input = document.createElement("input");
    input.type = "number";
    document.body.append(input);
    const [qty, setQty] = useSignal<number | undefined>(1);
    spreadOn(input, {
      get value() {
        return qty();
      },
    });
    expect(input.value).toBe("1");
    // A browser shows "1-" in a number input whose value is "" (badInput): the live value is "" and the
    // state goes undefined. The write of "" would clear the typed text, so it is skipped.
    input.value = "";
    const writes = watchValueWrites(input);
    setQty(undefined);
    flushSync();
    expect(writes()).toBe(0);
    expect(input.value).toBe("");
    input.remove();
  });

  it("[SPR-47] a date that is partly cleared keeps its live value: an unchanged empty value is not written again", () => {
    const input = document.createElement("input");
    input.type = "date";
    document.body.append(input);
    const [day, setDay] = useSignal("2027-01-31");
    spreadOn(input, {
      get value() {
        return day();
      },
    });
    expect(input.value).toBe("2027-01-31");
    // Clearing one segment of a date leaves the value "" while the fields keep the other segments.
    input.value = "";
    const writes = watchValueWrites(input);
    setDay("");
    flushSync();
    expect(writes()).toBe(0);
    expect(input.value).toBe("");
    input.remove();
  });

  it("[SPR-48] a Symbol value prop reaches the value setter, which throws a TypeError as a browser does", () => {
    const input = document.createElement("input");
    // A browser converts an assigned value to a DOMString, which throws for a Symbol; happy-dom stores it.
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: (next: string) => `${next}`,
    });
    expect(() => spreadOn(input, { value: Symbol("v") })).toThrow(TypeError);
  });
});

/** Counts the writes to an input's live `value` property; returns the counter. */
function watchValueWrites(input: HTMLInputElement): () => number {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const get = descriptor?.get;
  const set = descriptor?.set;
  if (get === undefined || set === undefined) throw new TypeError("no value accessor");
  let writes = 0;
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => get.call(input),
    set: (next: string) => {
      writes += 1;
      set.call(input, next);
    },
  });
  return () => writes;
}

describe("state-bearing props through spread", () => {
  it("[SPD-LIVE] value and checked follow the data even after the user has edited the element", async () => {
    const { createRoot, flushSync, useSignal } = await import("@shadow-js/core");
    const { spread } = await import("../src/spread");
    const [text, setText] = useSignal("a");
    const [on, setOn] = useSignal(false);
    const input = document.createElement("input");
    const box = document.createElement("input");
    box.type = "checkbox";
    createRoot(() => {
      spread(input, {
        get value() {
          return text();
        },
      });
      spread(box, {
        get checked() {
          return on();
        },
      });
    });
    expect(input.value).toBe("a");
    expect(input.getAttribute("value")).toBe("a");
    input.value = "typed";
    flushSync(() => setText("b"));
    expect(input.value).toBe("b");
    expect(input.getAttribute("value")).toBe("b");
    box.checked = true;
    flushSync(() => setOn(true));
    flushSync(() => setOn(false));
    expect(box.checked).toBe(false);
    flushSync(() => setText(undefined as unknown as string));
    expect(input.value).toBe("");
  });
});
