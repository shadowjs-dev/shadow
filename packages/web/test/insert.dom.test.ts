import { createRoot, flushSync, onError, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anchor, insert } from "../src/index";
import { cleanupDom, hasComment, mount, shape, spyMutations, texts } from "./support/dom";

afterEach(cleanupDom);

function element(tag: string, label = ""): HTMLElement {
  const node = document.createElement(tag);
  if (label !== "") node.setAttribute("data-id", label);
  return node;
}

describe("insert(): static values", () => {
  it("[INS-01] null, undefined and false render nothing", () => {
    const parent = mount();
    insert(parent, null);
    insert(parent, undefined);
    insert(parent, false);
    expect(parent.childNodes.length).toBe(0);
  });

  it("[INS-02] true renders nothing", () => {
    const parent = mount();
    insert(parent, true);
    expect(parent.childNodes.length).toBe(0);
  });

  it("[INS-03] strings and numbers become one Text node, including zero", () => {
    const parent = mount();
    insert(parent, "hello");
    expect(shape(parent)).toEqual(texts("hello"));
    const numbers = mount();
    insert(numbers, 0);
    expect(shape(numbers)).toEqual(texts("0"));
  });

  it("[INS-04] HTML-looking strings are text and never parsed into elements", () => {
    const parent = mount();
    insert(parent, "<b>bold</b>&amp;");
    expect(parent.querySelector("b")).toBeNull();
    expect(parent.textContent).toBe("<b>bold</b>&amp;");
  });

  it("[INS-05] a Node is inserted itself, by identity", () => {
    const parent = mount();
    const child = element("span");
    insert(parent, child);
    expect(parent.firstChild).toBe(child);
  });

  it("[INS-06] a DocumentFragment inserts a snapshot of its children and empties itself", () => {
    const parent = mount();
    const fragment = document.createDocumentFragment();
    const first = element("i");
    const second = element("b");
    fragment.append(first, second);
    insert(parent, fragment);
    expect(shape(parent)).toEqual(["i", "b"]);
    expect(parent.firstChild).toBe(first);
    expect(fragment.childNodes.length).toBe(0);
  });

  it("[INS-07] nested arrays flatten in order, skipping null, undefined and booleans", () => {
    const parent = mount();
    const b = element("b");
    insert(parent, ["a", [b, [null, undefined, false, true, "c"]], "d"]);
    expect(shape(parent)).toEqual(["#t:a", "b", "#t:c", "#t:d"]);
  });

  it("[INS-08] repeated nodes are inserted once, at their first position", () => {
    const parent = mount();
    const a = element("a");
    const b = element("b");
    insert(parent, [a, b, a]);
    expect(shape(parent)).toEqual(["a", "b"]);
  });

  it("[INS-09] arrays nested 10000 levels deep are flattened without recursion", () => {
    const parent = mount();
    let value: unknown = "deep";
    for (let depth = 0; depth < 10_000; depth += 1) value = [value];
    insert(parent, value);
    expect(shape(parent)).toEqual(texts("deep"));
  });

  it("[INS-10] a cyclic array throws a TypeError instead of looping", () => {
    const parent = mount();
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => insert(parent, cycle)).toThrow(TypeError);
  });

  it("[INS-11] an empty array renders nothing", () => {
    const parent = mount();
    insert(parent, []);
    expect(parent.childNodes.length).toBe(0);
  });

  it("[INS-12] symbols, bigints and objects are rendered as their string form", () => {
    const parent = mount();
    insert(parent, Symbol("s"));
    insert(parent, 10n);
    insert(parent, {});
    expect(shape(parent)).toEqual(texts("Symbol(s)", "10", "[object Object]"));
  });

  it("[INS-13] returns the accepted value (a fragment returns its snapshot array)", () => {
    const parent = mount();
    const list = ["x", "y"];
    expect(insert(parent, list)).toBe(list);
    const fragment = document.createDocumentFragment();
    const child = element("i");
    fragment.append(child);
    expect(insert(parent, fragment)).toEqual([child]);
  });

  it("[INS-14] a nested accessor inside an array is called once per update", () => {
    const parent = mount();
    createRoot(() => insert(parent, [() => "x", "y"]));
    expect(shape(parent)).toEqual(texts("x", "y"));
  });

  it("[INS-15] a runtime-built tree never contains comment nodes", () => {
    const parent = mount();
    insert(parent, [element("a"), "t", null, [element("b")]]);
    expect(hasComment(parent)).toBe(false);
  });
});

describe("insert(): reactive accessors", () => {
  it("[INS-20] a Text node is reused and only its data changes", () => {
    const parent = mount();
    const [value, setValue] = useSignal<unknown>("a");
    createRoot(() => insert(parent, value));
    const original = parent.firstChild;
    setValue("b");
    flushSync();
    expect(parent.firstChild).toBe(original);
    expect(shape(parent)).toEqual(texts("b"));
  });

  it("[INS-21] a number and a string share the reused Text node", () => {
    const parent = mount();
    const [value, setValue] = useSignal<unknown>(1);
    createRoot(() => insert(parent, value));
    const original = parent.firstChild;
    setValue("two");
    flushSync();
    setValue(3);
    flushSync();
    expect(parent.firstChild).toBe(original);
    expect(shape(parent)).toEqual(texts("3"));
  });

  it("[INS-22] an unchanged value causes no DOM mutation", () => {
    const parent = mount();
    const [value, setValue] = useSignal<unknown>("same");
    createRoot(() => insert(parent, value));
    const spies = spyMutations();
    setValue("same");
    flushSync();
    expect(spies.insertBefore).not.toHaveBeenCalled();
    expect(spies.removeChild).not.toHaveBeenCalled();
  });

  it("[INS-23] a value that switches text -> array -> node -> null -> text ends correct", () => {
    const parent = mount();
    const [value, setValue] = useSignal<unknown>("text");
    createRoot(() => insert(parent, value));
    expect(shape(parent)).toEqual(texts("text"));
    const node = element("hr");
    setValue(["x", node]);
    flushSync();
    expect(shape(parent)).toEqual(["#t:x", "hr"]);
    setValue(node);
    flushSync();
    expect(shape(parent)).toEqual(["hr"]);
    setValue(null);
    flushSync();
    expect(parent.childNodes.length).toBe(0);
    setValue("again");
    flushSync();
    expect(shape(parent)).toEqual(texts("again"));
  });

  it("[INS-24] a user-supplied Text node is never mutated by later string updates", () => {
    const parent = mount();
    const userText = document.createTextNode("user");
    const [value, setValue] = useSignal<unknown>(userText);
    createRoot(() => insert(parent, value));
    setValue("generated");
    flushSync();
    expect(userText.data).toBe("user");
    expect(shape(parent)).toEqual(texts("generated"));
  });

  it("[INS-25] a function returned by an accessor is called and its result rendered", () => {
    const parent = mount();
    createRoot(() => insert(parent, () => () => "inner"));
    expect(shape(parent)).toEqual(texts("inner"));
  });

  it("[INS-16] an accessor inside an array is tracked: string -> node -> null -> string updates in place", () => {
    const parent = mount();
    const [member, setMember] = useSignal<unknown>("first");
    const marker = element("hr");
    createRoot(() => insert(parent, ["head", () => member(), "tail"]));
    expect(shape(parent)).toEqual(texts("head", "first", "tail"));
    setMember(marker);
    flushSync();
    expect(shape(parent)).toEqual(["#t:head", "hr", "#t:tail"]);
    setMember(null);
    flushSync();
    expect(shape(parent)).toEqual(texts("head", "tail"));
    setMember("again");
    flushSync();
    expect(shape(parent)).toEqual(texts("head", "again", "tail"));
  });

  it("[INS-17] an accessor member that throws keeps the previous content and reports the error", () => {
    const parent = mount();
    const errors: unknown[] = [];
    const [member, setMember] = useSignal<unknown>("ok");
    createRoot(() => {
      onError((error) => {
        errors.push(error);
      });
      insert(parent, [
        "a",
        () => {
          const current = member();
          if (current === "boom") throw new Error("member");
          return current;
        },
      ]);
    });
    setMember("boom");
    flushSync();
    expect(errors.length).toBe(1);
    expect(shape(parent)).toEqual(texts("a", "ok"));
    setMember("fine");
    flushSync();
    expect(shape(parent)).toEqual(texts("a", "fine"));
  });

  it("[INS-18] a function member nested in arrays is tracked too", () => {
    const parent = mount();
    const [deep, setDeep] = useSignal("x");
    createRoot(() => insert(parent, [["p", [() => deep()]], "q"]));
    setDeep("y");
    flushSync();
    expect(shape(parent)).toEqual(texts("p", "y", "q"));
  });

  it("[INS-26] string items inside an array keep their Text identity across reorders", () => {
    const parent = mount();
    const [value, setValue] = useSignal<unknown>(["a", "b", "c"]);
    createRoot(() => insert(parent, value));
    const before = Array.from(parent.childNodes);
    setValue(["c", "a", "b"]);
    flushSync();
    expect(shape(parent)).toEqual(texts("c", "a", "b"));
    expect(parent.childNodes[0]).toBe(before[2]);
    expect(parent.childNodes[1]).toBe(before[0]);
    expect(parent.childNodes[2]).toBe(before[1]);
  });

  it("[INS-27] nodes no longer in the value are removed from the parent", () => {
    const parent = mount();
    const first = element("a");
    const second = element("b");
    const [value, setValue] = useSignal<unknown>([first, second]);
    createRoot(() => insert(parent, value));
    setValue([second]);
    flushSync();
    expect(first.parentNode).toBeNull();
    expect(shape(parent)).toEqual(["b"]);
  });

  it("[INS-28] a disposed owner stops the region from updating", () => {
    const parent = mount();
    const [value, setValue] = useSignal<unknown>("before");
    let dispose: () => void = () => undefined;
    createRoot((stop) => {
      dispose = stop;
      insert(parent, value);
    });
    dispose();
    setValue("after");
    flushSync();
    expect(shape(parent)).toEqual(texts("before"));
  });

  it("[INS-29] a Text node adopted from initial content is reused for string updates", () => {
    const parent = mount();
    const existing = document.createTextNode("old");
    parent.appendChild(existing);
    const [value, setValue] = useSignal<unknown>("old");
    createRoot(() => insert(parent, value, null, existing));
    setValue("new");
    flushSync();
    expect(parent.firstChild).toBe(existing);
    expect(existing.data).toBe("new");
  });

  it("[INS-30] initial content already in place causes no DOM mutation on first run", () => {
    const parent = mount();
    const first = element("a");
    const second = element("b");
    parent.append(first, second);
    const spies = spyMutations();
    createRoot(() => insert(parent, () => [first, second], null, [first, second]));
    expect(spies.insertBefore).not.toHaveBeenCalled();
    expect(spies.removeChild).not.toHaveBeenCalled();
    expect(shape(parent)).toEqual(["a", "b"]);
  });

  it("[INS-31] an accessor that throws keeps the region's previous content and reports the error", () => {
    const parent = mount();
    const errors: unknown[] = [];
    const [value, setValue] = useSignal<unknown>("ok");
    createRoot(() => {
      onError((error) => {
        errors.push(error);
      });
      insert(parent, () => {
        const current = value();
        if (current === "boom") throw new Error("boom");
        return current;
      });
    });
    setValue("boom");
    flushSync();
    expect(errors.map((error) => (error instanceof Error ? error.message : ""))).toEqual(["boom"]);
    expect(shape(parent)).toEqual(texts("ok"));
    setValue("recovered");
    flushSync();
    expect(shape(parent)).toEqual(texts("recovered"));
  });

  it("[INS-32] an accessor that throws on its first run renders nothing and reports", () => {
    const parent = mount();
    const errors: unknown[] = [];
    createRoot(() => {
      onError((error) => {
        errors.push(error);
      });
      insert(parent, () => {
        throw new Error("first");
      });
    });
    expect(errors.length).toBe(1);
    expect(parent.childNodes.length).toBe(0);
  });

  it("[INS-33] nodes that were deleted by a region keep their identity when re-inserted later", () => {
    const parent = mount();
    const kept = element("k");
    const [value, setValue] = useSignal<unknown>([kept]);
    createRoot(() => insert(parent, value));
    setValue([]);
    flushSync();
    setValue([kept]);
    flushSync();
    expect(parent.firstChild).toBe(kept);
  });
});

describe("insert(): anchors and empty regions", () => {
  it("[INS-40] content goes before the anchor node", () => {
    const parent = mount();
    const tail = element("i");
    parent.appendChild(tail);
    createRoot(() => insert(parent, "x", tail));
    expect(shape(parent)).toEqual(["#t:x", "i"]);
  });

  it("[INS-41] an empty region keeps its position with an explicit anchor", () => {
    const parent = mount();
    const tail = element("i");
    parent.appendChild(tail);
    const [value, setValue] = useSignal<unknown>(["a"]);
    createRoot(() => insert(parent, value, tail));
    setValue(null);
    flushSync();
    expect(shape(parent)).toEqual(["i"]);
    setValue("b");
    flushSync();
    expect(shape(parent)).toEqual(["#t:b", "i"]);
    setValue(["c", "d"]);
    flushSync();
    expect(shape(parent)).toEqual(["#t:c", "#t:d", "i"]);
  });

  it("[INS-42] an empty region without anchor stays after the node that preceded it", () => {
    const parent = mount();
    const first = element("i");
    parent.appendChild(first);
    const [value, setValue] = useSignal<unknown>([]);
    createRoot(() => insert(parent, value));
    parent.appendChild(element("b"));
    setValue("x");
    flushSync();
    expect(shape(parent)).toEqual(["i", "#t:x", "b"]);
  });

  it("[INS-43] a region shrinking to empty then growing again lands in its original slot", () => {
    const parent = mount();
    const head = element("h");
    const tail = element("t");
    parent.append(head, tail);
    const [value, setValue] = useSignal<unknown>(["1", "2"]);
    createRoot(() => insert(parent, value, tail));
    setValue([]);
    flushSync();
    expect(shape(parent)).toEqual(["h", "t"]);
    setValue(["3"]);
    flushSync();
    expect(shape(parent)).toEqual(["h", "#t:3", "t"]);
  });

  it("[INS-44] two adjacent anchored regions stay in order in every grow and shrink combination", () => {
    const states: unknown[] = [null, "t", ["a", "b"], [], ["c"]];
    const expected = (value: unknown): string[] => {
      if (value === null) return [];
      if (typeof value === "string") return texts(value);
      return Array.isArray(value) ? texts(...(value as string[])) : [];
    };
    for (const first of states) {
      for (const second of states) {
        const parent = mount();
        const firstAnchor = anchor(parent, null);
        const secondAnchor = anchor(parent, null);
        const [one, setOne] = useSignal<unknown>(null);
        const [two, setTwo] = useSignal<unknown>(null);
        createRoot(() => {
          insert(parent, one, firstAnchor);
          insert(parent, two, secondAnchor);
        });
        for (const [a, b] of [
          [first, second],
          [second, first],
          [null, null],
        ] as const) {
          setOne(a);
          setTwo(b);
          flushSync();
          const shapeOfBoth = [...expected(a), "#t:", ...expected(b), "#t:"];
          expect(shape(parent)).toEqual(shapeOfBoth);
        }
      }
    }
  });

  it("[INS-45] a region created on an empty parent grows after content appended later", () => {
    const parent = mount();
    const [value, setValue] = useSignal<unknown>(null);
    createRoot(() => insert(parent, value));
    parent.appendChild(element("after"));
    setValue("x");
    flushSync();
    expect(shape(parent)).toEqual(["#t:x", "after"]);
  });
});

describe("insert(): ownership", () => {
  it("[INS-50] an accessor's render effect is disposed with its owner", () => {
    const parent = mount();
    const [value, setValue] = useSignal("a");
    let dispose: () => void = () => undefined;
    createRoot((stop) => {
      dispose = stop;
      insert(parent, value);
    });
    dispose();
    const spies = spyMutations();
    setValue("b");
    flushSync();
    expect(spies.insertBefore).not.toHaveBeenCalled();
    expect(shape(parent)).toEqual(texts("a"));
  });

  it("[INS-51] nested inserts are disposed together with their parent root", () => {
    const parent = mount();
    const [outer, setOuter] = useSignal("o");
    const [inner, setInner] = useSignal("i");
    let dispose: () => void = () => undefined;
    createRoot((stop) => {
      dispose = stop;
      insert(parent, () => {
        const child = document.createElement("span");
        insert(child, inner);
        return [outer(), child];
      });
    });
    dispose();
    setInner("changed");
    setOuter("changed");
    flushSync();
    expect(parent.textContent).toBe("oi");
  });
});

describe("insert(): many updates", () => {
  it("[INS-52] repeated updates to a value with mixed content keep the DOM equal to the value", () => {
    const parent = mount();
    const [value, setValue] = useSignal<unknown>(null);
    createRoot(() => insert(parent, value));
    const script: unknown[] = ["a", ["b", "c"], null, ["c", "b", "a"], [], "z"];
    for (const next of script) {
      setValue(next);
      flushSync();
      const expected = typeof next === "string" ? texts(next) : [];
      const arrayExpected = Array.isArray(next) ? texts(...(next as string[])) : expected;
      expect(shape(parent)).toEqual(arrayExpected);
    }
  });

  it("[INS-53] a thousand sequential updates leave exactly one node per item", () => {
    const parent = mount();
    const [count, setCount] = useSignal(0);
    createRoot(() => insert(parent, () => Array.from({ length: count() }, (_, i) => `${i}`)));
    for (let step = 1; step <= 1000; step += 1) {
      setCount(step % 7);
      flushSync();
    }
    expect(parent.childNodes.length).toBe(1000 % 7);
  });
});

describe("insert(): dev guards", () => {
  it("[INS-54] an owner-less insert with an accessor still works", () => {
    const parent = mount();
    const warn = vi.mocked(console.warn);
    insert(parent, "static");
    expect(shape(parent)).toEqual(texts("static"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("[INS-RE1] an accessor that builds a component is not run again when the component's own accessor changes", async () => {
    const parent = mount();
    const [show, setShow] = useSignal(true);
    const [text, setText] = useSignal("a");
    let built = 0;
    const Child = (): unknown => () => text();
    createRoot(() =>
      insert(parent, [
        () => {
          if (!show()) return null;
          built += 1;
          return Child();
        },
      ]),
    );
    expect(parent.textContent).toBe("a");
    expect(built).toBe(1);
    flushSync(() => setText("b"));
    flushSync(() => setText("c"));
    expect(parent.textContent).toBe("c");
    expect(built).toBe(1);
    flushSync(() => setShow(false));
    expect(parent.textContent).toBe("");
    flushSync(() => setShow(true));
    expect(built).toBe(2);
    expect(parent.textContent).toBe("c");
  });
});
