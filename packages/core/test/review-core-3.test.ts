import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "../src/index";
import { resetWarningDedupe } from "../src/internal/diagnostics";

type Core = typeof import("../src/index");

const REGISTRY = Symbol.for("shadow-js.core.instances");

/** The warnings printed since the last call, taken out of the spy so the test setup does not fail on them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.join(" "));
  spy.mockClear();
  return messages;
}

/** Loads another copy of core, the way a second bundle of it would be evaluated. */
async function loadCopy(): Promise<Core> {
  vi.resetModules();
  return import("../src/index");
}

/** How many core copies the shared registry lists as having live roots. */
function listedCopies(): number {
  const registry: unknown = Reflect.get(globalThis, REGISTRY);
  return registry instanceof Map ? registry.size : 0;
}

afterEach(() => {
  resetWarningDedupe();
});

describe("review of core, round three: DUPLICATE_CORE", () => {
  it("[CORE-R3-1] a root of a second copy warns while a root of the first copy is alive", async () => {
    const disposeFirst = createRoot((dispose) => dispose);
    const second = await loadCopy();
    expect(takeWarnings()).toEqual([]);
    const disposeSecond = second.createRoot((dispose) => dispose);
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[shadow DUPLICATE_CORE]");
    expect(warnings[0]).toContain("More than one copy of @shadow-js/core");
    disposeSecond();
    disposeFirst();
    expect(listedCopies()).toBe(0);
  });

  it("[CORE-R3-1] copies whose roots do not overlap in time do not warn", async () => {
    createRoot((dispose) => dispose());
    const second = await loadCopy();
    second.createRoot((dispose) => dispose());
    const third = await loadCopy();
    third.createRoot((dispose) => dispose());
    expect(takeWarnings()).toEqual([]);
    expect(listedCopies()).toBe(0);
  });

  it("[CORE-R3-1] a copy of the other build (server or client) is not a duplicate", () => {
    const registry = new Map<object, number>();
    Reflect.set(globalThis, REGISTRY, registry);
    // What the server build of core lists while a test hydrates what it rendered in the same process.
    registry.set({ server: true }, 1);
    createRoot((dispose) => dispose());
    expect(takeWarnings()).toEqual([]);
    registry.clear();
    registry.set({ server: false }, 1);
    createRoot((dispose) => dispose());
    expect(takeWarnings().join("\n")).toContain("DUPLICATE_CORE");
    registry.clear();
  });

  it("[CORE-R3-1] many roots of one copy never warn, nested or detached", () => {
    const disposers: Array<() => void> = [];
    createRoot((disposeOuter) => {
      disposers.push(disposeOuter);
      createRoot((disposeInner) => {
        disposers.push(disposeInner);
      });
      createRoot(
        (disposeDetached) => {
          disposers.push(disposeDetached);
        },
        { detached: true },
      );
    });
    expect(takeWarnings()).toEqual([]);
    for (const dispose of disposers) dispose();
    expect(listedCopies()).toBe(0);
  });

  it("[CORE-R3-1] disposing the parent of an attached root releases it, and disposing twice releases once", async () => {
    const second = await loadCopy();
    let disposeInner = (): void => undefined;
    const disposeOuter = second.createRoot((dispose) => {
      second.createRoot((inner) => {
        disposeInner = inner;
      });
      return dispose;
    });
    disposeOuter();
    disposeInner();
    disposeOuter();
    // Were a count left over, this root of the first copy would warn.
    createRoot((dispose) => dispose());
    expect(takeWarnings()).toEqual([]);
    expect(listedCopies()).toBe(0);
  });

  it("[CORE-R3-1] a root that throws is released", async () => {
    const second = await loadCopy();
    expect(() =>
      second.createRoot(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    createRoot((dispose) => dispose());
    expect(takeWarnings()).toEqual([]);
  });

  it("[CORE-R3-1] the registry lists at most eight copies, however many load", async () => {
    const disposers: Array<() => void> = [];
    for (let copy = 0; copy < 12; copy += 1) {
      const loaded = await loadCopy();
      disposers.push(loaded.createRoot((dispose) => dispose));
    }
    expect(listedCopies()).toBeLessThanOrEqual(8);
    expect(takeWarnings().some((message) => message.includes("DUPLICATE_CORE"))).toBe(true);
    for (const dispose of disposers) dispose();
    expect(listedCopies()).toBe(0);
  });
});
