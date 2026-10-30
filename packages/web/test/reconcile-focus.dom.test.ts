import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Portal } from "../src/control-flow/portal";
import { insert } from "../src/index";
import { cleanupDom, installMoveBefore, mount } from "./support/dom";

afterEach(cleanupDom);

/** A list of rows, each holding an input, rendered with `insert` into `parent`. */
function rows(parent: Node, count: number) {
  const made = Array.from({ length: count }, (_, index) => {
    const row = document.createElement("li");
    const input = document.createElement("input");
    input.value = `value ${index}`;
    row.append(input);
    return { row, input };
  });
  const [order, setOrder] = useSignal(made.map((entry) => entry.row));
  createRoot(() => insert(parent, () => [...order()]));
  flushSync();
  const change = (update: (current: HTMLLIElement[]) => HTMLLIElement[]): void => {
    setOrder(update(order()));
    flushSync();
  };
  return { made, order: change, reverse: () => change((current) => [...current].reverse()) };
}

describe("reconcile: focus across a move without moveBefore", () => {
  it("[REC-16] a focused input inside a moved row still has the focus after the list is reversed", () => {
    const ul = mount("ul");
    const { made, reverse } = rows(ul, 4);
    const focused = made[1]?.input as HTMLInputElement;
    focused.focus();
    expect(document.activeElement).toBe(focused);
    reverse();
    expect(Array.from(ul.children)).toEqual(made.map((entry) => entry.row).reverse());
    expect(document.activeElement).toBe(focused);
  });

  it("[REC-17] the selection of the focused text control survives the move", () => {
    const ul = mount("ul");
    const { made, reverse } = rows(ul, 3);
    const focused = made[0]?.input as HTMLInputElement;
    focused.focus();
    focused.setSelectionRange(2, 5, "backward");
    reverse();
    expect(document.activeElement).toBe(focused);
    expect([focused.selectionStart, focused.selectionEnd, focused.selectionDirection]).toEqual([
      2,
      5,
      "backward",
    ]);
  });

  it("[REC-18] focus is restored without scrolling, and only when the focused row moved", () => {
    const ul = mount("ul");
    const { made, order } = rows(ul, 4);
    const focused = made[2]?.input as HTMLInputElement;
    focused.focus();
    const focus = vi.spyOn(focused, "focus");
    // Swapping the first two rows leaves the focused row in place: the focus code does nothing.
    order(([a, b, ...rest]) => [b, a, ...rest].filter((row) => row !== undefined));
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(focused);
    order((current) => [...current].reverse());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(focused);
  });

  it("[REC-19] a focused input in a shadow root keeps the focus when its row moves", () => {
    const host = mount("div");
    const shadow = host.attachShadow({ mode: "open" });
    const ul = document.createElement("ul");
    shadow.append(ul);
    const { made, reverse } = rows(ul, 3);
    const focused = made[0]?.input as HTMLInputElement;
    focused.focus();
    expect(shadow.activeElement).toBe(focused);
    reverse();
    expect(shadow.activeElement).toBe(focused);
  });

  it("[REC-20] with moveBefore available nothing restores the focus", () => {
    const restore = installMoveBefore();
    try {
      const ul = mount("ul");
      const { made, reverse } = rows(ul, 3);
      const focused = made[1]?.input as HTMLInputElement;
      focused.focus();
      const focus = vi.spyOn(focused, "focus");
      reverse();
      expect(focus).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("[REC-21] a reactive Portal mount keeps the focus of an input in its content", () => {
    const first = mount("div");
    const second = mount("div");
    const [target, setTarget] = useSignal<Element>(first);
    const input = document.createElement("input");
    input.value = "typed";
    const callSite = mount();
    createRoot(() => insert(callSite, Portal({ mount: () => target(), children: input })));
    flushSync();
    input.focus();
    input.setSelectionRange(1, 3);
    setTarget(second);
    flushSync();
    expect(input.parentNode).toBe(second);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
  });
});
