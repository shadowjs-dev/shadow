import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRoot,
  flushSync,
  onCleanup,
  untrack,
  useEffect,
  useRenderEffect,
  useSignal,
} from "../src/index";
import { resetWarningDedupe, setWarningListener } from "../src/internal/diagnostics";
import { indexArray, mapArray } from "../src/list";

interface Obj {
  readonly id: number;
}

beforeEach(() => {
  resetWarningDedupe();
});

afterEach(() => {
  setWarningListener(undefined);
  resetWarningDedupe();
});

/** Runs `fn` inside a flush so memo recomputation and row effects settle before it returns. */
function settle<T>(fn: () => T): T {
  return flushSync(fn);
}

/** Returns one shared object per id, so a numeric id stands for a stable item reference. */
function objectsFor(pool: Map<number, Obj>, ids: readonly number[]): Obj[] {
  return ids.map((id) => {
    const existing = pool.get(id);
    if (existing !== undefined) return existing;
    const fresh = { id };
    pool.set(id, fresh);
    return fresh;
  });
}

/** Deterministic shuffle: sorts by a multiplicative hash of the position. */
function shuffled<T>(values: readonly T[], seed: number): T[] {
  return values
    .map((value, position) => ({ value, rank: (Math.imul(position, 2654435761) + seed) >>> 0 }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.value);
}

describe("mapArray: identity and ownership", () => {
  it("[LST-01] keeps the mapped value of every row whose item reference survives", () => {
    const a = { name: "a" };
    const b = { name: "b" };
    const c = { name: "c" };
    let created = 0;
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly (typeof a)[]>([a, b]);
      const rows = mapArray(list, (item) => {
        created += 1;
        return { item };
      });
      const first = settle(() => rows());
      const second = settle(() => {
        setList([c, a, b]);
        return rows();
      });
      expect(second[1]).toBe(first[0]);
      expect(second[2]).toBe(first[1]);
      expect(second.map((row) => row.item)).toEqual([c, a, b]);
      expect(created).toBe(3);
      dispose();
    });
  });

  it("[LST-02] keyed rows receive a new object under the same key through item() without re-creation", () => {
    let created = 0;
    const seen: string[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal([
        { id: 1, v: "a" },
        { id: 2, v: "b" },
      ]);
      const rows = mapArray(
        list,
        (item) => {
          created += 1;
          useEffect(() => {
            seen.push(item().v);
          });
          return { id: untrack(() => item().id) };
        },
        { key: (value) => value.id },
      );
      const first = settle(() => rows());
      settle(() => {
        setList([
          { id: 1, v: "A" },
          { id: 2, v: "b" },
        ]);
      });
      const second = settle(() => rows());
      expect(second[0]).toBe(first[0]);
      expect(second[1]).toBe(first[1]);
      expect(created).toBe(2);
      // Both items are new objects, so both item() signals change and both effects rerun.
      expect(seen).toEqual(["a", "b", "A", "b"]);
      dispose();
    });
  });

  it("[LST-03] index() follows a row when it moves, and the row effect runs once per flush", () => {
    const log: string[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal(["a", "b", "c"]);
      const rows = mapArray(list, (item, index) => {
        useEffect(() => {
          log.push(`${item}:${index()}`);
        });
        return item;
      });
      settle(() => rows());
      expect(log).toEqual(["a:0", "b:1", "c:2"]);
      log.length = 0;
      settle(() => {
        setList(["x", "a", "b", "c"]);
      });
      settle(() => rows());
      expect(log.toSorted()).toEqual(["a:1", "b:2", "c:3", "x:0"]);
      dispose();
    });
  });

  it("[LST-04] creates and disposes exactly the rows that enter and leave the list", () => {
    const pool = new Map<number, Obj>();
    const created: number[] = [];
    const disposed: number[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly Obj[]>(objectsFor(pool, [1, 2, 3, 4]));
      const rows = mapArray(list, (item) => {
        created.push(item.id);
        onCleanup(() => {
          disposed.push(item.id);
        });
        return item.id;
      });
      settle(() => rows());
      expect(created).toEqual([1, 2, 3, 4]);
      settle(() => {
        setList(objectsFor(pool, [1, 3, 4]));
      });
      settle(() => rows());
      expect(disposed).toEqual([2]);
      expect(created).toEqual([1, 2, 3, 4]);
      dispose();
    });
    expect(disposed.toSorted()).toEqual([1, 2, 3, 4]);
  });

  it("[LST-05] creates rows in input order, including when prepending", () => {
    const pool = new Map<number, Obj>();
    const order: number[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly Obj[]>([]);
      const rows = mapArray(list, (item) => {
        order.push(item.id);
        return item.id;
      });
      settle(() => setList(objectsFor(pool, [1, 2, 3])));
      settle(() => rows());
      expect(order).toEqual([1, 2, 3]);
      order.length = 0;
      settle(() => setList(objectsFor(pool, [7, 8, 1, 2, 3])));
      settle(() => rows());
      expect(order).toEqual([7, 8]);
      dispose();
    });
  });

  it("[LST-06] runs no map call until the output is first read", () => {
    let created = 0;
    createRoot((dispose) => {
      const [list] = useSignal([1, 2, 3]);
      const rows = mapArray(list, (item) => {
        created += 1;
        return item;
      });
      expect(created).toBe(0);
      settle(() => rows());
      expect(created).toBe(3);
      dispose();
    });
  });

  it("[LST-07] disposes every row and effect when the owner of the list is disposed", () => {
    const disposed: number[] = [];
    const effectCleanups: number[] = [];
    const dispose = createRoot((disposeRoot) => {
      const [list] = useSignal([1, 2, 3]);
      const rows = mapArray(list, (item) => {
        onCleanup(() => {
          disposed.push(item);
        });
        useEffect(() => () => {
          effectCleanups.push(item);
        });
        return item;
      });
      settle(() => rows());
      return disposeRoot;
    });
    expect(disposed).toEqual([]);
    dispose();
    expect(disposed.toSorted()).toEqual([1, 2, 3]);
    expect(effectCleanups.toSorted()).toEqual([1, 2, 3]);
  });

  it("[LST-08] disposes the effects inside a row when that row leaves the list", () => {
    const cleaned: number[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal([1, 2, 3]);
      const rows = mapArray(list, (item) => {
        useEffect(() => () => {
          cleaned.push(item);
        });
        return item;
      });
      settle(() => rows());
      expect(cleaned).toEqual([]);
      settle(() => setList([1, 3]));
      settle(() => rows());
      expect(cleaned).toEqual([2]);
      dispose();
    });
  });

  it("[LST-09] runs the map callback untracked, so reading a signal inside it does not rebuild the output", () => {
    createRoot((dispose) => {
      const [dependency, setDependency] = useSignal(0);
      const [list] = useSignal([1, 2]);
      let created = 0;
      const rows = mapArray(list, (item) => {
        created += 1;
        dependency();
        return item;
      });
      const first = settle(() => rows());
      settle(() => setDependency(1));
      const second = settle(() => rows());
      expect(second).toBe(first);
      expect(created).toBe(2);
      dispose();
    });
  });
});

describe("mapArray: fallback and empty lists", () => {
  it("[LST-10] treats null, undefined and false as an empty list", () => {
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly number[] | null | undefined | false>([1, 2]);
      const rows = mapArray(list, (item) => item * 10);
      expect(settle(() => rows())).toEqual([10, 20]);
      settle(() => setList(null));
      expect(settle(() => rows())).toEqual([]);
      settle(() => setList(undefined));
      expect(settle(() => rows())).toEqual([]);
      settle(() => setList(false));
      expect(settle(() => rows())).toEqual([]);
      dispose();
    });
  });

  it("[LST-11] shows the fallback in its own root while empty and disposes it when items arrive", () => {
    let fallbacks = 0;
    let fallbackDisposed = 0;
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly string[] | null | false>(false);
      const rows = mapArray(list, (item) => item, {
        fallback: () => {
          fallbacks += 1;
          onCleanup(() => {
            fallbackDisposed += 1;
          });
          return "none";
        },
      });
      expect(settle(() => rows())).toEqual(["none"]);
      expect(fallbacks).toBe(1);
      settle(() => setList(["a", "b"]));
      expect(settle(() => rows())).toEqual(["a", "b"]);
      expect(fallbackDisposed).toBe(1);
      settle(() => setList([]));
      expect(settle(() => rows())).toEqual(["none"]);
      expect(fallbacks).toBe(2);
      settle(() => setList(null));
      expect(settle(() => rows())).toEqual(["none"]);
      expect(fallbacks).toBe(2);
      dispose();
    });
    expect(fallbackDisposed).toBe(2);
  });
});

describe("mapArray: duplicates", () => {
  it("[LST-12] pairs duplicate primitives in order of occurrence", () => {
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly number[]>([1, 1, 2]);
      const rows = mapArray(list, (value) => ({ value }));
      const before = settle(() => rows());
      settle(() => setList([2, 1, 1]));
      const after = settle(() => rows());
      expect(after[0]).toBe(before[2]);
      expect(after[1]).toBe(before[0]);
      expect(after[2]).toBe(before[1]);
      dispose();
    });
  });

  it("[LST-13] keeps the first copy of a repeated object and gives later copies fresh rows", () => {
    createRoot((dispose) => {
      const shared = { name: "shared" };
      const [list, setList] = useSignal<readonly (typeof shared)[]>([shared, shared]);
      let created = 0;
      const rows = mapArray(list, (item) => {
        created += 1;
        return { item };
      });
      const first = settle(() => rows());
      expect(created).toBe(2);
      settle(() => setList([shared]));
      const second = settle(() => rows());
      expect(second).toHaveLength(1);
      expect(second[0]).toBe(first[0]);
      settle(() => setList([shared, shared, shared]));
      const third = settle(() => rows());
      expect(third).toHaveLength(3);
      expect(third[0]).toBe(first[0]);
      expect(third[1]).not.toBe(first[1]);
      expect(third[2]).not.toBe(third[1]);
      dispose();
    });
  });

  it("[LST-14] keyed duplicates still render, warn once, and the later copies get fresh rows", () => {
    const warnings: string[] = [];
    setWarningListener((code) => {
      warnings.push(code);
    });
    createRoot((dispose) => {
      const [list, setList] = useSignal([
        { k: "a", n: 1 },
        { k: "a", n: 2 },
        { k: "b", n: 3 },
      ]);
      const rows = mapArray(list, (item) => ({ n: untrack(() => item().n) }), {
        key: (value) => value.k,
      });
      const first = settle(() => rows());
      expect(first.map((row) => row.n)).toEqual([1, 2, 3]);
      settle(() =>
        setList([
          { k: "a", n: 4 },
          { k: "a", n: 5 },
          { k: "b", n: 6 },
        ]),
      );
      const second = settle(() => rows());
      expect(second.map((row) => row.n)).toEqual([1, 5, 3]);
      expect(second[0]).toBe(first[0]);
      expect(second[1]).not.toBe(first[1]);
      expect(second[2]).toBe(first[2]);
      dispose();
    });
    expect(warnings).toEqual(["EACH_KEY_DUPLICATE"]);
  });
});

describe("mapArray: errors and scheduling", () => {
  it("[LST-15] a throwing map keeps the previous rows, disposes the rows it made, and rethrows", () => {
    const disposed: number[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly number[]>([1, 2]);
      const rows = mapArray(list, (item) => {
        if (item === 13) throw new Error("bad 13");
        onCleanup(() => {
          disposed.push(item);
        });
        return { item };
      });
      const before = settle(() => rows());
      settle(() => setList([1, 2, 4, 13]));
      expect(() => settle(() => rows())).toThrow("bad 13");
      expect(disposed).toEqual([4]);
      settle(() => setList([1, 2]));
      const after = settle(() => rows());
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
      expect(disposed).toEqual([4]);
      dispose();
    });
  });

  it("[LST-16] a throwing cleanup does not stop the other removed rows from being disposed", () => {
    const disposed: number[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal([1, 2, 3]);
      const rows = mapArray(list, (item) => {
        onCleanup(() => {
          if (item === 1) throw new Error("cleanup 1");
          disposed.push(item);
        });
        return item;
      });
      settle(() => rows());
      settle(() => setList([]));
      expect(() => settle(() => rows())).toThrow("cleanup 1");
      expect(disposed).toEqual([2, 3]);
      dispose();
    });
  });

  it("[LST-17] a row effect runs once per flush even when its item and index both change", () => {
    const log: string[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal([
        { id: 1, v: "a" },
        { id: 2, v: "b" },
      ]);
      const rows = mapArray(
        list,
        (item, index) => {
          useEffect(() => {
            log.push(`${item().id}:${index()}:${item().v}`);
          });
          return item().id;
        },
        { key: (value) => value.id },
      );
      settle(() => rows());
      expect(log).toEqual(["1:0:a", "2:1:b"]);
      log.length = 0;
      settle(() => {
        setList([
          { id: 2, v: "B" },
          { id: 1, v: "A" },
        ]);
      });
      settle(() => rows());
      expect(log.toSorted()).toEqual(["1:1:A", "2:0:B"]);
      dispose();
    });
  });
});

describe("mapArray: reconciliation fast paths", () => {
  /** Each case moves from one id list to another and checks retention, creation and disposal. */
  const cases: readonly {
    readonly name: string;
    readonly from: readonly number[];
    readonly to: readonly number[];
  }[] = [
    { name: "empty to n", from: [], to: [0, 1, 2, 3, 4, 5] },
    { name: "n to empty", from: [0, 1, 2, 3, 4, 5], to: [] },
    { name: "append", from: [0, 1, 2, 3, 4], to: [0, 1, 2, 3, 4, 5] },
    { name: "prepend", from: [0, 1, 2, 3, 4], to: [9, 0, 1, 2, 3, 4] },
    { name: "remove one", from: [0, 1, 2, 3, 4], to: [0, 1, 3, 4] },
    { name: "swap two", from: [0, 1, 2, 3, 4], to: [0, 3, 2, 1, 4] },
    {
      name: "full reverse",
      from: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      to: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    },
    {
      name: "mixed replace",
      from: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      to: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    },
    {
      name: "random permutation",
      from: Array.from({ length: 100 }, (_, i) => i),
      to: shuffled(
        Array.from({ length: 100 }, (_, i) => i),
        11,
      ),
    },
  ];

  for (const testCase of cases) {
    it(`[LST-18] ${testCase.name}: order, retention, creation and disposal are exact`, () => {
      const pool = new Map<number, Obj>();
      let created = 0;
      let disposed = 0;
      createRoot((dispose) => {
        const [list, setList] = useSignal<readonly Obj[]>(objectsFor(pool, testCase.from));
        const rows = mapArray(list, (item) => {
          created += 1;
          onCleanup(() => {
            disposed += 1;
          });
          return { id: item.id };
        });
        const before = new Map(settle(() => rows()).map((row) => [row.id, row] as const));
        const fromSet = new Set(testCase.from);
        const toSet = new Set(testCase.to);
        const newIds = testCase.to.filter((id) => !fromSet.has(id)).length;
        const goneIds = testCase.from.filter((id) => !toSet.has(id)).length;
        created = 0;
        disposed = 0;
        const after = settle(() => {
          setList(objectsFor(pool, testCase.to));
          return rows();
        });
        expect(after.map((row) => row.id)).toEqual(testCase.to);
        for (const row of after) {
          const previous = before.get(row.id);
          if (previous !== undefined) expect(row).toBe(previous);
        }
        expect(created).toBe(newIds);
        expect(disposed).toBe(goneIds);
        dispose();
      });
    });
  }
});

describe("indexArray", () => {
  it("[LST-19] keeps a row per position; its item() updates without re-creating the row", () => {
    let created = 0;
    createRoot((dispose) => {
      const [list, setList] = useSignal([{ v: "a" }, { v: "b" }]);
      const rows = indexArray(list, (item, index) => {
        created += 1;
        return { item, index };
      });
      const first = settle(() => rows());
      settle(() => setList([{ v: "A" }, { v: "b" }]));
      const second = settle(() => rows());
      expect(second[0]).toBe(first[0]);
      expect(second[1]).toBe(first[1]);
      expect(second[0]?.item().v).toBe("A");
      expect(created).toBe(2);
      dispose();
    });
  });

  it("[LST-20] creates rows only when the length grows and disposes them only when it shrinks", () => {
    const disposed: number[] = [];
    createRoot((dispose) => {
      const [list, setList] = useSignal([1, 2]);
      let created = 0;
      const rows = indexArray(list, (item) => {
        created += 1;
        onCleanup(() => {
          disposed.push(untrack(item));
        });
        return item;
      });
      settle(() => rows());
      settle(() => setList([5, 6, 7]));
      expect(settle(() => rows())).toHaveLength(3);
      expect(created).toBe(3);
      settle(() => setList([9]));
      expect(settle(() => rows())).toHaveLength(1);
      expect(disposed.toSorted()).toEqual([6, 7]);
      dispose();
    });
  });

  it("[LST-21] shows the fallback while empty and treats null and false as empty", () => {
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly number[] | null | false>(null);
      const rows = indexArray(list, (item) => item(), { fallback: () => -1 });
      expect(settle(() => rows())).toEqual([-1]);
      settle(() => setList([4]));
      expect(settle(() => rows())).toEqual([4]);
      settle(() => setList(false));
      expect(settle(() => rows())).toEqual([-1]);
      dispose();
    });
  });
});

describe("mapArray scale", () => {
  it("[LST-22] reorders 20,000 keyed rows in under a second", () => {
    const objects = Array.from({ length: 20000 }, (_, id) => ({ id }));
    createRoot((dispose) => {
      const [list, setList] = useSignal<readonly Obj[]>(objects);
      const rows = mapArray(list, (item) => ({ id: item().id }), { key: (value) => value.id });
      const before = settle(() => rows());
      const next = shuffled(objects, 7);
      const start = performance.now();
      const after = settle(() => {
        setList(next);
        return rows();
      });
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1000);
      expect(after.map((row) => row.id)).toEqual(next.map((item) => item.id));
      const byId = new Map(before.map((row) => [row.id, row] as const));
      expect(after.every((row) => byId.get(row.id) === row)).toBe(true);
      dispose();
    });
  });
});

describe("mapArray property", () => {
  type Row = { readonly key: number; readonly serial: number };

  it("[LST-23] matches a naive reference over random keyed updates, with identity and counts", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 0, max: 6 }), { maxLength: 10 }), {
          minLength: 1,
          maxLength: 12,
        }),
        (updates) => {
          const warnings: string[] = [];
          const previous = setWarningListener((code) => {
            warnings.push(code);
          });
          try {
            let serial = 0;
            let created = 0;
            let disposed = 0;
            const holder = createRoot((dispose) => {
              const [list, setList] = useSignal<readonly number[]>([]);
              const rows = mapArray(
                list,
                (item) => {
                  created += 1;
                  serial += 1;
                  const row: Row = { key: item(), serial };
                  onCleanup(() => {
                    disposed += 1;
                  });
                  return row;
                },
                { key: (value) => value },
              );
              return { dispose, rows, setList };
            });
            let prev: readonly Row[] = [];
            for (const update of updates) {
              const createdBefore = created;
              const disposedBefore = disposed;
              settle(() => holder.setList(update));
              const got = settle(() => holder.rows());

              // Naive reference: the first copy of each key reuses the previous first copy.
              const firstPrev = new Map<number, Row>();
              for (const row of prev) {
                if (!firstPrev.has(row.key)) firstPrev.set(row.key, row);
              }
              const seen = new Set<number>();
              let retained = 0;
              update.forEach((key, position) => {
                const duplicate = seen.has(key);
                seen.add(key);
                const reused = duplicate ? undefined : firstPrev.get(key);
                const row = got[position];
                expect(row).toBeDefined();
                if (reused !== undefined) {
                  retained += 1;
                  expect(row).toBe(reused);
                } else {
                  expect(prev.includes(row as Row)).toBe(false);
                }
              });
              expect(got.map((row) => row.key)).toEqual(update);
              expect(created - createdBefore).toBe(update.length - retained);
              expect(disposed - disposedBefore).toBe(prev.length - retained);
              expect(created - disposed).toBe(got.length);
              prev = got;
            }
            holder.dispose();
            expect(created).toBe(disposed);
          } finally {
            setWarningListener(previous);
          }
          expect(warnings.every((code) => code === "EACH_KEY_DUPLICATE")).toBe(true);
        },
      ),
      { seed: 424242, numRuns: 300 },
    );
  });
});

describe("writes from row cleanups", () => {
  it("[LST-CLEAN-W] a row cleanup may write a signal while the list memo tears the row down", () => {
    const [list, setList] = useSignal(["a", "b"]);
    const [seen, setSeen] = useSignal(0);
    createRoot((dispose) => {
      const rows = mapArray(list, (item) => {
        onCleanup(() => setSeen((n) => n + 1));
        return item;
      });
      useRenderEffect(
        () => rows(),
        () => undefined,
      );
      flushSync();
      expect(() => {
        setList(["a"]);
        flushSync();
      }).not.toThrow();
      expect(seen()).toBe(1);
      dispose();
    });
  });
});
