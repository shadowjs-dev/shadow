import {
  batch,
  createRoot,
  flushSync,
  onCleanup,
  untrack,
  useEffect,
  useSignal,
} from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { Show } from "../../src/control-flow/index";

/** Unwraps accessors the way the DOM insert does: a function value is read until a plain value appears. */
function unwrap(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") current = (current as () => unknown)();
  return current;
}

/** Records the unwrapped value of `accessor` each time an effect re-runs (settled by flushSync). */
function watch(accessor: () => unknown): { values: unknown[]; dispose: () => void } {
  const values: unknown[] = [];
  const dispose = createRoot((dispose) => {
    useEffect(() => {
      values.push(unwrap(accessor()));
    });
    return dispose;
  });
  flushSync();
  return { values, dispose };
}

describe("Show: basics", () => {
  it("[SHW-01] shows children while when is truthy and the fallback otherwise", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    const view = Show({
      get when() {
        return when();
      },
      children: "on",
      fallback: "off",
    });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["on"]);
    flushSync(() => setWhen(null));
    expect(values).toEqual(["on", "off"]);
    flushSync(() => setWhen(3));
    expect(values).toEqual(["on", "off", "on"]);
    dispose();
  });

  it("[SHW-02] returns the fallback when when is initially falsy", () => {
    const view = Show({ when: undefined, children: "on", fallback: "off" });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["off"]);
    dispose();
  });

  it("[SHW-03] treats null, undefined, false, 0 and the empty string as falsy", () => {
    for (const value of [null, undefined, false, 0, ""] as const) {
      const view = Show({ when: value, children: "on", fallback: "off" });
      const { values, dispose } = watch(view);
      expect(values).toEqual(["off"]);
      dispose();
    }
  });

  it("[SHW-04] treats every non-empty value as truthy, including empty arrays, objects and the string 0", () => {
    for (const value of [1, "a", "0", {}, [], true] as const) {
      const view = Show({ when: value, children: "on", fallback: "off" });
      const { values, dispose } = watch(view);
      expect(values).toEqual(["on"]);
      dispose();
    }
  });

  it("[SHW-05] returns undefined content when there are no children and the condition is truthy", () => {
    const view = Show({ when: 1 });
    const { values, dispose } = watch(view);
    expect(values).toEqual([undefined]);
    dispose();
  });

  it("[SHW-06] passes plain children through untouched when they are an array", () => {
    const view = Show({ when: true, children: ["a", "b"] });
    const { values, dispose } = watch(view);
    expect(values).toEqual([["a", "b"]]);
    dispose();
  });

  it("[SHW-07] returns a single child as the plain value, without wrapping", () => {
    const node = { tag: "node" };
    const view = Show({ when: true, children: node as never });
    expect(untrack(view)).toBe(node);
  });

  it("[SHW-08] returns an accessor child (length 0) as is, to be read reactively by the caller", () => {
    const [text, setText] = useSignal("first");
    const accessor = (): string => text();
    const view = Show({ when: true, children: accessor });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["first"]);
    flushSync(() => setText("second"));
    expect(values).toEqual(["first", "second"]);
    dispose();
  });
});

describe("Show: non-keyed callbacks and rebuild rules", () => {
  it("[SHW-09] calls a callback child with an accessor of the value, untracked", () => {
    const [user, setUser] = useSignal<{ name: string } | null>({ name: "a" });
    let read: (() => { name: string }) | undefined;
    const view = Show({
      get when() {
        return user();
      },
      children: (value: () => { name: string }) => {
        read = value;
        return "shown";
      },
      fallback: "none",
    });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["shown"]);
    expect(read?.().name).toBe("a");
    flushSync(() => setUser({ name: "b" }));
    expect(read?.().name).toBe("b");
    dispose();
  });

  it("[SHW-10] rebuilds the branch only when the truthiness of when changes", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    let created = 0;
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        created += 1;
        return `v${String(value())}`;
      },
      fallback: "off",
    });
    const { values, dispose } = watch(view);
    expect(created).toBe(1);
    flushSync(() => setWhen(2));
    flushSync(() => setWhen(3));
    expect(created).toBe(1);
    expect(values).toEqual(["v1"]);
    dispose();
  });

  it("[SHW-11] a truthy value change without a rebuild still updates what the accessor returns", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    let read: (() => number) | undefined;
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        read = value;
        return "shown";
      },
    });
    const { dispose } = watch(view);
    flushSync(() => setWhen(7));
    expect(read?.()).toBe(7);
    dispose();
  });

  it("[SHW-12] an effect reading the accessor re-runs when the value changes while truthy", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    const seen: number[] = [];
    let read: (() => number) | undefined;
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        read = value;
        return "shown";
      },
    });
    const dispose = createRoot((dispose) => {
      useEffect(() => {
        if (read !== undefined) seen.push(read());
      });
      return dispose;
    });
    const { dispose: stop } = watch(view);
    flushSync(() => setWhen(2));
    flushSync(() => setWhen(3));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(3);
    stop();
    dispose();
  });

  it("[SHW-13] show, hide, show, hide cycles build and clean up each branch exactly once", () => {
    const [when, setWhen] = useSignal<boolean>(true);
    let created = 0;
    let cleaned = 0;
    const view = Show({
      get when() {
        return when();
      },
      children: (_value: unknown) => {
        created += 1;
        onCleanup(() => {
          cleaned += 1;
        });
        return "on";
      },
      fallback: "off",
    });
    const { values, dispose } = watch(view);
    expect([created, cleaned]).toEqual([1, 0]);
    flushSync(() => setWhen(false));
    expect([created, cleaned]).toEqual([1, 1]);
    flushSync(() => setWhen(true));
    expect([created, cleaned]).toEqual([2, 1]);
    flushSync(() => setWhen(false));
    expect([created, cleaned]).toEqual([2, 2]);
    expect(values).toEqual(["on", "off", "on", "off"]);
    dispose();
  });

  it("[SHW-14] the previous branch's cleanups run before the new branch is created", () => {
    const [when, setWhen] = useSignal<number>(1);
    const order: string[] = [];
    const view = Show({
      get when() {
        return when() > 0 ? when() : 0;
      },
      children: (value: () => number) => {
        const label = `v${String(untrack(value))}`;
        order.push(`create ${label}`);
        onCleanup(() => order.push(`cleanup ${label}`));
        return label;
      },
      fallback: "off",
    });
    const { dispose } = watch(view);
    flushSync(() => setWhen(0));
    flushSync(() => setWhen(5));
    expect(order).toEqual(["create v1", "cleanup v1", "create v5"]);
    dispose();
  });

  it("[SHW-15] an effect created inside a branch re-runs while shown and stops after the branch is hidden", () => {
    const [when, setWhen] = useSignal<boolean>(true);
    const [tick, setTick] = useSignal(0);
    let runs = 0;
    const view = Show({
      get when() {
        return when();
      },
      children: (_value: unknown) => {
        useEffect(() => {
          tick();
          runs += 1;
        });
        return "on";
      },
      fallback: "off",
    });
    const { dispose } = watch(view);
    expect(runs).toBe(1);
    flushSync(() => setTick(1));
    expect(runs).toBe(2);
    flushSync(() => setWhen(false));
    flushSync(() => setTick(2));
    expect(runs).toBe(2);
    dispose();
  });

  it("[SHW-16] reads the children getter once per build, untracked", () => {
    const [when, setWhen] = useSignal<boolean>(true);
    let reads = 0;
    const view = Show({
      get when() {
        return when();
      },
      get children() {
        reads += 1;
        return "on";
      },
      fallback: "off",
    });
    const { dispose } = watch(view);
    expect(reads).toBe(1);
    flushSync(() => setWhen(false));
    flushSync(() => setWhen(true));
    expect(reads).toBe(2);
    dispose();
  });

  it("[SHW-17] reads the fallback lazily, only while it is shown", () => {
    const [when, setWhen] = useSignal<boolean>(true);
    let reads = 0;
    const view = Show({
      get when() {
        return when();
      },
      children: "on",
      get fallback() {
        reads += 1;
        return "off";
      },
    });
    const { values, dispose } = watch(view);
    expect(reads).toBe(0);
    flushSync(() => setWhen(false));
    expect(reads).toBe(1);
    expect(values).toEqual(["on", "off"]);
    dispose();
  });

  it("[SHW-18] falsy to falsy transitions do not rebuild the fallback", () => {
    const [when, setWhen] = useSignal<number | null | undefined>(null);
    let reads = 0;
    const view = Show({
      get when() {
        return when();
      },
      children: "on",
      get fallback() {
        reads += 1;
        return "off";
      },
    });
    const { values, dispose } = watch(view);
    expect(reads).toBe(1);
    flushSync(() => setWhen(0));
    flushSync(() => setWhen(undefined));
    expect(reads).toBe(1);
    expect(values).toEqual(["off"]);
    dispose();
  });

  it("[SHW-19] shows a fallback that is a function without calling it with arguments", () => {
    const view = Show({ when: false, fallback: () => "computed" });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["computed"]);
    dispose();
  });
});

describe("Show: stale accessors", () => {
  it("[SHW-20] reading the accessor after when became falsy throws a TypeError", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    let read: (() => number) | undefined;
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        read = value;
        return "shown";
      },
    });
    const { dispose } = watch(view);
    flushSync(() => setWhen(null));
    expect(() => read?.()).toThrow(TypeError);
    dispose();
  });

  it("[SHW-21] the stale error message starts with 'ShadowJS Show: stale accessor'", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    let read: (() => number) | undefined;
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        read = value;
        return "shown";
      },
    });
    const { dispose } = watch(view);
    flushSync(() => setWhen(null));
    let message = "";
    try {
      read?.();
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message.startsWith("ShadowJS Show: stale accessor")).toBe(true);
    dispose();
  });

  it("[SHW-22] reading the accessor in a cleanup of the disposing branch does not throw and returns the last truthy value", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    const seen: number[] = [];
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        onCleanup(() => {
          seen.push(value());
        });
        return "shown";
      },
      fallback: "off",
    });
    const { values, dispose } = watch(view);
    flushSync(() => setWhen(2));
    flushSync(() => setWhen(null));
    expect(seen).toEqual([2]);
    expect(values).toEqual(["shown", "off"]);
    dispose();
  });

  it("[SHW-23] a cleanup reading the accessor after a truthy change returns the new truthy value", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    const seen: number[] = [];
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        onCleanup(() => {
          seen.push(value());
        });
        return "shown";
      },
    });
    const { dispose } = watch(view);
    flushSync(() => setWhen(9));
    flushSync(() => setWhen(null));
    expect(seen).toEqual([9]);
    dispose();
  });

  it("[SHW-24] a stale accessor is still an error after the cleanup phase is over", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    let read: (() => number) | undefined;
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        read = value;
        onCleanup(() => {
          read?.();
        });
        return "shown";
      },
      fallback: "off",
    });
    const { dispose } = watch(view);
    flushSync(() => setWhen(null));
    expect(() => read?.()).toThrow(/stale accessor/);
    dispose();
  });

  it("[SHW-25] a stale accessor throws again after the branch is shown and hidden twice", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    let read: (() => number) | undefined;
    const view = Show({
      get when() {
        return when();
      },
      children: (value: () => number) => {
        read = value;
        return "shown";
      },
      fallback: "off",
    });
    const { dispose } = watch(view);
    flushSync(() => setWhen(null));
    flushSync(() => setWhen(4));
    flushSync(() => setWhen(null));
    expect(() => read?.()).toThrow(TypeError);
    dispose();
  });
});

describe("Show: batching", () => {
  it("[SHW-26] flipping when many times inside one batch builds only the final state", () => {
    const [when, setWhen] = useSignal<number | null | undefined>(null);
    let created = 0;
    const view = Show({
      get when() {
        return when();
      },
      children: (_value: unknown) => {
        created += 1;
        return "on";
      },
      fallback: "off",
    });
    const { values, dispose } = watch(view);
    batch(() => {
      setWhen(1);
      setWhen(null);
      setWhen(2);
      setWhen(null);
      setWhen(3);
    });
    flushSync();
    expect(created).toBe(1);
    expect(values).toEqual(["off", "on"]);
    dispose();
  });

  it("[SHW-27] a batch that flips back to the same truthiness does not rebuild the branch", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    let created = 0;
    const view = Show({
      get when() {
        return when();
      },
      children: (_value: unknown) => {
        created += 1;
        return "on";
      },
      fallback: "off",
    });
    const { values, dispose } = watch(view);
    batch(() => {
      setWhen(null);
      setWhen(5);
    });
    flushSync();
    expect(created).toBe(1);
    expect(values).toEqual(["on"]);
    dispose();
  });

  it("[SHW-28] a batch that ends falsy after starting truthy tears the branch down once", () => {
    const [when, setWhen] = useSignal<number | null>(1);
    let cleaned = 0;
    const view = Show({
      get when() {
        return when();
      },
      children: (_value: unknown) => {
        onCleanup(() => {
          cleaned += 1;
        });
        return "on";
      },
      fallback: "off",
    });
    const { values, dispose } = watch(view);
    batch(() => {
      setWhen(2);
      setWhen(null);
    });
    flushSync();
    expect(cleaned).toBe(1);
    expect(values).toEqual(["on", "off"]);
    dispose();
  });
});

describe("Show: keyed", () => {
  it("[SHW-29] keyed callbacks receive the value itself", () => {
    const [item, setItem] = useSignal<{ id: number } | null>({ id: 1 });
    const received: number[] = [];
    const view = Show({
      get when() {
        return item();
      },
      keyed: true,
      children: (value: { id: number }) => {
        received.push(value.id);
        return `item ${String(value.id)}`;
      },
      fallback: "none",
    });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["item 1"]);
    flushSync(() => setItem({ id: 2 }));
    expect(received).toEqual([1, 2]);
    expect(values).toEqual(["item 1", "item 2"]);
    dispose();
  });

  it("[SHW-30] keyed branches are rebuilt when the identity changes but not when it stays the same", () => {
    const first = { id: 1 };
    const [item, setItem] = useSignal<{ id: number }>(first);
    let created = 0;
    const view = Show({
      get when() {
        return item();
      },
      keyed: true,
      children: (_value: unknown) => {
        created += 1;
        return "on";
      },
      fallback: "off",
    });
    const { dispose } = watch(view);
    flushSync(() => setItem(first));
    expect(created).toBe(1);
    flushSync(() => setItem({ id: 1 }));
    expect(created).toBe(2);
    dispose();
  });

  it("[SHW-31] keyed falsy values do not rebuild the fallback when they change", () => {
    const [item, setItem] = useSignal<number | null>(0);
    let reads = 0;
    const view = Show({
      get when() {
        return item();
      },
      keyed: true,
      children: "on",
      get fallback() {
        reads += 1;
        return "off";
      },
    });
    const { values, dispose } = watch(view);
    flushSync(() => setItem(null));
    expect(reads).toBe(1);
    expect(values).toEqual(["off"]);
    dispose();
  });
});

describe("Show: errors and nesting", () => {
  it("[SHW-32] a throwing when getter surfaces when the accessor is read", () => {
    const view = Show({
      get when(): number {
        throw new Error("when failed");
      },
      children: "on",
    });
    expect(() => untrack(view)).toThrow("when failed");
  });

  it("[SHW-33] a throwing children getter surfaces when the accessor is read", () => {
    const view = Show({
      when: true,
      get children(): string {
        throw new Error("children failed");
      },
    });
    expect(() => untrack(view)).toThrow("children failed");
  });

  it("[SHW-34] disposing the owner tears down a shown branch exactly once", () => {
    let cleaned = 0;
    const [when] = useSignal(true);
    const dispose = createRoot((dispose) => {
      Show({
        get when() {
          return when();
        },
        children: (_value: unknown) => {
          onCleanup(() => {
            cleaned += 1;
          });
          return "on";
        },
      });
      return dispose;
    });
    expect(cleaned).toBe(0);
    dispose();
    expect(cleaned).toBe(1);
  });

  it("[SHW-35] nested Show components rebuild independently", () => {
    const [outer, setOuter] = useSignal<boolean>(true);
    const [inner, setInner] = useSignal<boolean>(true);
    let outerBuilds = 0;
    let innerBuilds = 0;
    const view = Show({
      get when() {
        return outer();
      },
      children: (_value: unknown) => {
        outerBuilds += 1;
        return Show({
          get when() {
            return inner();
          },
          children: (_value: unknown) => {
            innerBuilds += 1;
            return "deep";
          },
          fallback: "inner off",
        });
      },
      fallback: "outer off",
    });
    const { values, dispose } = watch(view);
    expect([outerBuilds, innerBuilds]).toEqual([1, 1]);
    flushSync(() => setInner(false));
    expect([outerBuilds, innerBuilds]).toEqual([1, 1]);
    flushSync(() => setOuter(false));
    flushSync(() => setOuter(true));
    expect([outerBuilds, innerBuilds]).toEqual([2, 1]);
    flushSync(() => setInner(true));
    expect([outerBuilds, innerBuilds]).toEqual([2, 2]);
    expect(values).toEqual(["deep", "inner off", "outer off", "inner off", "deep"]);
    dispose();
  });
});
