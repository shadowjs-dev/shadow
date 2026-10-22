import { describe, expect, it } from "vitest";
import { createOwner, disposeOwner, pauseOwner, resumeOwner } from "../src/extend";
import { flushSync, runWithOwner, useEffect, useMemo, useSignal } from "../src/index";

describe("pauseOwner / resumeOwner (Activity)", () => {
  it("[PSE-01] pausing runs the effect cleanups; writes wait; resuming runs the effect once with the latest value", () => {
    const runs: number[] = [];
    let cleaned = 0;
    let set: (next: number) => void = () => undefined;
    const child = createOwner(null);
    runWithOwner(child, () => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      useEffect(() => {
        runs.push(value());
        return () => {
          cleaned += 1;
        };
      });
    });
    flushSync();
    expect(runs).toEqual([0]);
    pauseOwner(child);
    expect(cleaned).toBe(1);
    set(1);
    set(2);
    flushSync();
    expect(runs).toEqual([0]);
    resumeOwner(child);
    flushSync();
    expect(runs).toEqual([0, 2]);
  });

  it("[PSE-02] a memo under a paused owner keeps its value while paused and recomputes after resume", () => {
    let set: (next: number) => void = () => undefined;
    const child = createOwner(null);
    const doubled = runWithOwner(child, () => {
      const [value, setValue] = useSignal(1);
      set = setValue;
      return useMemo(() => value() * 2);
    });
    expect(doubled()).toBe(2);
    pauseOwner(child);
    set(3);
    expect(doubled()).toBe(2);
    resumeOwner(child);
    expect(doubled()).toBe(6);
  });

  it("[PSE-07] a memo created while its owner is paused computes once when first read", () => {
    let computed = 0;
    const child = createOwner(null);
    pauseOwner(child);
    const value = runWithOwner(child, () =>
      useMemo(() => {
        computed += 1;
        return "first";
      }),
    );
    expect(value()).toBe("first");
    expect(computed).toBe(1);
  });

  it("[PSE-03] an effect created under a paused owner waits until the owner resumes", () => {
    const runs: string[] = [];
    const child = createOwner(null);
    pauseOwner(child);
    runWithOwner(child, () => {
      useEffect(() => {
        runs.push("ran");
      });
    });
    flushSync();
    expect(runs).toEqual([]);
    resumeOwner(child);
    flushSync();
    expect(runs).toEqual(["ran"]);
  });

  it("[PSE-04] pauses nest: resuming the outer owner keeps an inner pause in place", () => {
    const runs: string[] = [];
    const outer = createOwner(null);
    const inner = createOwner(outer);
    runWithOwner(inner, () => {
      useEffect(() => {
        runs.push("inner");
      });
    });
    flushSync();
    runs.length = 0;
    pauseOwner(outer);
    pauseOwner(inner);
    resumeOwner(outer);
    flushSync();
    expect(runs).toEqual([]);
    resumeOwner(inner);
    flushSync();
    expect(runs).toEqual(["inner"]);
  });

  it("[PSE-05] a paused subtree that is disposed never runs its effects again (no leaked effect)", () => {
    const runs: number[] = [];
    let cleaned = 0;
    let set: (next: number) => void = () => undefined;
    const child = createOwner(null);
    runWithOwner(child, () => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      useEffect(() => {
        runs.push(value());
        return () => {
          cleaned += 1;
        };
      });
    });
    flushSync();
    pauseOwner(child);
    expect(cleaned).toBe(1);
    disposeOwner(child);
    set(9);
    flushSync();
    expect(runs).toEqual([0]);
  });

  it("[PSE-06] many toggles run each effect once per resume and leave the subtree size unchanged", () => {
    let runs = 0;
    let set: (next: number) => void = () => undefined;
    const child = createOwner(null);
    runWithOwner(child, () => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      useEffect(() => {
        value();
        runs += 1;
      });
    });
    flushSync();
    for (let i = 1; i <= 50; i += 1) {
      pauseOwner(child);
      set(i);
      flushSync();
      resumeOwner(child);
      flushSync();
    }
    expect(runs).toBe(51);
  });
});
