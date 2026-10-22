import { describe, expect, it, vi } from "vitest";
import { createRoot, flushSync, onError, useAction, useEffect } from "../src/index";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("useAction", () => {
  it("[ACT-01] the state starts as initialState and pending is false", () => {
    createRoot(() => {
      const [state, , pending] = useAction((prev: number, by: number) => prev + by, 10);
      expect(state()).toBe(10);
      expect(pending()).toBe(false);
    });
  });

  it("[ACT-02] a synchronous action commits immediately and sets the new state", () => {
    createRoot(() => {
      const [state, dispatch] = useAction((prev: number, by: number) => prev + by, 1);
      void dispatch(2);
      expect(state()).toBe(3);
    });
  });

  it("[ACT-03] an async action is pending until its promise settles", async () => {
    let finish: ((value: string) => void) | undefined;
    const states: string[] = [];
    let pendingNow = false;
    let dispatchFn: ((text: string) => Promise<void>) | undefined;
    createRoot(() => {
      const [state, dispatch, pending] = useAction(
        (_prev: string, text: string) =>
          new Promise<string>((resolve) => {
            finish = resolve;
            void text;
          }),
        "idle",
      );
      dispatchFn = dispatch;
      useEffect(() => {
        states.push(state());
      });
      useEffect(() => {
        pendingNow = pending();
      });
    });
    flushSync();
    const dispatched = dispatchFn?.("go");
    flushSync();
    expect(pendingNow).toBe(true);
    finish?.("done");
    await dispatched;
    flushSync();
    expect(pendingNow).toBe(false);
    expect(states).toEqual(["idle", "done"]);
  });

  it("[ACT-04] only the latest dispatch commits; an older result that settles later is discarded", async () => {
    const resolvers: Array<(value: string) => void> = [];
    let dispatchFn: ((text: string) => Promise<void>) | undefined;
    let read: (() => string) | undefined;
    createRoot(() => {
      const [state, dispatch] = useAction(
        (_prev: string, text: string) =>
          new Promise<string>((resolve) => {
            resolvers.push(resolve);
            void text;
          }),
        "start",
      );
      dispatchFn = dispatch;
      read = state;
    });
    const first = dispatchFn?.("a");
    const second = dispatchFn?.("b");
    resolvers[1]?.("second");
    await second;
    flushSync();
    resolvers[0]?.("first");
    await first;
    flushSync();
    expect(read?.()).toBe("second");
  });

  it("[ACT-05] the previous committed state is passed to the action", async () => {
    const seen: number[] = [];
    let dispatchFn: ((n: number) => Promise<void>) | undefined;
    createRoot(() => {
      const [, dispatch] = useAction((prev: number, n: number) => {
        seen.push(prev);
        return prev + n;
      }, 0);
      dispatchFn = dispatch;
    });
    await dispatchFn?.(2);
    await dispatchFn?.(3);
    expect(seen).toEqual([0, 2]);
  });

  it("[ACT-06] a rejected action clears pending and reports the error to the owner's handler", async () => {
    const handler = vi.fn();
    let dispatchFn: (() => Promise<void>) | undefined;
    let pendingNow: (() => boolean) | undefined;
    createRoot(() => {
      onError(handler);
      const [, dispatch, pending] = useAction(
        (): Promise<number> => Promise.reject(new Error("boom")),
        0,
      );
      dispatchFn = dispatch;
      pendingNow = pending;
    });
    await dispatchFn?.();
    await tick();
    flushSync();
    expect(pendingNow?.()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]).toEqual([expect.objectContaining({ message: "boom" })]);
  });

  it("[ACT-07] without an owner, an action that throws synchronously rejects the returned promise", async () => {
    const [state, dispatch, pending] = useAction((_prev: number): number => {
      throw new Error("sync boom");
    }, 1);
    let result: Promise<void> | undefined;
    expect(() => {
      result = dispatch();
    }).not.toThrow();
    await expect(result).rejects.toThrow("sync boom");
    expect(state()).toBe(1);
    expect(pending()).toBe(false);
  });
});
