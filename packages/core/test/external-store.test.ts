import { describe, expect, it } from "vitest";
import { createRoot, flushSync, onCleanup, useEffect, useExternalStore } from "../src/index";

/** A minimal external store (the shape Redux, Zustand, a DOM API or an observable exposes). */
function externalCounter(initial: number) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: (): number => value,
    set(next: number): void {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get listeners(): number {
      return listeners.size;
    },
  };
}

describe("useExternalStore", () => {
  it("[EXT-01] the accessor returns the snapshot and follows external notifications after flush", () => {
    const store = externalCounter(1);
    createRoot(() => {
      const count = useExternalStore(store.subscribe, store.get);
      expect(count()).toBe(1);
      store.set(2);
      flushSync();
      expect(count()).toBe(2);
    });
  });

  it("[EXT-02] an effect reading the snapshot re-runs on change only (equal notifications are ignored)", () => {
    const store = externalCounter(0);
    const seen: number[] = [];
    createRoot(() => {
      const count = useExternalStore(store.subscribe, store.get);
      useEffect(() => {
        seen.push(count());
      });
    });
    flushSync();
    store.set(0); // equal snapshot: no re-run
    flushSync();
    store.set(3);
    flushSync();
    expect(seen).toEqual([0, 3]);
  });

  it("[EXT-03] the subscription is removed when the owner is disposed", () => {
    const store = externalCounter(0);
    const dispose = createRoot((d) => {
      useExternalStore(store.subscribe, store.get);
      return d;
    });
    flushSync();
    expect(store.listeners).toBe(1);
    dispose();
    expect(store.listeners).toBe(0);
  });

  it("[EXT-05] a notification during subscribe is caught up on the first flush (no missed update)", () => {
    const store = externalCounter(1);
    createRoot(() => {
      const count = useExternalStore((listener) => {
        // The store changes between the snapshot read and the subscription.
        store.set(5);
        return store.subscribe(listener);
      }, store.get);
      flushSync();
      expect(count()).toBe(5);
    });
  });

  it("[EXT-06] equals: a custom comparison decides whether a snapshot change propagates", () => {
    const store = externalCounter(1);
    const seen: number[] = [];
    createRoot(() => {
      const count = useExternalStore(store.subscribe, store.get, {
        equals: (a: number, b: number) => Math.floor(a / 10) === Math.floor(b / 10),
      });
      useEffect(() => {
        seen.push(count());
      });
    });
    flushSync();
    store.set(5);
    flushSync();
    store.set(42);
    flushSync();
    expect(seen).toEqual([1, 42]);
  });

  it("[EXT-07] Solid-style `from` recipe: a producer that reads the latest value through the subscription", () => {
    // The Solid `from(setter => cleanup)` shape, written with the one public API.
    let emit: (value: string) => void = () => undefined;
    let unsubscribed = 0;
    const from = (producer: (set: (v: string) => void) => () => void, initial: string) => {
      let snapshot = initial;
      return useExternalStore(
        (notify) => {
          const cleanup = producer((next) => {
            snapshot = next;
            notify();
          });
          return () => {
            unsubscribed += 1;
            cleanup();
          };
        },
        () => snapshot,
      );
    };
    const dispose = createRoot((d) => {
      const time = from((set) => {
        emit = set;
        return () => undefined;
      }, "");
      flushSync(); // the producer runs when the subscription effect runs
      emit("10:00:00");
      flushSync();
      expect(time()).toBe("10:00:00");
      return d;
    });
    dispose();
    expect(unsubscribed).toBe(1);
  });

  it("[EXT-08] cleanup registered by the owner runs after the subscription is removed", () => {
    const store = externalCounter(0);
    const order: string[] = [];
    const dispose = createRoot((d) => {
      useExternalStore((listener) => {
        const off = store.subscribe(listener);
        return () => {
          order.push("unsubscribe");
          off();
        };
      }, store.get);
      onCleanup(() => order.push("owner"));
      return d;
    });
    flushSync();
    dispose();
    expect(order).toEqual(["unsubscribe", "owner"]);
  });
});
