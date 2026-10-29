import { describe, expect, it } from "vitest";
import { beginHold, endHold, registerTransitionLane, SUSPENSION } from "../src/extend";
import { createRoot, flushSync, useEffect, useMemo, useSignal } from "../src/index";
import { rt } from "../src/internal/state";

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
 * Creates `count` memos that hold a distinct object as their value, suspends each one (it throws the
 * suspension sentinel on its second run) and disposes it, all while a hold is engaged. Done in its own
 * frame so no local of the test keeps the last token alive.
 */
function suspendAndDispose(count: number): WeakRef<object>[] {
  const refs: WeakRef<object>[] = [];
  for (let index = 0; index < count; index += 1) {
    const token: object = { index };
    refs.push(new WeakRef(token));
    const dispose = createRoot((disposeRoot) => {
      const [fail, setFail] = useSignal(false);
      const memo = useMemo(() => {
        if (fail()) throw SUSPENSION;
        return token;
      });
      useEffect(() => {
        memo();
      });
      flushSync();
      setFail(true);
      flushSync();
      return disposeRoot;
    });
    dispose();
  }
  return refs;
}

describe("transition holds: memory", () => {
  it("[CORE-R2-2] disposed suspended nodes are released while the hold stays engaged", async () => {
    const gc = exposedGc();
    registerTransitionLane();
    beginHold();
    const refs = suspendAndDispose(2000);
    let released = 0;
    for (let pass = 0; pass < 25 && released < 1500; pass += 1) {
      await nextJob();
      gc();
      gc();
      released = refs.filter((ref) => ref.deref() === undefined).length;
    }
    endHold();
    // The list drops its disposed nodes each time it reaches its limit (64 and then twice the
    // survivors), so only the newest few stay: far fewer than the 2000 that came and went.
    expect(released).toBeGreaterThanOrEqual(1500);
    expect(rt.hooks).not.toBeNull();
  });
});
