import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createRoot, flushSync, onError, untrack, useEffect, useSignal } from "../src/index";
import { resetWarningDedupe } from "../src/internal/diagnostics";
import { useSelector } from "../src/selector";

describe("useSelector", () => {
  it("[SEL-01] with 10,000 rows a selection change reruns exactly the two affected row effects", () => {
    const ROWS = 10_000;
    const [selected, setSelected] = useSignal(0);
    let sourceReads = 0;
    const reran: number[] = [];
    createRoot(() => {
      const isSelected = useSelector(() => {
        sourceReads += 1;
        return selected();
      });
      for (let row = 0; row < ROWS; row += 1) {
        useEffect(() => {
          reran.push(row);
          isSelected(row);
        });
      }
    });
    flushSync();
    expect(reran.length).toBe(ROWS);
    reran.length = 0;
    sourceReads = 0;
    setSelected(5000);
    flushSync();
    expect(reran).toEqual([0, 5000]);
    expect(sourceReads).toBe(1);
  });

  it("[SEL-02] a consumer that reads several keys depends on exactly those keys", () => {
    const [selected, setSelected] = useSignal(3);
    let runs = 0;
    createRoot(() => {
      const isSelected = useSelector(selected);
      useEffect(() => {
        runs += 1;
        isSelected(1);
        isSelected(2);
      });
    });
    flushSync();
    expect(runs).toBe(1);
    setSelected(4);
    flushSync();
    expect(runs).toBe(1);
    setSelected(2);
    flushSync();
    expect(runs).toBe(2);
  });

  it("[SEL-03] a consumer that re-runs keeps exactly one subscription per key", () => {
    const [selected, setSelected] = useSignal(0);
    const [tick, setTick] = useSignal(0);
    let runs = 0;
    createRoot(() => {
      const isSelected = useSelector(selected);
      useEffect(() => {
        tick();
        runs += 1;
        isSelected(7);
      });
    });
    flushSync();
    for (let round = 1; round <= 50; round += 1) {
      setTick(round);
      flushSync();
    }
    expect(runs).toBe(51);
    setSelected(7);
    flushSync();
    expect(runs).toBe(52);
    setSelected(8);
    flushSync();
    expect(runs).toBe(53);
  });

  it("[SEL-04] a subscriber that also reads a store keeps reacting after selection changes", () => {
    const [selected, setSelected] = useSignal(1);
    const [other, setOther] = useSignal("a");
    const seen: string[] = [];
    createRoot(() => {
      const isSelected = useSelector(selected);
      useEffect(() => {
        seen.push(`${String(isSelected(1))}:${other()}`);
      });
    });
    flushSync();
    setSelected(2);
    flushSync();
    setOther("b");
    flushSync();
    setSelected(1);
    flushSync();
    expect(seen).toEqual(["true:a", "false:a", "false:b", "true:b"]);
  });

  it("[SEL-05] a custom equals is called once per registered key per change", () => {
    const [value, setValue] = useSignal(0);
    let equalsCalls = 0;
    createRoot(() => {
      const inRange = useSelector<number, number>(value, (key, current) => {
        equalsCalls += 1;
        return key <= current;
      });
      // Keys far above every value in this test never flip, so their readers do not re-run.
      for (const key of [100, 101, 102, 103, 104]) {
        useEffect(() => {
          inRange(key);
        });
      }
    });
    flushSync();
    equalsCalls = 0;
    setValue(3);
    flushSync();
    expect(equalsCalls).toBe(5);
  });

  it("[SEL-05b] a custom equals (key <= value) re-runs exactly the readers whose answer flipped", () => {
    const [value, setValue] = useSignal(0);
    const reran: number[] = [];
    const seen = new Map<number, boolean>();
    createRoot(() => {
      const inRange = useSelector<number, number>(value, (key, current) => key <= current);
      for (const key of [1, 2, 3, 4, 5]) {
        useEffect(() => {
          reran.push(key);
          seen.set(key, inRange(key));
        });
      }
    });
    flushSync();
    reran.length = 0;
    setValue(3);
    flushSync();
    expect(reran).toEqual([1, 2, 3]);
    expect([...seen.values()]).toEqual([true, true, true, false, false]);
  });

  it("[SEL-16] disposing every consumer stops notifications and the selector keeps answering", () => {
    const [selected, setSelected] = useSignal(1);
    let runs = 0;
    const isSelected = createRoot(() => useSelector(selected));
    const consumerRoot = createRoot((disposeRoot) => {
      useEffect(() => {
        runs += 1;
        isSelected(1);
      });
      return disposeRoot;
    });
    flushSync();
    expect(runs).toBe(1);
    consumerRoot();
    setSelected(2);
    flushSync();
    expect(runs).toBe(1);
    expect(isSelected(2)).toBe(true);
  });

  it("[SEL-07] an untracked call answers from the source and creates no subscription", () => {
    const [selected, setSelected] = useSignal(2);
    const isSelected = createRoot(() => useSelector(selected));
    expect(isSelected(2)).toBe(true);
    setSelected(3);
    expect(isSelected(2)).toBe(false);
    expect(untrack(() => isSelected(3))).toBe(true);
  });

  it("[SEL-08] a selector created before its consumers makes each consumer run once per change", () => {
    const [selected, setSelected] = useSignal(0);
    const runs = new Array<number>(10).fill(0);
    const reran: number[] = [];
    createRoot(() => {
      const isSelected = useSelector(selected);
      for (let key = 0; key < 10; key += 1) {
        useEffect(() => {
          runs[key] = (runs[key] ?? 0) + 1;
          reran.push(key);
          isSelected(key);
        });
      }
    });
    flushSync();
    reran.length = 0;
    setSelected(4);
    flushSync();
    expect(reran).toEqual([0, 4]);
    expect(runs[0]).toBe(2);
    expect(runs[4]).toBe(2);
    expect(runs[9]).toBe(1);
  });

  it("[SEL-09] a throwing source is routed as an effect error; consumers keep their last value and the selector recovers", () => {
    const [value, setValue] = useSignal(1);
    const errors: unknown[] = [];
    const seen: number[] = [];
    createRoot(() => {
      onError((error) => {
        errors.push(error);
      });
      const isSelected = useSelector(() => {
        const current = value();
        if (current < 0) throw new Error("negative");
        return current;
      });
      useEffect(() => {
        seen.push(isSelected(1) ? 1 : 0);
      });
    });
    flushSync();
    setValue(-1);
    flushSync();
    expect(errors.length).toBe(1);
    expect(seen).toEqual([1]);
    setValue(1);
    flushSync();
    expect(seen).toEqual([1]);
    setValue(2);
    flushSync();
    expect(seen).toEqual([1, 0]);
  });

  it("[SEL-10] 0 and -0 select the same key; NaN is never selected under the default equality", () => {
    const [value, setValue] = useSignal(0);
    let runs = 0;
    createRoot(() => {
      const isSelected = useSelector(value);
      useEffect(() => {
        runs += 1;
        isSelected(0);
        isSelected(Number.NaN);
      });
    });
    flushSync();
    expect(runs).toBe(1);
    setValue(-0);
    flushSync();
    expect(runs).toBe(1);
    const isSelectedNaN = createRoot(() => useSelector(() => Number.NaN));
    expect(isSelectedNaN(Number.NaN)).toBe(false);
  });

  it("[SEL-11] a consumer created after the selection changed reads the current value immediately", () => {
    const [selected, setSelected] = useSignal(1);
    const isSelected = createRoot(() => useSelector(selected));
    setSelected(3);
    flushSync();
    const seen: boolean[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(isSelected(3));
      });
    });
    flushSync();
    expect(seen).toEqual([true]);
  });

  it("[SEL-14] [E-5] a custom equals that throws for one key is routed as an effect error and the other keys still update", () => {
    const [value, setValue] = useSignal(0);
    const errors: unknown[] = [];
    const seen = new Map<number, boolean>();
    createRoot(() => {
      onError((error) => {
        errors.push(error);
      });
      const isSelected = useSelector<number, number>(value, (key, current) => {
        if (key === 2 && current === 5) throw new Error("bad key");
        return key <= current;
      });
      for (const key of [1, 2, 3]) {
        useEffect(() => {
          seen.set(key, isSelected(key));
        });
      }
    });
    flushSync();
    setValue(5);
    flushSync();
    expect(errors.length).toBe(1);
    expect(seen.get(1)).toBe(true);
    expect(seen.get(3)).toBe(true);
    setValue(1);
    flushSync();
    expect(seen.get(3)).toBe(false);
    expect(seen.get(1)).toBe(true);
  });

  it("[SEL-15] created outside an owner it warns NO_OWNER_EFFECT and still answers untracked", () => {
    resetWarningDedupe();
    const [selected] = useSignal(4);
    const isSelected = useSelector(selected);
    const warnings = vi.mocked(console.warn).mock.calls.map((args) => String(args[0]));
    expect(warnings.some((message) => message.includes("NO_OWNER_EFFECT"))).toBe(true);
    vi.mocked(console.warn).mockClear();
    expect(isSelected(4)).toBe(true);
  });

  it("[TYPSEL-01] K defaults to T; a custom equals infers K from its first parameter", () => {
    const [selected] = useSignal("a");
    const plain = createRoot(() => useSelector(selected));
    expectTypeOf(plain).toEqualTypeOf<(key: string) => boolean>();
    const ranged = createRoot(() =>
      useSelector(
        () => 3,
        (key: number, value) => key <= value,
      ),
    );
    expectTypeOf(ranged).toEqualTypeOf<(key: number) => boolean>();
  });
});
