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
 * Bound (ratchet): the value recorded when the per-row allocation work landed. A regression raises the number
 * and fails the test; lower the bound when the number falls. Node 24 measures about 1,281 B and Node 26 on Linux about
 * 1,340 B (V8's own object sizes differ by version), so the bound has room for that; it catches a change of design.
 */
const RETAINED_BYTES_PER_ROW_BOUND = 1_360;

describe("keyed list row memory", () => {
  it("[LIST-GC-1] a keyed row retains at most the recorded number of bytes", () => {
    const gc = exposedGc();
    const items = Array.from({ length: ROWS }, (_, id) => ({ id, label: `row ${id}` }));
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

    const perRow = (after - before) / ROWS;
    console.log(`[LIST-GC-1] retained bytes per row: ${perRow.toFixed(1)}`);
    expect(rows?.()).toHaveLength(ROWS);
    expect(perRow).toBeLessThanOrEqual(RETAINED_BYTES_PER_ROW_BOUND);
    dispose?.();
  });
});
