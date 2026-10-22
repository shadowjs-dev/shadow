import type { Accessor, Setter } from "@shadow-js/core";
import * as core from "@shadow-js/core";
import {
  batch,
  createRoot,
  flushSync,
  onCleanup,
  onMount,
  untrack,
  useEffect,
  useMemo,
  useRenderEffect,
  useSelector,
  useSignal,
} from "@shadow-js/core";
import { useStore } from "@shadow-js/core/store";
import { effect, render } from "@shadow-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "../support/compile";

// Solid-docs parity, area RX (part 1): signals, derived signals, memos, effects, render effects,
// computed, reaction, deferred, selector, fine-grained reactivity.

const disposers: Array<() => void> = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dispose of disposers.splice(0).reverse()) dispose();
  document.body.replaceChildren();
});

/** Runs `fn` inside a root that is disposed after the test. */
function inRoot<T>(fn: () => T): T {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return fn();
  });
}

function mount(view: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  disposers.push(render(view, host));
  return host;
}

function q<T extends Element = HTMLElement>(parent: ParentNode, selector: string): T {
  const found = parent.querySelector<T>(selector);
  if (found === null) throw new Error(`missing element: ${selector}`);
  return found;
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("concepts/signals + reference/create-signal", () => {
  it("[SOLID-RX-01] concepts/signals: createSignal returns a getter/setter pair (useSignal)", () => {
    const [count, setCount] = useSignal(0);
    expect(typeof count).toBe("function");
    expect(typeof setCount).toBe("function");
    expect(count()).toBe(0);
  });

  it("[SOLID-RX-02] concepts/signals: setCount(count() + 1) updates the value", () => {
    const [count, setCount] = useSignal(0);
    setCount(count() + 1);
    expect(count()).toBe(1);
  });

  it("[SOLID-RX-03] concepts/signals: the setter accepts an updater that receives the previous value", () => {
    const [count, setCount] = useSignal(0);
    setCount((prevCount) => prevCount + 1);
    expect(count()).toBe(1);
    setCount((prevCount) => prevCount + 10);
    expect(count()).toBe(11);
  });

  it("[SOLID-RX-04] concepts/signals: mutating an array in place does not notify, setItems(copy) does", () => {
    const [items, setItems] = useSignal(["apple", "banana"]);
    const seen: string[][] = [];
    inRoot(() =>
      useEffect(() => {
        seen.push([...items()]);
      }),
    );
    flushSync();
    items().push("cherry");
    flushSync();
    expect(seen).toHaveLength(1);
    setItems((currentItems) => [...currentItems, "date"]);
    flushSync();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(["apple", "banana", "cherry", "date"]);
  });

  it("[SOLID-RX-05] concepts/intro-to-reactivity: reading inside an effect subscribes it (logs Count: 0, Count: 1)", () => {
    const [count, setCount] = useSignal(0);
    const log: string[] = [];
    inRoot(() =>
      useEffect(() => {
        log.push(`Count: ${count()}`);
      }),
    );
    flushSync();
    setCount(1);
    flushSync();
    expect(log).toEqual(["Count: 0", "Count: 1"]);
  });

  it("[SOLID-RX-06] concepts/intro-to-reactivity: a read outside a tracking scope never re-runs", () => {
    const [count, setCount] = useSignal(0);
    const log: string[] = [];
    inRoot(() => {
      log.push(`Count: ${count()}`);
    });
    setCount(1);
    flushSync();
    expect(log).toEqual(["Count: 0"]);
  });

  it("[SOLID-RX-07] concepts/signals: untrack(count) reads without subscribing (there is no .peek())", () => {
    const [count, setCount] = useSignal(0);
    let runs = 0;
    inRoot(() =>
      useEffect(() => {
        runs += 1;
        untrack(count);
      }),
    );
    flushSync();
    setCount(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[SOLID-RX-08] reference/create-signal: equal primitive writes (===) do not notify", () => {
    const [count, setCount] = useSignal(1);
    let runs = 0;
    inRoot(() =>
      useEffect(() => {
        count();
        runs += 1;
      }),
    );
    flushSync();
    setCount(1);
    flushSync();
    expect(runs).toBe(1);
    setCount(2);
    flushSync();
    expect(runs).toBe(2);
  });

  // DIFFERENCE from Solid (by design): default equality is Object.is (packages/core/src/signal.ts:29), Solid's is `===`, so a NaN write notifies in Solid but not here
  it("[SOLID-RX-09] reference/create-signal: default equality is reference equality (===), NaN to NaN notifies (differs from Solid; ShadowJS: equality is Object.is, so NaN to NaN does not notify)", () => {
    const [n, setN] = useSignal(Number.NaN);
    let runs = 0;
    inRoot(() =>
      useEffect(() => {
        n();
        runs += 1;
      }),
    );
    flushSync();
    setN(Number.NaN);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[SOLID-RX-10] reference/create-signal: equals: false always notifies, even for the same value", () => {
    const [count, setCount] = useSignal(0, { equals: false });
    let runs = 0;
    inRoot(() =>
      useEffect(() => {
        count();
        runs += 1;
      }),
    );
    flushSync();
    setCount(0);
    flushSync();
    setCount(0);
    flushSync();
    expect(runs).toBe(3);
  });

  it("[SOLID-RX-11] reference/create-signal: custom equals(prev, next) returning true suppresses the update", () => {
    const [point, setPoint] = useSignal(
      { x: 1, label: "a" },
      { equals: (prev, next) => prev.x === next.x },
    );
    const seen: string[] = [];
    inRoot(() =>
      useEffect(() => {
        seen.push(point().label);
      }),
    );
    flushSync();
    setPoint({ x: 1, label: "b" });
    flushSync();
    expect(seen).toEqual(["a"]);
    setPoint({ x: 2, label: "c" });
    flushSync();
    expect(seen).toEqual(["a", "c"]);
  });

  it("[SOLID-RX-12] reference/create-signal: a function initial value is stored as is; setX(() => fn) stores a function", () => {
    const first = () => "first";
    const second = () => "second";
    const [fn, setFn] = useSignal(first);
    expect(fn()).toBe(first);
    setFn(() => second);
    expect(fn()).toBe(second);
  });

  it("[SOLID-RX-13] reference/create-signal: the setter returns the value that was set", () => {
    const [count, setCount] = useSignal(0);
    expect(setCount(5)).toBe(5);
    expect(setCount((prev) => prev + 1)).toBe(6);
    expect(count()).toBe(6);
  });

  it("[SOLID-RX-14] reference/create-signal: createSignal() with no value starts as undefined, options.name accepted", () => {
    // The zero-argument overload exists at runtime only; the type requires a value (type-level gap).
    const create = useSignal as unknown as (
      value?: undefined,
      options?: { name?: string },
    ) => [Accessor<undefined>, Setter<undefined>];
    const [value] = create(undefined, { name: "empty" });
    expect(value()).toBeUndefined();
    const [named, setNamed] = useSignal(1, { name: "counter" });
    setNamed(2);
    expect(named()).toBe(2);
  });

  it("[SOLID-RX-15] reference/create-signal: reads inside a setter updater are untracked", () => {
    const [a, setA] = useSignal(1);
    const [b, setB] = useSignal(10);
    let runs = 0;
    inRoot(() =>
      useEffect(() => {
        runs += 1;
        setA((prev) => prev + b());
      }),
    );
    flushSync();
    expect(a()).toBe(11);
    setB(20);
    flushSync();
    expect(runs).toBe(1);
  });
});

describe("concepts/derived-values/derived-signals", () => {
  it("[SOLID-RX-16] concepts/derived-signals: const double = () => count() * 2 is re-evaluated inside an effect", () => {
    const [count, setCount] = useSignal(1);
    const double = () => count() * 2;
    const seen: number[] = [];
    inRoot(() =>
      useEffect(() => {
        seen.push(double());
      }),
    );
    flushSync();
    setCount(2);
    flushSync();
    expect(seen).toEqual([2, 4]);
  });

  it("[SOLID-RX-17] concepts/derived-signals: a derived signal over store properties (fullName) tracks the store", () => {
    const [store, setStore] = useStore({ firstName: "Ada", lastName: "Lovelace" });
    const fullName = () => `${store.firstName} ${store.lastName}`;
    const seen: string[] = [];
    inRoot(() =>
      useEffect(() => {
        seen.push(fullName());
      }),
    );
    flushSync();
    setStore((draft) => {
      draft.lastName = "Byron";
    });
    flushSync();
    expect(seen).toEqual(["Ada Lovelace", "Ada Byron"]);
  });

  it("[SOLID-RX-18] concepts/derived-signals: a derived signal stores no value (recomputes per call); a memo caches", () => {
    const [count, setCount] = useSignal(1);
    let derivedRuns = 0;
    let memoRuns = 0;
    const derived = () => {
      derivedRuns += 1;
      return count() * 2;
    };
    inRoot(() => {
      const memo = useMemo(() => {
        memoRuns += 1;
        return count() * 2;
      });
      useEffect(() => {
        derived();
        derived();
        memo();
        memo();
      });
    });
    flushSync();
    expect(derivedRuns).toBe(2);
    expect(memoRuns).toBe(1);
    setCount(2);
    flushSync();
    expect(derivedRuns).toBe(4);
    expect(memoRuns).toBe(2);
  });

  it("[SOLID-RX-19] concepts/derived-signals: a derived signal in JSX updates the bound text", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export const App = () => {
        const [count, setCount] = useSignal(1);
        const double = () => count() * 2;
        return <div><p>Doubled: {double()}</p><button onClick={() => setCount(count() + 1)}>inc</button></div>;
      };
    `);
    const host = mount(() => mod.App());
    expect(q(host, "p").textContent).toBe("Doubled: 2");
    q(host, "button").click();
    flushSync();
    expect(q(host, "p").textContent).toBe("Doubled: 4");
  });

  it("[SOLID-RX-20] concepts/derived-signals: examples/counter trap, const doubled = count() * 2 then {doubled()} is made live by the compiler's derive pass", async () => {
    // Solid compiles {doubled()} to insert(el, doubled) with doubled a plain number: static text.
    // ShadowJS' compiler (packages/compiler/src/internal/derive.ts, "forgiving reactivity") wraps a
    // component-body const computed from reactive reads into a derived accessor, so it updates.
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export const App = () => {
        const [count, setCount] = useSignal(1);
        const doubled = count() * 2;
        return <div><p>Doubled: {doubled()}</p><button onClick={() => setCount(count() + 1)}>inc</button></div>;
      };
    `);
    const host = mount(() => mod.App());
    expect(q(host, "p").textContent).toBe("Doubled: 2");
    q(host, "button").click();
    flushSync();
    expect(q(host, "p").textContent).toBe("Doubled: 4");
  });

  it("[SOLID-RX-148] concepts/derived-signals: outside a PascalCase component the trap stays, a const computed once is static text", async () => {
    // The derive pass only rewrites PascalCase component functions. A lowercase view function keeps
    // Solid's behavior: {doubled()} lowers to insert(el, doubled) with a number, so no update.
    const mod = await load<{ view: () => unknown; bump: () => void }>(`
      import { useSignal } from "@shadow-js/core";
      const [count, setCount] = useSignal(1);
      export const bump = () => setCount(count() + 1);
      export function view() {
        const doubled = count() * 2;
        return <p>Doubled: {doubled()}</p>;
      }
    `);
    const host = mount(() => mod.view());
    expect(q(host, "p").textContent).toBe("Doubled: 2");
    mod.bump();
    flushSync();
    expect(q(host, "p").textContent).toBe("Doubled: 2");
  });
});

describe("concepts/derived-values/memos + reference/create-memo", () => {
  it("[SOLID-RX-21] concepts/memos: isEven memo reads fresh right after a write (true, then false after setCount(3))", () => {
    const [count, setCount] = useSignal(0);
    const isEven = inRoot(() => useMemo(() => count() % 2 === 0));
    expect(isEven()).toBe(true);
    setCount(3);
    expect(isEven()).toBe(false);
  });

  it("[SOLID-RX-22] concepts/memos: a memo caches; repeated reads do not re-run the function", () => {
    const [count, setCount] = useSignal(1);
    let runs = 0;
    const memo = inRoot(() =>
      useMemo(() => {
        runs += 1;
        return count() * 2;
      }),
    );
    memo();
    memo();
    memo();
    expect(runs).toBe(1);
    setCount(2);
    memo();
    memo();
    expect(runs).toBe(2);
  });

  it("[SOLID-RX-23] concepts/memos: a memo executes once per dependency change regardless of the number of observers", () => {
    const [count, setCount] = useSignal(1);
    let runs = 0;
    const seenA: number[] = [];
    const seenB: number[] = [];
    inRoot(() => {
      const memo = useMemo(() => {
        runs += 1;
        return count() + 1;
      });
      useEffect(() => {
        seenA.push(memo());
      });
      useEffect(() => {
        seenB.push(memo());
      });
    });
    flushSync();
    setCount(2);
    flushSync();
    expect(runs).toBe(2);
    expect(seenA).toEqual([2, 3]);
    expect(seenB).toEqual([2, 3]);
  });

  it("[SOLID-RX-24] concepts/memos: no downstream update when dependencies change but the value is === equal", () => {
    const [count, setCount] = useSignal(2);
    const seen: boolean[] = [];
    inRoot(() => {
      const isEven = useMemo(() => count() % 2 === 0);
      useEffect(() => {
        seen.push(isEven());
      });
    });
    flushSync();
    setCount(4);
    flushSync();
    expect(seen).toEqual([true]);
    setCount(5);
    flushSync();
    expect(seen).toEqual([true, false]);
  });

  it("[SOLID-RX-25] reference/create-memo: custom equals (DateNormalizer) suppresses notifications for equal timestamps", () => {
    const [dateString, setDateString] = useSignal("2024-05-10");
    const seen: string[] = [];
    inRoot(() => {
      const dateObject = useMemo(() => new Date(dateString()), {
        equals: (prev, next) => prev.getTime() === next.getTime(),
      });
      useEffect(() => {
        seen.push(dateObject().toISOString());
      });
    });
    flushSync();
    setDateString("2024-05-10");
    flushSync();
    expect(seen).toEqual(["2024-05-10T00:00:00.000Z"]);
    setDateString("2024-05-11");
    flushSync();
    expect(seen).toEqual(["2024-05-10T00:00:00.000Z", "2024-05-11T00:00:00.000Z"]);
  });

  it("[SOLID-RX-26] reference/create-memo: equals: false notifies on every re-execution", () => {
    const [count, setCount] = useSignal(2);
    let effectRuns = 0;
    inRoot(() => {
      const isEven = useMemo(() => count() % 2 === 0, { equals: false });
      useEffect(() => {
        isEven();
        effectRuns += 1;
      });
    });
    flushSync();
    setCount(4);
    flushSync();
    expect(effectRuns).toBe(2);
  });

  it("[SOLID-RX-27] reference/create-memo: fn receives the previous value (undefined on the first run)", () => {
    const [count, setCount] = useSignal(0);
    const trend = inRoot(() =>
      useMemo((prev: { value: number; label: string } | undefined) => {
        const current = count();
        const last = prev?.value ?? 0;
        if (current === last) return { value: current, label: "Same" };
        return { value: current, label: current > last ? "Up" : "Down" };
      }),
    );
    expect(trend()).toEqual({ value: 0, label: "Same" });
    setCount((c) => c + 1);
    expect(trend()).toEqual({ value: 1, label: "Up" });
    setCount((c) => c - 2);
    expect(trend()).toEqual({ value: -1, label: "Down" });
  });

  // DIFFERENCE from Solid (by design): useMemo(fn, options) has no initial-value parameter; Solid's createMemo(fn, value, options) seeds the first `prev` (packages/core/src/memo.ts:27)
  it("[SOLID-RX-28] reference/create-memo: createMemo(fn, initialValue) seeds the first previous value (differs from Solid; ShadowJS: useMemo has no initial-value parameter; seed with the previous value)", () => {
    const [count] = useSignal(5);
    const total = inRoot(() => useMemo((prev: number | undefined) => (prev ?? 100) + count()));
    expect(total()).toBe(105);
  });

  it("[SOLID-RX-29] reference/create-memo: the memo function runs immediately (eager); lazy: true defers until first read", () => {
    let eagerRuns = 0;
    let lazyRuns = 0;
    inRoot(() => {
      useMemo(() => {
        eagerRuns += 1;
        return 1;
      });
      const lazy = useMemo(
        () => {
          lazyRuns += 1;
          return 2;
        },
        { lazy: true },
      );
      expect(eagerRuns).toBe(1);
      expect(lazyRuns).toBe(0);
      expect(lazy()).toBe(2);
      expect(lazyRuns).toBe(1);
    });
  });

  it("[SOLID-RX-30] concepts/memos: writing a signal inside a memo (badMemo) throws WRITE_IN_MEMO to the reader in dev", () => {
    const [count, setCount] = useSignal(11);
    const [, setMessage] = useSignal("");
    const badMemo = inRoot(() =>
      useMemo(() => {
        if (count() > 10) setMessage("Count is too high!");
        return count() % 2 === 0;
      }),
    );
    expect(() => badMemo()).toThrow(/WRITE_IN_MEMO/);
    setCount(1);
    expect(badMemo()).toBe(false);
  });

  it("[SOLID-RX-31] concepts/memos: moving the side effect to an effect keeps the memo pure (isEven + message effect)", () => {
    const [count, setCount] = useSignal(0);
    const [message, setMessage] = useSignal("");
    const isEven = inRoot(() => {
      const memo = useMemo(() => count() % 2 === 0);
      useEffect(() => {
        if (count() > 10) setMessage("Count is too high!");
      });
      return memo;
    });
    flushSync();
    expect(isEven()).toBe(true);
    expect(message()).toBe("");
    setCount(11);
    flushSync();
    expect(isEven()).toBe(false);
    expect(message()).toBe("Count is too high!");
  });

  it("[SOLID-RX-32] concepts/memos: a message memo notifies only when count crosses 10 (vs effect on every change)", () => {
    const [count, setCount] = useSignal(0);
    let effectRuns = 0;
    let observerRuns = 0;
    inRoot(() => {
      const message = useMemo(() => (count() > 10 ? "Count is too high!" : ""));
      useEffect(() => {
        count();
        effectRuns += 1;
      });
      useEffect(() => {
        message();
        observerRuns += 1;
      });
    });
    flushSync();
    for (const n of [1, 2, 3, 11, 12, 13]) {
      setCount(n);
      flushSync();
    }
    expect(effectRuns).toBe(7);
    expect(observerRuns).toBe(2);
  });

  it("[SOLID-RX-33] reference/create-memo: FilterList example, memo runs only when query changes and is shared by two readers", async () => {
    const mod = await load<{ FilterList: () => unknown; calc: { runs: number } }>(`
      import { useSignal, useMemo } from "@shadow-js/core";
      import { For } from "@shadow-js/web";
      const NAMES = ["Alice Smith", "Bob Jones", "Charlie Day", "David Lee"];
      export const calc = { runs: 0 };
      export function FilterList() {
        const [query, setQuery] = useSignal("");
        const filteredNames = useMemo(() => {
          calc.runs += 1;
          return NAMES.filter((name) => name.toLowerCase().includes(query().toLowerCase()));
        });
        return (
          <div>
            <input value={query()} onInput={(e) => setQuery(e.currentTarget.value)} placeholder="Search..." />
            <div class="count">Count: {filteredNames().length}</div>
            <ul>
              <For each={filteredNames()}>{(name) => <li>{name}</li>}</For>
            </ul>
          </div>
        );
      }
    `);
    const host = mount(() => mod.FilterList());
    expect(mod.calc.runs).toBe(1);
    expect(host.querySelectorAll("li")).toHaveLength(4);
    const input = q<HTMLInputElement>(host, "input");
    input.value = "ob";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(mod.calc.runs).toBe(2);
    expect(q(host, ".count").textContent).toBe("Count: 1");
    expect([...host.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Bob Jones"]);
  });
});

describe("concepts/effects + reference/create-effect", () => {
  it("[SOLID-RX-34] concepts/effects: the first run is deferred to the flush; a dependency-free effect runs exactly once", () => {
    let runs = 0;
    inRoot(() => {
      useEffect(() => {
        runs += 1;
      });
      expect(runs).toBe(0);
    });
    flushSync();
    expect(runs).toBe(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[SOLID-RX-35] reference/create-effect: execution timing example (render effect runs sync, effects after the render phase)", async () => {
    const log: string[] = [];
    inRoot(() => {
      const [count, setCount] = useSignal(0);
      log.push("Hello from counter");
      useEffect(() => {
        log.push(`Effect: ${count()}`);
      });
      useRenderEffect(() => {
        log.push(`Render effect: ${count()}`);
      });
      setCount(1);
      queueMicrotask(() => {
        setCount(2);
      });
    });
    expect(log).toEqual(["Hello from counter", "Render effect: 0"]);
    await macrotask();
    expect(log).toEqual([
      "Hello from counter",
      "Render effect: 0",
      "Render effect: 1",
      "Effect: 1",
      "Render effect: 2",
      "Effect: 2",
    ]);
  });

  it("[SOLID-RX-36] concepts/effects: a returned function cleans up before the next run and on disposal", () => {
    const [count, setCount] = useSignal(0);
    const log: string[] = [];
    const dispose = createRoot((d) => {
      useEffect(() => {
        const value = count();
        log.push(`run ${value}`);
        return () => {
          log.push(`cleanup ${value}`);
        };
      });
      return d;
    });
    flushSync();
    setCount(1);
    flushSync();
    dispose();
    expect(log).toEqual(["run 0", "cleanup 0", "run 1", "cleanup 1"]);
  });

  it("[SOLID-RX-37] concepts/effects: onCleanup inside an effect runs before the re-run and at disposal", () => {
    const [count, setCount] = useSignal(0);
    const log: string[] = [];
    const dispose = createRoot((d) => {
      useEffect(() => {
        const value = count();
        onCleanup(() => {
          log.push(`cleanup ${value}`);
        });
      });
      return d;
    });
    flushSync();
    setCount(1);
    flushSync();
    expect(log).toEqual(["cleanup 0"]);
    dispose();
    expect(log).toEqual(["cleanup 0", "cleanup 1"]);
  });

  it("[SOLID-RX-38] concepts/effects: an effect tracking two signals runs with the latest values when either changes", () => {
    const [count, setCount] = useSignal(0);
    const [message, setMessage] = useSignal("Hello");
    const log: Array<[number, string]> = [];
    inRoot(() =>
      useEffect(() => {
        log.push([count(), message()]);
      }),
    );
    flushSync();
    setCount(1);
    flushSync();
    setMessage("World");
    flushSync();
    expect(log).toEqual([
      [0, "Hello"],
      [1, "Hello"],
      [1, "World"],
    ]);
  });

  // NOTE (different by decision): ADR-007 defers effects to a microtask, so two writes without a flush in between give one run
  it("[SOLID-RX-39] concepts/effects: two writes in the same tick run the effect once (ADR-007 deferred effects)", () => {
    const [count, setCount] = useSignal(0);
    const [message, setMessage] = useSignal("Hello");
    const log: Array<[number, string]> = [];
    inRoot(() =>
      useEffect(() => {
        log.push([count(), message()]);
      }),
    );
    flushSync();
    setCount(1);
    setMessage("World");
    flushSync();
    expect(log).toEqual([
      [0, "Hello"],
      [1, "World"],
    ]);
  });

  it("[SOLID-RX-40] reference/create-effect: multiple dependencies changed in one batch run the effect once", () => {
    const [a, setA] = useSignal(1);
    const [b, setB] = useSignal(1);
    let runs = 0;
    inRoot(() =>
      useEffect(() => {
        a();
        b();
        runs += 1;
      }),
    );
    flushSync();
    batch(() => {
      setA(2);
      setB(2);
    });
    flushSync();
    expect(runs).toBe(2);
  });

  it("[SOLID-RX-41] concepts/effects: nested effects register and run independently (outer starts, outer ends, inner)", () => {
    const log: string[] = [];
    inRoot(() =>
      useEffect(() => {
        log.push("Outer effect starts");
        useEffect(() => {
          log.push("Inner effect");
        });
        log.push("Outer effect ends");
      }),
    );
    flushSync();
    expect(log).toEqual(["Outer effect starts", "Outer effect ends", "Inner effect"]);
  });

  it("[SOLID-RX-42] concepts/effects: a signal read in an inner effect re-runs only the inner effect", () => {
    const [count, setCount] = useSignal(0);
    const log: string[] = [];
    inRoot(() =>
      useEffect(() => {
        log.push("Outer effect starts");
        useEffect(() => {
          log.push(`inner ${count()}`);
        });
        log.push("Outer effect ends");
      }),
    );
    flushSync();
    setCount(1);
    flushSync();
    expect(log).toEqual(["Outer effect starts", "Outer effect ends", "inner 0", "inner 1"]);
  });

  it("[SOLID-RX-43] concepts/effects: explicit dependencies, the deps function is tracked and the callback is untracked", () => {
    const [count, setCount] = useSignal(0);
    const [other, setOther] = useSignal("x");
    const log: Array<[number, number | undefined, string]> = [];
    inRoot(() =>
      useEffect(
        () => count(),
        (value, prev) => {
          log.push([value, prev, other()]);
        },
      ),
    );
    flushSync();
    setOther("y");
    flushSync();
    expect(log).toEqual([[0, undefined, "x"]]);
    setCount(1);
    flushSync();
    expect(log).toEqual([
      [0, undefined, "x"],
      [1, 0, "y"],
    ]);
  });

  it("[SOLID-RX-44] concepts/effects: explicit dependencies with defer: true skip the first run (on(..., { defer: true }))", () => {
    const [count, setCount] = useSignal(0);
    const log: Array<[number, number | undefined]> = [];
    inRoot(() =>
      useEffect(
        () => count(),
        (value, prev) => {
          log.push([value, prev]);
        },
        { defer: true },
      ),
    );
    flushSync();
    expect(log).toEqual([]);
    setCount(1);
    flushSync();
    expect(log).toEqual([[1, 0]]);
  });

  it("[SOLID-RX-45] concepts/effects: explicit dependencies over several signals (on([a, b], ...) as a tuple)", () => {
    const [a, setA] = useSignal(1);
    const [b, setB] = useSignal(2);
    const log: number[] = [];
    inRoot(() =>
      useEffect(
        () => [a(), b()] as const,
        ([x, y]) => {
          log.push(x + y);
        },
      ),
    );
    flushSync();
    setA(10);
    flushSync();
    setB(20);
    flushSync();
    expect(log).toEqual([3, 12, 30]);
  });

  // DIFFERENCE from Solid (by design): the single-function useEffect return value is the cleanup, never fed back as `prev`; Solid's createEffect((prev) => ..., init) passes the last return value (packages/core/src/internal/graph.ts:437)
  it("[SOLID-RX-46] reference/create-effect: the effect function receives the value returned by the previous run (differs from Solid; ShadowJS: the return value of an effect is its cleanup, never fed back)", () => {
    const [count, setCount] = useSignal(1);
    const seen: Array<number | undefined> = [];
    const effectWithPrev = (prev?: number): number => {
      seen.push(prev);
      return count();
    };
    inRoot(() => useEffect(effectWithPrev as unknown as () => void));
    flushSync();
    setCount(2);
    flushSync();
    expect(seen).toEqual([undefined, undefined]);
  });

  // DIFFERENCE from Solid (by design): useEffect(fn, value) has no initial-value parameter; a non-function second argument is read as options (packages/core/src/effect.ts:64)
  it("[SOLID-RX-47] reference/create-effect: createEffect(fn, initialValue) passes initialValue to the first run (differs from Solid; ShadowJS: useEffect has no initial-value parameter; the first run gets undefined)", () => {
    const seen: Array<number | undefined> = [];
    const withOptions = useEffect as unknown as (
      fn: (prev: number | undefined) => void,
      options: { name: string },
    ) => void;
    inRoot(() =>
      withOptions(
        (prev) => {
          seen.push(prev);
        },
        { name: "seeded" },
      ),
    );
    flushSync();
    expect(seen).toEqual([undefined]);
  });

  it("[SOLID-RX-48] reference/create-effect: options.name is accepted", () => {
    let ran = false;
    inRoot(() =>
      useEffect(
        () => {
          ran = true;
        },
        { name: "named effect" },
      ),
    );
    flushSync();
    expect(ran).toBe(true);
  });

  it("[SOLID-RX-49] reference/create-effect: effects run after memos in the same update (no stale or double run)", () => {
    const [a, setA] = useSignal(1);
    const log: Array<[number, number]> = [];
    inRoot(() => {
      const doubled = useMemo(() => a() * 2);
      useEffect(() => {
        log.push([a(), doubled()]);
      });
    });
    flushSync();
    setA(2);
    flushSync();
    expect(log).toEqual([
      [1, 2],
      [2, 4],
    ]);
  });

  it("[SOLID-RX-50] concepts/intro-to-reactivity: an effect that writes a signal (double = count * 2) keeps it in sync", () => {
    const [count, setCount] = useSignal(0);
    const [double, setDouble] = useSignal(0);
    inRoot(() =>
      useEffect(() => {
        setDouble(count() * 2);
      }),
    );
    flushSync();
    setCount(5);
    flushSync();
    expect(double()).toBe(10);
  });

  it("[SOLID-RX-51] concepts/effects: onMount runs once after the owner is flushed and does not track", () => {
    const [count, setCount] = useSignal(0);
    let runs = 0;
    inRoot(() => {
      onMount(() => {
        count();
        runs += 1;
      });
      expect(runs).toBe(0);
    });
    flushSync();
    expect(runs).toBe(1);
    setCount(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[SOLID-RX-52] concepts/effects: onCleanup clears an interval started in the component body on unmount", async () => {
    vi.useFakeTimers();
    const mod = await load<{ App: () => unknown }>(`
      import { onCleanup, useSignal } from "@shadow-js/core";
      export function App() {
        const [count, setCount] = useSignal(0);
        const timer = setInterval(() => { setCount((prev) => prev + 1); }, 1000);
        onCleanup(() => { clearInterval(timer); });
        return <div>Count: {count()}</div>;
      }
    `);
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => mod.App(), host);
    vi.advanceTimersByTime(3000);
    flushSync();
    expect(host.textContent).toBe("Count: 3");
    dispose();
    vi.advanceTimersByTime(3000);
    flushSync();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[SOLID-RX-53] advanced-concepts/fine-grained-reactivity: reads inside a setTimeout callback are not tracked", () => {
    vi.useFakeTimers();
    const [count, setCount] = useSignal(0);
    let effectRuns = 0;
    const logged: number[] = [];
    inRoot(() =>
      useEffect(() => {
        effectRuns += 1;
        setTimeout(() => {
          logged.push(count());
        }, 1000);
      }),
    );
    flushSync();
    setCount(1);
    flushSync();
    expect(effectRuns).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(logged).toEqual([1]);
  });

  it("[SOLID-RX-54] advanced-concepts/fine-grained-reactivity: Temperature example, a memo's untaken branch is not tracked", () => {
    const log: string[] = [];
    const [temperature] = useSignal(72);
    const [unit, setUnit] = useSignal("Fahrenheit");
    const [displayTemp, setDisplayTemp] = useSignal(true);
    inRoot(() => {
      const displayTemperature = useMemo(() => {
        if (!displayTemp()) return "Temperature display is off";
        return `${temperature()} degrees ${unit()}`;
      });
      useEffect(() => {
        log.push(`Current temperature is ${displayTemperature()}`);
      });
    });
    flushSync();
    setDisplayTemp(false);
    flushSync();
    setUnit("Celsius");
    flushSync();
    setDisplayTemp(true);
    flushSync();
    expect(log).toEqual([
      "Current temperature is 72 degrees Fahrenheit",
      "Current temperature is Temperature display is off",
      "Current temperature is 72 degrees Celsius",
    ]);
  });

  it("[SOLID-RX-55] concepts/intro-to-reactivity: signals read in a component body are not tracked; the body runs once", async () => {
    const mod = await load<{
      Counter: () => unknown;
      stats: { bodyRuns: number; logged: number[] };
    }>(`
      import { useEffect, useSignal } from "@shadow-js/core";
      export const stats = { bodyRuns: 0, logged: [] as number[] };
      export function Counter() {
        stats.bodyRuns += 1;
        const [count, setCount] = useSignal(0);
        const increment = () => setCount((prev) => prev + 1);
        stats.logged.push(count());
        return (
          <div>
            <span>Count: {count()}</span>
            <button type="button" onClick={increment}>Increment</button>
          </div>
        );
      }
    `);
    const host = mount(() => mod.Counter());
    q(host, "button").click();
    q(host, "button").click();
    flushSync();
    expect(q(host, "span").textContent).toBe("Count: 2");
    expect(mod.stats.bodyRuns).toBe(1);
    expect(mod.stats.logged).toEqual([0]);
  });
});

describe("advanced-concepts/fine-grained-reactivity + concepts/intro-to-reactivity", () => {
  it("[SOLID-RX-56] concepts/intro-to-reactivity: clicking Increment updates only the bound text node, not the component", async () => {
    const mod = await load<{ Counter: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export function Counter() {
        const [count, setCount] = useSignal(0);
        const increment = () => setCount((prev) => prev + 1);
        return (
          <div>
            <span>Count: {count()}</span>{" "}
            <button type="button" onClick={increment}>Increment</button>
          </div>
        );
      }
    `);
    const host = mount(() => mod.Counter());
    const span = q(host, "span");
    const button = q(host, "button");
    const staticText = span.firstChild;
    const mutations: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) mutations.push(`${record.type}:${record.target.nodeName}`);
    });
    observer.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    button.click();
    flushSync();
    mutations.push(...observer.takeRecords().map((r) => `${r.type}:${r.target.nodeName}`));
    observer.disconnect();
    expect(span.textContent).toBe("Count: 1");
    expect(q(host, "span")).toBe(span);
    expect(q(host, "button")).toBe(button);
    expect(span.firstChild).toBe(staticText);
    // Only text under the span was touched; no element was replaced.
    expect(mutations.every((m) => m.endsWith(":#text") || m.endsWith(":SPAN"))).toBe(true);
    expect(mutations.some((m) => m.startsWith("childList:DIV"))).toBe(false);
  });

  it("[SOLID-RX-57] advanced-concepts/fine-grained-reactivity: JSX text bindings in one component update independently", async () => {
    const mod = await load<{ App: () => unknown; runs: Record<string, number> }>(`
      import { useSignal } from "@shadow-js/core";
      export const runs = { a: 0, b: 0 };
      export function App() {
        const [a, setA] = useSignal(0);
        const [b, setB] = useSignal(0);
        return (
          <div>
            <p class="a">{(runs.a += 1, a())}</p>
            <p class="b">{(runs.b += 1, b())}</p>
            <button onClick={() => setA(a() + 1)}>a</button>
          </div>
        );
      }
    `);
    const host = mount(() => mod.App());
    expect(mod.runs).toEqual({ a: 1, b: 1 });
    q(host, "button").click();
    flushSync();
    expect(q(host, ".a").textContent).toBe("1");
    expect(mod.runs).toEqual({ a: 2, b: 1 });
  });

  it("[SOLID-RX-58] advanced-concepts/fine-grained-reactivity: a memo's branch change re-tracks (dependencies discovered on each run)", () => {
    const [flag, setFlag] = useSignal(true);
    const [a, setA] = useSignal("A");
    const [b, setB] = useSignal("B");
    let runs = 0;
    const memo = inRoot(() =>
      useMemo(() => {
        runs += 1;
        return flag() ? a() : b();
      }),
    );
    setB("B2");
    expect(memo()).toBe("A");
    expect(runs).toBe(1);
    setFlag(false);
    expect(memo()).toBe("B2");
    setA("A2");
    expect(memo()).toBe("B2");
    expect(runs).toBe(2);
  });

  it("[SOLID-RX-59] concepts/intro-to-reactivity: batch delays an update so a subscriber of two signals runs once", () => {
    const [first, setFirst] = useSignal("a");
    const [last, setLast] = useSignal("b");
    const seen: string[] = [];
    inRoot(() =>
      useEffect(() => {
        seen.push(`${first()}${last()}`);
      }),
    );
    flushSync();
    batch(() => {
      setFirst("x");
      setLast("y");
    });
    flushSync();
    expect(seen).toEqual(["ab", "xy"]);
  });
});

describe("reference/secondary-primitives/create-render-effect + create-computed", () => {
  it("[SOLID-RX-60] create-render-effect: useRenderEffect runs synchronously when created and re-runs on change", () => {
    const [count, setCount] = useSignal(0);
    const log: number[] = [];
    inRoot(() => {
      useRenderEffect(() => {
        log.push(count());
      });
      expect(log).toEqual([0]);
    });
    setCount(1);
    flushSync();
    expect(log).toEqual([0, 1]);
  });

  it("[SOLID-RX-61] create-render-effect: render effects run before user effects within one flush", () => {
    const [count, setCount] = useSignal(0);
    const log: string[] = [];
    inRoot(() => {
      useEffect(() => {
        log.push(`effect ${count()}`);
      });
      useRenderEffect(() => {
        log.push(`render ${count()}`);
      });
    });
    flushSync();
    log.length = 0;
    setCount(1);
    flushSync();
    expect(log).toEqual(["render 1", "effect 1"]);
  });

  it("[SOLID-RX-62] create-render-effect: two-function form tracks compute and applies untracked with (value, previous)", () => {
    const [count, setCount] = useSignal(0);
    const [other, setOther] = useSignal("o");
    const log: Array<[number, number | undefined, string]> = [];
    inRoot(() =>
      useRenderEffect(
        () => count(),
        (value, previous) => {
          log.push([value, previous, other()]);
        },
      ),
    );
    setOther("p");
    flushSync();
    setCount(1);
    flushSync();
    expect(log).toEqual([
      [0, undefined, "o"],
      [1, 0, "p"],
    ]);
  });

  it("[SOLID-RX-63] create-render-effect: @shadow-js/web effect() is the render effect and also runs synchronously", () => {
    const [count, setCount] = useSignal(0);
    const log: number[] = [];
    inRoot(() => {
      effect(() => {
        log.push(count());
      });
    });
    expect(log).toEqual([0]);
    setCount(2);
    flushSync();
    expect(log).toEqual([0, 2]);
  });

  it("[SOLID-RX-64] create-render-effect: refs are not set on the initial render-effect run, but are set for effects and onMount", async () => {
    const mod = await load<{ Example: () => unknown; log: Array<[string, string | undefined]> }>(`
      import { onMount, useEffect, useRenderEffect } from "@shadow-js/core";
      export const log: Array<[string, string | undefined]> = [];
      export function Example() {
        let element: HTMLDivElement | undefined;
        useRenderEffect(() => { log.push(["render effect", element?.tagName]); });
        useEffect(() => { log.push(["effect", element?.tagName]); });
        onMount(() => { log.push(["mounted", element?.tagName]); });
        return <div ref={element}>Hello</div>;
      }
    `);
    mount(() => mod.Example());
    expect(mod.log).toEqual([
      ["render effect", undefined],
      ["effect", "DIV"],
      ["mounted", "DIV"],
    ]);
  });

  it("[SOLID-RX-65] create-computed: the createWritableMemo workaround via useRenderEffect works after a flush", () => {
    function createWritableMemo<T>(fn: () => T): Accessor<T> {
      const [value, setValue] = useSignal(fn());
      useRenderEffect(() => {
        const next = fn();
        setValue(() => next);
      });
      return value;
    }
    const [count, setCount] = useSignal(1);
    const double = inRoot(() => createWritableMemo(() => count() * 2));
    expect(double()).toBe(2);
    setCount((value) => value + 1);
    flushSync();
    expect(double()).toBe(4);
  });

  // DIFFERENCE from Solid (by design): no createComputed; render effects are deferred to the flush, so a write is not reflected synchronously (packages/core/src/effect.ts, ADR-007)
  it("[SOLID-RX-66] create-computed: createComputed re-runs synchronously when a dependency changes (differs from Solid; ShadowJS: there is no createComputed; a render effect writes at the flush)", () => {
    function createWritableMemo<T>(fn: () => T): Accessor<T> {
      const [value, setValue] = useSignal(fn());
      useRenderEffect(() => {
        const next = fn();
        setValue(() => next);
      });
      return value;
    }
    const [count, setCount] = useSignal(1);
    const double = inRoot(() => createWritableMemo(() => count() * 2));
    setCount(2);
    expect(double()).toBe(2);
    flushSync();
    expect(double()).toBe(4);
  });

  // DIFFERENCE from Solid (by design): createComputed is not exported from @shadow-js/core (packages/core/src/index.ts); useMemo cannot write signals
  it("[SOLID-RX-67] create-computed: createComputed(fn) exists and writes signals while tracking (differs from Solid; ShadowJS: createComputed is not exported)", () => {
    expect(Reflect.get(core, "createComputed")).toBeUndefined();
  });
});

describe("reference/secondary-primitives/create-reaction + create-deferred", () => {
  // Renamed: createReaction is `useReaction` (DEC-REACTION).
  it("[SOLID-RX-68] create-reaction: track(() => value()) invalidates once, then is a no-op until track() runs again", () => {
    const { useReaction } = core as unknown as {
      useReaction: (onInvalidate: () => void) => (tracking: () => void) => void;
    };
    const [value, setValue] = useSignal("start");
    const log: string[] = [];
    inRoot(() => {
      const track = useReaction(() => {
        log.push("changed");
      });
      track(() => {
        value();
      });
    });
    setValue("end");
    flushSync();
    expect(log).toEqual(["changed"]);
    setValue("final");
    flushSync();
    expect(log).toEqual(["changed"]);
  });

  // RENAMED: createDeferred(source) is useDeferredValue(source) in ShadowJS (DEC-TRANSITIONS).
  it("[SOLID-RX-69] create-deferred: createDeferred(value) initially reflects the source and lags behind updates", async () => {
    const { useDeferredValue } = core as unknown as {
      useDeferredValue: <T>(source: Accessor<T>) => Accessor<T>;
    };
    const [value, setValue] = useSignal("");
    const deferredValue = inRoot(() => useDeferredValue(value));
    expect(deferredValue()).toBe("");
    setValue("typed");
    await macrotask();
    flushSync();
    expect(deferredValue()).toBe("typed");
  });
});

describe("reference/secondary-primitives/create-selector", () => {
  it("[SOLID-RX-70] create-selector: isSelected(key) reports whether the key matches the source", () => {
    const [selected, setSelected] = useSignal<number | undefined>(undefined);
    const isSelected = inRoot(() => useSelector(selected));
    expect(isSelected(1)).toBe(false);
    setSelected(1);
    flushSync();
    expect(isSelected(1)).toBe(true);
    expect(isSelected(2)).toBe(false);
  });

  it("[SOLID-RX-71] create-selector: only readers of the previous and the new key re-run when the selection changes", () => {
    const [selected, setSelected] = useSignal(1);
    const runs: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    inRoot(() => {
      const isSelected = useSelector(selected);
      for (const key of [1, 2, 3]) {
        useEffect(() => {
          isSelected(key);
          runs[key] = (runs[key] ?? 0) + 1;
        });
      }
    });
    flushSync();
    expect(runs).toEqual({ 1: 1, 2: 1, 3: 1 });
    setSelected(2);
    flushSync();
    expect(runs).toEqual({ 1: 2, 2: 2, 3: 1 });
  });

  it("[SOLID-RX-72] create-selector: custom comparison fn receives (key, value)", () => {
    const [selected, setSelected] = useSignal("abc");
    const isSelected = inRoot(() =>
      useSelector(selected, (key: string, value: string) => value.startsWith(key)),
    );
    const seen: boolean[] = [];
    inRoot(() =>
      useEffect(() => {
        seen.push(isSelected("ab"));
      }),
    );
    flushSync();
    setSelected("abd");
    flushSync();
    setSelected("xyz");
    flushSync();
    expect(seen).toEqual([true, false]);
  });

  it("[SOLID-RX-73] create-selector: Example list, classList active follows the clicked row", async () => {
    const mod = await load<{
      Example: (props: { list: Array<{ id: number; name: string }> }) => unknown;
    }>(`
      import { useSelector, useSignal } from "@shadow-js/core";
      import { For } from "@shadow-js/web";
      export function Example(props) {
        const [selectedId, setSelectedId] = useSignal<number | undefined>(undefined);
        const isSelected = useSelector(selectedId);
        return (
          <ul>
            <For each={props.list}>
              {(item) => (
                <li classList={{ active: isSelected(item.id) }} onClick={() => setSelectedId(item.id)}>
                  {item.name}
                </li>
              )}
            </For>
          </ul>
        );
      }
    `);
    const list = [
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ];
    const host = mount(() => mod.Example({ list }));
    const items = host.querySelectorAll("li");
    expect([...items].map((li) => li.className)).toEqual(["", ""]);
    (items[1] as HTMLElement).click();
    flushSync();
    expect([...items].map((li) => li.classList.contains("active"))).toEqual([false, true]);
    (items[0] as HTMLElement).click();
    flushSync();
    expect([...items].map((li) => li.classList.contains("active"))).toEqual([true, false]);
  });
});
