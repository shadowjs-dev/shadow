import { flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startViewTransition } from "../../src/index";

/** Installs (or removes, with undefined) the View Transitions entry point on the test document. */
function stubStartViewTransition(
  implementation: ((callback: () => void) => { finished: Promise<void> }) | undefined,
): void {
  if (implementation === undefined) {
    Reflect.deleteProperty(document, "startViewTransition");
    return;
  }
  Object.defineProperty(document, "startViewTransition", {
    value: implementation,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  stubStartViewTransition(undefined);
});

describe("startViewTransition (ADR-018 helper)", () => {
  it("[VT-01] without the View Transitions API the update runs at once and the promise resolves", async () => {
    const [value, setValue] = useSignal(0);
    const done = startViewTransition(() => setValue(1));
    expect(value()).toBe(1);
    await expect(done).resolves.toBeUndefined();
    flushSync();
  });

  it("[VT-02] with the API the update runs inside its callback and the promise waits for finished", async () => {
    let update: (() => void) | undefined;
    let finish: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    stubStartViewTransition(
      vi.fn((callback: () => void) => {
        update = callback;
        return { finished };
      }),
    );
    const [value, setValue] = useSignal(0);
    let settled = false;
    const done = startViewTransition(() => setValue(2)).then(() => {
      settled = true;
    });
    expect(value()).toBe(0);
    update?.();
    expect(value()).toBe(2);
    await Promise.resolve();
    expect(settled).toBe(false);
    finish?.();
    await done;
    expect(settled).toBe(true);
  });

  it("[VT-03] an update that throws rejects the promise without the API", async () => {
    const done = startViewTransition(() => {
      throw new Error("update failed");
    });
    await expect(done).rejects.toThrow("update failed");
  });

  it("[VT-04] an update that throws inside the API rejects the promise after finished", async () => {
    stubStartViewTransition((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    const done = startViewTransition(() => {
      throw new Error("inside");
    });
    await expect(done).rejects.toThrow("inside");
  });
});
