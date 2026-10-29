import { describe, expect, it } from "vitest";
import { createOwner, disposeOwner, pauseOwner, resumeOwner } from "../src/extend";
import {
  createRoot,
  flushSync,
  onCleanup,
  onError,
  runWithOwner,
  useAction,
  useEffect,
  useMemo,
  useRenderEffect,
  useSignal,
} from "../src/index";

describe("review r7: zombies, nested disposal, throwing cleanups, pause, useAction", () => {
  it("[CORE-R7-1] a render effect never runs before its stale parent effect disposes it", () => {
    const [user, setUser] = useSignal<{ name: string } | null>({ name: "a" });
    const names: string[] = [];
    createRoot(() => {
      useEffect(() => {
        if (user() !== null) {
          useRenderEffect(() => {
            names.push((user() as { name: string }).name);
          });
        }
      });
    });
    flushSync();
    setUser(null);
    expect(() => flushSync()).not.toThrow();
    expect(names).toEqual(["a"]);
  });

  it("[CORE-R7-1b] an effect made by a memo does not run before the stale memo, read deeper, disposes it", () => {
    const [source, setSource] = useSignal<{ name: string } | null>({ name: "a" });
    const seen: string[] = [];
    createRoot(() => {
      const memo = useMemo(() => {
        const value = source();
        if (value !== null) {
          useEffect(() => {
            seen.push((source() as { name: string }).name);
          });
        }
        return value;
      });
      // Deeper than the memo's effect, so the effect is first in the queue.
      const deeper = createOwner(null);
      runWithOwner(deeper, () => {
        const deepest = createOwner(deeper);
        runWithOwner(deepest, () => {
          useEffect(() => {
            memo();
          });
        });
      });
    });
    flushSync();
    setSource(null);
    expect(() => flushSync()).not.toThrow();
    expect(seen).toEqual(["a"]);
  });

  it("[CORE-R7-2] a disposal nested in a cleanup does not flush effects mid-teardown", () => {
    const [count, setCount] = useSignal(0);
    const log: string[] = [];
    const outer = createOwner(null);
    runWithOwner(outer, () => {
      // Older sibling: still alive when the newer one's cleanup runs.
      useEffect(() => {
        log.push(`older ${count()}`);
      });
      const newer = createOwner(outer);
      runWithOwner(newer, () => {
        onCleanup(() => {
          setCount(1);
          disposeOwner(createOwner(null));
          log.push("cleanup");
        });
      });
    });
    flushSync();
    log.length = 0;
    disposeOwner(outer);
    expect(log).toEqual(["cleanup"]);
  });

  it("[CORE-R7-3] when a memo cleanup throws, the older cleanups run, the memo re-runs and is clean", () => {
    const [source, setSource] = useSignal(0);
    const log: string[] = [];
    let runs = 0;
    const memo = createRoot(() =>
      useMemo(() => {
        runs += 1;
        onCleanup(() => log.push("older"));
        onCleanup(() => {
          throw new Error("newer boom");
        });
        return source();
      }),
    );
    expect(memo()).toBe(0);
    setSource(1);
    expect(() => memo()).toThrow("newer boom");
    expect(log).toEqual(["older"]);
    expect(runs).toBe(2);
    expect(memo()).toBe(1);
    expect(runs).toBe(2);
  });

  it("[CORE-R7-3b] several throwing cleanups all run and arrive as an AggregateError", () => {
    const [source, setSource] = useSignal(0);
    const log: string[] = [];
    const memo = createRoot(() =>
      useMemo(() => {
        onCleanup(() => {
          log.push("a");
          throw new Error("a");
        });
        onCleanup(() => {
          log.push("b");
          throw new Error("b");
        });
        return source();
      }),
    );
    memo();
    setSource(1);
    let caught: unknown;
    try {
      memo();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect(log).toEqual(["b", "a"]);
  });

  it("[CORE-R7-4] pause: a throwing cleanup leaves no node unpaused, and cleanups run children first", () => {
    const log: string[] = [];
    const parent = createOwner(null);
    runWithOwner(parent, () => {
      useEffect(() => {
        onCleanup(() => log.push("parent"));
        const child = createOwner(parent);
        runWithOwner(child, () => {
          useEffect(() => {
            onCleanup(() => log.push("child"));
          });
        });
      });
    });
    flushSync();
    pauseOwner(parent);
    expect(log).toEqual(["child", "parent"]);
    resumeOwner(parent);

    const throwing = createOwner(null);
    let ran = 0;
    let setValue: (next: number) => void = () => undefined;
    runWithOwner(throwing, () => {
      const [value, set] = useSignal(0);
      setValue = set;
      useEffect(() => {
        value();
        ran += 1;
        onCleanup(() => {
          throw new Error("pause boom");
        });
      });
      useEffect(() => {
        value();
        ran += 1;
      });
    });
    flushSync();
    expect(ran).toBe(2);
    expect(() => pauseOwner(throwing)).toThrow("pause boom");
    setValue(1);
    flushSync();
    expect(ran).toBe(2);
    expect(throwing.pauses).toBe(1);
    resumeOwner(throwing);
    flushSync();
    expect(ran).toBe(4);
  });

  it("[CORE-R7-5] a stale dispatch's error reaches the owner's handler; the latest state is untouched", async () => {
    const errors: unknown[] = [];
    let release: (() => void) | undefined;
    let dispatch: ((slow: boolean) => Promise<void>) | undefined;
    let state: (() => string) | undefined;
    let pending: (() => boolean) | undefined;
    createRoot(() => {
      onError((error) => errors.push(error));
      const [s, d, p] = useAction(
        (_prev: string, slow: boolean) =>
          slow
            ? new Promise<string>((_resolve, reject) => {
                release = () => reject(new Error("stale boom"));
              })
            : Promise.resolve("fast"),
        "start",
      );
      state = s;
      dispatch = d;
      pending = p;
    });
    const first = dispatch?.(true);
    const second = dispatch?.(false);
    release?.();
    await first;
    await second;
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("stale boom");
    expect(state?.()).toBe("fast");
    expect(pending?.()).toBe(false);
  });

  it("[CORE-R7-5b] dispatch never throws synchronously: an owner without a handler reports the error", async () => {
    const reported: unknown[] = [];
    const original = globalThis.reportError;
    globalThis.reportError = (error: unknown) => {
      reported.push(error);
    };
    try {
      let dispatch: (() => Promise<void>) | undefined;
      createRoot(() => {
        [, dispatch] = useAction((): string => {
          throw new Error("sync boom");
        }, "x");
      });
      let result: Promise<void> | undefined;
      expect(() => {
        result = dispatch?.();
      }).not.toThrow();
      await result;
      expect(reported).toHaveLength(1);
      expect((reported[0] as Error).message).toBe("sync boom");
    } finally {
      globalThis.reportError = original;
    }
  });

  it("[CORE-R7-6] a memo cleanup may write a signal (no WRITE_IN_MEMO from the outer memo)", () => {
    const [source, setSource] = useSignal(0);
    const [log, setLog] = useSignal(0);
    createRoot(() => {
      const inner = useMemo(() => {
        onCleanup(() => setLog(log() + 1));
        return source();
      });
      const outer = useMemo(() => source() + inner());
      outer();
      setSource(1);
      expect(outer()).toBe(2);
    });
    expect(log()).toBe(1);
  });
});
