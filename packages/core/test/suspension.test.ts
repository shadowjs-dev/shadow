import { describe, expect, it } from "vitest";
import { beginHold, endHold, wakeSuspended } from "../src/extend";
import {
  createRoot,
  flushSync,
  SuspenseContext,
  type SuspenseTracker,
  startTransition,
  useEffect as useEffect2,
  useMemo,
  useResource,
  useSignal,
} from "../src/index";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A minimal boundary: counts pending reads, and while a transition reads pending data it holds the
 * readers (they keep their previous values) until the count returns to zero. Mirrors what
 * `@shadow-js/web`'s Suspense does with the same extension points.
 */
function boundary(): { tracker: SuspenseTracker; holds: () => number; count: () => number } {
  let count = 0;
  let holds = 0;
  let holding = false;
  const tracker: SuspenseTracker = {
    increment() {
      count += 1;
    },
    decrement() {
      count -= 1;
      if (count === 0 && holding) {
        holding = false;
        wakeSuspended();
        endHold();
      }
    },
    hold() {
      holds += 1;
      if (!holding) {
        holding = true;
        beginHold();
      }
      return true;
    },
  };
  return { tracker, holds: () => holds, count: () => count };
}

describe("suspension: a transition keeps the previous value while data loads", () => {
  it("[SUS-01] a transition that reads pending data keeps the memo's value, and the memo recomputes when the data arrives", async () => {
    let resolveData: (value: string) => void = () => undefined;
    const data = new Promise<string>((resolve) => {
      resolveData = resolve;
    });
    const boundaryState = boundary();
    let set: (next: number) => void = () => undefined;
    const seen: string[] = [];
    createRoot(() => {
      const [mode, setMode] = useSignal(0);
      set = setMode;
      const res = useResource(() => data);
      SuspenseContext({
        value: boundaryState.tracker,
        get children() {
          const view = useMemo(() => (mode() === 0 ? "ready" : `value:${res()}`));
          useEffect2(() => {
            seen.push(view());
          });
          return null;
        },
      });
    });
    flushSync();
    expect(seen).toEqual(["ready"]);
    const done = startTransition(() => set(1));
    await tick();
    expect(seen).toEqual(["ready"]);
    expect(boundaryState.holds()).toBeGreaterThan(0);
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    resolveData("loaded");
    await done;
    flushSync();
    expect(seen.at(-1)).toBe("value:loaded");
  });

  it("[SUS-02] an urgent read of pending data does not hold: the reader sees the loading value (fallback path)", async () => {
    let resolveData: (value: string) => void = () => undefined;
    const data = new Promise<string>((resolve) => {
      resolveData = resolve;
    });
    const boundaryState = boundary();
    let set: (next: number) => void = () => undefined;
    let view: () => string = () => "";
    createRoot(() => {
      const [mode, setMode] = useSignal(0);
      set = setMode;
      const res = useResource(() => data);
      SuspenseContext({
        value: boundaryState.tracker,
        get children() {
          view = useMemo(() => (mode() === 0 ? "ready" : `value:${res() ?? "loading"}`));
          return null;
        },
      });
    });
    flushSync();
    set(1);
    flushSync();
    expect(view()).toBe("value:loading");
    expect(boundaryState.holds()).toBe(0);
    resolveData("late");
    await tick();
    flushSync();
    expect(view()).toBe("value:late");
  });

  it("[SUS-03] a suspended effect leaves its previous effect output in place until released", async () => {
    let resolveData: (value: string) => void = () => undefined;
    const data = new Promise<string>((resolve) => {
      resolveData = resolve;
    });
    const boundaryState = boundary();
    let set: (next: number) => void = () => undefined;
    const applied: string[] = [];
    createRoot(() => {
      const [mode, setMode] = useSignal(0);
      set = setMode;
      const res = useResource(() => data);
      SuspenseContext({
        value: boundaryState.tracker,
        get children() {
          // A write, in an effect, of the value the reader sees.
          useEffect2(() => {
            applied.push(mode() === 0 ? "ready" : `value:${res() ?? "x"}`);
          });
          return null;
        },
      });
    });
    flushSync();
    expect(applied).toEqual(["ready"]);
    const done = startTransition(() => set(1));
    await tick();
    expect(applied).toEqual(["ready"]);
    resolveData("ok");
    await done;
    flushSync();
    expect(applied.at(-1)).toBe("value:ok");
  });
});
