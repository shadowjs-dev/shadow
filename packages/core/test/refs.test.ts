import { describe, expect, it } from "vitest";
import { createRef, createRoot, untrack, useImperativeHandle } from "../src/index";

describe("createRef", () => {
  it("[REF-01] a ref is callable (ref={r} works) and exposes the value as .current", () => {
    const ref = createRef<{ id: number }>();
    expect(ref.current).toBeUndefined();
    const node = { id: 1 };
    ref(node);
    expect(ref.current).toBe(node);
  });

  it("[REF-02] calling the ref with undefined clears .current", () => {
    const ref = createRef<string>();
    ref("x");
    ref(undefined);
    expect(ref.current).toBeUndefined();
  });
});

describe("useImperativeHandle", () => {
  it("[IH-01] publishes the handle to the ref when the owner is created", () => {
    const ref = createRef<{ focus: () => string }>();
    createRoot(() => {
      useImperativeHandle(ref, () => ({ focus: () => "focused" }));
    });
    expect(ref.current?.focus()).toBe("focused");
  });

  it("[IH-02] disposing the owner clears the ref (ref receives undefined)", () => {
    const calls: Array<string | undefined> = [];
    const dispose = createRoot((d) => {
      useImperativeHandle<string>(
        (value) => calls.push(value),
        () => "handle",
      );
      return d;
    });
    dispose();
    expect(calls).toEqual(["handle", undefined]);
  });

  it("[IH-03] a missing ref is accepted and the create function does not run", () => {
    let created = 0;
    createRoot(() => {
      useImperativeHandle(undefined, () => {
        created += 1;
        return "x";
      });
    });
    expect(created).toBe(0);
  });

  it("[IH-04] the handle is created untracked (reads in create do not subscribe the owner)", () => {
    const seen: number[] = [];
    createRoot(() => {
      useImperativeHandle<number>(
        (value) => {
          if (value !== undefined) seen.push(value);
        },
        () => untrack(() => 42),
      );
    });
    expect(seen).toEqual([42]);
  });
});
