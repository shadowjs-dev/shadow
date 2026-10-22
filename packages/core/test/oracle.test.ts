import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { batch, createRoot, flushSync, useEffect, useMemo, useSignal } from "../src/index";

/**
 * Differential test (R-TEST-4): a random graph is evaluated by the engine and by a naive
 * evaluator that recomputes everything from the signal values. After every flush they must agree,
 * effects must never observe a glitch, and effects must rerun only when something they read changed.
 */
type Op = "sum" | "max" | "branch" | "parity";
interface MemoSpec {
  op: Op;
  inputs: number[];
}
interface EffectSpec {
  reads: number[];
}
interface Program {
  signals: number;
  memos: MemoSpec[];
  effects: EffectSpec[];
  steps: Array<{ writes: Array<[number, number]>; grouped: boolean }>;
}

function evaluate(op: Op, values: number[]): number {
  const [a = 0, b = 0, c = 0] = values;
  switch (op) {
    case "sum":
      return values.reduce((x, y) => x + y, 0);
    case "max":
      return Math.max(...values);
    case "parity":
      return a % 2;
    case "branch":
      return a % 2 === 0 ? b : c;
  }
}

const programArb: fc.Arbitrary<Program> = fc
  .record({ signals: fc.integer({ min: 1, max: 5 }), memoCount: fc.integer({ min: 0, max: 12 }) })
  .chain(({ signals, memoCount }) => {
    const memoArbs = Array.from({ length: memoCount }, (_, i) =>
      fc.record({
        op: fc.constantFrom<Op>("sum", "max", "branch", "parity"),
        inputs: fc.array(fc.integer({ min: 0, max: signals + i - 1 }), {
          minLength: 3,
          maxLength: 3,
        }),
      }),
    );
    const total = signals + memoCount;
    return fc.record({
      signals: fc.constant(signals),
      memos: fc.tuple(...memoArbs).map((m) => m as MemoSpec[]),
      effects: fc.array(
        fc.record({
          reads: fc.array(fc.integer({ min: 0, max: total - 1 }), { minLength: 1, maxLength: 3 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
      steps: fc.array(
        fc.record({
          writes: fc.array(
            fc.tuple(fc.integer({ min: 0, max: signals - 1 }), fc.integer({ min: 0, max: 4 })),
            { minLength: 1, maxLength: 4 },
          ),
          grouped: fc.boolean(),
        }),
        { minLength: 1, maxLength: 10 },
      ),
    });
  });

describe("oracle", () => {
  it("[ORA-01] engine agrees with a from-scratch evaluator, glitch free, minimal reruns", () => {
    fc.assert(
      fc.property(programArb, (program) => {
        const model: number[] = Array.from({ length: program.signals }, () => 0);
        const oracleValues = (): number[] => {
          const all = [...model];
          for (const memo of program.memos) {
            all.push(
              evaluate(
                memo.op,
                memo.inputs.map((i) => all[i] ?? 0),
              ),
            );
          }
          return all;
        };
        const setters: Array<(value: number) => number> = [];
        const getters: Array<() => number> = [];
        const log: number[][][] = program.effects.map(() => []);
        const dispose = createRoot((dispose) => {
          for (let i = 0; i < program.signals; i += 1) {
            const [get, set] = useSignal(0);
            getters.push(get);
            setters.push(set);
          }
          for (const memo of program.memos) {
            getters.push(
              useMemo(() =>
                evaluate(
                  memo.op,
                  memo.inputs.map((i) => getters[i]?.() ?? 0),
                ),
              ),
            );
          }
          program.effects.forEach((effect, index) => {
            useEffect(() => {
              const seen = effect.reads.map((i) => getters[i]?.() ?? 0);
              const expected = oracleValues();
              // Glitch freedom: what an effect observes equals the oracle at that moment.
              expect(seen).toEqual(effect.reads.map((i) => expected[i]));
              log[index]?.push(seen);
            });
          });
          return dispose;
        });
        flushSync();
        let previous = program.effects.map((_, i) => log[i]?.length ?? 0);
        for (const step of program.steps) {
          const before = oracleValues();
          // A write that changes a signal and later restores it still notifies; only steps made of
          // pure no-op writes (value equal to the current one) may skip effects entirely.
          let pureNoop = true;
          const apply = () => {
            for (const [index, value] of step.writes) {
              if (model[index] !== value) pureNoop = false;
              model[index] = value;
              setters[index]?.(value);
            }
          };
          if (step.grouped) batch(apply);
          else flushSync(apply);
          flushSync();
          const after = oracleValues();
          program.effects.forEach((effect, index) => {
            const runs = log[index] ?? [];
            const expected = effect.reads.map((i) => after[i]);
            expect(runs[runs.length - 1]).toEqual(expected);
            const changed = effect.reads.some((i) => before[i] !== after[i]);
            const delta = runs.length - (previous[index] ?? 0);
            // Equality cut-off (G-2): untouched inputs mean no rerun; a changed read means a rerun.
            if (pureNoop) expect(delta).toBe(0);
            if (!changed && !pureNoop && step.writes.length === 1) expect(delta).toBe(0);
            if (changed) expect(delta).toBeGreaterThanOrEqual(1);
          });
          previous = program.effects.map((_, i) => log[i]?.length ?? 0);
        }
        dispose();
      }),
      { numRuns: 400, seed: 20261009 },
    );
  });
});
