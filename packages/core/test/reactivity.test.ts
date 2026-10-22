import { describe, expect, it, vi } from "vitest";
import {
  batch,
  catchError,
  createRoot,
  flushSync,
  onCleanup,
  untrack,
  useEffect,
  useMemo,
  useRenderEffect,
  useSignal,
} from "../src/index";

describe("signals", () => {
  it("[SIG-01] reads the initial value and the written value", () => {
    const [get, set] = useSignal(1);
    expect(get()).toBe(1);
    expect(set(2)).toBe(2);
    expect(get()).toBe(2);
  });

  it("[SIG-02] accepts an updater function", () => {
    const [get, set] = useSignal(1);
    set((n) => n + 1);
    expect(get()).toBe(2);
  });

  it("[SIG-03] stores functions through an updater", () => {
    const [get, set] = useSignal<() => number>(() => 1);
    const next = () => 2;
    set(() => next);
    expect(get()).toBe(next);
  });
});

describe("effects", () => {
  it("[EFF-01] first run is deferred until flush", () => {
    const [get] = useSignal(1);
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(get());
      });
    });
    expect(seen).toEqual([]);
    flushSync();
    expect(seen).toEqual([1]);
  });

  it("[EFF-02] reruns when a dependency changes, once per batch (G-5)", () => {
    const [a, setA] = useSignal(1);
    const [b, setB] = useSignal(1);
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(a() + b());
      });
    });
    flushSync();
    batch(() => {
      setA(2);
      setB(3);
    });
    expect(seen).toEqual([2, 5]);
  });

  it("[EFF-03] writes outside a batch coalesce into one microtask flush", async () => {
    const [a, setA] = useSignal(0);
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(a());
      });
    });
    flushSync();
    setA(1);
    setA(2);
    setA(3);
    expect(seen).toEqual([0]);
    await Promise.resolve();
    expect(seen).toEqual([0, 3]);
  });

  it("[EFF-04] cleanup runs before rerun and on dispose, newest first", () => {
    const [a, setA] = useSignal(0);
    const log: string[] = [];
    const dispose = createRoot((dispose) => {
      useEffect(() => {
        const value = a();
        log.push(`run ${value}`);
        onCleanup(() => log.push(`clean-a ${value}`));
        onCleanup(() => log.push(`clean-b ${value}`));
      });
      return dispose;
    });
    flushSync();
    flushSync(() => setA(1));
    dispose();
    expect(log).toEqual(["run 0", "clean-b 0", "clean-a 0", "run 1", "clean-b 1", "clean-a 1"]);
  });

  it("[EFF-05] returned function is the cleanup", () => {
    const [a, setA] = useSignal(0);
    const log: string[] = [];
    createRoot(() => {
      useEffect(() => {
        const value = a();
        return () => log.push(`clean ${value}`);
      });
    });
    flushSync();
    flushSync(() => setA(1));
    expect(log).toEqual(["clean 0"]);
  });

  it("[EFF-06] explicit deps form only tracks deps and passes previous", () => {
    const [a, setA] = useSignal(1);
    const [b, setB] = useSignal(10);
    const calls: Array<[number, number | undefined]> = [];
    createRoot(() => {
      useEffect(a, (value, previous) => {
        b();
        calls.push([value, previous]);
      });
    });
    flushSync();
    flushSync(() => setB(11));
    flushSync(() => setA(2));
    expect(calls).toEqual([
      [1, undefined],
      [2, 1],
    ]);
  });

  it("[EFF-07] defer skips the first run", () => {
    const [a, setA] = useSignal(1);
    const calls: number[] = [];
    createRoot(() => {
      useEffect(a, (value) => void calls.push(value), { defer: true });
    });
    flushSync();
    expect(calls).toEqual([]);
    flushSync(() => setA(2));
    expect(calls).toEqual([2]);
  });

  it("[EFF-08] render effects run synchronously at creation and before user effects", () => {
    const [a, setA] = useSignal(0);
    const log: string[] = [];
    createRoot(() => {
      useEffect(() => void log.push(`user ${a()}`));
      useRenderEffect(() => {
        log.push(`render ${a()}`);
      });
    });
    expect(log).toEqual(["render 0"]);
    flushSync();
    flushSync(() => setA(1));
    expect(log).toEqual(["render 0", "user 0", "render 1", "user 1"]);
  });

  it("[EFF-09] disposed effects never run (G-17)", () => {
    const [a, setA] = useSignal(0);
    const seen: number[] = [];
    const dispose = createRoot((dispose) => {
      useEffect(() => void seen.push(a()));
      return dispose;
    });
    flushSync();
    setA(1);
    dispose();
    flushSync();
    expect(seen).toEqual([0]);
  });

  it("[EFF-10] parent reruns before children; children are recreated (G-18)", () => {
    const [a, setA] = useSignal(0);
    const log: string[] = [];
    createRoot(() => {
      useEffect(() => {
        const value = a();
        log.push(`parent ${value}`);
        useEffect(() => void log.push(`child ${value}`));
      });
    });
    flushSync();
    flushSync(() => setA(1));
    expect(log).toEqual(["parent 0", "child 0", "parent 1", "child 1"]);
  });

  it("[EFF-11] an effect that writes its own dependency converges", () => {
    const [a, setA] = useSignal(0);
    createRoot(() => {
      useEffect(() => {
        if (a() < 3) setA(a() + 1);
      });
    });
    flushSync();
    expect(a()).toBe(3);
  });

  it("[LPG-01] an endless effect loop is aborted with INFINITE_LOOP", () => {
    const [a, setA] = useSignal(0);
    createRoot(() => {
      useEffect(() => void setA(a() + 1));
    });
    expect(() => flushSync()).toThrow(/INFINITE_LOOP/);
    expect(a()).toBeGreaterThan(900);
    // The scheduler is usable afterward.
    const [b, setB] = useSignal(0);
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => void seen.push(b()));
    });
    flushSync();
    flushSync(() => setB(1));
    expect(seen).toEqual([0, 1]);
  });
});

describe("memos", () => {
  it("[MEM-01] computes eagerly and caches", () => {
    const [a, setA] = useSignal(1);
    const compute = vi.fn(() => a() * 2);
    const doubled = useMemo(compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(doubled()).toBe(2);
    expect(doubled()).toBe(2);
    expect(compute).toHaveBeenCalledTimes(1);
    setA(2);
    expect(doubled()).toBe(4);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("[MEM-02] lazy memo computes on first read", () => {
    const compute = vi.fn(() => 1);
    const lazy = useMemo(compute, { lazy: true });
    expect(compute).not.toHaveBeenCalled();
    expect(lazy()).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("[G-2] equality cut-off stops propagation", () => {
    const [a, setA] = useSignal(1);
    const parity = useMemo(() => a() % 2);
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => void seen.push(parity()));
    });
    flushSync();
    flushSync(() => setA(3));
    expect(seen).toEqual([1]);
    flushSync(() => setA(4));
    expect(seen).toEqual([1, 0]);
  });

  it("[G-1] diamond graph is glitch free", () => {
    const [a, setA] = useSignal(1);
    const left = useMemo(() => a() + 1);
    const right = useMemo(() => a() * 10);
    const seen: Array<[number, number]> = [];
    createRoot(() => {
      useEffect(() => void seen.push([left(), right()]));
    });
    flushSync();
    flushSync(() => setA(2));
    expect(seen).toEqual([
      [2, 10],
      [3, 20],
    ]);
  });

  it("[G-3] dynamic dependencies are re-tracked every run", () => {
    const [flag, setFlag] = useSignal(true);
    const [a, setA] = useSignal("a");
    const [b, setB] = useSignal("b");
    const compute = vi.fn(() => (flag() ? a() : b()));
    const value = useMemo(compute);
    expect(value()).toBe("a");
    setB("b2");
    expect(value()).toBe("a");
    expect(compute).toHaveBeenCalledTimes(1);
    setFlag(false);
    expect(value()).toBe("b2");
    setA("a2");
    expect(value()).toBe("b2");
    expect(compute).toHaveBeenCalledTimes(2);
    setB("b3");
    expect(value()).toBe("b3");
  });

  it("[G-6] reads after writes are fresh inside a batch", () => {
    const [a, setA] = useSignal(1);
    const doubled = useMemo(() => a() * 2);
    batch(() => {
      setA(5);
      expect(doubled()).toBe(10);
    });
  });

  it("[G-7] a cycle is a deterministic error, not a stack overflow", () => {
    let self: () => number = () => 0;
    self = useMemo(() => self() + 1, { lazy: true });
    expect(() => self()).toThrow(/CYCLE_DETECTED/);
  });

  it("[G-9] writing a signal inside a memo is a dev error", () => {
    const [, setA] = useSignal(0);
    const bad = useMemo(
      () => {
        setA(1);
        return 1;
      },
      { lazy: true },
    );
    expect(() => bad()).toThrow(/WRITE_IN_MEMO/);
  });

  it("[E-1] a throwing memo rethrows to every reader until it recovers", () => {
    const [a, setA] = useSignal(0);
    const memo = useMemo(() => {
      if (a() === 0) throw new Error("boom");
      return a();
    });
    expect(() => memo()).toThrow("boom");
    expect(() => memo()).toThrow("boom");
    setA(1);
    expect(memo()).toBe(1);
  });

  it("[G-10] 100000-deep chains are safe on create, write and read", () => {
    const [base, setBase] = useSignal(0);
    let tail: () => number = base;
    for (let i = 0; i < 100_000; i += 1) {
      const previous = tail;
      tail = useMemo(() => previous() + 1);
    }
    expect(tail()).toBe(100_000);
    setBase(1);
    expect(tail()).toBe(100_001);
  });

  it("[G-10] deep chains where every node also reads a fresh signal do not overflow", () => {
    const [base, setBase] = useSignal(0);
    let tail: () => number = base;
    for (let i = 0; i < 20_000; i += 1) {
      const previous = tail;
      tail = useMemo(() => previous() + base());
    }
    setBase(1);
    expect(typeof tail()).toBe("number");
  });
});

describe("untrack and errors", () => {
  it("[EFF-12] untrack prevents subscription", () => {
    const [a, setA] = useSignal(0);
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => void seen.push(untrack(a)));
    });
    flushSync();
    flushSync(() => setA(1));
    expect(seen).toEqual([0]);
  });

  it("[UNC-01] a throwing effect is isolated and handled by catchError", () => {
    const [a, setA] = useSignal(0);
    const errors: unknown[] = [];
    const seen: number[] = [];
    createRoot(() => {
      catchError(
        () => {
          useEffect(() => {
            if (a() === 1) throw new Error("bad");
          });
        },
        (error) => errors.push(error),
      );
      useEffect(() => void seen.push(a()));
    });
    flushSync();
    flushSync(() => setA(1));
    expect(errors).toHaveLength(1);
    expect(seen).toEqual([0, 1]);
  });

  it("[UNC-02] an unhandled effect error is thrown after the flush drains", () => {
    const [a, setA] = useSignal(0);
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => {
        if (a() === 1) throw new Error("unhandled");
      });
      useEffect(() => void seen.push(a()));
    });
    flushSync();
    expect(() => flushSync(() => setA(1))).toThrow("unhandled");
    expect(seen).toEqual([0, 1]);
  });

  it("[O-5] a throwing cleanup does not stop the others", () => {
    const log: string[] = [];
    const errors: unknown[] = [];
    createRoot((dispose) => {
      catchError(
        () => {
          onCleanup(() => log.push("first"));
          onCleanup(() => {
            throw new Error("cleanup");
          });
          onCleanup(() => log.push("last"));
        },
        (error) => errors.push(error),
      );
      dispose();
    });
    expect(log).toEqual(["last", "first"]);
    expect(errors).toHaveLength(1);
  });
});
