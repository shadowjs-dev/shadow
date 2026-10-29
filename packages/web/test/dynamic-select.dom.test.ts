import { flushSync, useSignal } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { createComponent, Dynamic, render } from "../src/index";

function options(values: readonly string[]): HTMLOptionElement[] {
  return values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  });
}

describe("Dynamic select", () => {
  it("[WEB-R8-1] a select rendered by Dynamic shows its value, and shows it again when new options replace the old ones", () => {
    const host = document.createElement("div");
    const [list, setList] = useSignal<readonly string[]>(["a", "b", "c"]);
    const dispose = render(
      () =>
        createComponent(Dynamic, {
          component: "select",
          value: "b",
          get children() {
            return options(list());
          },
        }),
      host,
    );
    const select = host.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("b");
    setList(["x", "b", "y"]);
    flushSync();
    expect(select.value).toBe("b");
    dispose();
  });

  it("[WEB-R8-2] defaultValue is selected once the options exist", () => {
    const host = document.createElement("div");
    const dispose = render(
      () =>
        createComponent(Dynamic, {
          component: "select",
          defaultValue: "c",
          get children() {
            return options(["a", "b", "c"]);
          },
        }),
      host,
    );
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe("c");
    dispose();
  });
});
