import { describe, expect, it } from "vitest";
import { element, render } from "../src/index";

describe("element event tuples", () => {
  it("[WEB-R8-3] a [handler, data] tuple passes the data it held when the listener was bound", () => {
    const host = document.createElement("div");
    const seen: unknown[] = [];
    const pair: [(data: unknown) => void, unknown] = [(data) => seen.push(data), 1];
    const dispose = render(() => element("button", { onClick: pair, children: "b" }), host);
    pair[1] = 2;
    host.querySelector("button")?.click();
    dispose();
    expect(seen).toEqual([1]);
  });
});
