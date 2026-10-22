import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  batch,
  catchError,
  children,
  createContext,
  createRoot,
  flushSync,
  getOwner,
  indexArray,
  mapArray,
  mergeProps,
  type Owner,
  onCleanup,
  onError,
  onMount,
  runWithOwner,
  splitProps,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRenderEffect,
  useSelector,
  useSignal,
} from "../src/index";
// Warnings are deduplicated per code for the whole module; tests reset that state. This is the
// only internal import, and it exists purely to make warning assertions deterministic.
import { resetWarningDedupe } from "../src/internal/diagnostics";

/*
 * Adversarial suite for the reactive core. Each test attacks one invariant from
 * reactive-core invariant (section 3.3 of the architecture notes) or one documented edge case.
 * A test that exposed a confirmed engine bug carries a `// Regression (fixed):` note.
 */

const NO_THROW = Symbol("no-throw");

/** What `fn` threw, or NO_THROW when it returned normally. */
function errorOf(fn: () => unknown): unknown {
  try {
    fn();
    return NO_THROW;
  } catch (error) {
    return error;
  }
}

/** The ShadowError code carried by a thrown value. */
function codeOf(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

/** Warning messages printed since the last call. Clears them so the console guard passes. */
function takeWarnings(): string[] {
  const warn = vi.mocked(console.warn);
  const messages = warn.mock.calls.map((args) => String(args[0]));
  warn.mockClear();
  return messages;
}

/** An attached-to-nothing root; returns its dispose function. */
function root(body: () => void): () => void {
  return createRoot((dispose) => {
    body();
    return dispose;
  });
}

/** Deterministic PRNG (LCG) so every failure reproduces from its seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Errors that a flush or a dispose surfaced in a test that did not expect them. */
const strayErrors: unknown[] = [];

beforeEach(() => {
  resetWarningDedupe();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Work a failing test left queued must not run inside the next test; its errors are kept aside.
  try {
    flushSync();
  } catch (error) {
    strayErrors.push(error);
  }
});

const Theme = createContext("light", { name: "theme" });
const Level = createContext<number>();

describe("glitch freedom, equality cut-off, dynamic dependencies", () => {
  it("[G-1a] diamond: the effect never sees a mix of old and new branches", () => {
    const [a, setA] = useSignal(1);
    const b = useMemo(() => a() * 2);
    const c = useMemo(() => a() * 3);
    const seen: number[] = [];
    root(() => {
      useEffect(() => {
        seen.push(b() + c());
      });
    });
    flushSync();
    setA(2);
    flushSync();
    expect(seen).toEqual([5, 10]);
  });

  it("[G-1b] jagged diamond with a long branch: each run sees consistent values", () => {
    const [a, setA] = useSignal(1);
    const short = useMemo(() => a() + 1);
    let long: () => number = a;
    for (let i = 0; i < 5; i += 1) {
      const prev = long;
      long = useMemo(() => prev());
    }
    const tail = long;
    const seen: Array<[number, number]> = [];
    root(() => {
      useEffect(() => {
        seen.push([short(), tail()]);
      });
    });
    flushSync();
    setA(2);
    flushSync();
    expect(seen).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });

  it("[G-1c] six levels of diamonds match a naive evaluator and run once per write", () => {
    const naive = (x: number): [number, number] => {
      let p = x;
      let q = x;
      for (let i = 0; i < 6; i += 1) [p, q] = [p + q, p - q];
      return [p, q];
    };
    const [a, setA] = useSignal(1);
    let p: () => number = a;
    let q: () => number = a;
    for (let level = 0; level < 6; level += 1) {
      const pp = p;
      const qq = q;
      p = useMemo(() => pp() + qq());
      q = useMemo(() => pp() - qq());
    }
    const seen: Array<[number, number]> = [];
    root(() => {
      useEffect(() => {
        seen.push([p(), q()]);
      });
    });
    flushSync();
    for (const x of [2, 3, -4]) {
      setA(x);
      flushSync();
    }
    expect(seen).toEqual([naive(1), naive(2), naive(3), naive(-4)]);
  });

  it("[G-6a] read-your-writes outside a batch: a memo is fresh right after set()", () => {
    const [s, setS] = useSignal(1);
    const doubled = useMemo(() => s() * 2);
    setS(3);
    expect(doubled()).toBe(6);
  });

  it("[G-6b] read-your-writes inside a batch, for memos and for updater writes", () => {
    const [a, setA] = useSignal(1);
    const doubled = useMemo(() => a() * 2);
    batch(() => {
      setA(5);
      expect(doubled()).toBe(10);
      setA(6);
      expect(doubled()).toBe(12);
    });
  });

  it("[G-2a] a memo recomputing to an equal value does not re-run its dependents", () => {
    const [a, setA] = useSignal(1);
    const sign = useMemo(() => a() > 0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        sign();
        runs += 1;
      });
    });
    flushSync();
    setA(2);
    flushSync();
    expect(runs).toBe(1);
    setA(-1);
    flushSync();
    expect(runs).toBe(2);
  });

  it("[G-2b] equality cut-off along a three-memo chain stops at the first equal link", () => {
    const [a, setA] = useSignal(1);
    const m1 = useMemo(() => a() > 0);
    const m2 = useMemo(() => m1());
    const m3 = useMemo(() => (m2() ? "pos" : "neg"));
    let runs = 0;
    root(() => {
      useEffect(() => {
        m3();
        runs += 1;
      });
    });
    flushSync();
    setA(5);
    flushSync();
    expect(runs).toBe(1);
    setA(-5);
    flushSync();
    expect(runs).toBe(2);
  });

  it("[G-2c] equals:false memo propagates a recomputed but equal value", () => {
    const [a, setA] = useSignal(1);
    const sign = useMemo(() => a() > 0, { equals: false });
    let runs = 0;
    root(() => {
      useEffect(() => {
        sign();
        runs += 1;
      });
    });
    flushSync();
    setA(2);
    flushSync();
    expect(runs).toBe(2);
  });

  it("[G-2d] equals:false signal notifies its memo on every write, and an equal memo cuts off", () => {
    const [s, setS] = useSignal(0, { equals: false });
    const big = useMemo(() => s() > 100);
    let runs = 0;
    root(() => {
      useEffect(() => {
        big();
        runs += 1;
      });
    });
    flushSync();
    setS(0);
    setS(0);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[G-4a] a dependency discovered in a dirty branch is refreshed before its reader finishes", () => {
    const [flag, setFlag] = useSignal(false);
    const [s, setS] = useSignal(1);
    const inner = useMemo(() => s() * 10);
    const outer = useMemo(() => (flag() ? inner() : -1));
    const seen: number[] = [];
    root(() => {
      useEffect(() => {
        seen.push(outer());
      });
    });
    flushSync();
    batch(() => {
      setS(2);
      setFlag(true);
    });
    flushSync();
    expect(seen).toEqual([-1, 20]);
  });

  it("[G-3a] dynamic dependencies: after a branch flip the untaken signal no longer re-runs", () => {
    const [flag, setFlag] = useSignal(true);
    const [a, setA] = useSignal(0);
    const [b, setB] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
        if (flag()) a();
        else b();
      });
    });
    flushSync();
    setB(1);
    flushSync();
    expect(runs).toBe(1);
    setFlag(false);
    flushSync();
    expect(runs).toBe(2);
    setA(1);
    flushSync();
    expect(runs).toBe(2);
    setB(2);
    flushSync();
    expect(runs).toBe(3);
  });

  it("[G-3b] 1000 branch flips keep the subscription set exact on every run", () => {
    const [flag, setFlag] = useSignal(true);
    const [a, setA] = useSignal(0);
    const [b, setB] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
        if (flag()) a();
        else b();
      });
    });
    flushSync();
    for (let i = 1; i <= 1000; i += 1) {
      setFlag(i % 2 === 0);
      flushSync();
    }
    expect(runs).toBe(1001);
    const before = runs;
    setB(1);
    flushSync();
    expect(runs).toBe(before);
    setA(1);
    flushSync();
    expect(runs).toBe(before + 1);
  });

  it("[G-12a] reordering reads between runs keeps every edge alive", () => {
    const [flag, setFlag] = useSignal(true);
    const [a, setA] = useSignal(0);
    const [b, setB] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
        if (flag()) {
          a();
          b();
        } else {
          b();
          a();
        }
      });
    });
    flushSync();
    setFlag(false);
    flushSync();
    const afterFlip = runs;
    setA(1);
    flushSync();
    setB(1);
    flushSync();
    expect(runs).toBe(afterFlip + 2);
  });

  it("[G-13a] a signal read only on the first run is dropped once a later run stops reading it", () => {
    const [s, setS] = useSignal(0);
    let first = true;
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
        if (first) {
          first = false;
          s();
        }
      });
    });
    flushSync();
    expect(runs).toBe(1);
    setS(1);
    flushSync();
    expect(runs).toBe(2);
    setS(2);
    flushSync();
    expect(runs).toBe(2);
  });

  it("[G-5a] N writes inside a batch cause one effect run with the final value", () => {
    const [s, setS] = useSignal(0);
    const seen: number[] = [];
    root(() => {
      useEffect(() => {
        seen.push(s());
      });
    });
    flushSync();
    batch(() => {
      for (let i = 1; i <= 100; i += 1) setS(i);
    });
    expect(seen).toEqual([0, 100]);
  });

  it("[G-5b] write-then-revert inside a batch runs the effect at most once (policy pin)", () => {
    const [s, setS] = useSignal(1);
    let runs = 0;
    root(() => {
      useEffect(() => {
        s();
        runs += 1;
      });
    });
    flushSync();
    const before = runs;
    batch(() => {
      setS(2);
      setS(1);
    });
    flushSync();
    expect(runs - before).toBeLessThanOrEqual(1);
  });

  it("[G-5c] equals:false writes inside a batch still produce one run", () => {
    const [s, setS] = useSignal(0, { equals: false });
    let runs = 0;
    root(() => {
      useEffect(() => {
        s();
        runs += 1;
      });
    });
    flushSync();
    batch(() => {
      setS(0);
      setS(0);
      setS(0);
    });
    flushSync();
    expect(runs).toBe(2);
  });

  it("[G-14a] an unobserved lazy memo recomputes exactly once after many writes", () => {
    const [s, setS] = useSignal(0);
    let computes = 0;
    const m = useMemo(
      () => {
        computes += 1;
        return s() * 2;
      },
      { lazy: true },
    );
    for (let i = 1; i <= 100; i += 1) setS(i);
    expect(computes).toBe(0);
    expect(m()).toBe(200);
    expect(computes).toBe(1);
    expect(m()).toBe(200);
    expect(computes).toBe(1);
  });

  it("[P-1] random graphs with dynamic branches match a naive evaluator and stay glitch-free", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const rand = prng(seed);
      const SIGNALS = 4;
      const MEMOS = 30;
      const picks: Array<[number, number]> = [];
      for (let i = 0; i < MEMOS; i += 1) {
        picks.push([Math.floor(rand() * (SIGNALS + i)), Math.floor(rand() * (SIGNALS + i))]);
      }
      const step = (vp: number, vq: number): number =>
        vp % 2 === 0 ? (vq + 1) % 1000 : (vp * 2) % 1000;
      const naive = (signals: number[]): number[] => {
        const all = [...signals];
        for (const [p, q] of picks) all.push(step(all[p] ?? 0, all[q] ?? 0));
        return all;
      };
      const reads: Array<() => number> = [];
      const writes: Array<(value: number) => unknown> = [];
      for (let i = 0; i < SIGNALS; i += 1) {
        const [read, write] = useSignal(0);
        reads.push(read);
        writes.push(write);
      }
      const memos: Array<() => number> = [];
      const read = (j: number): number =>
        j < SIGNALS ? (reads[j]?.() ?? 0) : (memos[j - SIGNALS]?.() ?? 0);
      for (let i = 0; i < MEMOS; i += 1) {
        const [p, q] = picks[i] ?? [0, 0];
        memos.push(
          useMemo(() => {
            const vp = read(p);
            return vp % 2 === 0 ? (read(q) + 1) % 1000 : (vp * 2) % 1000;
          }),
        );
      }
      const mismatches: string[] = [];
      root(() => {
        useEffect(() => {
          const expected = naive(reads.map((r) => r()));
          memos.forEach((m, i) => {
            if (m() !== expected[SIGNALS + i]) mismatches.push(`seed ${seed} memo ${i}`);
          });
        });
      });
      flushSync();
      for (let round = 0; round < 12; round += 1) {
        const count = 1 + Math.floor(rand() * 3);
        batch(() => {
          for (let k = 0; k < count; k += 1) {
            writes[Math.floor(rand() * SIGNALS)]?.(Math.floor(rand() * 5));
          }
        });
        flushSync();
        const expected = naive(reads.map((r) => r()));
        memos.forEach((m, i) => {
          expect(m(), `seed ${seed} round ${round} memo ${i}`).toBe(expected[SIGNALS + i]);
        });
      }
      expect(mismatches).toEqual([]);
    }
  });
});

describe("cycles and writes inside memos", () => {
  it("[G-7a] a memo that reads itself throws CYCLE_DETECTED instead of overflowing", () => {
    const [s, setS] = useSignal(0);
    const ref: { read?: () => number } = {};
    const m = useMemo(
      () => {
        s();
        return ref.read === undefined ? 0 : ref.read();
      },
      { lazy: true },
    );
    expect(m()).toBe(0);
    ref.read = m;
    setS(1);
    expect(codeOf(errorOf(() => m()))).toBe("CYCLE_DETECTED");
  });

  it("[G-7b] an indirect memo cycle A to B to A throws CYCLE_DETECTED", () => {
    const [s, setS] = useSignal(0);
    const refs: { a?: () => number; b?: () => number } = {};
    const a = useMemo(
      () => {
        const v = s();
        return refs.b === undefined ? v : refs.b() + v;
      },
      { lazy: true },
    );
    const b = useMemo(
      () => {
        const v = s();
        return refs.a === undefined ? v : refs.a() + v;
      },
      { lazy: true },
    );
    expect(a()).toBe(0);
    expect(b()).toBe(0);
    refs.a = a;
    refs.b = b;
    setS(1);
    expect(codeOf(errorOf(() => a()))).toBe("CYCLE_DETECTED");
  });

  it("[G-7c] a cycle hit by an effect is routed to the owner's onError handler", () => {
    const [s, setS] = useSignal(0);
    const ref: { read?: () => number } = {};
    const m = useMemo(
      () => {
        s();
        return ref.read === undefined ? 0 : ref.read();
      },
      { lazy: true },
    );
    expect(m()).toBe(0);
    ref.read = m;
    setS(1);
    const codes: unknown[] = [];
    root(() => {
      onError((e) => {
        codes.push(codeOf(e));
      });
      useEffect(() => {
        m();
      });
    });
    flushSync();
    expect(codes).toEqual(["CYCLE_DETECTED"]);
  });

  it("[G-7d] a cycle does not disturb an unrelated part of the graph", () => {
    const [s, setS] = useSignal(0);
    const ref: { read?: () => number } = {};
    const cyclic = useMemo(
      () => {
        s();
        return ref.read === undefined ? 0 : ref.read();
      },
      { lazy: true },
    );
    expect(cyclic()).toBe(0);
    ref.read = cyclic;
    const other = useMemo(() => s() + 100);
    setS(1);
    expect(codeOf(errorOf(() => cyclic()))).toBe("CYCLE_DETECTED");
    expect(other()).toBe(101);
    setS(2);
    expect(other()).toBe(102);
  });

  it("[G-9a] a signal written inside a memo throws WRITE_IN_MEMO and the write does not happen", () => {
    const [s, setS] = useSignal(0);
    const m = useMemo(
      () => {
        setS(1);
        return 0;
      },
      { lazy: true },
    );
    expect(codeOf(errorOf(() => m()))).toBe("WRITE_IN_MEMO");
    expect(s()).toBe(0);
    setS(5);
    expect(s()).toBe(5);
  });

  it("[G-9b] a render effect created inside a memo may write from its apply (effect context)", () => {
    // Regression (fixed): apply runs with rt.running still pointing at the enclosing memo, so a legal effect
    // write is reported as WRITE_IN_MEMO. Expected: apply is an effect context and may write.
    const [a] = useSignal(1);
    const [b, setB] = useSignal(0);
    const m = useMemo(
      () => {
        useRenderEffect(
          () => a(),
          (v) => {
            setB(v);
          },
        );
        return 0;
      },
      { lazy: true },
    );
    expect(() => m()).not.toThrow();
    expect(b()).toBe(1);
  });
});

describe("scale (100k-deep chains, wide graphs, owner trees)", () => {
  it("[G-10a] a 100,000-deep memo chain is built, written and flushed without overflow", () => {
    const N = 100_000;
    const [head, setHead] = useSignal(0);
    let tail: () => number = head;
    for (let i = 0; i < N; i += 1) {
      const prev = tail;
      tail = useMemo(() => prev() + 1);
    }
    let seen = -1;
    root(() => {
      useEffect(() => {
        seen = tail();
      });
    });
    flushSync();
    expect(seen).toBe(N);
    setHead(1);
    flushSync();
    expect(seen).toBe(N + 1);
  });

  it("[G-10b] a 100,000-deep chain read in the middle of a batch", () => {
    const N = 100_000;
    const [head, setHead] = useSignal(0);
    let tail: () => number = head;
    for (let i = 0; i < N; i += 1) {
      const prev = tail;
      tail = useMemo(() => prev() + 1);
    }
    batch(() => {
      setHead(10);
      expect(tail()).toBe(N + 10);
    });
  });

  it("[G-10c] 100,000 memos fan out from one signal and are all refreshed", () => {
    const N = 100_000;
    const [s, setS] = useSignal(0);
    const memos: Array<() => number> = [];
    for (let i = 0; i < N; i += 1) memos.push(useMemo(() => s() + i));
    let total = -1;
    root(() => {
      useEffect(() => {
        let sum = 0;
        for (const m of memos) sum += m();
        total = sum;
      });
    });
    flushSync();
    expect(total).toBe((N * (N - 1)) / 2);
    setS(1);
    flushSync();
    expect(total).toBe((N * (N - 1)) / 2 + N);
  });

  it("[G-10d] a 10,000-wide fan-in recomputes only when a leaf really changes", () => {
    const N = 10_000;
    const reads: Array<() => number> = [];
    const writes: Array<(value: number) => unknown> = [];
    for (let i = 0; i < N; i += 1) {
      const [read, write] = useSignal(0);
      reads.push(read);
      writes.push(write);
    }
    const leaves = reads.map((r) => useMemo(() => r() % 2));
    let fanRuns = 0;
    const count = useMemo(() => {
      fanRuns += 1;
      let sum = 0;
      for (const leaf of leaves) sum += leaf();
      return sum;
    });
    const seen: number[] = [];
    root(() => {
      useEffect(() => {
        seen.push(count());
      });
    });
    flushSync();
    writes[0]?.(2);
    flushSync();
    expect(fanRuns).toBe(1);
    writes[0]?.(3);
    flushSync();
    expect(fanRuns).toBe(2);
    expect(seen).toEqual([0, 1]);
  });

  it("[G-10e] a 300-deep chain where every node also reads the head signal (eager path)", () => {
    const [head, setHead] = useSignal(0);
    let tail: () => number = head;
    for (let i = 0; i < 300; i += 1) {
      const prev = tail;
      tail = useMemo(() => head() + prev());
    }
    setHead(1);
    let expected = 1;
    for (let i = 0; i < 300; i += 1) expected = 1 + expected;
    expect(tail()).toBe(expected);
  });

  it("[G-10f] a 100,000-deep owner tree is disposed without recursion", () => {
    const N = 100_000;
    let cleaned = 0;
    let parent: Owner | null = null;
    let disposeTop: () => void = () => undefined;
    for (let i = 0; i < N; i += 1) {
      const level: { dispose: () => void; owner: Owner | null } = runWithOwner(parent, () =>
        createRoot((dispose) => {
          onCleanup(() => {
            cleaned += 1;
          });
          return { owner: getOwner(), dispose };
        }),
      );
      if (i === 0) disposeTop = level.dispose;
      parent = level.owner;
    }
    disposeTop();
    expect(cleaned).toBe(N);
  });

  it("[G-10g] a 900-step cascade of effects that each write the next completes in one flush", () => {
    const N = 900;
    const reads: Array<() => number> = [];
    const writes: Array<(value: number) => unknown> = [];
    for (let i = 0; i <= N; i += 1) {
      const [read, write] = useSignal(0);
      reads.push(read);
      writes.push(write);
    }
    root(() => {
      for (let i = 0; i < N; i += 1) {
        const read = reads[i];
        const write = writes[i + 1];
        if (read === undefined || write === undefined) throw new Error("missing cell");
        useEffect(() => {
          write(read() + 1);
        });
      }
    });
    flushSync();
    writes[0]?.(10);
    flushSync();
    expect(reads[N]?.()).toBe(10 + N);
  });

  it("[G-23a] 50,000 effects on one signal each run once per write", () => {
    const N = 50_000;
    const [s, setS] = useSignal(0);
    let total = 0;
    root(() => {
      for (let i = 0; i < N; i += 1) {
        useEffect(() => {
          s();
          total += 1;
        });
      }
    });
    flushSync();
    expect(total).toBe(N);
    setS(1);
    flushSync();
    expect(total).toBe(2 * N);
  });

  it("[G-23b] 50,000 effects on one signal written inside one batch run once each", () => {
    const N = 50_000;
    const [s, setS] = useSignal(0);
    let total = 0;
    root(() => {
      for (let i = 0; i < N; i += 1) {
        useEffect(() => {
          s();
          total += 1;
        });
      }
    });
    flushSync();
    batch(() => {
      setS(2);
      setS(3);
      setS(4);
    });
    expect(total).toBe(2 * N);
  });
});

describe("loop guard and bounded flushing", () => {
  it("[G-8a] a user effect that keeps writing its own dependency aborts with INFINITE_LOOP", () => {
    const [s, setS] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
        // Runaway guard so a broken engine cannot hang the worker.
        if (runs > 5000) throw new Error("runaway: loop guard never fired");
        setS(s() + 1);
      });
    });
    expect(codeOf(errorOf(() => flushSync()))).toBe("INFINITE_LOOP");
    expect(runs).toBeLessThan(1100);
  });

  it("[G-8b] after an INFINITE_LOOP abort the effect re-runs on the next external write", () => {
    // Regression (fixed): the loop guard clears the queues but leaves the effect DIRTY and unqueued, so
    // every later notification is swallowed by the `previous >= next` early return in stale().
    const [s, setS] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
        const v = s();
        if (v >= 0) setS(v + 1);
      });
    });
    expect(codeOf(errorOf(() => flushSync()))).toBe("INFINITE_LOOP");
    const before = runs;
    setS(-1);
    flushSync();
    expect(runs).toBe(before + 1);
  });

  it("[G-8c] a render effect whose apply keeps writing its own dependency aborts with INFINITE_LOOP", () => {
    // Regression (fixed): render-queue draining has no pass counter, so the loop never reaches the guard.
    // The runs counter ends the loop so the worker cannot hang.
    const [s, setS] = useSignal(0);
    let runs = 0;
    root(() => {
      useRenderEffect(
        () => s(),
        (v) => {
          runs += 1;
          if (runs > 5000) throw new Error("runaway: render loop guard never fired");
          setS(v + 1);
        },
      );
    });
    expect(codeOf(errorOf(() => flushSync()))).toBe("INFINITE_LOOP");
    expect(runs).toBeLessThan(1100);
  });
});

describe("ordering: render before user, parent before child, siblings by creation", () => {
  it("[G-16a] render effects run before user effects in the same flush, even if created later", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        log.push(`user:${s()}`);
      });
      useRenderEffect(
        () => s(),
        (v) => {
          log.push(`render:${v}`);
        },
      );
    });
    flushSync();
    setS(1);
    flushSync();
    expect(log).toEqual(["render:0", "user:0", "render:1", "user:1"]);
  });

  it("[G-16b] siblings run in creation order", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        log.push(`A${s()}`);
      });
      useEffect(() => {
        log.push(`B${s()}`);
      });
      useEffect(() => {
        log.push(`C${s()}`);
      });
    });
    flushSync();
    log.length = 0;
    setS(1);
    flushSync();
    expect(log).toEqual(["A1", "B1", "C1"]);
  });

  it("[G-16c] a parent runs before its child, and the child sees the parent's fresh value", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        const v = s();
        log.push(`parent:${v}`);
        useEffect(() => {
          log.push(`child:${v}:${s()}`);
        });
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(log).toEqual(["parent:0", "child:0:0", "parent:1", "child:1:1"]);
  });

  it("[G-16d] a shallower writer runs first, so the deeper reader runs once with the final value", () => {
    const [trigger, setTrigger] = useSignal(0);
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      createRoot(() => {
        useEffect(() => {
          log.push(`deep:${s()}`);
        });
      });
      useEffect(() => {
        if (trigger() === 1) {
          setS(10);
          log.push("shallow");
        }
      });
    });
    flushSync();
    log.length = 0;
    batch(() => {
      setS(5);
      setTrigger(1);
    });
    flushSync();
    expect(log).toEqual(["shallow", "deep:10"]);
  });

  it("[G-16e] an effect that writes a signal read by an already-run earlier reader re-runs it", () => {
    const [x, setX] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        log.push(`reader:${x()}`);
      });
      useEffect(() => {
        log.push("writer");
        setX(5);
      });
    });
    flushSync();
    expect(log).toEqual(["reader:0", "writer", "reader:5"]);
  });

  it("[G-16f] a writer created before its reader leaves the reader one run with the new value", () => {
    const [x, setX] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        log.push("writer");
        setX(5);
      });
      useEffect(() => {
        log.push(`reader:${x()}`);
      });
    });
    flushSync();
    expect(log).toEqual(["writer", "reader:5"]);
  });

  it("[G-18a] a child re-created by a parent re-run: old cleanup first, new child once, fresh values", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        const v = s();
        log.push(`parent:${v}`);
        useEffect(() => {
          log.push(`child:${v}`);
          onCleanup(() => {
            log.push(`cleanup-child:${v}`);
          });
        });
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(log).toEqual(["parent:0", "child:0", "cleanup-child:0", "parent:1", "child:1"]);
  });

  it("[G-19a] an effect created during a flush runs within the same flushSync call", () => {
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        log.push("outer");
        useEffect(() => {
          log.push("inner");
        });
      });
    });
    flushSync();
    expect(log).toEqual(["outer", "inner"]);
  });

  it("[G-19b] an earlier effect disposing a later sibling in the same flush stops it", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    let killSecond: () => void = () => undefined;
    root(() => {
      useEffect(() => {
        const v = s();
        log.push(`A${v}`);
        if (v === 1) killSecond();
      });
      killSecond = createRoot((dispose) => {
        useEffect(() => {
          log.push(`B${s()}`);
        });
        return dispose;
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(log).toEqual(["A0", "B0", "A1"]);
  });

  it("[G-19c] an effect disposed between its queueing and the flush never runs", () => {
    const [s, setS] = useSignal(0);
    let runs = 0;
    const dispose = root(() => {
      useEffect(() => {
        s();
        runs += 1;
      });
    });
    flushSync();
    setS(1);
    dispose();
    flushSync();
    setS(2);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[G-17a] Show-like: a child effect never runs with the null condition (effect form)", () => {
    const [item, setItem] = useSignal<{ name: string } | null>({ name: "a" });
    const names: string[] = [];
    let zombies = 0;
    root(() => {
      useEffect(() => {
        if (item() === null) return;
        useEffect(() => {
          const current = item();
          if (current === null) zombies += 1;
          else names.push(current.name);
        });
      });
    });
    flushSync();
    setItem(null);
    flushSync();
    expect(zombies).toBe(0);
    expect(names).toEqual(["a"]);
  });

  it("[G-17b] Show-like: a child memo never recomputes with the null condition (memo form)", () => {
    const [item, setItem] = useSignal<{ name: string } | null>({ name: "a" });
    const names: string[] = [];
    let zombies = 0;
    root(() => {
      useEffect(() => {
        if (item() === null) return;
        const name = useMemo(() => {
          const current = item();
          if (current === null) {
            zombies += 1;
            return "";
          }
          return current.name;
        });
        useEffect(() => {
          names.push(name());
        });
      });
    });
    flushSync();
    setItem(null);
    flushSync();
    expect(zombies).toBe(0);
    expect(names).toEqual(["a"]);
  });

  it("[G-17c] a non-descendant effect reading a child-owned memo never sees the null condition", () => {
    // The reader is an effect created before the owner, so it runs first in the same pass
    // and pulls the child memo while its owner has not been disposed yet. The memo then throws
    // a TypeError. The zombie guard only covers the owner-child effect path.
    const [item, setItem] = useSignal<{ name: string } | null>({ name: "a" });
    const [tick, setTick] = useSignal(0);
    const seen: string[] = [];
    let childName: () => string = () => "init";
    root(() => {
      // Created first, so it is not a descendant of the owner below.
      useEffect(() => {
        tick();
        seen.push(childName());
      });
      useEffect(() => {
        if (item() === null) return;
        childName = useMemo(() => (item() as { name: string }).name);
      });
    });
    flushSync();
    // Make the reader subscribe to the child memo, which only exists after the first flush.
    setTick(1);
    flushSync();
    expect(seen).toEqual(["init", "a"]);
    setItem(null);
    expect(() => flushSync()).not.toThrow();
    expect(seen).toEqual(["init", "a"]);
  });

  it("[G-24a] onMount runs once after the flush and never on signal changes", () => {
    const [s, setS] = useSignal(0);
    let mounts = 0;
    root(() => {
      onMount(() => {
        mounts += 1;
      });
      useEffect(() => {
        s();
      });
    });
    expect(mounts).toBe(0);
    flushSync();
    expect(mounts).toBe(1);
    setS(1);
    flushSync();
    expect(mounts).toBe(1);
  });

  it("[G-24b] the onMount cleanup runs when the owner is disposed", () => {
    let unmounts = 0;
    const dispose = root(() => {
      onMount(() => () => {
        unmounts += 1;
      });
    });
    flushSync();
    expect(unmounts).toBe(0);
    dispose();
    expect(unmounts).toBe(1);
  });

  it("[G-25a] writes after an await coalesce into one microtask flush", async () => {
    const [s, setS] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        s();
        runs += 1;
      });
    });
    flushSync();
    await Promise.resolve();
    setS(1);
    setS(2);
    setS(3);
    await Promise.resolve();
    expect(runs).toBe(2);
  });
});

describe("disposal: order, throwing cleanups, re-entrancy, zombies", () => {
  it("[O-1a] children are disposed first, then cleanups newest first", () => {
    const log: string[] = [];
    const dispose = root(() => {
      onCleanup(() => log.push("root-1"));
      onCleanup(() => log.push("root-2"));
      createRoot(() => {
        onCleanup(() => log.push("child"));
        createRoot(() => onCleanup(() => log.push("grandchild")));
      });
      onCleanup(() => log.push("root-3"));
    });
    dispose();
    expect(log).toEqual(["grandchild", "child", "root-3", "root-2", "root-1"]);
  });

  it("[O-1b] sibling roots are disposed last-created first", () => {
    const log: string[] = [];
    const dispose = root(() => {
      createRoot(() => onCleanup(() => log.push("A")));
      createRoot(() => onCleanup(() => log.push("B")));
    });
    dispose();
    expect(log).toEqual(["B", "A"]);
  });

  it("[O-2a] a re-run runs the previous cleanup before the new run", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        const v = s();
        log.push(`run${v}`);
        onCleanup(() => {
          log.push(`cleanup${v}`);
        });
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(log).toEqual(["run0", "cleanup0", "run1"]);
  });

  it("[O-2b] disposing a child and then its parent runs the child cleanup exactly once", () => {
    let count = 0;
    let disposeInner: () => void = () => undefined;
    const disposeOuter = root(() => {
      disposeInner = createRoot((dispose) => {
        onCleanup(() => {
          count += 1;
        });
        return dispose;
      });
    });
    disposeInner();
    disposeOuter();
    expect(count).toBe(1);
  });

  it("[O-3a] cleanups run untracked: a signal read in a cleanup does not subscribe the effect", () => {
    const [s, setS] = useSignal(0);
    const [t, setT] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
        s();
        onCleanup(() => {
          t();
        });
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(runs).toBe(2);
    setT(1);
    flushSync();
    expect(runs).toBe(2);
  });

  it("[O-3b] a write from a cleanup during dispose is flushed by the end of dispose (implicit batch)", () => {
    // Cleanups run in an implicit batch: writes flush before dispose() returns.
    const [s, setS] = useSignal(0);
    let seen = -1;
    root(() => {
      useEffect(() => {
        seen = s();
      });
    });
    flushSync();
    const dispose = root(() => {
      onCleanup(() => {
        setS(1);
      });
    });
    dispose();
    expect(seen).toBe(1);
  });

  it("[O-3c] a memo that reads itself from its own cleanup keeps its value and dependency", () => {
    const [s, setS] = useSignal(1);
    const holder: { read?: () => number } = {};
    root(() => {
      holder.read = useMemo<number>(() => {
        s();
        onCleanup(() => {
          holder.read?.();
        });
        return s() * 2;
      });
    });
    expect(holder.read?.()).toBe(2);
    setS(2);
    expect(holder.read?.()).toBe(4);
    setS(3);
    expect(holder.read?.()).toBe(6);
  });

  it("[O-4a] a throwing cleanup does not stop the others, and its error is routed to onError", () => {
    const ran: string[] = [];
    const handled: unknown[] = [];
    const err = new Error("cleanup");
    const dispose = root(() => {
      onError((e) => {
        handled.push(e);
      });
      onCleanup(() => {
        ran.push("a");
      });
      onCleanup(() => {
        throw err;
      });
      onCleanup(() => {
        ran.push("c");
      });
    });
    expect(() => dispose()).not.toThrow();
    expect(ran).toEqual(["c", "a"]);
    expect(handled).toEqual([err]);
  });

  it("[O-4b] a throwing cleanup with no handler is rethrown after every cleanup ran", () => {
    const ran: string[] = [];
    const err = new Error("cleanup");
    const dispose = root(() => {
      onCleanup(() => {
        ran.push("a");
      });
      onCleanup(() => {
        throw err;
      });
    });
    expect(errorOf(() => dispose())).toBe(err);
    expect(ran).toEqual(["a"]);
  });

  it("[O-4c] a throwing cleanup never fires again on a second dispose", () => {
    const err = new Error("once");
    let fires = 0;
    const dispose = root(() => {
      onCleanup(() => {
        fires += 1;
        throw err;
      });
    });
    expect(errorOf(() => dispose())).toBe(err);
    expect(() => dispose()).not.toThrow();
    expect(fires).toBe(1);
  });

  it("[O-4d] several throwing cleanups aggregate into one AggregateError, newest first", () => {
    const e1 = new Error("first registered");
    const e2 = new Error("second registered");
    const dispose = root(() => {
      onCleanup(() => {
        throw e1;
      });
      onCleanup(() => {
        throw e2;
      });
    });
    const error = errorOf(() => dispose());
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([e2, e1]);
  });

  it("[O-5a] an owner disposed during its own effect run lets the run finish", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    let disposeMine: () => void = () => undefined;
    root(() => {
      disposeMine = createRoot((dispose) => {
        useEffect(() => {
          log.push(`run${s()}`);
          disposeMine();
          log.push("after");
        });
        return dispose;
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(log).toEqual(["run0", "after"]);
  });

  it("[O-5b] disposing from inside an own cleanup is re-entrant-safe", () => {
    let cleanups = 0;
    let dispose: () => void = () => undefined;
    dispose = root(() => {
      useEffect(() => {
        onCleanup(() => {
          cleanups += 1;
          dispose();
        });
      });
    });
    flushSync();
    expect(() => dispose()).not.toThrow();
    expect(cleanups).toBe(1);
  });

  it("[O-5c] a cleanup returned by an effect that disposed its own owner still runs", () => {
    // Regression (fixed): once the owner is disposed mid-run, settleEffect() still attaches the returned
    // cleanup to the dead node, and nothing ever runs it.
    const log: string[] = [];
    let disposeOwner: () => void = () => undefined;
    root(() => {
      disposeOwner = createRoot((dispose) => {
        useEffect(() => {
          disposeOwner();
          return () => {
            log.push("cleanup");
          };
        });
        return dispose;
      });
    });
    flushSync();
    expect(log).toEqual(["cleanup"]);
  });

  it("[O-5d] disposing twice is a no-op", () => {
    let count = 0;
    const dispose = root(() => {
      onCleanup(() => {
        count += 1;
      });
    });
    dispose();
    expect(() => dispose()).not.toThrow();
    expect(count).toBe(1);
  });

  it("[O-6a] a disposed memo serves its last value and never relinks", () => {
    const [s, setS] = useSignal(1);
    let m: () => number = () => -1;
    const dispose = root(() => {
      m = useMemo(() => s() * 2);
    });
    dispose();
    setS(5);
    expect(m()).toBe(2);
  });

  it("[O-6b] a memo that was dirty when its owner was disposed serves the old value", () => {
    const [s, setS] = useSignal(1);
    let m: () => number = () => -1;
    const dispose = root(() => {
      m = useMemo(() => s() * 2);
    });
    setS(5);
    dispose();
    expect(m()).toBe(2);
  });

  it("[O-7a] an attached child root is disposed with its parent; a detached one survives", () => {
    const [s, setS] = useSignal(0);
    let attachedRuns = 0;
    let detachedRuns = 0;
    const disposeParent = root(() => {
      createRoot(() => {
        useEffect(() => {
          s();
          attachedRuns += 1;
        });
      });
      createRoot(
        () => {
          useEffect(() => {
            s();
            detachedRuns += 1;
          });
        },
        { detached: true },
      );
    });
    flushSync();
    disposeParent();
    setS(1);
    flushSync();
    expect(attachedRuns).toBe(1);
    expect(detachedRuns).toBe(2);
  });

  it("[O-7b] a root whose body throws is disposed and the error is rethrown", () => {
    const err = new Error("body");
    let cleaned = 0;
    const error = errorOf(() =>
      createRoot(() => {
        onCleanup(() => {
          cleaned += 1;
        });
        throw err;
      }),
    );
    expect(error).toBe(err);
    expect(cleaned).toBe(1);
  });

  it("[O-7c] runWithOwner(null) detaches: onCleanup inside it warns and does nothing", () => {
    root(() => {
      runWithOwner(null, () => {
        onCleanup(() => undefined);
      });
    });
    expect(takeWarnings().some((w) => w.includes("NO_OWNER_CLEANUP"))).toBe(true);
  });

  it("[O-8a] runWithOwner with a disposed owner warns and runs the callback without an owner", () => {
    const captured: { owner: Owner | null } = { owner: null };
    const dispose = root(() => {
      captured.owner = getOwner();
    });
    dispose();
    let inner: Owner | null | undefined;
    runWithOwner(captured.owner, () => {
      inner = getOwner();
    });
    expect(inner).toBeNull();
    expect(takeWarnings().some((w) => w.includes("RUN_WITH_DISPOSED_OWNER"))).toBe(true);
  });

  it("[O-8b] getOwner() inside a cleanup is null", () => {
    const seen: Array<Owner | null> = [];
    const dispose = root(() => {
      onCleanup(() => {
        seen.push(getOwner());
      });
    });
    dispose();
    expect(seen).toEqual([null]);
  });

  it("[O-9a] a root created inside an effect is disposed when the effect re-runs", () => {
    const [s, setS] = useSignal(0);
    let cleaned = 0;
    let innerRuns = 0;
    root(() => {
      useEffect(() => {
        s();
        createRoot(() => {
          onCleanup(() => {
            cleaned += 1;
          });
          useEffect(() => {
            innerRuns += 1;
          });
        });
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(cleaned).toBe(1);
    expect(innerRuns).toBe(2);
  });

  it("[O-9b] a root created inside a memo is disposed when the memo recomputes", () => {
    const [s, setS] = useSignal(0);
    let disposed = 0;
    const m = useMemo(() => {
      const v = s();
      createRoot(() => {
        onCleanup(() => {
          disposed += 1;
        });
      });
      return v;
    });
    expect(m()).toBe(0);
    setS(1);
    expect(m()).toBe(1);
    expect(disposed).toBe(1);
  });

  it("[O-9c] a root created inside a cleanup has no owner, but its effects still run", () => {
    const [s, setS] = useSignal(0);
    let ran = 0;
    root(() => {
      useEffect(() => {
        s();
        onCleanup(() => {
          createRoot(() => {
            useEffect(() => {
              ran += 1;
            });
          });
        });
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(ran).toBe(1);
  });

  it("[G-15a] a memo created inside an effect is disposed when the effect re-runs", () => {
    const [s, setS] = useSignal(1);
    let memoRuns = 0;
    const seen: number[] = [];
    root(() => {
      useEffect(() => {
        const k = s();
        const inner = useMemo(() => {
          memoRuns += 1;
          return s() * 10 + k;
        });
        seen.push(inner());
      });
    });
    flushSync();
    setS(2);
    flushSync();
    expect(memoRuns).toBe(2);
    expect(seen).toEqual([11, 22]);
  });
});

describe("memos reading later memos, useEffect forms, scheduling", () => {
  it("[G-15b] a lazy memo that reads a memo created after it sees that memo", () => {
    const [s, setS] = useSignal(1);
    let later: (() => number) | undefined;
    const early = useMemo(() => (later === undefined ? -1 : later()), { lazy: true });
    later = useMemo(() => s() * 2);
    expect(early()).toBe(2);
    setS(5);
    expect(early()).toBe(10);
  });

  it("[E-y1] a deferred effect skips its first apply and receives the first value as previous", () => {
    const [s, setS] = useSignal(1);
    const seen: Array<[number, number | undefined]> = [];
    root(() => {
      useEffect(
        () => s(),
        (v, prev) => {
          seen.push([v, prev]);
        },
        { defer: true },
      );
    });
    flushSync();
    expect(seen).toEqual([]);
    setS(2);
    flushSync();
    expect(seen).toEqual([[2, 1]]);
  });

  it("[E-y2] the apply half of useEffect(deps, fn) is untracked", () => {
    const [a, setA] = useSignal(0);
    const [b, setB] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(
        () => a(),
        () => {
          runs += 1;
          b();
        },
      );
    });
    flushSync();
    setB(1);
    flushSync();
    expect(runs).toBe(1);
    setA(1);
    flushSync();
    expect(runs).toBe(2);
  });

  it("[G-21a] a write outside any batch is flushed by a microtask when nothing else runs", async () => {
    const [s, setS] = useSignal(0);
    let seen = -1;
    root(() => {
      useEffect(() => {
        seen = s();
      });
    });
    flushSync();
    setS(1);
    expect(seen).toBe(0);
    await Promise.resolve();
    expect(seen).toBe(1);
  });

  it("[G-21b] many writes schedule the microtask flush exactly once", async () => {
    const [s, setS] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        s();
        runs += 1;
      });
    });
    flushSync();
    for (let i = 1; i <= 10; i += 1) setS(i);
    await Promise.resolve();
    expect(runs).toBe(2);
  });

  it("[G-21c] flushSync with nothing pending is a no-op", () => {
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
      });
    });
    flushSync();
    expect(() => flushSync()).not.toThrow();
    expect(runs).toBe(1);
  });

  it("[G-21d] an error inside a microtask flush goes to reportError and does not wedge later flushes", async () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (error: unknown) => {
      reported.push(error);
    });
    const [s, setS] = useSignal(0);
    const err = new Error("micro");
    let seen = -1;
    root(() => {
      useEffect(() => {
        const v = s();
        if (v === 1) throw err;
        seen = v;
      });
    });
    flushSync();
    setS(1);
    await Promise.resolve();
    expect(reported).toEqual([err]);
    setS(2);
    await Promise.resolve();
    expect(seen).toBe(2);
  });

  it("[G-6c] flushSync inside a batch flushes early (underspecified; pinned as observed)", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        log.push(`run${s()}`);
      });
    });
    flushSync();
    batch(() => {
      setS(1);
      flushSync();
      log.push("mid");
      setS(2);
    });
    expect(log).toEqual(["run0", "run1", "mid", "run2"]);
  });

  it("[G-20a] flushSync inside an effect warns FLUSH_IN_EFFECT and leaves the work to the outer flush", () => {
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      useEffect(() => {
        const v = s();
        log.push(`a${v}`);
        if (v === 0) {
          flushSync(() => setS(1));
          log.push("after-flushSync");
        }
      });
      useEffect(() => {
        log.push(`b${s()}`);
      });
    });
    flushSync();
    expect(log).toEqual(["a0", "after-flushSync", "b1", "a1"]);
    expect(takeWarnings().some((w) => w.includes("FLUSH_IN_EFFECT"))).toBe(true);
  });

  it("[G-20b] nested batches: an inner throw is caught by the outer callback and effects run once", () => {
    const [a, setA] = useSignal(0);
    const [b, setB] = useSignal(0);
    const seen: string[] = [];
    root(() => {
      useEffect(() => {
        seen.push(`${a()}-${b()}`);
      });
    });
    flushSync();
    const inner = new Error("inner");
    let caught: unknown;
    batch(() => {
      setA(1);
      try {
        batch(() => {
          setB(1);
          throw inner;
        });
      } catch (error) {
        caught = error;
      }
      setA(2);
    });
    expect(caught).toBe(inner);
    expect(seen).toEqual(["0-0", "2-1"]);
  });

  it("[G-22a] flushSync returns the callback result and rethrows its error after flushing", () => {
    expect(flushSync(() => 42)).toBe(42);
    const [s, setS] = useSignal(0);
    let seen = -1;
    root(() => {
      useEffect(() => {
        seen = s();
      });
    });
    flushSync();
    const boom = new Error("callback");
    expect(
      errorOf(() =>
        flushSync(() => {
          setS(1);
          throw boom;
        }),
      ),
    ).toBe(boom);
    expect(seen).toBe(1);
  });

  it("[G-22b] a batch whose callback throws restores the batch depth (proved by a microtask flush)", async () => {
    const [s, setS] = useSignal(0);
    let seen = -1;
    root(() => {
      useEffect(() => {
        seen = s();
      });
    });
    flushSync();
    expect(
      errorOf(() =>
        batch(() => {
          throw new Error("x");
        }),
      ),
    ).toBeInstanceOf(Error);
    setS(7);
    await Promise.resolve();
    expect(seen).toBe(7);
  });

  it("[G-22c] a throwing batch callback still flushes its effects and keeps the error identity", () => {
    const [s, setS] = useSignal(0);
    const seen: number[] = [];
    root(() => {
      useEffect(() => {
        seen.push(s());
      });
    });
    flushSync();
    const cbError = new Error("cb");
    expect(
      errorOf(() =>
        batch(() => {
          setS(3);
          throw cbError;
        }),
      ),
    ).toBe(cbError);
    expect(seen).toEqual([0, 3]);
  });

  it("[G-22d] a batch callback and the flush that follows both throw: AggregateError with both", () => {
    const [s, setS] = useSignal(0);
    const effectError = new Error("effect");
    root(() => {
      useEffect(() => {
        if (s() === 1) throw effectError;
      });
    });
    flushSync();
    const cbError = new Error("cb");
    const error = errorOf(() =>
      batch(() => {
        setS(1);
        throw cbError;
      }),
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([cbError, effectError]);
  });
});

describe("errors: routing, caching, escalation, identity", () => {
  it("[E-1a] a memo error is cached: every reader gets the same error and nothing recomputes", () => {
    const [s, setS] = useSignal(0);
    let runs = 0;
    const err = new Error("memo");
    const m = useMemo(() => {
      runs += 1;
      if (s() === 1) throw err;
      return s();
    });
    setS(1);
    expect(errorOf(() => m())).toBe(err);
    expect(errorOf(() => m())).toBe(err);
    expect(errorOf(() => m())).toBe(err);
    expect(runs).toBe(2);
  });

  it("[E-1b] a memo error heals when its dependency changes again", () => {
    const [s, setS] = useSignal(0);
    const m = useMemo(() => {
      if (s() === 1) throw new Error("bad");
      return s();
    });
    setS(1);
    expect(codeOf(errorOf(() => m()))).toBeUndefined();
    setS(2);
    expect(m()).toBe(2);
  });

  it("[E-2a] an effect error is routed to the nearest onError handler", () => {
    const [s, setS] = useSignal(0);
    const err = new Error("effect");
    const handled: unknown[] = [];
    root(() => {
      onError((e) => {
        handled.push(e);
      });
      createRoot(() => {
        useEffect(() => {
          if (s() === 1) throw err;
        });
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(handled).toEqual([err]);
  });

  it("[E-2b] a handler that rethrows escalates the error to the next handler up", () => {
    const err = new Error("original");
    const rethrown = new Error("rethrown");
    const innerSeen: unknown[] = [];
    const outerSeen: unknown[] = [];
    root(() => {
      onError((e) => {
        outerSeen.push(e);
      });
      createRoot(() => {
        onError((e) => {
          innerSeen.push(e);
          throw rethrown;
        });
        useRenderEffect(() => {
          throw err;
        });
      });
    });
    expect(innerSeen).toEqual([err]);
    expect(outerSeen).toEqual([rethrown]);
  });

  it("[E-2c] an error thrown by a render effect's apply is routed to the owner", () => {
    const err = new Error("apply");
    const handled: unknown[] = [];
    root(() => {
      onError((e) => {
        handled.push(e);
      });
      useRenderEffect(
        () => 1,
        () => {
          throw err;
        },
      );
    });
    expect(handled).toEqual([err]);
  });

  it("[E-2d] with no handler, flushSync rethrows the effect's error itself", () => {
    const err = new Error("unhandled");
    root(() => {
      useEffect(() => {
        throw err;
      });
    });
    expect(errorOf(() => flushSync())).toBe(err);
  });

  it("[E-2e] one failing effect does not stop the others, and all of them ran", () => {
    const ran: string[] = [];
    const err = new Error("a");
    root(() => {
      useEffect(() => {
        throw err;
      });
      useEffect(() => {
        ran.push("b");
      });
    });
    expect(errorOf(() => flushSync())).toBe(err);
    expect(ran).toEqual(["b"]);
  });

  it("[E-2f] two failing effects in one flush surface as an AggregateError", () => {
    const e1 = new Error("one");
    const e2 = new Error("two");
    root(() => {
      useEffect(() => {
        throw e1;
      });
      useEffect(() => {
        throw e2;
      });
    });
    const error = errorOf(() => flushSync());
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([e1, e2]);
  });

  it("[E-2g] catchError catches a synchronous throw and returns undefined", () => {
    const err = new Error("sync");
    const handled: unknown[] = [];
    const result = catchError(
      () => {
        throw err;
      },
      (e) => {
        handled.push(e);
      },
    );
    expect(result).toBeUndefined();
    expect(handled).toEqual([err]);
  });

  it("[E-2h] catchError's scope handles errors from effects created inside it", () => {
    const err = new Error("scoped");
    const handled: unknown[] = [];
    catchError(
      () => {
        useEffect(() => {
          throw err;
        });
      },
      (e) => {
        handled.push(e);
      },
    );
    flushSync();
    expect(handled).toEqual([err]);
  });

  it("[E-2i] nested catchError: the inner handler's rethrow reaches the outer handler", () => {
    const err = new Error("source");
    const wrapped = new Error("wrapped");
    const outer: unknown[] = [];
    catchError(
      () => {
        catchError(
          () => {
            useEffect(() => {
              throw err;
            });
          },
          () => {
            throw wrapped;
          },
        );
      },
      (e) => {
        outer.push(e);
      },
    );
    flushSync();
    expect(outer).toEqual([wrapped]);
  });

  it("[E-6a] non-Error values keep their identity through a handler (undefined from an effect)", () => {
    let got: unknown = "unset";
    catchError(
      () => {
        useRenderEffect(() => {
          throw undefined;
        });
      },
      (e) => {
        got = e;
      },
    );
    expect(got).toBeUndefined();
  });

  it("[E-6b] a memo that throws null rethrows null to its reader", () => {
    const m = useMemo(
      () => {
        throw null;
      },
      { lazy: true },
    );
    expect(errorOf(() => m())).toBeNull();
  });

  it("[E-5a] a comparator that throws does not wedge the effect that reads the memo", () => {
    // Regression (fixed): a throw from settleMemo() leaves the reader in CHECK, and stale() only enqueues an
    // observer whose previous state is CLEAN. The effect is therefore never queued again.
    // The contract (reactivity.md E-5, issue #2837) requires the queue to keep working.
    const [s, setS] = useSignal(0);
    const seen: number[] = [];
    const m = useMemo(() => s(), {
      equals: (prev, next) => {
        if (next === 99) throw new Error("comparator");
        return Object.is(prev, next);
      },
    });
    root(() => {
      useEffect(() => {
        seen.push(m());
      });
    });
    flushSync();
    setS(99);
    expect(() => flushSync()).toThrow("comparator");
    setS(5);
    flushSync();
    expect(seen).toEqual([0, 5]);
  });

  it("[E-5b] a signal comparator that throws makes set() throw and leaves the value untouched", () => {
    const [s, setS] = useSignal(0, {
      equals: (a, b) => {
        if (b === 13) throw new Error("eq");
        return a === b;
      },
    });
    expect(() => setS(13)).toThrow("eq");
    expect(s()).toBe(0);
    setS(4);
    expect(s()).toBe(4);
  });

  it("[E-2j] a cleanup that throws during a re-run is routed, and the re-run still happens", () => {
    const [s, setS] = useSignal(0);
    const seen: number[] = [];
    const handled: unknown[] = [];
    const err = new Error("cleanup during rerun");
    root(() => {
      onError((e) => {
        handled.push(e);
      });
      useEffect(() => {
        const v = s();
        seen.push(v);
        onCleanup(() => {
          if (v === 0) throw err;
        });
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(seen).toEqual([0, 1]);
    expect(handled).toEqual([err]);
  });

  it("[E-2k] an effect reading a failing memo is routed, and recovers when the memo heals", () => {
    const [s, setS] = useSignal(0);
    const err = new Error("memo failed");
    const m = useMemo(() => {
      if (s() === 1) throw err;
      return s() * 10;
    });
    const seen: number[] = [];
    const handled: unknown[] = [];
    root(() => {
      onError((e) => {
        handled.push(e);
      });
      useEffect(() => {
        seen.push(m());
      });
    });
    flushSync();
    setS(1);
    flushSync();
    setS(2);
    flushSync();
    expect(handled).toEqual([err]);
    expect(seen).toEqual([0, 20]);
  });

  it("[E-2l] an onError registered in an effect body applies only to that run", () => {
    // Regression (fixed): handlers registered by onError() accumulate on the effect node across re-runs
    // (nothing clears owner.errorHandlers on recompute), so a stale handler from run 0 still
    // runs after the run-1 handler rethrows.
    const [s, setS] = useSignal(0);
    const log: string[] = [];
    root(() => {
      onError(() => {
        log.push("root");
      });
      useEffect(() => {
        const v = s();
        onError((e) => {
          log.push(`run${v}`);
          throw e;
        });
        throw new Error(`x${v}`);
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(log).toEqual(["run0", "root", "run1", "root"]);
  });

  it("[E-2m] a memo error that nobody reads is not reported at creation (underspecified)", () => {
    useMemo(() => {
      throw new Error("unread");
    });
    expect(() => flushSync()).not.toThrow();
  });

  it("[E-2n] an effect error raised by a batch's flush is thrown from batch() with the same identity", () => {
    const [s, setS] = useSignal(0);
    const err = new Error("batch flush");
    root(() => {
      useEffect(() => {
        if (s() === 1) throw err;
      });
    });
    flushSync();
    expect(errorOf(() => batch(() => setS(1)))).toBe(err);
  });
});

describe("signals: equality, updaters, function values", () => {
  it("[SIG-a] NaN written over NaN is no change (Object.is)", () => {
    const [s, setS] = useSignal(Number.NaN);
    let runs = 0;
    root(() => {
      useEffect(() => {
        s();
        runs += 1;
      });
    });
    flushSync();
    setS(Number.NaN);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[SIG-b] -0 and +0 are different values under Object.is", () => {
    const [s, setS] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        s();
        runs += 1;
      });
    });
    flushSync();
    setS(-0);
    flushSync();
    expect(runs).toBe(2);
  });

  it("[SIG-c] null to undefined is a change; undefined to undefined is not", () => {
    const [s, setS] = useSignal<string | null | undefined>(null);
    let runs = 0;
    root(() => {
      useEffect(() => {
        s();
        runs += 1;
      });
    });
    flushSync();
    setS(undefined);
    flushSync();
    setS(undefined);
    flushSync();
    expect(runs).toBe(2);
    expect(s()).toBeUndefined();
  });

  it("[SIG-d] a function-valued signal is written through an updater that receives the previous value", () => {
    const [fn, setFn] = useSignal<() => string>(() => "first");
    const second = () => "second";
    setFn(() => second);
    expect(fn()).toBe(second);
    setFn((prev) => () => `${prev()}!`);
    expect(fn()()).toBe("second!");
  });

  it("[SIG-e] an updater returning undefined stores undefined", () => {
    const [s, setS] = useSignal<number | undefined>(1);
    setS(() => undefined);
    expect(s()).toBeUndefined();
  });

  it("[SIG-f] an updater that throws leaves the value unchanged and the signal usable", () => {
    const [s, setS] = useSignal(1);
    expect(() =>
      setS(() => {
        throw new Error("updater");
      }),
    ).toThrow("updater");
    expect(s()).toBe(1);
    setS(2);
    expect(s()).toBe(2);
  });

  it("[SIG-g] an updater runs untracked: the effect that wrote it does not subscribe to what it read", () => {
    const [s, setS] = useSignal(0);
    const [u, setU] = useSignal(0);
    const [t, setT] = useSignal(0);
    let runs = 0;
    root(() => {
      useEffect(() => {
        runs += 1;
        u();
        setT(() => s() + 1);
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(runs).toBe(1);
    setU(1);
    flushSync();
    expect(runs).toBe(2);
    expect(t()).toBe(2);
  });

  it("[SIG-h] an updater inside a batch sees the value written by the previous updater", () => {
    const [n, setN] = useSignal(0);
    batch(() => {
      setN((x) => x + 1);
      setN((x) => x + 1);
      expect(n()).toBe(2);
    });
  });

  it("[SIG-i] a signal holding a function returns that same function and never calls it", () => {
    let calls = 0;
    const [fn, setFn] = useSignal<() => number>(() => 0);
    const f = () => {
      calls += 1;
      return 1;
    };
    setFn(() => f);
    expect(fn()).toBe(f);
    expect(calls).toBe(0);
  });
});

describe("selector, lists, props, context, ids, warnings", () => {
  it("[SEL-a] useSelector re-runs only the readers of the old and new key", () => {
    const [selected, setSelected] = useSignal(1);
    const runs = [0, 0, 0, 0];
    let isSel: (key: number) => boolean = () => false;
    root(() => {
      isSel = useSelector(selected);
      for (const key of [1, 2, 3]) {
        useEffect(() => {
          isSel(key);
          runs[key] = (runs[key] ?? 0) + 1;
        });
      }
    });
    flushSync();
    setSelected(2);
    flushSync();
    expect(runs).toEqual([0, 2, 2, 1]);
  });

  it("[SEL-b] useSelector outside a tracked context reads the source directly", () => {
    const [selected, setSelected] = useSignal(1);
    let isSel: (key: number) => boolean = () => false;
    root(() => {
      isSel = useSelector(selected);
    });
    setSelected(2);
    expect(isSel(2)).toBe(true);
    expect(isSel(1)).toBe(false);
  });

  it("[SEL-c] NaN never matches in useSelector (=== semantics, documented)", () => {
    let isSel: (key: number) => boolean = () => true;
    root(() => {
      isSel = useSelector(() => Number.NaN);
    });
    expect(isSel(Number.NaN)).toBe(false);
  });

  it("[SEL-d] a custom comparator that throws for one key still updates the other keys", () => {
    const [v, setV] = useSignal(1);
    const err = new Error("comparator");
    const handled: unknown[] = [];
    const out: boolean[] = [false, false];
    root(() => {
      onError((e) => {
        handled.push(e);
      });
      const isSel = useSelector(v, (key, value) => {
        if (key === 0 && value === 9) throw err;
        return key === value;
      });
      for (const key of [0, 1]) {
        useEffect(() => {
          out[key] = isSel(key);
        });
      }
    });
    flushSync();
    expect(out).toEqual([false, true]);
    setV(9);
    flushSync();
    expect(handled).toEqual([err]);
    expect(out[1]).toBe(false);
  });

  it("[LIST-a] keyed mapArray: a new object under the same key updates item() without a rebuild", () => {
    const [list, setList] = useSignal([
      { id: 1, label: "a" },
      { id: 2, label: "b" },
    ]);
    let builds = 0;
    let rows: () => Array<{ read: () => { id: number; label: string } }> = () => [];
    root(() => {
      rows = mapArray(
        list,
        (item) => {
          builds += 1;
          return { read: item };
        },
        { key: (x) => x.id },
      );
    });
    expect(rows()).toHaveLength(2);
    expect(builds).toBe(2);
    setList([
      { id: 1, label: "A" },
      { id: 2, label: "b" },
    ]);
    expect(rows()[0]?.read().label).toBe("A");
    expect(builds).toBe(2);
  });

  it("[LIST-b] keyed mapArray reversal moves rows without building new ones", () => {
    const [list, setList] = useSignal([{ id: 1 }, { id: 2 }]);
    let builds = 0;
    let rows: () => Array<{ id: number }> = () => [];
    root(() => {
      rows = mapArray(
        list,
        (item) => {
          builds += 1;
          return item();
        },
        { key: (x) => x.id },
      );
    });
    rows();
    setList([{ id: 2 }, { id: 1 }]);
    expect(rows().map((r) => r.id)).toEqual([2, 1]);
    expect(builds).toBe(2);
  });

  it("[LIST-c] removed rows are disposed, and disposing the owner disposes the rest", () => {
    const [list, setList] = useSignal([1, 2, 3]);
    let disposed = 0;
    let rows: () => number[] = () => [];
    const dispose = root(() => {
      rows = mapArray(list, (item) => {
        onCleanup(() => {
          disposed += 1;
        });
        return item;
      });
    });
    expect(rows()).toHaveLength(3);
    setList([1, 3]);
    expect(rows()).toEqual([1, 3]);
    expect(disposed).toBe(1);
    dispose();
    expect(disposed).toBe(3);
  });

  it("[LIST-d] duplicate keys warn once, and later copies are rebuilt on every update", () => {
    const [list, setList] = useSignal([{ id: 1 }, { id: 1 }, { id: 2 }]);
    let builds = 0;
    let rows: () => unknown[] = () => [];
    root(() => {
      rows = mapArray(
        list,
        (item) => {
          builds += 1;
          return item().id;
        },
        { key: (x) => x.id },
      );
    });
    rows();
    expect(builds).toBe(3);
    expect(takeWarnings().some((w) => w.includes("EACH_KEY_DUPLICATE"))).toBe(true);
    setList([{ id: 1 }, { id: 1 }, { id: 2 }]);
    rows();
    expect(builds).toBe(4);
  });

  it("[LIST-e] indexArray grows and shrinks by position and never rebuilds kept rows", () => {
    const [list, setList] = useSignal([1, 2, 3]);
    let builds = 0;
    let rows: () => Array<{ value: () => number }> = () => [];
    root(() => {
      rows = indexArray(list, (item) => {
        builds += 1;
        return { value: item };
      });
    });
    expect(rows()).toHaveLength(3);
    expect(builds).toBe(3);
    setList([9]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.value()).toBe(9);
    expect(builds).toBe(3);
    setList([9, 8, 7, 6]);
    expect(rows()).toHaveLength(4);
    expect(builds).toBe(6);
  });

  it("[LIST-f] the fallback is shown while empty, replaced when filled, and rebuilt when empty again", () => {
    const [list, setList] = useSignal<number[]>([]);
    let fallbacks = 0;
    let rows: () => number[] = () => [];
    root(() => {
      rows = mapArray(list, (x) => x, {
        fallback: () => {
          fallbacks += 1;
          return -1;
        },
      });
    });
    expect(rows()).toEqual([-1]);
    setList([5]);
    expect(rows()).toEqual([5]);
    setList([]);
    expect(rows()).toEqual([-1]);
    expect(fallbacks).toBe(2);
  });

  it("[LIST-g] a row whose build throws fails the update, and the previous rows survive", () => {
    const [list, setList] = useSignal([1, 2]);
    let rows: () => number[] = () => [];
    root(() => {
      rows = mapArray(list, (x) => {
        if (x === 3) throw new Error("bad row");
        return x * 10;
      });
    });
    expect(rows()).toEqual([10, 20]);
    setList([1, 3]);
    expect(() => rows()).toThrow("bad row");
    setList([1, 2]);
    expect(rows()).toEqual([10, 20]);
  });

  it("[LIST-h] a 10,000-row reversal keeps every row and builds nothing new", () => {
    const N = 10_000;
    const base = Array.from({ length: N }, (_, i) => ({ id: i }));
    const [list, setList] = useSignal(base);
    let builds = 0;
    let rows: () => Array<{ id: number }> = () => [];
    root(() => {
      rows = mapArray(
        list,
        (item) => {
          builds += 1;
          return item();
        },
        { key: (x) => x.id },
      );
    });
    rows();
    setList([...base].reverse());
    expect(rows()[0]?.id).toBe(N - 1);
    expect(builds).toBe(N);
  });

  it("[CTX-a] an inner provider shadows the outer value and the outer value returns after it", () => {
    const seen: string[] = [];
    root(() => {
      Theme({
        value: "outer",
        get children() {
          seen.push(useContext(Theme));
          Theme({
            value: "inner",
            get children() {
              seen.push(useContext(Theme));
              return undefined;
            },
          });
          seen.push(useContext(Theme));
          return undefined;
        },
      });
    });
    expect(seen).toEqual(["outer", "inner", "outer"]);
  });

  it("[CTX-b] a provider does not leak into its sibling", () => {
    const seen: string[] = [];
    root(() => {
      Theme({
        value: "dark",
        get children() {
          seen.push(useContext(Theme));
          return undefined;
        },
      });
      Theme({
        value: "blue",
        get children() {
          seen.push(useContext(Theme));
          return undefined;
        },
      });
      seen.push(useContext(Theme));
    });
    expect(seen).toEqual(["dark", "blue", "light"]);
  });

  it("[CTX-c] a missing context falls back to its default, or throws CONTEXT_MISSING without one", () => {
    expect(useContext(Theme)).toBe("light");
    expect(codeOf(errorOf(() => useContext(Level)))).toBe("CONTEXT_MISSING");
  });

  it("[CTX-d] an effect created inside a provider sees the provided value", () => {
    const values: string[] = [];
    root(() => {
      Theme({
        value: "p",
        get children() {
          useEffect(() => {
            values.push(useContext(Theme));
          });
          return undefined;
        },
      });
    });
    flushSync();
    expect(values).toEqual(["p"]);
  });

  it("[CTX-e] a context value is recovered after an await through runWithOwner", async () => {
    const captured: { owner: Owner | null } = { owner: null };
    const dispose = root(() => {
      Theme({
        value: "async",
        get children() {
          captured.owner = getOwner();
          return undefined;
        },
      });
    });
    await Promise.resolve();
    expect(runWithOwner(captured.owner, () => useContext(Theme))).toBe("async");
    dispose();
  });

  it("[CTX-f] a detached root inherits the context of the owner that created it", () => {
    let read = "";
    root(() => {
      Theme({
        value: "x",
        get children() {
          createRoot(
            () => {
              read = useContext(Theme);
            },
            { detached: true },
          );
          return undefined;
        },
      });
    });
    expect(read).toBe("x");
  });

  it("[ID-a] useId is identical for the same tree built twice", () => {
    const build = (): string[] => {
      const ids: string[] = [];
      createRoot(() => {
        ids.push(useId());
        createRoot(() => {
          ids.push(useId());
          ids.push(useId());
        });
        ids.push(useId());
      });
      return ids;
    };
    expect(build()).toEqual(build());
  });

  it("[ID-b] useId values of sibling roots are distinct", () => {
    const ids: string[] = [];
    createRoot(() => {
      createRoot(() => {
        ids.push(useId());
      });
      createRoot(() => {
        ids.push(useId());
      });
    });
    expect(new Set(ids).size).toBe(2);
  });

  it("[ID-e] useId values are valid CSS identifiers without escaping", () => {
    createRoot(() => {
      const id = useId();
      expect(id).toMatch(/^[A-Za-z][\w-]*$/);
    });
  });

  it("[ID-c] useId outside any owner throws NO_OWNER_ID", () => {
    expect(codeOf(errorOf(() => useId()))).toBe("NO_OWNER_ID");
  });

  it("[ID-d] useId restarts its sequence when the computation re-runs", () => {
    // Regression (fixed): owner.idCount is never reset in recompute(), so the second run of an effect gets
    // ":1" where the first run got ":0". Contract O-10 requires ids to reset on re-run.
    const [s, setS] = useSignal(0);
    const ids: string[] = [];
    root(() => {
      useEffect(() => {
        s();
        ids.push(useId());
      });
    });
    flushSync();
    setS(1);
    flushSync();
    expect(ids[1]).toBe(ids[0]);
  });

  it("[PROP-a] mergeProps: the right-most defined value wins and undefined falls through", () => {
    const merged = mergeProps({ a: 1, b: "x" }, { b: undefined, c: true }, { a: undefined });
    expect(merged.a).toBe(1);
    expect(merged.b).toBe("x");
    expect(merged.c).toBe(true);
  });

  it("[PROP-b] mergeProps re-reads a function source on every access", () => {
    const [s, setS] = useSignal(1);
    const merged = mergeProps(() => ({ v: s() }), { w: 2 });
    expect(merged.v).toBe(1);
    setS(2);
    expect(merged.v).toBe(2);
    expect(merged.w).toBe(2);
  });

  it("[PROP-c] mergeProps drops __proto__ keys and leaves Object.prototype intact", () => {
    const hostile: unknown = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    const merged = mergeProps(hostile as object);
    expect(Object.keys(merged)).toEqual(["ok"]);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("[PROP-d] splitProps: the rest object stays reactive and excludes the listed keys", () => {
    const [s, setS] = useSignal(1);
    const props = {
      get a() {
        return s();
      },
      b: 2,
    };
    const [own, rest] = splitProps(props, ["a"]);
    expect(own.a).toBe(1);
    expect(Object.keys(rest)).toEqual(["b"]);
    setS(5);
    expect(own.a).toBe(5);
  });

  it("[PROP-e] children flattens arrays and accessors, drops empties, and rejects a cyclic array", () => {
    const resolved = children(() => [1, [null, 2, [false, 3]], undefined, () => 4]);
    expect(resolved.toArray()).toEqual([1, 2, 3, 4]);
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    const broken = children(() => cyclic);
    expect(errorOf(() => broken())).toBeInstanceOf(TypeError);
    const selfish = (): unknown => selfish;
    const runaway = children(selfish);
    expect(errorOf(() => runaway())).toBeInstanceOf(TypeError);
  });

  it("[WARN-a] an effect outside any owner warns NO_OWNER_EFFECT and still runs", () => {
    let ran = 0;
    useEffect(() => {
      ran += 1;
    });
    flushSync();
    expect(ran).toBe(1);
    expect(takeWarnings().some((w) => w.includes("NO_OWNER_EFFECT"))).toBe(true);
  });

  it("[WARN-b] onCleanup and onError outside any owner each warn", () => {
    onCleanup(() => undefined);
    onError(() => undefined);
    const warnings = takeWarnings();
    expect(warnings.some((w) => w.includes("NO_OWNER_CLEANUP"))).toBe(true);
    expect(warnings.some((w) => w.includes("NO_OWNER_ERROR"))).toBe(true);
  });

  it("[ASYNC-a] an owner disposed during an await makes the continuation run without an owner", async () => {
    const captured: { owner: Owner | null } = { owner: null };
    const dispose = root(() => {
      captured.owner = getOwner();
    });
    const pending = Promise.resolve().then(() => {
      let inner: Owner | null | undefined;
      runWithOwner(captured.owner, () => {
        inner = getOwner();
      });
      return inner;
    });
    dispose();
    expect(await pending).toBeNull();
    expect(takeWarnings().some((w) => w.includes("RUN_WITH_DISPOSED_OWNER"))).toBe(true);
  });

  it("[ASYNC-b] an effect created after an await inside a live owner belongs to it and is disposed with it", async () => {
    const captured: { owner: Owner | null } = { owner: null };
    let runs = 0;
    const dispose = root(() => {
      captured.owner = getOwner();
    });
    await Promise.resolve();
    runWithOwner(captured.owner, () => {
      useEffect(() => {
        runs += 1;
      });
    });
    flushSync();
    expect(runs).toBe(1);
    dispose();
    flushSync();
    expect(runs).toBe(1);
  });
});

describe("memo failures inside a boundary", () => {
  it("[E-9a] a memo that fails later reports to the enclosing handler and keeps its previous value", () => {
    const seen: unknown[] = [];
    const [n, setN] = useSignal(1);
    const values: number[] = [];
    createRoot(() => {
      catchError(
        () => {
          const doubled = useMemo(() => {
            if (n() === 2) throw new Error("bad");
            return n() * 10;
          });
          useRenderEffect(
            () => doubled(),
            (value) => {
              values.push(value);
            },
          );
        },
        (error) => seen.push(error),
      );
    });
    flushSync();
    expect(values).toEqual([10]);
    setN(2);
    flushSync();
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe("bad");
    expect(values).toEqual([10]);
    setN(3);
    flushSync();
    expect(values).toEqual([10, 30]);
  });

  it("[E-9b] a memo whose first computation fails reports to the handler; its reader sees undefined", () => {
    const seen: unknown[] = [];
    let read: unknown = "unset";
    createRoot(() => {
      const memo = catchError(
        () =>
          useMemo<number | undefined>(() => {
            throw new Error("first");
          }),
        (error) => seen.push(error),
      );
      read = memo?.();
    });
    expect(seen).toHaveLength(1);
    expect(read).toBeUndefined();
  });

  it("[E-9c] without a handler the failure is still stored and rethrown to readers", () => {
    createRoot(() => {
      const memo = useMemo<number>(() => {
        throw new Error("loud");
      });
      expect(() => memo()).toThrow("loud");
    });
  });

  it("[E-9d] a handler that rethrows leaves the error visible to readers", () => {
    createRoot(() => {
      const memo = catchError(
        () =>
          useMemo<number>(() => {
            throw new Error("again");
          }),
        (error) => {
          throw error;
        },
      );
      expect(() => memo?.()).toThrow("again");
    });
  });
});
