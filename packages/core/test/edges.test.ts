import { describe, expect, it } from "vitest";
import {
  type ComputationNode,
  createComputation,
  createOwner,
  createSignalNode,
  disposeOwner,
  markObservers,
  readComputation,
  readSignal,
  type SignalNode,
  type SourceNode,
  schedule,
  track,
} from "../src/extend";
import { flushSync } from "../src/index";
import { observersOf, sourcesOf } from "../src/internal/graph";

/**
 * Edge bookkeeping of the reactive graph: every edge is recorded on both sides (the observer's list of sources and the
 * source's list of observers) with the index of the other side, so removing one is O(1). These tests read both lists
 * through the engine's own accessors and check that they describe the same edges, after every kind of change.
 */

/** The pair arrays of the engine hold, next to each node, the index of this node's pair on the other side. */
function pairIndex(edges: readonly unknown[] | null, entry: number): number {
  return (edges as unknown[])[entry * 2 + 1] as number;
}

/** The index of `source` in the source list of its observer number `index`, read from the observer pair. */
function observerSlotAt(source: SourceNode, index: number): number {
  return pairIndex(source.observers, index) / 2;
}

/** The index of `node` in the observer list of its source number `index`, read from the source pair. */
function sourceSlotAt(node: ComputationNode, index: number): number {
  return pairIndex(node.sources, index) / 2;
}

type Node = SignalNode<number> | ComputationNode;

/** Asserts that both sides of every edge agree, and that no node lists the same neighbor twice. */
function expectConsistent(
  signals: readonly SignalNode<number>[],
  computations: readonly ComputationNode[],
): void {
  for (const computation of computations) {
    const sources = sourcesOf(computation);
    expect(new Set(sources).size, "a source is listed once").toBe(sources.length);
    sources.forEach((source, index) => {
      const slot = sourceSlotAt(computation, index);
      expect(observersOf(source)[slot], "the source lists its observer where the slot says").toBe(
        computation,
      );
      expect(observerSlotAt(source, slot), "and the slot points back").toBe(index);
    });
  }
  for (const source of [...signals, ...computations] as Node[]) {
    const observers = observersOf(source);
    expect(new Set(observers).size, "an observer is listed once").toBe(observers.length);
    observers.forEach((observer, index) => {
      const slot = observerSlotAt(source, index);
      expect(sourcesOf(observer)[slot], "the observer lists its source where the slot says").toBe(
        source,
      );
      expect(sourceSlotAt(observer, slot), "and the slot points back").toBe(index);
    });
  }
}

describe("[EDGE-1] the first edge of a source", () => {
  it("is recorded, runs the reader on a write, and is gone when the reader is disposed", () => {
    const owner = createOwner(null);
    const signal = createSignalNode<number>(0, Object.is);
    const runs = { count: 0 };
    const holder = createOwner(owner);
    const effect = createComputation({
      kind: "effect",
      owner: holder,
      fn: () => {
        runs.count += 1;
        return readSignal(signal);
      },
    });
    flushSync();
    expect(observersOf(signal)).toEqual([effect]);
    expect(sourcesOf(effect)).toEqual([signal]);
    signal.value = 1;
    markObservers(signal);
    schedule();
    flushSync();
    expect(runs.count).toBe(2);
    disposeOwner(holder);
    expect(observersOf(signal)).toEqual([]);
    expectConsistent([signal], [effect]);
    disposeOwner(owner);
  });

  it("moves to the next observer when the first one leaves", () => {
    const owner = createOwner(null);
    const signal = createSignalNode<number>(0, Object.is);
    const holders = [createOwner(owner), createOwner(owner), createOwner(owner)];
    const runs = [{ count: 0 }, { count: 0 }, { count: 0 }];
    const effects = holders.map((holder, index) =>
      createComputation({
        kind: "effect",
        owner: holder,
        fn: () => {
          (runs[index] as { count: number }).count += 1;
          return readSignal(signal);
        },
      }),
    );
    flushSync();
    expectConsistent([signal], effects);
    expect(observersOf(signal)).toHaveLength(3);
    disposeOwner(holders[0] as ReturnType<typeof createOwner>);
    expectConsistent([signal], effects);
    expect(observersOf(signal)).toHaveLength(2);
    signal.value = 1;
    markObservers(signal);
    schedule();
    flushSync();
    expect(runs.map((entry) => entry.count)).toEqual([1, 2, 2]);
    disposeOwner(holders[1] as ReturnType<typeof createOwner>);
    expectConsistent([signal], effects);
    expect(observersOf(signal)).toEqual([effects[2]]);
    disposeOwner(holders[2] as ReturnType<typeof createOwner>);
    expect(observersOf(signal)).toEqual([]);
    disposeOwner(owner);
  });
});

describe("[EDGE-2] a reader whose dependencies change", () => {
  it("keeps both sides in agreement while it switches between sources, adds some and drops others", () => {
    const owner = createOwner(null);
    const signals = [0, 1, 2, 3, 4].map(() => createSignalNode<number>(0, Object.is));
    const mode = createSignalNode<number>(0, Object.is);
    const plans: number[][] = [
      [0],
      [0, 1],
      [1, 0],
      [2, 3, 4],
      [4],
      [],
      [0, 1, 2, 3, 4],
      [3],
      [3, 2],
      [0],
    ];
    const effect = createComputation({
      kind: "effect",
      owner,
      fn: () => {
        for (const index of plans[readSignal(mode)] ?? [])
          readSignal(signals[index] as SignalNode<number>);
        return undefined;
      },
    });
    flushSync();
    for (let step = 0; step < plans.length; step += 1) {
      mode.value = step;
      markObservers(mode);
      schedule();
      flushSync();
      expectConsistent([...signals, mode], [effect]);
      const expected = new Set<SourceNode>([
        mode,
        ...(plans[step] ?? []).map((index) => signals[index] as SignalNode<number>),
      ]);
      expect(new Set(sourcesOf(effect))).toEqual(expected);
      for (const signal of signals) {
        expect(observersOf(signal).length, "a signal nobody reads has no observers").toBe(
          expected.has(signal) ? 1 : 0,
        );
      }
    }
    disposeOwner(owner);
  });
});

describe("[EDGE-3] random churn", () => {
  it("keeps every edge consistent while readers are created, rewired and disposed, and every reader sees current values", () => {
    // A small deterministic generator: the test must give the same run everywhere.
    let seed = 0x2545f491;
    const random = (limit: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    const owner = createOwner(null);
    const signals = Array.from({ length: 7 }, () => createSignalNode<number>(0, Object.is));
    interface Live {
      holder: ReturnType<typeof createOwner>;
      node: ComputationNode;
      picks: SignalNode<number>[];
      lastSeen: number;
    }
    const live: Live[] = [];
    const memos: ComputationNode[] = [];

    for (let step = 0; step < 400; step += 1) {
      const action = random(5);
      if (action === 0 && live.length < 24) {
        const picks = signals.filter(() => random(3) === 0);
        const holder = createOwner(owner);
        const entry: Live = {
          holder,
          picks,
          lastSeen: -1,
          node: undefined as unknown as ComputationNode,
        };
        entry.node = createComputation({
          kind: "effect",
          owner: holder,
          fn: () => {
            let sum = 0;
            for (const source of entry.picks) sum += readSignal(source);
            entry.lastSeen = sum;
            return undefined;
          },
        });
        live.push(entry);
      } else if (action === 1 && live.length > 0) {
        const [gone] = live.splice(random(live.length), 1);
        if (gone !== undefined) disposeOwner(gone.holder);
      } else if (action === 2 && memos.length < 6) {
        const picks = signals.filter(() => random(2) === 0);
        memos.push(
          createComputation({
            kind: "memo",
            owner,
            fn: () => {
              let sum = 0;
              for (const source of picks) sum += readSignal(source);
              return sum;
            },
          }),
        );
      } else {
        const target = signals[random(signals.length)] as SignalNode<number>;
        target.value += 1;
        markObservers(target);
        schedule();
      }
      flushSync();
      const computations = [...live.map((entry) => entry.node), ...memos];
      expectConsistent(signals, computations);
      for (const entry of live) {
        const expected = entry.picks.reduce((total, source) => total + source.value, 0);
        expect(entry.lastSeen, `step ${step}`).toBe(expected);
      }
      for (const memo of memos) expect(Number.isFinite(readComputation<number>(memo))).toBe(true);
    }
    disposeOwner(owner);
    for (const signal of signals) expect(observersOf(signal)).toEqual([]);
  });
});

describe("[EDGE-4] memos as sources", () => {
  it("passes staleness down a chain whose every link has a single observer", () => {
    const owner = createOwner(null);
    const base = createSignalNode<number>(1, Object.is);
    const first = createComputation({ kind: "memo", owner, fn: () => readSignal(base) * 2 });
    const second = createComputation({
      kind: "memo",
      owner,
      fn: () => readComputation<number>(first) + 1,
    });
    let seen = 0;
    const effect = createComputation({
      kind: "effect",
      owner,
      fn: () => {
        seen = readComputation<number>(second);
        return undefined;
      },
    });
    flushSync();
    expect(seen).toBe(3);
    base.value = 5;
    markObservers(base);
    schedule();
    flushSync();
    expect(seen).toBe(11);
    expectConsistent([base], [first, second, effect]);
    expect(observersOf(first)).toEqual([second]);
    expect(observersOf(second)).toEqual([effect]);
    disposeOwner(owner);
    expect(observersOf(base)).toEqual([]);
  });

  it("lets a memo with several observers lose them in any order", () => {
    const owner = createOwner(null);
    const base = createSignalNode<number>(1, Object.is);
    const memo = createComputation({ kind: "memo", owner, fn: () => readSignal(base) + 1 });
    const holders = [
      createOwner(owner),
      createOwner(owner),
      createOwner(owner),
      createOwner(owner),
    ];
    const seen = [0, 0, 0, 0];
    const effects = holders.map((holder, index) =>
      createComputation({
        kind: "effect",
        owner: holder,
        fn: () => {
          seen[index] = readComputation<number>(memo);
          return undefined;
        },
      }),
    );
    flushSync();
    for (const order of [2, 0, 3, 1]) {
      disposeOwner(holders[order] as ReturnType<typeof createOwner>);
      const rest = effects.filter((_, index) => !holders[index]?.disposed);
      expectConsistent([base], [memo, ...rest]);
      expect(observersOf(memo)).toHaveLength(rest.length);
    }
    disposeOwner(owner);
  });
});

describe("[EDGE-5] a custom source built by hand", () => {
  it("still works when it has only the documented fields", () => {
    const owner = createOwner(null);
    const clock: SourceNode = { kind: 0, value: 0, observers: null, stamp: 0 };
    const read = (): number => {
      track(clock);
      return clock.value as number;
    };
    const holders = [createOwner(owner), createOwner(owner), createOwner(owner)];
    const seen = [-1, -1, -1];
    const effects = holders.map((holder, index) =>
      createComputation({
        kind: "effect",
        owner: holder,
        fn: () => {
          seen[index] = read();
          return undefined;
        },
      }),
    );
    flushSync();
    expect(observersOf(clock)).toHaveLength(3);
    clock.value = 7;
    markObservers(clock);
    schedule();
    flushSync();
    expect(seen).toEqual([7, 7, 7]);
    disposeOwner(holders[0] as ReturnType<typeof createOwner>);
    clock.value = 8;
    markObservers(clock);
    schedule();
    flushSync();
    expect(seen).toEqual([7, 8, 8]);
    expectConsistent([], effects.slice(1));
    disposeOwner(owner);
    expect(observersOf(clock)).toEqual([]);
  });
});
