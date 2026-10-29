import { createRoot, flushSync, onCleanup, useEffect, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it } from "vitest";
import { Portal } from "../src/control-flow/portal";
import { classList, className, element, insert, render, spread, style } from "../src/index";
import { load } from "./support/compile";
import { cleanupDom, mount } from "./support/dom";

afterEach(cleanupDom);

interface PanelModule {
  Later: () => unknown;
  Swap: () => unknown;
  setOpen: (value: boolean) => void;
}

function host(): HTMLElement {
  return mount();
}

describe("ViewTransition naming follows its content", () => {
  it("[WEB-R7-3] a Show that opens later gets the name, and a fallback swapped for content too", async () => {
    const mod = await load<PanelModule>(`
import { ViewTransition, Show } from "@shadow-js/web";
import { useSignal } from "@shadow-js/core";
export const [open, setOpen] = useSignal(false);
export function Later() {
  return <ViewTransition name="panel" class="soft"><Show when={open()}><section /></Show></ViewTransition>;
}
export function Swap() {
  return <ViewTransition name="panel"><Show when={open()} fallback={<p />}><section /></Show></ViewTransition>;
}
// r7-3
`);
    const later = host();
    render(() => mod.Later(), later);
    flushSync();
    expect(later.querySelector("section")).toBeNull();
    mod.setOpen(true);
    flushSync();
    const section = later.querySelector<HTMLElement>("section");
    expect(section?.style.getPropertyValue("view-transition-name")).toBe("panel");
    expect(section?.style.getPropertyValue("view-transition-class")).toBe("soft");
    mod.setOpen(false);
    flushSync();

    const swap = host();
    render(() => mod.Swap(), swap);
    flushSync();
    expect(
      swap.querySelector<HTMLElement>("p")?.style.getPropertyValue("view-transition-name"),
    ).toBe("panel");
    mod.setOpen(true);
    flushSync();
    expect(
      swap.querySelector<HTMLElement>("section")?.style.getPropertyValue("view-transition-name"),
    ).toBe("panel");
    expect(swap.querySelector("p")).toBeNull();
  });
});

describe("insert() keeps a fragment's nodes", () => {
  it("[WEB-R7-4] an array holding a fragment and an accessor still shows the fragment's nodes after the accessor re-runs", () => {
    const parent = host();
    const fragment = document.createDocumentFragment();
    fragment.append(document.createElement("span"), document.createElement("b"));
    const [n, setN] = useSignal(1);
    createRoot(() => {
      insert(parent, [fragment, () => n()]);
    });
    flushSync();
    expect(parent.innerHTML).toBe("<span></span><b></b>1");
    setN(2);
    flushSync();
    expect(parent.innerHTML).toBe("<span></span><b></b>2");
  });

  it("[WEB-R7-4] an accessor that returns the same fragment each time keeps its nodes", () => {
    const parent = host();
    const fragment = document.createDocumentFragment();
    fragment.append(document.createElement("i"));
    const [n, setN] = useSignal(0);
    createRoot(() => {
      insert(parent, () => {
        n();
        return fragment;
      });
    });
    flushSync();
    setN(1);
    flushSync();
    expect(parent.innerHTML).toBe("<i></i>");
  });
});

describe("class and style accessors match the server", () => {
  it("[WEB-R7-5] className calls accessors in arrays, object values, nested accessors and at the top", () => {
    const el = document.createElement("div");
    className(el, ["a", () => "b"]);
    expect(el.className).toBe("a b");
    className(el, { on: () => false, off: () => true });
    expect(el.className).toBe("off");
    className(el, () => () => ["x", () => ["y", () => "z"]]);
    expect(el.className).toBe("x y z");
    className(el, () => "top");
    expect(el.className).toBe("top");
    className(el, () => null);
    expect(el.hasAttribute("class")).toBe(false);
  });

  it("[WEB-R7-5] an accessor read in an effect keeps the class up to date", () => {
    const el = document.createElement("div");
    const [on, setOn] = useSignal(true);
    createRoot(() => {
      useEffect(() => {
        className(el, { active: () => on() });
      });
    });
    flushSync();
    expect(el.className).toBe("active");
    setOn(false);
    flushSync();
    expect(el.className).toBe("");
  });

  it("[WEB-R7-5] an accessor chain deeper than 1000 throws instead of looping", () => {
    const el = document.createElement("div");
    const loop = (): unknown => loop;
    expect(() => className(el, loop)).toThrow(TypeError);
    expect(() => style(el, loop)).toThrow(TypeError);
  });

  it("[WEB-R7-5] classList calls accessor values and hands back what it applied", () => {
    const el = document.createElement("div");
    let flag = true;
    const map = { a: () => flag, b: () => false };
    const first = classList(el, map);
    expect(el.className).toBe("a");
    flag = false;
    const second = classList(el, map, first);
    expect(el.className).toBe("");
    expect(second).toEqual({ a: false, b: false });
  });

  it("[WEB-R7-5] style calls accessors: the value, array items and property values", () => {
    const el = document.createElement("div");
    style(el, { color: () => "red" });
    expect(el.style.color).toBe("red");
    style(el, () => ({ color: () => () => "blue", width: () => 10 }));
    expect(el.style.color).toBe("blue");
    expect(el.style.width).toBe("10px");
    style(el, [() => "color: green", () => ({ height: () => 4 })]);
    expect(el.style.color).toBe("green");
    expect(el.style.height).toBe("4px");
    expect(() => style(el, [() => ["color:red"]])).toThrow(TypeError);
  });

  it("[WEB-R7-5] style diffs against the values that were applied, not the accessors", () => {
    const el = document.createElement("div");
    let color = "red";
    const map = { color: () => color };
    const first = style(el, map);
    color = "blue";
    style(el, map, first);
    expect(el.style.color).toBe("blue");
  });
});

describe("Portal keeps its content when the mount changes", () => {
  it("[WEB-R7-6] a reactive mount moves an input without rebuilding it", () => {
    const first = host();
    const second = host();
    const [target, setTarget] = useSignal<Element>(first);
    const callSite = host();
    let built = 0;
    const dispose = createRoot((stop) => {
      insert(
        callSite,
        Portal({
          mount: () => target(),
          get children() {
            built += 1;
            return document.createElement("input");
          },
        }),
      );
      return stop;
    });
    flushSync();
    const input = first.querySelector("input");
    expect(input).not.toBeNull();
    if (input === null) return;
    input.value = "typed";
    setTarget(second);
    flushSync();
    expect(second.querySelector("input")).toBe(input);
    expect(input.value).toBe("typed");
    expect(first.childNodes.length).toBe(0);
    expect(built).toBe(1);
    dispose();
    expect(second.childNodes.length).toBe(0);
  });

  it("[WEB-R7-6] a component child is neither disposed nor rebuilt by the move, and updates in place", () => {
    const first = host();
    const second = host();
    const [target, setTarget] = useSignal<Element>(first);
    const [label, setLabel] = useSignal("a");
    let setups = 0;
    let cleanups = 0;
    const Child = (): unknown => {
      setups += 1;
      onCleanup(() => {
        cleanups += 1;
      });
      return () => label();
    };
    const dispose = createRoot((stop) => {
      insert(
        host(),
        Portal({
          mount: () => target(),
          get children() {
            return Child();
          },
        }),
      );
      return stop;
    });
    flushSync();
    setTarget(second);
    flushSync();
    expect(second.textContent).toBe("a");
    expect(first.textContent).toBe("");
    expect(setups).toBe(1);
    expect(cleanups).toBe(0);
    setLabel("b");
    flushSync();
    expect(second.textContent).toBe("b");
    dispose();
    expect(cleanups).toBe(1);
    expect(second.textContent).toBe("");
  });
});

describe("boolean attributes follow the server's truthiness rule", () => {
  it("[WEB-R7-1] spread writes a boolean attribute only for a truthy value, like ssrElement", () => {
    const button = document.createElement("button");
    createRoot(() => {
      spread(
        button,
        { disabled: 0, hidden: "", required: Number.NaN, loop: 0, id: "b" },
        false,
        true,
      );
    });
    flushSync();
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.hasAttribute("hidden")).toBe(false);
    expect(button.hasAttribute("required")).toBe(false);
    expect(button.hasAttribute("loop")).toBe(false);
    expect(button.id).toBe("b");
  });

  it("[WEB-R7-1] a truthy value is a bare flag, it follows a signal, and hidden keeps until-found", () => {
    const [on, setOn] = useSignal<unknown>(1);
    const button = document.createElement("button");
    const panel = document.createElement("div");
    createRoot(() => {
      spread(
        button,
        {
          get disabled() {
            return on();
          },
        },
        false,
        true,
      );
      spread(panel, { hidden: "until-found" }, false, true);
    });
    flushSync();
    expect(button.getAttribute("disabled")).toBe("");
    expect(panel.getAttribute("hidden")).toBe("until-found");
    setOn(0);
    flushSync();
    expect(button.hasAttribute("disabled")).toBe(false);
    setOn("0");
    flushSync();
    expect(button.getAttribute("disabled")).toBe("");
  });

  it("[WEB-R7-1] element() applies the same rule, whatever the case of the prop name", () => {
    const off = createRoot(() =>
      element("button", { disabled: 0, readOnly: "", hidden: Number.NaN }),
    ) as HTMLElement;
    flushSync();
    expect(off.hasAttribute("disabled")).toBe(false);
    expect(off.hasAttribute("readonly")).toBe(false);
    expect(off.hasAttribute("hidden")).toBe(false);
    const on = createRoot(() =>
      element("input", { readOnly: true, hidden: "until-found" }),
    ) as HTMLElement;
    flushSync();
    expect(on.getAttribute("readonly")).toBe("");
    expect(on.getAttribute("hidden")).toBe("until-found");
  });
});

describe("a spread select keeps its value when its options change", () => {
  it("[WEB-R7-2] value b stays selected after the options are replaced by others that include b", () => {
    const [options, setOptions] = useSignal(["a", "b", "c"]);
    const select = document.createElement("select");
    createRoot(() => {
      spread(select, {
        value: "b",
        get children() {
          return options().map((text) => {
            const option = document.createElement("option");
            option.value = text;
            option.textContent = text;
            return option;
          });
        },
      });
    });
    flushSync();
    expect(select.value).toBe("b");
    setOptions(["x", "b", "y", "z"]);
    flushSync();
    expect(select.options.length).toBe(4);
    expect(select.value).toBe("b");
  });

  it("[WEB-R7-2] a changed value and a multiple select are applied after the new options", () => {
    const [options, setOptions] = useSignal(["a"]);
    const [value, setValue] = useSignal("c");
    const select = document.createElement("select");
    createRoot(() => {
      spread(select, {
        get value() {
          return value();
        },
        get children() {
          return options().map((text) => {
            const option = document.createElement("option");
            option.value = text;
            return option;
          });
        },
      });
    });
    flushSync();
    setOptions(["a", "b", "c"]);
    flushSync();
    expect(select.value).toBe("c");
    setValue("b");
    flushSync();
    expect(select.value).toBe("b");
    const many = document.createElement("select");
    many.multiple = true;
    const [list, setList] = useSignal(["a"]);
    createRoot(() => {
      spread(many, {
        value: ["b", "d"],
        get children() {
          return list().map((text) => {
            const option = document.createElement("option");
            option.value = text;
            return option;
          });
        },
      });
    });
    flushSync();
    setList(["b", "c", "d"]);
    flushSync();
    expect(Array.from(many.selectedOptions, (o) => o.value)).toEqual(["b", "d"]);
  });
});
