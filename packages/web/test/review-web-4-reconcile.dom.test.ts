import { describe, expect, it } from "vitest";
import { reconcileNodes } from "../src/internal/reconcile";

/** Builds an `<option>` with a value and text. */
function option(value: string): HTMLOptionElement {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = value;
  return node;
}

describe("reconcileNodes: a list where nothing survives", () => {
  it("[WEB-R4-1] new nodes are inserted in document order, not back to front", () => {
    const parent = document.createElement("div");
    const old = [document.createElement("i"), document.createElement("i")];
    for (const node of old) parent.append(node);
    const next = ["a", "b", "c"].map((name) => {
      const node = document.createElement("b");
      node.id = name;
      return node;
    });
    const order: string[] = [];
    const insertBefore = parent.insertBefore.bind(parent);
    parent.insertBefore = <T extends Node>(node: T, child: Node | null): T => {
      order.push((node as unknown as Element).id);
      return insertBefore(node, child);
    };
    reconcileNodes(parent, old, next, null);
    expect(order).toEqual(["a", "b", "c"]);
    expect(Array.from(parent.children, (node) => node.id)).toEqual(["a", "b", "c"]);
  });

  it("[WEB-R4-1] a select whose options are all replaced shows the value set on it after they arrive", () => {
    const select = document.createElement("select");
    const old = ["x", "y"].map(option);
    for (const node of old) select.append(node);
    const next = ["fr", "de", "it"].map(option);
    reconcileNodes(select, old, next, null);
    select.value = "de";
    expect(select.value).toBe("de");
    expect(Array.from(select.options, (node) => node.value)).toEqual(["fr", "de", "it"]);
  });
});
