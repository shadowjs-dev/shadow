import { describe, expect, it } from "vitest";
import { createRoot, flushSync, useEffect, useSignal } from "../src/index";
import { useSelector } from "../src/selector";

/** The engine's garbage collector hook; the gc project always runs with --expose-gc. */
function exposedGc(): () => void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error("the gc project must run with --expose-gc");
  return gc;
}

/** Yields to the next job: a WeakRef target made in the current job stays alive until that job ends. */
function nextJob(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Subscribes `count` fresh keys, each from its own root, and returns a WeakRef to every key and every root's
 * dispose. The keys are created here, not in the caller, so no slot of the caller's frame keeps the last one alive
 * (a stale slot made the count depend on the collector's register use).
 */
function subscribeKeys(
  isSelected: (key: object) => boolean,
  count: number,
): { refs: WeakRef<object>[]; disposers: Array<() => void> } {
  const refs: WeakRef<object>[] = [];
  const disposers: Array<() => void> = [];
  for (let index = 0; index < count; index += 1) {
    const key: object = { index };
    refs.push(new WeakRef(key));
    disposers.push(
      createRoot((dispose) => {
        useEffect(() => {
          isSelected(key);
        });
        return dispose;
      }),
    );
  }
  return { refs, disposers };
}

/**
 * Disposes every root and empties the list. A helper, like {@link subscribeKeys}: a loop variable left in the
 * frame of a test that then awaits keeps the last root's owner and its key reachable, which made the count
 * depend on the register allocation of the JIT.
 */
function disposeAll(disposers: Array<() => void>): void {
  for (const dispose of disposers) dispose();
  disposers.length = 0;
}

/**
 * Collects until `expected` targets are gone, at most 25 forced collections, each after a yield to the next job.
 * A collector under load may need several passes; a leak never converges, so the bound still fails it.
 */
async function collectUntil(
  gc: () => void,
  refs: readonly WeakRef<object>[],
  expected: number,
): Promise<number> {
  let released = 0;
  for (let pass = 0; pass < 25 && released < expected; pass += 1) {
    await nextJob();
    gc();
    gc();
    released = refs.filter((ref) => ref.deref() === undefined).length;
  }
  return released;
}

/**
 * Heap bytes per subscribed key, with one effect per key (what a keyed list row costs). Bound (ratchet): lower it when
 * the number falls.
 */
const RETAINED_BYTES_PER_KEY_BOUND = 700;

describe("useSelector memory", () => {
  it("[SEL-06] disposed subscriptions release their keys; a live subscription keeps its key", async () => {
    const gc = exposedGc();
    const [selected] = useSignal<object | null>(null);
    const isSelected = createRoot(() => useSelector(selected));

    const kept: object = { kept: true };
    const keptRef = new WeakRef(kept);
    const keptRoot = createRoot((dispose) => {
      useEffect(() => {
        isSelected(kept);
      });
      return dispose;
    });
    const { refs, disposers } = subscribeKeys(isSelected, 10_000);
    flushSync();

    disposeAll(disposers);
    const released = await collectUntil(gc, refs, refs.length);

    expect(released).toBe(refs.length);
    expect(keptRef.deref()).toBe(kept);
    keptRoot();
  });

  it("[SEL-GC-1] a subscribed key retains at most the recorded number of bytes", () => {
    const gc = exposedGc();
    const KEYS = 4000;
    const keys: object[] = Array.from({ length: KEYS }, (_, index) => ({ index }));
    const [selected] = useSignal<object | null>(null);
    let isSelected: ((key: object) => boolean) | undefined;
    let disposeAll: (() => void) | undefined;

    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    createRoot((dispose) => {
      disposeAll = dispose;
      isSelected = useSelector(selected);
      for (const key of keys) {
        useEffect(() => {
          isSelected?.(key);
        });
      }
    });
    flushSync();
    gc();
    gc();
    const after = process.memoryUsage().heapUsed;

    // The effects and their closures are part of the per-key cost: the bound ratchets down with the entry's own size.
    const perKey = (after - before) / KEYS;
    console.log(`[SEL-GC-1] retained bytes per subscribed key: ${perKey.toFixed(1)}`);
    expect(isSelected?.(keys[0] as object)).toBe(false);
    expect(perKey).toBeLessThanOrEqual(RETAINED_BYTES_PER_KEY_BOUND);
    disposeAll?.();
  });
});
