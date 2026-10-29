// @vitest-environment happy-dom
import { createRoot, useSignal } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { insert } from "../src/insert";

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
 * Creates and disposes `count` unanchored regions behind a live one on `parent`, each showing a distinct
 * node, and returns weak references to those nodes. Its own frame, so no local of the test keeps them.
 */
function churn(parent: HTMLElement, count: number): WeakRef<object>[] {
  const refs: WeakRef<object>[] = [];
  for (let index = 0; index < count; index += 1) {
    const node = document.createElement("i");
    refs.push(new WeakRef(node));
    createRoot((dispose) => {
      insert(parent, () => node);
      dispose();
    });
    // Out of the document too, so only a region that still lists the node can keep it alive.
    parent.replaceChildren();
  }
  return refs;
}

describe("insert() regions on a long-lived parent", () => {
  it("[WEB-R3-1] the parent keeps at most the newest of the regions disposed behind a live one", async () => {
    const parent = document.createElement("div");
    const [live] = useSignal<unknown>(null);
    const dispose = createRoot((disposeRoot) => {
      insert(parent, live);
      return disposeRoot;
    });
    const refs = churn(parent, 200);
    await nextJob();
    exposedGc()();
    await nextJob();
    exposedGc()();
    // The parent remembers its newest region (alive or not) to know whom to anchor next: one, not 200.
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBeLessThanOrEqual(1);
    dispose();
  });
});
