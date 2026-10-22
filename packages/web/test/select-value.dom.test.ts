import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it } from "vitest";
import { setSelectValue, spread } from "../src/index";
import { cleanupDom, mount } from "./support/dom";

afterEach(cleanupDom);

/** A select with options a, b, c and one without a value attribute, in the body. */
function makeSelect(multiple = false): HTMLSelectElement {
  const select = document.createElement("select");
  select.multiple = multiple;
  select.innerHTML =
    '<option value="">none</option><option value="a">A</option><option value="b">B</option><option value="3">3</option><option>Plain text</option>';
  document.body.append(select);
  return select;
}

/** What the options show, as the values that are selected. */
const chosen = (select: HTMLSelectElement): string[] =>
  Array.from(select.options)
    .filter((option) => option.selected)
    .map((option) => option.value);

describe("setSelectValue()", () => {
  it("[SPR-40] a single value selects the option with that value, or with that text", () => {
    const select = makeSelect();
    setSelectValue(select, "b");
    expect(select.value).toBe("b");
    setSelectValue(select, "Plain text");
    expect(select.value).toBe("Plain text");
    setSelectValue(select, 3);
    expect(select.value).toBe("3");
  });

  it("[SPR-41] null and undefined are the empty string", () => {
    const select = makeSelect();
    setSelectValue(select, "a");
    setSelectValue(select, null);
    expect(select.value).toBe("");
    setSelectValue(select, "a");
    setSelectValue(select, undefined);
    expect(select.value).toBe("");
  });

  it("[SPR-42] a multiple select takes an array: exactly the listed options are selected", () => {
    const select = makeSelect(true);
    setSelectValue(select, ["a", 3, null, undefined]);
    expect(chosen(select)).toEqual(["a", "3"]);
    setSelectValue(select, ["b"]);
    expect(chosen(select)).toEqual(["b"]);
    setSelectValue(select, []);
    expect(chosen(select)).toEqual([]);
    setSelectValue(select, "a");
    expect(chosen(select)).toEqual(["a"]);
  });
});

describe("spread() on a select", () => {
  it("[SPR-43] the value prop follows its signal, single and multiple", () => {
    const single = makeSelect();
    const many = makeSelect(true);
    const [one, setOne] = useSignal<unknown>("a");
    const [list, setList] = useSignal<unknown>(["a", "b"]);
    createRoot(() => {
      spread(single, {
        get value() {
          return one();
        },
      });
      spread(many, {
        get value() {
          return list();
        },
      });
    });
    expect(single.value).toBe("a");
    expect(chosen(many)).toEqual(["a", "b"]);
    flushSync(() => {
      setOne("b");
      setList(["3"]);
    });
    expect(single.value).toBe("b");
    expect(chosen(many)).toEqual(["3"]);
  });

  it("[SPR-44] a selection the user changed is put back when the props run again", () => {
    const many = makeSelect(true);
    const [list] = useSignal<unknown>(["a"]);
    const [title, setTitle] = useSignal("t");
    createRoot(() => {
      spread(many, {
        get value() {
          return list();
        },
        get title() {
          return title();
        },
      });
    });
    const options = Array.from(many.options);
    const b = options.find((option) => option.value === "b");
    if (b === undefined) throw new Error("missing option");
    b.selected = true;
    expect(chosen(many)).toEqual(["a", "b"]);
    flushSync(() => setTitle("u"));
    expect(chosen(many)).toEqual(["a"]);
  });

  it("[SPR-45] removing the value prop clears the choice; other elements keep the property path", () => {
    const select = makeSelect();
    const [props, setProps] = useSignal<Record<string, unknown>>({ value: "b" });
    createRoot(() => {
      spread(select, () => props());
    });
    expect(select.value).toBe("b");
    flushSync(() => setProps({}));
    expect(select.value).toBe("");
    const input = mount("input") as HTMLInputElement;
    createRoot(() => {
      spread(input, { value: "x" });
    });
    expect(input.value).toBe("x");
  });
});
