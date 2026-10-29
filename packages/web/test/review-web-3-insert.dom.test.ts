import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import * as fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { insert } from "../src/insert";
import { cleanupDom, mount } from "./support/dom";

afterEach(() => {
  cleanupDom();
});

/** A value a region can be set to: nothing, a string, one element, or an array of both kinds. */
type Shown = { kind: "empty" } | { kind: "text" } | { kind: "node" } | { kind: "array" };

/** Builds the value for a region, and the text it must show, from a shape and a unique tag. */
function build(shown: Shown, tag: string): { value: unknown; text: string } {
  switch (shown.kind) {
    case "empty":
      return { value: null, text: "" };
    case "text":
      return { value: tag, text: tag };
    case "node": {
      const element = document.createElement("i");
      element.textContent = tag;
      return { value: element, text: tag };
    }
    case "array": {
      const element = document.createElement("b");
      element.textContent = `${tag}b`;
      return { value: [`${tag}a`, element, `${tag}c`], text: `${tag}a${tag}b${tag}c` };
    }
  }
}

/** A fresh element, so a region replaces its node instead of reusing a Text node. */
function element(text: string): HTMLElement {
  const node = document.createElement("i");
  node.textContent = text;
  return node;
}

describe("insert() without an anchor keeps call order", () => {
  it("[WEB-R3-1] a region whose marker node is replaced by a sibling region keeps its place", () => {
    const parent = mount();
    const [first, setFirst] = useSignal<unknown>("x");
    const [second, setSecond] = useSignal<unknown>(null);
    const [third, setThird] = useSignal<unknown>(null);
    const dispose = createRoot((disposeRoot) => {
      insert(parent, first);
      insert(parent, second);
      insert(parent, third);
      return disposeRoot;
    });
    expect(parent.textContent).toBe("x");
    setFirst(element("w"));
    flushSync();
    setThird("z");
    flushSync();
    setSecond("y");
    flushSync();
    expect(parent.textContent).toBe("wyz");
    dispose();
  });

  it("[WEB-R3-1] the second of two empty regions is not placed before the first when the first fills later", () => {
    const parent = mount();
    const [first, setFirst] = useSignal<unknown>(null);
    const [second, setSecond] = useSignal<unknown>(null);
    const dispose = createRoot((disposeRoot) => {
      insert(parent, first);
      insert(parent, second);
      return disposeRoot;
    });
    setFirst("a");
    flushSync();
    setSecond("b");
    flushSync();
    expect(parent.textContent).toBe("ab");
    dispose();
  });

  it("[WEB-R3-1] yzb: static content between regions stays between them", () => {
    const parent = mount();
    const [first, setFirst] = useSignal<unknown>("x");
    const [second, setSecond] = useSignal<unknown>(null);
    const dispose = createRoot((disposeRoot) => {
      insert(parent, first);
      insert(parent, second);
      parent.append("b");
      return disposeRoot;
    });
    setFirst(element("y"));
    flushSync();
    setSecond("z");
    flushSync();
    expect(parent.textContent).toBe("yzb");
    dispose();
  });

  it("[WEB-R3-1] disposing a region hands its place to the region after it", () => {
    const parent = mount();
    const [first, setFirst] = useSignal<unknown>("x");
    const [second, setSecond] = useSignal<unknown>(null);
    const [third, setThird] = useSignal<unknown>(null);
    let disposeFirst = (): void => undefined;
    const dispose = createRoot((disposeRoot) => {
      createRoot((inner) => {
        disposeFirst = inner;
        insert(parent, first);
      });
      insert(parent, second);
      insert(parent, third);
      return disposeRoot;
    });
    disposeFirst();
    setThird("z");
    flushSync();
    setSecond("y");
    flushSync();
    // The first region's text stays in the document (nothing removes it), the others follow it in order.
    expect(parent.textContent).toBe("xyz");
    setFirst("ignored");
    dispose();
  });

  it("[WEB-R3-1] a region behind a live one that is replaced by newer ones over and over adds nothing to the parent", () => {
    const parent = mount();
    const [first, setFirst] = useSignal<unknown>("a");
    const dispose = createRoot((disposeRoot) => {
      insert(parent, first);
      return disposeRoot;
    });
    let stopPrevious = createRoot((stop) => {
      insert(parent, () => "r0");
      return stop;
    });
    for (let round = 1; round <= 40; round += 1) {
      // The next region is created while the previous one is still alive, then the previous one goes.
      const stopNext = createRoot((stop) => {
        insert(parent, () => `r${round}`);
        return stop;
      });
      stopPrevious();
      stopPrevious = stopNext;
    }
    const ours = Array.from(parent.childNodes).filter((node) => node.textContent === "");
    expect(ours.length).toBeLessThanOrEqual(2);
    setFirst(element("A"));
    flushSync();
    expect(parent.firstChild?.textContent).toBe("A");
    stopPrevious();
    dispose();
  });

  it("[WEB-R3-1] a region that is empty behind a disposed one follows what that one left", () => {
    const parent = mount();
    let disposeFirst = (): void => undefined;
    createRoot((stop) => {
      disposeFirst = stop;
      insert(parent, () => element("x"));
    });
    const [second, setSecond] = useSignal<unknown>(null);
    const dispose = createRoot((disposeRoot) => {
      insert(parent, second);
      return disposeRoot;
    });
    disposeFirst();
    setSecond("y");
    flushSync();
    expect(parent.textContent).toBe("xy");
    dispose();
  });

  it("[WEB-R3-1] a region keeps its place ahead of regions created and disposed after it", () => {
    const parent = mount();
    const [keep, setKeep] = useSignal<unknown>(null);
    const dispose = createRoot((disposeRoot) => {
      insert(parent, keep);
      return disposeRoot;
    });
    for (let round = 0; round < 50; round += 1) {
      createRoot((inner) => {
        insert(parent, () => `r${round}`);
        inner();
      });
    }
    const before = parent.childNodes.length;
    setKeep("k");
    flushSync();
    expect(parent.childNodes.length).toBe(before + 1);
    expect(parent.firstChild?.textContent).toBe("k");
    dispose();
  });

  it("[WEB-R3-1] property: the DOM order is the call order for any sequence of values", () => {
    const shown = fc.oneof(
      fc.constant<Shown>({ kind: "empty" }),
      fc.constant<Shown>({ kind: "text" }),
      fc.constant<Shown>({ kind: "node" }),
      fc.constant<Shown>({ kind: "array" }),
    );
    // The layout is the parent's content in call order: `true` is a region, `false` a static node.
    const layout = fc
      .array(fc.boolean(), { minLength: 1, maxLength: 6 })
      .filter((items) => items.some(Boolean));
    fc.assert(
      fc.property(
        layout,
        fc.array(fc.tuple(fc.nat(5), shown), { maxLength: 24 }),
        fc.array(shown, { minLength: 6, maxLength: 6 }),
        (items, steps, initials) => {
          const parent = mount();
          const regionCount = items.filter(Boolean).length;
          const signals: Array<(value: unknown) => void> = [];
          const expected: string[] = [];
          let counter = 0;
          const dispose = createRoot((disposeRoot) => {
            let region = 0;
            for (const isRegion of items) {
              if (!isRegion) {
                parent.append("S");
                expected.push("S");
                continue;
              }
              const index = region;
              region += 1;
              const initial = build(initials[index] ?? { kind: "empty" }, `i${index}`);
              const [read, write] = useSignal<unknown>(initial.value);
              signals.push((value) => write(() => value));
              expected.push(initial.text);
              insert(parent, read);
            }
            return disposeRoot;
          });
          const regionSlots = items.flatMap((isRegion, slot) => (isRegion ? [slot] : []));
          expect(parent.textContent).toBe(expected.join(""));
          for (const [which, kind] of steps) {
            const index = which % regionCount;
            counter += 1;
            const next = build(kind, `n${counter}`);
            signals[index]?.(next.value);
            flushSync();
            expected[regionSlots[index] ?? 0] = next.text;
            expect(parent.textContent).toBe(expected.join(""));
          }
          dispose();
          parent.remove();
        },
      ),
      { seed: 20260513, numRuns: 300 },
    );
  });
});
