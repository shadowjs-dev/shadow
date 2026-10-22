import { describe, expect, it } from "vitest";
import { mergeProps, splitProps, useSignal } from "../src/index";

describe("nested dynamic props", () => {
  it("[PRP-NEST-01] reading a value through many nested live merges takes time linear in the depth", () => {
    // Each level is a live view (a source that is a function) over the level below it, the shape a
    // chain of components that forward `{...props}` makes. Every read of a live view used to recompute
    // the views below it for each key it checked, so the cost multiplied per level.
    const [flag] = useSignal(true);
    let view: object = { base: 1 };
    for (let level = 0; level < 22; level += 1) {
      const inner = view;
      view = mergeProps(
        () => inner,
        () => (flag() ? { [`own${level}`]: level } : {}),
      );
    }
    const started = Date.now();
    const [picked, rest] = splitProps(view as { base: number }, ["base"] as const);
    expect(picked.base).toBe(1);
    expect(Object.keys(rest).length).toBeGreaterThan(20);
    expect(Date.now() - started).toBeLessThan(2000);
  }, 5000);
});
