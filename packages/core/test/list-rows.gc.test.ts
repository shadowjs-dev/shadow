import { describe, expect, it } from "vitest";
import { createRoot, flushSync, mapArray, useEffect, useSignal } from "../src/index";

/** The engine's garbage collector hook; the gc project always runs with --expose-gc. */
function exposedGc(): () => void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error("the gc project must run with --expose-gc");
  return gc;
}

/** Rows in one measurement. Large enough that per-row cost dominates the fixed cost of the test. */
const ROWS = 2000;

/**
 * Heap bytes that a keyed list of `ROWS` rows retains, per row. Each row is what the row benchmark builds: a
 * mapped root whose effect reads the row's item. The items are created before the first measurement and kept
 * alive afterward, so only the rows count.
 *
 * Bound (ratchet): a regression raises the number and fails the test; lower the bound when the number falls. The value is
 * the median of several measurements (see `SAMPLES`): the first one also pays one-time costs (compiled code, object
 * shapes), about 150 B per row more, and any single reading can swing by about 100 B with GC timing. Node 26 on macOS
 * measures about 1,155 B; V8's object sizes differ between Node versions and platforms by a few dozen bytes, so the
 * bound has room for that and still catches a change of design.
 */
const RETAINED_BYTES_PER_ROW_BOUND = 1_260;

/** Separate measurements per run. One reading can swing by about 100 B per row with GC timing; the median does not. */
const SAMPLES = 5;

/** Builds one keyed list of `ROWS` rows over `items`, measures the heap it retains per row, then disposes it. */
function measurePerRow(gc: () => void, items: readonly { id: number; label: string }[]): number {
  let rows: (() => unknown[]) | undefined;
  let dispose: (() => void) | undefined;
  gc();
  gc();
  const before = process.memoryUsage().heapUsed;
  createRoot((rootDispose) => {
    dispose = rootDispose;
    const [list] = useSignal(items);
    rows = mapArray(
      list,
      (item) => {
        useEffect(() => {
          void item().id;
        });
        return item;
      },
      { key: (item) => item.id },
    );
  });
  rows?.();
  flushSync();
  gc();
  gc();
  const after = process.memoryUsage().heapUsed;
  expect(rows?.()).toHaveLength(ROWS);
  dispose?.();
  return (after - before) / ROWS;
}

describe("keyed list row memory", () => {
  it("[LIST-GC-1] a keyed row retains at most the recorded number of bytes", () => {
    const gc = exposedGc();
    const items = Array.from({ length: ROWS }, (_, id) => ({ id, label: `row ${id}` }));
    const samples = Array.from({ length: SAMPLES }, () => measurePerRow(gc, items)).sort(
      (a, b) => a - b,
    );
    const perRow = samples[Math.floor(SAMPLES / 2)] ?? Number.POSITIVE_INFINITY;
    console.log(
      `[LIST-GC-1] retained bytes per row: ${perRow.toFixed(1)} (median of ${samples.map((one) => one.toFixed(0)).join(", ")})`,
    );
    expect(perRow).toBeLessThanOrEqual(RETAINED_BYTES_PER_ROW_BOUND);
  });
});
