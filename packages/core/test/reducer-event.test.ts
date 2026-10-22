import { describe, expect, it } from "vitest";
import { createRoot, flushSync, useEffect, useEvent, useReducer, useSignal } from "../src/index";

type Action = { type: "inc" } | { type: "add"; by: number };

function reducer(state: number, action: Action): number {
  return action.type === "inc" ? state + 1 : state + action.by;
}

describe("useReducer", () => {
  it("[RED-01] dispatch applies the reducer and reads are fresh before any flush", () => {
    createRoot(() => {
      const [count, dispatch] = useReducer(reducer, 0);
      dispatch({ type: "inc" });
      expect(count()).toBe(1);
      dispatch({ type: "add", by: 4 });
      expect(count()).toBe(5);
    });
  });

  it("[RED-02] effects that read the state re-run once per dispatch", () => {
    const seen: number[] = [];
    let dispatchFn: ((action: Action) => void) | undefined;
    createRoot(() => {
      const [count, dispatch] = useReducer(reducer, 0);
      dispatchFn = dispatch;
      useEffect(() => {
        seen.push(count());
      });
    });
    flushSync();
    dispatchFn?.({ type: "inc" });
    dispatchFn?.({ type: "inc" });
    flushSync();
    expect(seen).toEqual([0, 2]);
  });

  it("[RED-03] a dispatch that leaves the state equal does not notify", () => {
    const runs: number[] = [];
    let dispatchFn: ((action: Action) => void) | undefined;
    createRoot(() => {
      const [count, dispatch] = useReducer((state: number) => (state > 100 ? state : state), 3);
      dispatchFn = dispatch;
      useEffect(() => {
        runs.push(count());
      });
    });
    flushSync();
    dispatchFn?.({ type: "inc" });
    flushSync();
    expect(runs).toEqual([3]);
  });
});

describe("useEvent", () => {
  it("[EVT-01] the returned function keeps the arguments and the result of the handler", () => {
    const add = useEvent((a: number, b: number) => a + b);
    expect(add(2, 3)).toBe(5);
  });

  it("[EVT-02] reads inside the handler do not subscribe the calling effect", () => {
    const runs: number[] = [];
    let event: (() => number) | undefined;
    const [count, setCount] = useSignal(1);
    createRoot(() => {
      event = useEvent(() => count());
      useEffect(() => {
        runs.push(event?.() ?? -1);
      });
    });
    flushSync();
    setCount(2);
    flushSync();
    expect(runs).toEqual([1]);
  });

  it("[EVT-03] the handler sees the latest value of a prop-like accessor when called later", () => {
    const [value, setValue] = useSignal("first");
    const read = useEvent(() => value());
    setValue("second");
    expect(read()).toBe("second");
  });
});
