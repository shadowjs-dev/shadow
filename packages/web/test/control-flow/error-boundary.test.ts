import {
  type Accessor,
  createRoot,
  flushSync,
  onCleanup,
  untrack,
  useEffect,
  useMemo,
  useRenderEffect,
  useSignal,
} from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { ErrorBoundary, For, Show } from "../../src/control-flow/index";

/** Unwraps accessors the way the DOM insert does: a function value is read until a plain value appears. */
function unwrap(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") current = (current as () => unknown)();
  return current;
}

/** Builds the view inside its own root and records the unwrapped value after every flush. */
function mount(make: () => Accessor<unknown>): { values: unknown[]; dispose: () => void } {
  const values: unknown[] = [];
  const dispose = createRoot((dispose) => {
    const view = make();
    useEffect(() => {
      values.push(unwrap(view()));
    });
    return dispose;
  });
  flushSync();
  return { values, dispose };
}

/** Text of an error for assertions: messages for Errors, the value itself otherwise. */
function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("ErrorBoundary: creation errors", () => {
  it("[EBD-01] renders children when nothing throws", () => {
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: "failed",
        get children() {
          return "ok";
        },
      }),
    );
    expect(values).toEqual(["ok"]);
    dispose();
  });

  it("[EBD-02] returns an accessor (a memo) rather than the content itself", () => {
    const view = createRoot((dispose) => {
      const boundary = ErrorBoundary({ fallback: "failed", children: "ok" });
      dispose();
      return boundary;
    });
    expect(typeof view).toBe("function");
  });

  it("[EBD-03] a synchronous throw while creating the children shows the fallback with the error", () => {
    const original = new Error("create failed");
    const received: unknown[] = [];
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (error: unknown) => {
          received.push(error);
          return `caught:${text(error)}`;
        },
        get children(): string {
          throw original;
        },
      }),
    );
    expect(values).toEqual(["caught:create failed"]);
    expect(received).toEqual([original]);
    expect(received[0]).toBe(original);
    dispose();
  });

  it("[EBD-04] throwing undefined still shows the fallback, which receives undefined", () => {
    const received: unknown[] = [];
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (error: unknown) => {
          received.push(error);
          return "caught";
        },
        get children(): string {
          throw undefined;
        },
      }),
    );
    expect(values).toEqual(["caught"]);
    expect(received).toEqual([undefined]);
    dispose();
  });

  it("[EBD-05] falsy thrown values (0, empty string, null, false) are all errors", () => {
    for (const value of [0, "", null, false] as const) {
      const received: unknown[] = [];
      const { values, dispose } = mount(() =>
        ErrorBoundary({
          fallback: (error: unknown) => {
            received.push(error);
            return "caught";
          },
          get children(): string {
            throw value;
          },
        }),
      );
      expect(values).toEqual(["caught"]);
      expect(received).toEqual([value]);
      dispose();
    }
  });

  it("[EBD-06] a plain (non-function) fallback is returned as is", () => {
    const fallback = { tag: "fallback" };
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: fallback as never,
        get children(): string {
          throw new Error("boom");
        },
      }),
    );
    expect(values).toEqual([fallback]);
    expect(values[0]).toBe(fallback);
    dispose();
  });

  it("[EBD-07] a function fallback is called once, untracked, with the error and a reset function", () => {
    let calls = 0;
    let receivedReset: unknown;
    const { dispose } = mount(() =>
      ErrorBoundary({
        fallback: (_error: unknown, reset: () => void) => {
          calls += 1;
          receivedReset = reset;
          return "caught";
        },
        get children(): string {
          throw new Error("boom");
        },
      }),
    );
    expect(calls).toBe(1);
    expect(typeof receivedReset).toBe("function");
    dispose();
  });

  it("[EBD-08] a synchronous render-phase effect that throws during creation is captured", () => {
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (error: unknown) => `caught:${text(error)}`,
        get children(): string {
          useRenderEffect(() => {
            throw new Error("render effect");
          });
          return "ok";
        },
      }),
    );
    expect(values).toEqual(["caught:render effect"]);
    dispose();
  });

  it("[EBD-09] partially created children are disposed before the fallback is shown", () => {
    let cleaned = 0;
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: "caught",
        get children(): string {
          onCleanup(() => {
            cleaned += 1;
          });
          throw new Error("after effect");
        },
      }),
    );
    flushSync();
    expect(cleaned).toBe(1);
    expect(values).toEqual(["caught"]);
    dispose();
  });

  it("[EBD-10] a creation error inside a nested Show is caught by the boundary", () => {
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: "caught",
        get children() {
          // Read the Show eagerly, the way a render effect would, so its creation error lands here.
          const view = Show({
            when: true,
            children: (_value: unknown): string => {
              throw new Error("in show");
            },
          });
          return untrack(view) as never;
        },
      }),
    );
    expect(values).toEqual(["caught"]);
    dispose();
  });
});

describe("ErrorBoundary: late errors", () => {
  it("[EBD-11] an effect that throws later replaces the children with the fallback", () => {
    const [boom, setBoom] = useSignal<boolean>(false);
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (error: unknown) => `caught:${text(error)}`,
        get children() {
          useEffect(() => {
            if (boom()) throw new Error("late");
          });
          return "ok";
        },
      }),
    );
    expect(values).toEqual(["ok"]);
    flushSync(() => setBoom(true));
    expect(values).toEqual(["ok", "caught:late"]);
    dispose();
  });

  it("[EBD-12] a memo inside the children that throws surfaces through a reader inside them", () => {
    const [fail, setFail] = useSignal<boolean>(false);
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (error: unknown) => `caught:${text(error)}`,
        get children() {
          const readMemo = useMemo(() => {
            if (fail()) throw new Error("memo");
            return "value";
          });
          useEffect(() => {
            readMemo();
          });
          return "ok";
        },
      }),
    );
    flushSync(() => setFail(true));
    expect(values).toEqual(["ok", "caught:memo"]);
    dispose();
  });

  it("[EBD-13] a cleanup that throws when a child effect re-runs is routed to the boundary", () => {
    const [step, setStep] = useSignal<number>(0);
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (error: unknown) => `caught:${text(error)}`,
        get children() {
          useEffect(() => {
            if (step() > 0) return undefined;
            return () => {
              throw new Error("cleanup");
            };
          });
          return "ok";
        },
      }),
    );
    flushSync(() => setStep(1));
    expect(values).toEqual(["ok", "caught:cleanup"]);
    dispose();
  });

  it("[EBD-14] a late error disposes the children, running their cleanups once", () => {
    const [boom, setBoom] = useSignal<boolean>(false);
    let cleaned = 0;
    const { dispose } = mount(() =>
      ErrorBoundary({
        fallback: "caught",
        get children() {
          useEffect(() => {
            onCleanup(() => {
              cleaned += 1;
            });
            if (boom()) throw new Error("late");
          });
          return "ok";
        },
      }),
    );
    flushSync(() => setBoom(true));
    // One cleanup for the first run (when the effect re-ran) and one for the run that threw.
    expect(cleaned).toBe(2);
    dispose();
  });

  it("[EBD-15] the fallback receives the late error object itself", () => {
    const [boom, setBoom] = useSignal<boolean>(false);
    const original = new Error("late identity");
    let received: unknown;
    const { dispose } = mount(() =>
      ErrorBoundary({
        fallback: (error: unknown) => {
          received = error;
          return "caught";
        },
        get children() {
          useEffect(() => {
            if (boom()) throw original;
          });
          return "ok";
        },
      }),
    );
    flushSync(() => setBoom(true));
    expect(received).toBe(original);
    dispose();
  });

  it("[EBD-16] several late errors in one flush show the fallback once", () => {
    const [boom, setBoom] = useSignal<boolean>(false);
    let calls = 0;
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: () => {
          calls += 1;
          return "caught";
        },
        get children() {
          useEffect(() => {
            if (boom()) throw new Error("one");
          });
          useEffect(() => {
            if (boom()) throw new Error("two");
          });
          return "ok";
        },
      }),
    );
    flushSync(() => setBoom(true));
    expect(calls).toBe(1);
    expect(values.at(-1)).toBe("caught");
    dispose();
  });

  it("[EBD-17] a late error inside a For row replaces the whole boundary content", () => {
    const [items, setItems] = useSignal<readonly number[]>([1, 2]);
    const [boom, setBoom] = useSignal<number | null>(null);
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: "caught",
        get children() {
          return For({
            get each() {
              return items();
            },
            children: (item: number) => {
              useEffect(() => {
                if (boom() === item) throw new Error(`row ${String(item)}`);
              });
              return item;
            },
          });
        },
      }),
    );
    expect(values.at(-1)).toEqual([1, 2]);
    flushSync(() => setBoom(2));
    expect(values.at(-1)).toBe("caught");
    flushSync(() => setItems([3]));
    expect(values.at(-1)).toBe("caught");
    dispose();
  });

  it("[EBD-18] a late error inside a Show branch is handled by the closest boundary", () => {
    const [visible] = useSignal<boolean>(true);
    const [boom, setBoom] = useSignal<boolean>(false);
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: "caught",
        get children() {
          return Show({
            get when() {
              return visible();
            },
            children: (_value: unknown) => {
              useEffect(() => {
                if (boom()) throw new Error("show branch");
              });
              return "shown";
            },
          });
        },
      }),
    );
    flushSync(() => setBoom(true));
    expect(values).toEqual(["shown", "caught"]);
    dispose();
  });
});

describe("ErrorBoundary: reset", () => {
  it("[EBD-19] reset rebuilds the children from scratch after a creation error", () => {
    let broken = true;
    let attempts = 0;
    let resetFn: (() => void) | undefined;
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (_error: unknown, reset: () => void) => {
          resetFn = reset;
          return "fallback";
        },
        get children() {
          attempts += 1;
          if (broken) throw new Error("still broken");
          return "ok";
        },
      }),
    );
    expect(values).toEqual(["fallback"]);
    broken = false;
    flushSync(() => resetFn?.());
    expect(values).toEqual(["fallback", "ok"]);
    expect(attempts).toBe(2);
    dispose();
  });

  it("[EBD-20] reset rebuilds after a late error and the children run again", () => {
    const [boom, setBoom] = useSignal<boolean>(false);
    let resetFn: (() => void) | undefined;
    let builds = 0;
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (_error: unknown, reset: () => void) => {
          resetFn = reset;
          return "fallback";
        },
        get children() {
          builds += 1;
          useEffect(() => {
            if (boom()) throw new Error("late");
          });
          return "ok";
        },
      }),
    );
    flushSync(() => setBoom(true));
    expect(values.at(-1)).toBe("fallback");
    flushSync(() => setBoom(false));
    flushSync(() => resetFn?.());
    expect(values.at(-1)).toBe("ok");
    expect(builds).toBe(2);
    dispose();
  });

  it("[EBD-21] a reset whose children still throw shows the fallback again", () => {
    let attempts = 0;
    let resetFn: (() => void) | undefined;
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (_error: unknown, reset: () => void) => {
          resetFn = reset;
          return "fallback";
        },
        get children(): string {
          attempts += 1;
          throw new Error("never fixed");
        },
      }),
    );
    flushSync(() => resetFn?.());
    expect(attempts).toBe(2);
    expect(values.at(-1)).toBe("fallback");
    dispose();
  });

  it("[EBD-22] reset is idempotent: calling it twice builds the children once", () => {
    let broken = true;
    let attempts = 0;
    let resetFn: (() => void) | undefined;
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (_error: unknown, reset: () => void) => {
          resetFn = reset;
          return "fallback";
        },
        get children() {
          attempts += 1;
          if (broken) throw new Error("x");
          return "ok";
        },
      }),
    );
    broken = false;
    flushSync(() => {
      resetFn?.();
      resetFn?.();
    });
    expect(values.at(-1)).toBe("ok");
    expect(attempts).toBe(2);
    dispose();
  });

  it("[EBD-23] the fallback can be shown and reset repeatedly", () => {
    let attempt = 0;
    let resetFn: (() => void) | undefined;
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (_error: unknown, reset: () => void) => {
          resetFn = reset;
          return "fallback";
        },
        get children(): string {
          attempt += 1;
          if (attempt % 2 === 1) throw new Error(`attempt ${String(attempt)}`);
          return `ok ${String(attempt)}`;
        },
      }),
    );
    // attempt 1 fails, attempt 2 succeeds, attempt 3 (the second reset) fails again.
    flushSync(() => resetFn?.());
    expect(values).toEqual(["fallback", "ok 2"]);
    flushSync(() => resetFn?.());
    expect(values).toEqual(["fallback", "ok 2", "fallback"]);
    dispose();
  });
});

describe("ErrorBoundary: nesting, parents and disposal", () => {
  it("[EBD-24] an error inside the fallback propagates to the parent boundary", () => {
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: "outer fallback",
        get children() {
          const inner = ErrorBoundary({
            fallback: (): string => {
              throw new Error("inner fallback");
            },
            get children(): string {
              throw new Error("inner children");
            },
          });
          useEffect(() => {
            unwrap(inner);
          });
          return "outer ok";
        },
      }),
    );
    expect(values.at(-1)).toBe("outer fallback");
    dispose();
  });

  it("[EBD-25] an inner boundary catches its own late error without touching the outer one", () => {
    const [boom, setBoom] = useSignal<boolean>(false);
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: "outer fallback",
        get children() {
          const inner = ErrorBoundary({
            fallback: "inner fallback",
            get children() {
              useEffect(() => {
                if (boom()) throw new Error("inner late");
              });
              return "inner ok";
            },
          });
          return inner;
        },
      }),
    );
    expect(values.at(-1)).toBe("inner ok");
    flushSync(() => setBoom(true));
    expect(values.at(-1)).toBe("inner fallback");
    dispose();
  });

  it("[EBD-26] an error thrown after dispose is dropped without an unhandled error", () => {
    let disposeRoot: (() => void) | undefined;
    const dispose = createRoot((dispose) => {
      disposeRoot = dispose;
      const view = ErrorBoundary({
        fallback: "fallback",
        get children() {
          useEffect(() => () => {
            throw new Error("cleanup after dispose");
          });
          return "ok";
        },
      });
      untrack(view);
      return dispose;
    });
    flushSync();
    expect(() => dispose()).not.toThrow();
    expect(disposeRoot).toBeDefined();
  });

  it("[EBD-27] reset after dispose is a no-op and does not throw", () => {
    let resetFn: (() => void) | undefined;
    const dispose = createRoot((dispose) => {
      const view = ErrorBoundary({
        fallback: (_error: unknown, reset: () => void) => {
          resetFn = reset;
          return "fallback";
        },
        get children(): string {
          throw new Error("boom");
        },
      });
      untrack(view);
      return dispose;
    });
    dispose();
    expect(() => resetFn?.()).not.toThrow();
  });

  it("[EBD-28] disposing the boundary disposes the fallback content", () => {
    let cleaned = 0;
    const dispose = createRoot((dispose) => {
      const view = ErrorBoundary({
        fallback: () => {
          useEffect(() => () => {
            cleaned += 1;
          });
          return "fallback";
        },
        get children(): string {
          throw new Error("boom");
        },
      });
      untrack(view);
      return dispose;
    });
    flushSync();
    expect(cleaned).toBe(0);
    dispose();
    expect(cleaned).toBe(1);
  });

  it("[EBD-29] disposing the boundary runs the children's cleanups exactly once", () => {
    let cleaned = 0;
    const dispose = createRoot((dispose) => {
      const view = ErrorBoundary({
        fallback: "fallback",
        get children() {
          useEffect(() => () => {
            cleaned += 1;
          });
          return "ok";
        },
      });
      untrack(view);
      return dispose;
    });
    flushSync();
    dispose();
    expect(cleaned).toBe(1);
  });

  it("[EBD-30] an error in a sibling boundary does not affect a boundary created beside it", () => {
    const [boom, setBoom] = useSignal<boolean>(false);
    const { values, dispose } = mount(() =>
      For({
        each: [1, 2],
        children: (item: number) =>
          ErrorBoundary({
            fallback: `caught ${String(item)}`,
            get children() {
              useEffect(() => {
                if (boom() && item === 1) throw new Error("only one");
              });
              return `ok ${String(item)}`;
            },
          }),
      }),
    );
    expect(values.at(-1)).toEqual([expect.any(Function), expect.any(Function)]);
    flushSync(() => setBoom(true));
    const rows = values.at(-1);
    expect(Array.isArray(rows)).toBe(true);
    if (Array.isArray(rows)) {
      expect(rows.map((row) => unwrap(row))).toEqual(["caught 1", "ok 2"]);
    }
    dispose();
  });
});
