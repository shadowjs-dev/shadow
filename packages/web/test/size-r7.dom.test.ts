import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it } from "vitest";
import { insert } from "../src/index";
import { watchCommits } from "../src/insert";
import { spread, spreadProps } from "../src/spread";
import { cleanupDom } from "./support/dom";

afterEach(cleanupDom);

describe("spreadProps is spread without a children region", () => {
  it("[WEB-SZ-2] it writes the same attributes as spread with skipChildren, and leaves the content alone", () => {
    const props = { class: ["a", () => "b"], disabled: 0, hidden: "until-found", title: "t" };
    const full = document.createElement("button");
    const lean = document.createElement("button");
    lean.append("kept");
    createRoot(() => {
      spread(full, props, false, true);
      spreadProps(lean, { ...props, children: "ignored" }, false);
    });
    flushSync();
    expect(lean.className).toBe("a b");
    expect(lean.hasAttribute("disabled")).toBe(false);
    expect(lean.getAttribute("hidden")).toBe("until-found");
    expect(lean.getAttribute("title")).toBe("t");
    expect(lean.textContent).toBe("kept");
    expect(lean.getAttributeNames().sort()).toEqual(full.getAttributeNames().sort());
  });

  it("[WEB-SZ-2] a props value that is not an object does nothing", () => {
    const el = document.createElement("div");
    createRoot(() => {
      spreadProps(el, null, false);
      spreadProps(el, "text", false);
    });
    flushSync();
    expect(el.attributes).toHaveLength(0);
  });

  it("[WEB-SZ-2] a props accessor is read in the effect, so the element follows it", () => {
    const [id, setId] = useSignal("one");
    const el = document.createElement("div");
    createRoot(() => {
      spreadProps(el, () => ({ id: id() }), false);
    });
    flushSync();
    expect(el.id).toBe("one");
    setId("two");
    flushSync();
    expect(el.id).toBe("two");
  });
});

describe("watchCommits ends with the owner that was current", () => {
  it("[WEB-SZ-3] it runs after each commit to a region of the parent, and stops once the owner is disposed", () => {
    const parent = document.createElement("div");
    const [text, setText] = useSignal<unknown>("a");
    let runs = 0;
    const dispose = createRoot((stop) => {
      watchCommits(parent, () => {
        runs += 1;
      });
      return stop;
    });
    // The content has an owner of its own, so it keeps committing after the watch has ended.
    createRoot(() => {
      insert(parent, () => [document.createElement(String(text()) === "a" ? "i" : "b")]);
    });
    flushSync();
    const afterFirst = runs;
    expect(afterFirst).toBeGreaterThan(0);
    setText("b");
    flushSync();
    expect(runs).toBeGreaterThan(afterFirst);
    dispose();
    const stopped = runs;
    setText("a");
    flushSync();
    expect(runs).toBe(stopped);
  });
});
