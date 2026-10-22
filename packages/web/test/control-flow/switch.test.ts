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
import { Match, Show, Switch } from "../../src/control-flow/index";

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

describe("Switch: selection", () => {
  it("[SWT-01] shows the first Match whose when is truthy", () => {
    const [a, setA] = useSignal<boolean>(false);
    const [b, setB] = useSignal<boolean>(true);
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: "A",
        }),
        Match({
          get when() {
            return b();
          },
          children: "B",
        }),
      ],
    });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["B"]);
    flushSync(() => setA(true));
    expect(values).toEqual(["B", "A"]);
    flushSync(() => setB(false));
    flushSync(() => setA(false));
    expect(values).toEqual(["B", "A", "none"]);
    dispose();
  });

  it("[SWT-02] shows the fallback when no Match is truthy", () => {
    const view = Switch({
      fallback: "none",
      children: [Match({ when: false, children: "A" }), Match({ when: 0, children: "B" })],
    });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["none"]);
    dispose();
  });

  it("[SWT-03] shows the fallback for empty children", () => {
    const view = Switch({ fallback: "none" });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["none"]);
    dispose();
  });

  it("[SWT-04] ignores null, undefined and false children", () => {
    const view = Switch({
      fallback: "none",
      children: [null, undefined, false, Match({ when: true, children: "A" })],
    });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["A"]);
    dispose();
  });

  it("[SWT-05] throws a TypeError for a child that is not a Match", () => {
    expect(() => Switch({ children: [Match({ when: true, children: "A" }), "text"] })).toThrow(
      TypeError,
    );
  });

  it("[SWT-06] the message of the non-Match error names <Match>", () => {
    let message = "";
    try {
      Switch({ children: 42 });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe("ShadowJS Switch: children must be <Match>");
  });

  it("[SWT-07] a node child is rejected as not a Match", () => {
    const node = { nodeType: 1 };
    expect(() => Switch({ children: [node] })).toThrow(TypeError);
  });

  it("[SWT-08] re-selecting the same Match with the same truthiness does not rebuild it", () => {
    const [a, setA] = useSignal<number>(1);
    let created = 0;
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: (_value: unknown) => {
            created += 1;
            return "A";
          },
        }),
      ],
    });
    const { values, dispose } = watch(view);
    flushSync(() => setA(2));
    flushSync(() => setA(3));
    expect(created).toBe(1);
    expect(values).toEqual(["A"]);
    dispose();
  });

  it("[SWT-09] tears down the previous branch before the next one is created", () => {
    const [a, setA] = useSignal<boolean>(true);
    const order: string[] = [];
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: (_value: unknown) => {
            order.push("create A");
            onCleanup(() => order.push("cleanup A"));
            return "A";
          },
        }),
        Match({
          get when() {
            return !a();
          },
          children: (_value: unknown) => {
            order.push("create B");
            onCleanup(() => order.push("cleanup B"));
            return "B";
          },
        }),
      ],
    });
    const { dispose } = watch(view);
    flushSync(() => setA(false));
    flushSync(() => setA(true));
    expect(order).toEqual(["create A", "cleanup A", "create B", "cleanup B", "create A"]);
    dispose();
  });

  it("[SWT-10] an earlier Match that becomes truthy takes over from a later one", () => {
    const [first, setFirst] = useSignal<boolean>(false);
    const [second, _setSecond] = useSignal<boolean>(true);
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return first();
          },
          children: "first",
        }),
        Match({
          get when() {
            return second();
          },
          children: "second",
        }),
      ],
    });
    const { values, dispose } = watch(view);
    flushSync(() => setFirst(true));
    expect(values).toEqual(["second", "first"]);
    dispose();
  });

  it("[SWT-11] a single Match child (not an array) works", () => {
    const view = Switch({
      fallback: "none",
      children: Match({ when: true, children: "only" }),
    });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["only"]);
    dispose();
  });

  it("[SWT-12] Match returns the props object it was given", () => {
    const props = { when: true, children: "x" } as const;
    expect(Match(props)).toBe(props);
  });

  it("[SWT-13] reads the fallback lazily, only while it is shown", () => {
    const [a, setA] = useSignal<boolean>(true);
    let reads = 0;
    const view = Switch({
      get fallback() {
        reads += 1;
        return "none";
      },
      children: [
        Match({
          get when() {
            return a();
          },
          children: "A",
        }),
      ],
    });
    const { values, dispose } = watch(view);
    expect(reads).toBe(0);
    flushSync(() => setA(false));
    expect(reads).toBe(1);
    expect(values).toEqual(["A", "none"]);
    dispose();
  });

  it("[SWT-14] show, hide, show, hide cycles of a Match create and clean up once each", () => {
    const [a, setA] = useSignal<boolean>(true);
    let created = 0;
    let cleaned = 0;
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: (_value: unknown) => {
            created += 1;
            onCleanup(() => {
              cleaned += 1;
            });
            return "A";
          },
        }),
      ],
    });
    const { dispose } = watch(view);
    flushSync(() => setA(false));
    flushSync(() => setA(true));
    flushSync(() => setA(false));
    flushSync(() => setA(true));
    expect([created, cleaned]).toEqual([3, 2]);
    dispose();
  });
});

describe("Switch: callbacks, keyed matches and stale accessors", () => {
  it("[SWT-15] a non-keyed callback receives an accessor of the latest truthy value", () => {
    const [a, setA] = useSignal<number | null>(1);
    let read: (() => number) | undefined;
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: (value: () => number) => {
            read = value;
            return "A";
          },
        }),
      ],
    });
    const { dispose } = watch(view);
    flushSync(() => setA(5));
    expect(read?.()).toBe(5);
    dispose();
  });

  it("[SWT-16] reading the accessor after its Match was replaced throws a TypeError", () => {
    const [a, setA] = useSignal<boolean>(true);
    let read: (() => boolean) | undefined;
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: (value: () => boolean) => {
            read = value;
            return "A";
          },
        }),
      ],
    });
    const { dispose } = watch(view);
    flushSync(() => setA(false));
    expect(() => read?.()).toThrow(TypeError);
    dispose();
  });

  it("[SWT-17] the stale error message starts with 'ShadowJS Switch: stale accessor'", () => {
    const [a, setA] = useSignal<boolean>(true);
    let read: (() => boolean) | undefined;
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: (value: () => boolean) => {
            read = value;
            return "A";
          },
        }),
      ],
    });
    const { dispose } = watch(view);
    flushSync(() => setA(false));
    let message = "";
    try {
      read?.();
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message.startsWith("ShadowJS Switch: stale accessor")).toBe(true);
    dispose();
  });

  it("[SWT-18] a cleanup reading the accessor during the teardown does not throw", () => {
    const [a, setA] = useSignal<number | null>(3);
    const seen: number[] = [];
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: (value: () => number) => {
            onCleanup(() => {
              seen.push(value());
            });
            return "A";
          },
        }),
      ],
    });
    const { values, dispose } = watch(view);
    flushSync(() => setA(null));
    expect(seen).toEqual([3]);
    expect(values).toEqual(["A", "none"]);
    dispose();
  });

  it("[SWT-19] keyed Match callbacks receive the value and rebuild when its identity changes", () => {
    const first = { id: 1 };
    const [item, setItem] = useSignal<{ id: number }>(first);
    const received: number[] = [];
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return item();
          },
          keyed: true,
          children: (value: { id: number }) => {
            received.push(value.id);
            return `id ${String(value.id)}`;
          },
        }),
      ],
    });
    const { values, dispose } = watch(view);
    flushSync(() => setItem(first));
    expect(received).toEqual([1]);
    flushSync(() => setItem({ id: 2 }));
    expect(received).toEqual([1, 2]);
    expect(values).toEqual(["id 1", "id 2"]);
    dispose();
  });

  it("[SWT-20] a batch that flips many Match conditions builds only the final selection", () => {
    const [a, setA] = useSignal<boolean>(false);
    const [b, setB] = useSignal<boolean>(false);
    let created = 0;
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: "A",
        }),
        Match({
          get when() {
            return b();
          },
          children: (_value: unknown) => {
            created += 1;
            return "B";
          },
        }),
      ],
    });
    const { values, dispose } = watch(view);
    batch(() => {
      setB(true);
      setB(false);
      setB(true);
      setA(true);
      setA(false);
      setB(true);
    });
    flushSync();
    expect(created).toBe(1);
    expect(values).toEqual(["none", "B"]);
    dispose();
  });

  it("[SWT-21] a single Match child with an accessor child is returned as is", () => {
    const [text, setText] = useSignal("one");
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          when: true,
          children: (): string => text(),
        }),
      ],
    });
    const { values, dispose } = watch(view);
    flushSync(() => setText("two"));
    expect(values).toEqual(["one", "two"]);
    dispose();
  });

  it("[SWT-22] an effect that depends only on the selection does not re-run when a Match stays selected", () => {
    const [a, setA] = useSignal<number>(1);
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when() {
            return a();
          },
          children: "A",
        }),
      ],
    });
    const { dispose } = watch(view);
    const runs = { count: 0 };
    const stop = createRoot((dispose) => {
      useEffect(() => {
        untrack(view);
        runs.count += 1;
      });
      return dispose;
    });
    flushSync();
    expect(runs.count).toBe(1);
    flushSync(() => setA(2));
    expect(runs.count).toBe(1);
    stop();
    dispose();
  });

  it("[SWT-23] a throwing when getter surfaces when the Switch is read", () => {
    const view = Switch({
      fallback: "none",
      children: [
        Match({
          get when(): boolean {
            throw new Error("match when failed");
          },
          children: "A",
        }),
      ],
    });
    expect(() => untrack(view)).toThrow("match when failed");
  });

  it("[SWT-24] disposing the owner tears down a shown Match once", () => {
    let cleaned = 0;
    const dispose = createRoot((dispose) => {
      Switch({
        fallback: "none",
        children: [
          Match({
            when: true,
            children: (_value: unknown) => {
              onCleanup(() => {
                cleaned += 1;
              });
              return "A";
            },
          }),
        ],
      });
      return dispose;
    });
    expect(cleaned).toBe(0);
    dispose();
    expect(cleaned).toBe(1);
  });

  it("[SWT-25] Switch nested inside Show is torn down with its parent branch", () => {
    const [outer, setOuter] = useSignal<boolean>(true);
    const [a, _setA] = useSignal<boolean>(true);
    let innerCleaned = 0;
    const view = Show({
      get when() {
        return outer();
      },
      children: (_value: unknown) =>
        Switch({
          fallback: "none",
          children: [
            Match({
              get when() {
                return a();
              },
              children: (_inner: unknown) => {
                onCleanup(() => {
                  innerCleaned += 1;
                });
                return "A";
              },
            }),
          ],
        }),
      fallback: "hidden",
    });
    const { values, dispose } = watch(view);
    expect(values).toEqual(["A"]);
    flushSync(() => setOuter(false));
    expect(innerCleaned).toBe(1);
    expect(values).toEqual(["A", "hidden"]);
    dispose();
  });
});
