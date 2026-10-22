import { describe, expect, it } from "vitest";
import {
  catchError,
  createRoot,
  flushSync,
  startTransition,
  useDeferredValue,
  useEffect,
  useSignal,
  useTransition,
} from "../src/index";

/** One macrotask: the transition lane is scheduled with a timer, so awaiting a timer lets it run. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
/** One microtask: where the urgent flush runs. */
const micro = (): Promise<void> => Promise.resolve();

describe("transitions: lane scheduling", () => {
  it("[TRN-01] an effect written inside startTransition runs in the lane, not inside flushSync", async () => {
    const log: number[] = [];
    let set: (next: number) => void = () => undefined;
    createRoot(() => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      useEffect(() => {
        log.push(value());
      });
    });
    flushSync();
    log.length = 0;
    const done = startTransition(() => set(1));
    flushSync();
    expect(log).toEqual([]);
    await tick();
    expect(log).toEqual([1]);
    await done;
  });

  it("[TRN-02] urgent writes flush in the microtask, before the transition lane", async () => {
    const log: string[] = [];
    let setA: (next: number) => void = () => undefined;
    let setB: (next: number) => void = () => undefined;
    createRoot(() => {
      const [a, writeA] = useSignal(0);
      const [b, writeB] = useSignal(0);
      setA = writeA;
      setB = writeB;
      useEffect(() => {
        log.push(`a${a()}`);
      });
      useEffect(() => {
        log.push(`b${b()}`);
      });
    });
    flushSync();
    log.length = 0;
    void startTransition(() => setB(1));
    setA(1);
    await micro();
    expect(log).toEqual(["a1"]);
    await tick();
    expect(log).toEqual(["a1", "b1"]);
  });

  it("[TRN-03] the promise returned by startTransition resolves after the lane has applied the writes", async () => {
    let seen = false;
    let set: (next: number) => void = () => undefined;
    createRoot(() => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      useEffect(() => {
        if (value() === 1) seen = true;
      });
    });
    flushSync();
    await startTransition(() => set(1));
    expect(seen).toBe(true);
  });

  it("[TRN-04] useTransition reports isPending from start until the transition settles", async () => {
    let set: (next: number) => void = () => undefined;
    let pending: () => boolean = () => false;
    let start: (fn: () => void) => Promise<void> = () => Promise.resolve();
    createRoot(() => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      const hook = useTransition();
      pending = hook[0];
      start = hook[1];
      useEffect(() => {
        value();
      });
    });
    flushSync();
    expect(pending()).toBe(false);
    const done = start(() => set(1));
    expect(pending()).toBe(true);
    await done;
    expect(pending()).toBe(false);
  });

  it("[TRN-05] useDeferredValue keeps the previous value until the lane runs", async () => {
    let set: (next: number) => void = () => undefined;
    let deferred: () => number = () => -1;
    const seen: number[] = [];
    createRoot(() => {
      const [value, setValue] = useSignal(1);
      set = setValue;
      deferred = useDeferredValue(value);
      useEffect(() => {
        seen.push(deferred());
      });
    });
    flushSync();
    expect(deferred()).toBe(1);
    set(2);
    flushSync();
    expect(deferred()).toBe(1);
    await tick();
    expect(deferred()).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it("[TRN-06] an error thrown by a transition effect reaches the nearest error handler", async () => {
    const errors: unknown[] = [];
    let set: (next: number) => void = () => undefined;
    createRoot(() => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      catchError(
        () => {
          useEffect(() => {
            if (value() === 1) throw new Error("lane boom");
          });
        },
        (error) => {
          errors.push(error);
        },
      );
    });
    flushSync();
    await startTransition(() => set(1));
    expect(errors.map((error) => (error instanceof Error ? error.message : error))).toEqual([
      "lane boom",
    ]);
  });

  it("[TRN-07] an urgent write promotes an effect already waiting in the lane", async () => {
    const runs: number[] = [];
    let setA: (next: number) => void = () => undefined;
    let setB: (next: number) => void = () => undefined;
    createRoot(() => {
      const [a, writeA] = useSignal(0);
      const [b, writeB] = useSignal(0);
      setA = writeA;
      setB = writeB;
      useEffect(() => {
        runs.push(a() + b());
      });
    });
    flushSync();
    runs.length = 0;
    void startTransition(() => setB(10));
    setA(1);
    await micro();
    expect(runs).toEqual([11]);
    await tick();
    expect(runs).toEqual([11]);
  });

  it("[TRN-08] several transitions before the lane runs produce one run with the newest value", async () => {
    const runs: number[] = [];
    let set: (next: number) => void = () => undefined;
    createRoot(() => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      useEffect(() => {
        runs.push(value());
      });
    });
    flushSync();
    runs.length = 0;
    void startTransition(() => set(1));
    void startTransition(() => set(2));
    await tick();
    expect(runs).toEqual([2]);
  });

  it("[TRN-09] a synchronous throw from the transition callback is rethrown and leaves writes urgent", async () => {
    const runs: number[] = [];
    let set: (next: number) => void = () => undefined;
    createRoot(() => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      useEffect(() => {
        runs.push(value());
      });
    });
    flushSync();
    runs.length = 0;
    expect(() =>
      startTransition(() => {
        throw new Error("sync");
      }),
    ).toThrow("sync");
    set(1);
    await micro();
    expect(runs).toEqual([1]);
  });

  it("[TRN-10] reads inside a transition see its own writes at once", () => {
    let set: (next: number) => void = () => undefined;
    let get: () => number = () => -1;
    createRoot(() => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      get = value;
    });
    void startTransition(() => {
      set(5);
      expect(get()).toBe(5);
    });
  });

  it("[TRN-11] flushSync does not flush the transition lane", async () => {
    const runs: number[] = [];
    let set: (next: number) => void = () => undefined;
    createRoot(() => {
      const [value, setValue] = useSignal(0);
      set = setValue;
      useEffect(() => {
        runs.push(value());
      });
    });
    flushSync();
    runs.length = 0;
    void startTransition(() => set(1));
    flushSync();
    expect(runs).toEqual([]);
    await tick();
    expect(runs).toEqual([1]);
  });

  it("[TRN-12] a large lane is applied in chunks, and an urgent write lands between two chunks", async () => {
    const TOTAL = 300;
    let laneRuns = 0;
    const urgent: number[] = [];
    let setA: (next: number) => void = () => undefined;
    let setB: (next: number) => void = () => undefined;
    createRoot(() => {
      const [a, writeA] = useSignal(0);
      const [b, writeB] = useSignal(0);
      setA = writeA;
      setB = writeB;
      useEffect(() => {
        urgent.push(a());
      });
      for (let i = 0; i < TOTAL; i += 1) {
        useEffect(() => {
          if (b() === 1) laneRuns += 1;
        });
      }
    });
    flushSync();
    laneRuns = 0;
    urgent.length = 0;
    void startTransition(() => setB(1));
    await tick();
    expect(laneRuns).toBeGreaterThan(0);
    expect(laneRuns).toBeLessThan(TOTAL);
    const before = laneRuns;
    setA(7);
    await micro();
    expect(urgent).toEqual([7]);
    expect(laneRuns).toBe(before);
    for (let i = 0; i < 10 && laneRuns < TOTAL; i += 1) await tick();
    expect(laneRuns).toBe(TOTAL);
  });

  it("[TRN-13] startTransition with no writes resolves at once", async () => {
    let resolved = false;
    await startTransition(() => undefined).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(true);
  });
});
