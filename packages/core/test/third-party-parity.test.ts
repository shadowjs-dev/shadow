import { describe, expect, it } from "vitest";
import { type Accessor, createRoot, flushSync, useEffect, useSignal } from "../src/index";

/*
 * Extensibility rule: a third party builds a built-in-style hook
 * from the PUBLIC exports only and gets the same behavior. This file is that third-party copy of
 * `useReducer` (built on useSignal and useEffect) and of `useAction`'s commit rule, compared with
 * the built-ins over the same script.
 */

/** A third-party `useReducer`: written against the public exports, nothing internal. */
function thirdPartyUseReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initial: S,
): [Accessor<S>, (action: A) => void] {
  const [state, setState] = useSignal(initial);
  return [state, (action: A) => setState((previous) => reducer(previous, action))];
}

/** A third-party "latest wins" guard, the rule `useAction` follows for overlapping calls. */
function thirdPartyLatestWins(): () => () => boolean {
  let latest = 0;
  return () => {
    latest += 1;
    const id = latest;
    return () => id === latest;
  };
}

describe("third-party copies of built-in APIs behave like the built-ins", () => {
  it("[XPT-01] a third-party useReducer over the public exports matches the built-in on the same script", async () => {
    const { useReducer } = await import("../src/index");
    const reduce = (n: number, by: number): number => n + by;

    const log: Array<[string, number[]]> = [];
    createRoot(() => {
      const [a, dispatchA] = useReducer(reduce, 0);
      const [b, dispatchB] = thirdPartyUseReducer(reduce, 0);
      useEffect(() => {
        log.push(["builtin", [a()]]);
      });
      useEffect(() => {
        log.push(["third-party", [b()]]);
      });
      dispatchA(1);
      dispatchB(1);
      dispatchA(2);
      dispatchB(2);
    });
    flushSync();

    const builtin = log.filter(([who]) => who === "builtin").map(([, value]) => value[0]);
    const third = log.filter(([who]) => who === "third-party").map(([, value]) => value[0]);
    expect(third).toEqual(builtin);
    expect(builtin.at(-1)).toBe(3);
  });

  it("[XPT-02] a third-party latest-wins guard drops a superseded result exactly like the built-in", async () => {
    const { useAction } = await import("../src/index");
    const start = thirdPartyLatestWins();
    const resolvers: Array<(v: string) => void> = [];
    const pending = (): Promise<string> =>
      new Promise<string>((resolve) => {
        resolvers.push(resolve);
      });

    // Third-party: the guard decides which settlement may commit.
    let thirdState = "start";
    const thirdCommit = (isLatest: () => boolean, value: string) => {
      if (isLatest()) thirdState = value;
    };
    const firstGuard = start();
    const firstThird = pending().then((v) => thirdCommit(firstGuard, v));
    const secondGuard = start();
    const secondThird = pending().then((v) => thirdCommit(secondGuard, v));
    resolvers[1]?.("second");
    await secondThird;
    resolvers[0]?.("first");
    await firstThird;

    // Built-in: the same script through useAction.
    let read: (() => string) | undefined;
    let dispatch: ((n: number) => Promise<void>) | undefined;
    let builtinIndex = 0;
    const builtinResolvers: Array<(v: string) => void> = [];
    createRoot(() => {
      const [state, run] = useAction((_prev: string, _n: number) => {
        builtinIndex += 1;
        return new Promise<string>((resolve) => {
          builtinResolvers.push(resolve);
        });
      }, "start");
      read = state;
      dispatch = run;
    });
    const a = dispatch?.(1);
    const b = dispatch?.(2);
    builtinResolvers[1]?.("second");
    await b;
    flushSync();
    builtinResolvers[0]?.("first");
    await a;
    flushSync();

    expect(thirdState).toBe("second");
    expect(read?.()).toBe("second");
    expect(builtinIndex).toBe(2);
  });
});
