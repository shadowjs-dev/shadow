import { createRoot, flushSync } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { use } from "../../src/index";

describe("ref callbacks may return a cleanup (React 19)", () => {
  it("[RCL-01] a cleanup returned by a ref callback runs when the owner is disposed", () => {
    const el = document.createElement("input");
    const log: string[] = [];
    const dispose = createRoot((d) => {
      use(
        () => () => {
          log.push("cleanup");
        },
        el,
      );
      return d;
    });
    flushSync();
    expect(log).toEqual([]);
    dispose();
    expect(log).toEqual(["cleanup"]);
  });

  it("[RCL-02] a ref callback that returns nothing registers nothing", () => {
    const el = document.createElement("div");
    let calls = 0;
    const dispose = createRoot((d) => {
      use(() => {
        calls += 1;
      }, el);
      return d;
    });
    dispose();
    expect(calls).toBe(1);
  });
});
