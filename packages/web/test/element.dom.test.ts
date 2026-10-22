import { flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it } from "vitest";
import { element, render } from "../src/index";

/** A fresh container per test, removed after it. */
const containers: Element[] = [];
function container(): Element {
  const el = document.createElement("div");
  document.body.appendChild(el);
  containers.push(el);
  return el;
}
afterEach(() => {
  for (const el of containers.splice(0)) el.remove();
});

describe("element()", () => {
  it("[EL-1] builds the tag with its attributes, and binds a reactive one in place", () => {
    const host = container();
    let setTitle: (value: string | undefined) => void = () => undefined;
    const dispose = render(() => {
      const [title, set] = useSignal<string | undefined>("first");
      setTitle = set;
      return element("a", {
        id: "link",
        get title(): string | undefined {
          return title();
        },
        children: "go",
      });
    }, host);
    const link = host.querySelector("a");
    expect(link?.id).toBe("link");
    expect(link?.getAttribute("title")).toBe("first");
    setTitle("second");
    flushSync();
    expect(link?.getAttribute("title")).toBe("second");
    setTitle(undefined);
    flushSync();
    expect(link?.hasAttribute("title")).toBe(false);
    dispose();
  });

  it("[EL-2] runs a handler as a native listener, with the element as this, and a tuple gets its data first", () => {
    const host = container();
    const seen: unknown[] = [];
    const dispose = render(
      () =>
        element("button", {
          onClick(this: Element, event: Event) {
            seen.push([this.tagName, event.type]);
          },
          onFocus: [(data: unknown) => seen.push(data), "focus-data"],
          onBlur: undefined,
          children: "b",
        }),
      host,
    );
    const button = host.querySelector("button");
    button?.dispatchEvent(new Event("click"));
    button?.dispatchEvent(new Event("focus"));
    expect(seen).toEqual([["BUTTON", "click"], "focus-data"]);
    dispose();
  });

  it("[EL-3] calls ref once with the element, after its attributes are bound", () => {
    const host = container();
    const seen: string[] = [];
    const dispose = render(
      () =>
        element("span", {
          id: "s",
          ref(node: Element) {
            seen.push(`${node.tagName}#${node.id}`);
          },
        }),
      host,
    );
    expect(seen).toEqual(["SPAN#s"]);
    dispose();
  });

  it("[EL-4] inserts reactive children and updates them", () => {
    const host = container();
    let setLabel: (value: string) => void = () => undefined;
    const dispose = render(() => {
      const [label, set] = useSignal("one");
      setLabel = set;
      return element("p", {
        get children(): string {
          return label();
        },
      });
    }, host);
    expect(host.querySelector("p")?.textContent).toBe("one");
    setLabel("two");
    flushSync();
    expect(host.querySelector("p")?.textContent).toBe("two");
    dispose();
  });

  it("[EL-5] refuses a tag name that is not allowed, and script in any case", () => {
    expect(() => element("script", {})).toThrow(TypeError);
    expect(() => element("Script", {})).toThrow(TypeError);
    expect(() => element("a b", {})).toThrow(TypeError);
    expect(() => element("1x", {})).toThrow(TypeError);
  });

  it("[EL-6] applies a style object through the style runtime", () => {
    const host = container();
    const dispose = render(() => element("i", { style: { color: "red" } }), host);
    const node = host.querySelector("i");
    expect(node?.style.color).toBe("red");
    dispose();
  });

  it("[EL-7] a reactive style object removes the properties that left it, as spread() does", () => {
    const host = container();
    let setStyle: (value: Record<string, string>) => void = () => undefined;
    const dispose = render(() => {
      const [current, set] = useSignal<Record<string, string>>({ color: "red", width: "10px" });
      setStyle = set;
      return element("i", {
        get style(): Record<string, string> {
          return current();
        },
      });
    }, host);
    const node = host.querySelector("i");
    expect(node?.style.width).toBe("10px");
    setStyle({ color: "blue" });
    flushSync();
    expect(node?.style.color).toBe("blue");
    expect(node?.style.width).toBe("");
    dispose();
  });
});
