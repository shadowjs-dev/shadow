import * as core from "@shadow-js/core";
import {
  batch,
  catchError,
  createContext,
  createRoot,
  flushSync,
  getOwner,
  indexArray,
  mapArray,
  mergeProps,
  type Owner,
  onCleanup,
  onMount,
  runWithOwner,
  splitProps,
  untrack,
  useContext,
  useEffect,
  useMemo,
  useSignal,
} from "@shadow-js/core";
import { useStore } from "@shadow-js/core/store";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "../support/compile";

const disposers: Array<() => void> = [];
const hosts: HTMLElement[] = [];

/** Runs `fn` in a root that the afterEach hook disposes. */
function inRoot<T>(fn: () => T): T {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return fn();
  });
}

/** Renders `view` into a fresh host that the afterEach hook cleans up. */
function mountApp(view: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  disposers.push(render(view, host));
  return host;
}

/** Looks up an export that the docs promise; fails with a clear message when it is absent. */
function need<T>(name: string): T {
  const value: unknown = Reflect.get(core, name);
  expect(value, `@shadow-js/core must export "${name}"`).toBeTypeOf("function");
  return value as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  for (const host of hosts.splice(0)) host.remove();
  vi.useRealTimers();
});

describe("reactive-utilities/batch", () => {
  function summaryFixture() {
    const log: string[] = [];
    const [count, setCount] = useSignal(0);
    const [total, setTotal] = useSignal(0);
    const summary = useMemo(() => `${count()} / ${total()}`);
    useEffect(() => {
      log.push(summary());
    });
    flushSync();
    return { log, setCount, setTotal, summary };
  }

  it("[SOLID-UT-01] reactive-utilities/batch: batch defers downstream computations until it completes", () => {
    inRoot(() => {
      const { log, setCount, setTotal } = summaryFixture();
      expect(log).toEqual(["0 / 0"]);
      batch(() => {
        setCount(1);
        setTotal(5);
      });
      expect(log).toEqual(["0 / 0", "1 / 5"]);
    });
  });

  // DIFFERENCE from Solid (by design): outside batch(), Solid re-runs the effect synchronously after every setter ("1 / 0" then "1 / 5").
  // ShadowJS queues the effect for a microtask flush (packages/core/src/internal/scheduler.ts:107 schedule()),
  // so nothing has run when the setter returns.
  it("[SOLID-UT-02] reactive-utilities/batch: outside batch each setter runs the effect synchronously (differs from Solid; ShadowJS: outside batch the effect runs at the next flush, once)", () => {
    inRoot(() => {
      const { log, setCount, setTotal } = summaryFixture();
      setCount(1);
      expect(log).toEqual(["0 / 0"]);
      setTotal(5);
      flushSync();
      expect(log).toEqual(["0 / 0", "1 / 5"]);
    });
  });

  it("[SOLID-UT-03] reactive-utilities/batch: outside batch ShadowJS coalesces writes into one microtask flush", async () => {
    const { log, setCount, setTotal } = inRoot(summaryFixture);
    setCount(1);
    setTotal(5);
    expect(log).toEqual(["0 / 0"]);
    await Promise.resolve();
    expect(log).toEqual(["0 / 0", "1 / 5"]);
  });

  it("[SOLID-UT-04] reactive-utilities/batch: reading a memo inside a batch returns the fresh value", () => {
    inRoot(() => {
      const { log, setCount, setTotal, summary } = summaryFixture();
      setCount(1);
      setTotal(5);
      flushSync();
      log.length = 0;
      const seen: string[] = [];
      batch(() => {
        setCount(2);
        seen.push(summary());
        setTotal(10);
      });
      expect(seen).toEqual(["2 / 5"]);
      expect(log).toEqual(["2 / 10"]);
    });
  });

  it("[SOLID-UT-05] reactive-utilities/batch: nested batch calls behave like one larger batch", () => {
    inRoot(() => {
      const { log, setCount, setTotal } = summaryFixture();
      batch(() => {
        batch(() => {
          setCount(1);
        });
        expect(log).toEqual(["0 / 0"]);
        setTotal(5);
      });
      expect(log).toEqual(["0 / 0", "1 / 5"]);
    });
  });

  it("[SOLID-UT-06] reactive-utilities/batch: returns the value produced by fn", () => {
    expect(batch(() => 42)).toBe(42);
  });

  it("[SOLID-UT-07] reactive-utilities/batch: writes inside onMount are batched into one effect run", () => {
    const log: string[] = [];
    inRoot(() => {
      const [count, setCount] = useSignal(0);
      const [total, setTotal] = useSignal(0);
      useEffect(() => {
        log.push(`${count()} / ${total()}`);
      });
      onMount(() => {
        setCount(1);
        setTotal(5);
      });
      flushSync();
    });
    expect(log).toEqual(["0 / 0", "1 / 5"]);
  });
});

describe("reactive-utilities/catch-error", () => {
  it("[SOLID-UT-08] reactive-utilities/catch-error: handles an error thrown by an effect in a child scope", () => {
    const messages: string[] = [];
    const [count, setCount] = useSignal(0);
    inRoot(() => {
      catchError(
        () => {
          useEffect(() => {
            if (count() > 2) throw new Error("count too large");
          });
        },
        (err) => {
          messages.push(messageOf(err));
        },
      );
    });
    flushSync();
    setCount(3);
    flushSync();
    expect(messages).toEqual(["count too large"]);
  });

  it("[SOLID-UT-09] reactive-utilities/catch-error: returns fn's value, or undefined when fn throws and is handled", () => {
    const handled: string[] = [];
    const handler = (err: unknown): void => {
      handled.push(messageOf(err));
    };
    expect(catchError(() => 42, handler)).toBe(42);
    expect(
      catchError(() => {
        throw new Error("boom");
      }, handler),
    ).toBeUndefined();
    expect(handled).toEqual(["boom"]);
  });

  it("[SOLID-UT-10] reactive-utilities/catch-error: only the nearest boundary handles the error", () => {
    const inner: string[] = [];
    const outer: string[] = [];
    inRoot(() => {
      catchError(
        () => {
          catchError(
            () => {
              useEffect(() => {
                throw new Error("nearest");
              });
            },
            (err) => {
              inner.push(messageOf(err));
            },
          );
        },
        (err) => {
          outer.push(messageOf(err));
        },
      );
    });
    flushSync();
    expect(inner).toEqual(["nearest"]);
    expect(outer).toEqual([]);
  });

  it("[SOLID-UT-11] reactive-utilities/catch-error: if the handler throws, the next parent boundary handles that error", () => {
    const outer: string[] = [];
    inRoot(() => {
      catchError(
        () => {
          catchError(
            () => {
              useEffect(() => {
                throw new Error("first");
              });
            },
            () => {
              throw new Error("from handler");
            },
          );
        },
        (err) => {
          outer.push(messageOf(err));
        },
      );
    });
    flushSync();
    expect(outer).toEqual(["from handler"]);
  });
});

describe("reactive-utilities/create-root", () => {
  it("[SOLID-UT-12] reactive-utilities/create-root: createCounter inside a root works and dispose stops its effect", () => {
    const logs: string[] = [];
    function createCounter(initial = 0) {
      const [count, setCount] = useSignal(initial);
      useEffect(() => {
        logs.push(`Count changed, new value: ${count()}`);
      });
      return {
        count,
        increment: () => setCount((c) => c + 1),
        reset: () => setCount(initial),
      };
    }
    createRoot((dispose) => {
      const { count, increment, reset } = createCounter(10);
      expect(count()).toBe(10);
      increment();
      expect(count()).toBe(11);
      reset();
      expect(count()).toBe(10);
      flushSync();
      dispose();
      increment();
      flushSync();
    });
    expect(logs).toEqual(["Count changed, new value: 10"]);
  });

  it("[SOLID-UT-13] reactive-utilities/create-root: returns fn's value and dispose runs onCleanup", () => {
    const cleanups: string[] = [];
    const counter = createRoot((dispose) => {
      const [count, setCount] = useSignal(0);
      onCleanup(() => {
        cleanups.push("Dispose was called!");
      });
      return { value: count, increment: () => setCount((c) => c + 1), dispose };
    });
    expect(counter.value()).toBe(0);
    counter.increment();
    expect(counter.value()).toBe(1);
    expect(cleanups).toEqual([]);
    counter.dispose();
    expect(cleanups).toEqual(["Dispose was called!"]);
  });

  it("[SOLID-UT-14] reactive-utilities/create-root: a root created inside another is disposed with it unless detached", () => {
    const log: string[] = [];
    createRoot((disposeOuter) => {
      createRoot(() => {
        onCleanup(() => {
          log.push("attached");
        });
      });
      createRoot(
        () => {
          onCleanup(() => {
            log.push("detached");
          });
        },
        { detached: true },
      );
      disposeOuter();
    });
    expect(log).toEqual(["attached"]);
  });

  it("[SOLID-UT-15] reactive-utilities/create-root: a detached root keeps the context of the owner it was created under", () => {
    const Theme = createContext("none");
    let seen = "";
    let owner: Owner | null = null;
    createRoot(() => {
      Theme({
        value: "dark",
        get children() {
          owner = getOwner();
          return null;
        },
      });
    });
    runWithOwner(owner, () => {
      createRoot(
        () => {
          seen = useContext(Theme);
        },
        { detached: true },
      );
    });
    expect(seen).toBe("dark");
  });

  it("[SOLID-UT-16] reactive-utilities/create-root: the root body does not track dependencies", () => {
    const runs: number[] = [];
    const [count, setCount] = useSignal(0);
    inRoot(() => {
      useEffect(() => {
        createRoot(() => {
          runs.push(count());
        });
      });
    });
    flushSync();
    setCount(1);
    flushSync();
    expect(runs).toEqual([0]);
  });

  it("[SOLID-UT-17] reactive-utilities/create-root: a throwing body disposes the root and rethrows", () => {
    const log: string[] = [];
    expect(() =>
      createRoot(() => {
        onCleanup(() => {
          log.push("disposed");
        });
        throw new Error("body failed");
      }),
    ).toThrow("body failed");
    expect(log).toEqual(["disposed"]);
  });
});

describe("reactive-utilities/from", () => {
  // DIFFERENCE from Solid (by design): `from` is not exported by @shadow-js/core (packages/core/src/index.ts has no such export).
  it("[SOLID-UT-18] reactive-utilities/from: creates an accessor from a subscribable source (differs from Solid; ShadowJS: there is no from())", () => {
    expect(Reflect.get(core, "from")).toBeUndefined();
  });

  // DIFFERENCE from Solid (by design): `from` is not exported by @shadow-js/core (packages/core/src/index.ts has no such export).
  it("[SOLID-UT-19] reactive-utilities/from: creates an accessor from a producer function (differs from Solid; ShadowJS: there is no from())", () => {
    expect(Reflect.get(core, "from")).toBeUndefined();
  });
});

describe("reactive-utilities/observable", () => {
  // DIFFERENCE from Solid (by design): `observable` is not exported by @shadow-js/core (packages/core/src/index.ts has no such export).
  it("[SOLID-UT-20] reactive-utilities/observable: subscribe() runs an effect over the accessor and unsubscribe() stops it (differs from Solid; ShadowJS: there is no observable())", () => {
    expect(Reflect.get(core, "observable")).toBeUndefined();
  });
});

describe("reactive-utilities/on-util", () => {
  it("[SOLID-UT-21] reactive-utilities/on-util: useEffect(deps, fn) tracks only deps and runs fn untracked", () => {
    const log: Array<[string, number]> = [];
    const [a, setA] = useSignal("a");
    const [b, setB] = useSignal(1);
    inRoot(() => {
      useEffect(a, (v) => {
        log.push([v, b()]);
      });
    });
    flushSync();
    setB(2);
    flushSync();
    expect(log).toEqual([["a", 1]]);
    setA("x");
    flushSync();
    expect(log).toEqual([
      ["a", 1],
      ["x", 2],
    ]);
  });

  it("[SOLID-UT-22] reactive-utilities/on-util: { defer: true } skips the first run and runs on change", () => {
    const log: string[] = [];
    const [a, setA] = useSignal("initial");
    inRoot(() => {
      useEffect(
        a,
        (v) => {
          log.push(v);
        },
        { defer: true },
      );
    });
    flushSync();
    expect(log).toEqual([]);
    setA("new");
    flushSync();
    expect(log).toEqual(["new"]);
  });

  it("[SOLID-UT-23] reactive-utilities/on-util: several dependencies are watched through one deps function", () => {
    const log: Array<{
      input: readonly [number, number];
      prev: readonly [number, number] | undefined;
    }> = [];
    const [a, setA] = useSignal(1);
    const [b, setB] = useSignal(10);
    inRoot(() => {
      useEffect(
        () => [a(), b()] as const,
        (input, prev) => {
          log.push({ input, prev });
        },
      );
    });
    flushSync();
    setA(2);
    flushSync();
    setB(20);
    flushSync();
    expect(log).toEqual([
      { input: [1, 10], prev: undefined },
      { input: [2, 10], prev: [1, 10] },
      { input: [2, 20], prev: [2, 10] },
    ]);
  });

  it("[SOLID-UT-24] reactive-utilities/on-util: with stores, an arrow function over the property tracks it", () => {
    const log: number[] = [];
    const [state, setState] = useStore({ a: 1, b: 2 });
    inRoot(() => {
      useEffect(
        () => state.a,
        (v) => {
          log.push(v);
        },
      );
    });
    flushSync();
    setState((draft) => {
      draft.b = 5;
    });
    flushSync();
    expect(log).toEqual([1]);
    setState((draft) => {
      draft.a = 4;
    });
    flushSync();
    expect(log).toEqual([1, 4]);
  });
});

describe("reactive-utilities/start-transition and use-transition", () => {
  // RENAMED: startTransition is exported from @shadow-js/core (DEC-TRANSITIONS).
  it("[SOLID-UT-25] reactive-utilities/start-transition: startTransition(fn) returns a promise that resolves when the transition completes", async () => {
    const startTransition = need<(fn: () => unknown) => Promise<void>>("startTransition");
    const [userId, setUserId] = useSignal(1);
    await startTransition(() => {
      setUserId(2);
    });
    expect(userId()).toBe(2);
  });

  // RENAMED: useTransition() returns [isPending, start] (DEC-TRANSITIONS).
  it("[SOLID-UT-26] reactive-utilities/use-transition: useTransition() returns [pending, start]", async () => {
    const useTransition =
      need<() => [() => boolean, (fn: () => void) => Promise<void>]>("useTransition");
    const [userId, setUserId] = useSignal(1);
    const [pending, start] = useTransition();
    expect(pending()).toBe(false);
    await start(() => {
      setUserId(2);
    });
    expect(userId()).toBe(2);
  });
});

describe("reactive-utilities/get-owner", () => {
  it("[SOLID-UT-27] reactive-utilities/get-owner: returns null when no owner is active and an owner inside a root", () => {
    expect(getOwner()).toBeNull();
    createRoot(() => {
      expect(getOwner()).not.toBeNull();
    });
  });

  it("[SOLID-UT-28] reactive-utilities/get-owner: component code sees the owner of its render subtree", () => {
    let seen: Owner | null = null;
    mountApp(() => {
      seen = getOwner();
      return null;
    });
    expect(seen).not.toBeNull();
  });

  it("[SOLID-UT-29] reactive-utilities/get-owner: untrack does not create or change the owner", () => {
    createRoot(() => {
      const before = getOwner();
      expect(untrack(() => getOwner())).toBe(before);
    });
  });

  it("[SOLID-UT-30] reactive-utilities/get-owner: an effect runs under its own owner, a child of the surrounding one", () => {
    let outer: Owner | null = null;
    let inside: Owner | null = null;
    inRoot(() => {
      outer = getOwner();
      useEffect(() => {
        inside = getOwner();
      });
    });
    flushSync();
    expect(inside).not.toBeNull();
    expect(inside).not.toBe(outer);
  });

  it("[SOLID-UT-31] reactive-utilities/get-owner: a captured owner can be restored later (doc example)", async () => {
    const log: string[] = [];
    createRoot(() => {
      const owner = getOwner();
      queueMicrotask(() => {
        if (owner) {
          runWithOwner(owner, () => {
            log.push("owner restored");
          });
        }
      });
    });
    await Promise.resolve();
    expect(log).toEqual(["owner restored"]);
  });
});

describe("reactive-utilities/run-with-owner", () => {
  it("[SOLID-UT-32] reactive-utilities/run-with-owner: an effect created under a captured owner is disposed with that owner", async () => {
    const log: number[] = [];
    const [n, setN] = useSignal(0);
    let owner: Owner | null = null;
    const dispose = createRoot((d) => {
      owner = getOwner();
      return d;
    });
    await Promise.resolve();
    runWithOwner(owner, () => {
      useEffect(() => {
        log.push(n());
      });
    });
    flushSync();
    setN(1);
    flushSync();
    expect(log).toEqual([0, 1]);
    dispose();
    setN(2);
    flushSync();
    expect(log).toEqual([0, 1]);
  });

  it("[SOLID-UT-33] reactive-utilities/run-with-owner: restores context lookup for descendants", () => {
    const Theme = createContext("none");
    let owner: Owner | null = null;
    createRoot(() => {
      Theme({
        value: "dark",
        get children() {
          owner = getOwner();
          return null;
        },
      });
    });
    expect(runWithOwner(owner, () => useContext(Theme))).toBe("dark");
  });

  it("[SOLID-UT-34] reactive-utilities/run-with-owner: does not restore dependency tracking", () => {
    const runs: number[] = [];
    const [count, setCount] = useSignal(0);
    inRoot(() => {
      const owner = getOwner();
      useEffect(() => {
        runWithOwner(owner, () => {
          runs.push(count());
        });
      });
    });
    flushSync();
    setCount(1);
    flushSync();
    expect(runs).toEqual([0]);
  });

  it("[SOLID-UT-35] reactive-utilities/run-with-owner: returns the value produced by fn", () => {
    createRoot(() => {
      expect(runWithOwner(getOwner(), () => "value")).toBe("value");
    });
  });

  it("[SOLID-UT-36] reactive-utilities/run-with-owner: a null owner runs fn without an owner", () => {
    createRoot(() => {
      expect(runWithOwner(null, () => getOwner())).toBeNull();
    });
  });

  // DIFFERENCE from Solid (by design): Solid routes an error thrown by fn to the owner's error handler and returns undefined.
  // ShadowJS runWithOwner only restores state in `finally` (packages/core/src/ownership.ts:67-83) and rethrows.
  it("[SOLID-UT-37] reactive-utilities/run-with-owner: an error thrown by fn is routed to the owner's handler and undefined is returned (differs from Solid; ShadowJS: an error thrown by fn is rethrown after the owner is restored)", () => {
    const handled: string[] = [];
    let owner: Owner | null = null;
    catchError(
      () => {
        owner = getOwner();
      },
      (err) => {
        handled.push(messageOf(err));
      },
    );
    expect(() =>
      runWithOwner(owner, () => {
        throw new Error("routed");
      }),
    ).toThrow("routed");
    expect(handled).toEqual([]);
    expect(getOwner()).toBeNull();
  });

  it("[SOLID-UT-38] reactive-utilities/run-with-owner: a disposed owner is ignored with a dev warning (ShadowJS extension)", () => {
    const warn = vi.mocked(console.warn);
    let owner: Owner | null = null;
    createRoot((dispose) => {
      owner = getOwner();
      dispose();
    });
    createRoot(() => {
      expect(runWithOwner(owner, () => getOwner())).toBeNull();
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("RUN_WITH_DISPOSED_OWNER");
    warn.mockClear();
  });

  it("[SOLID-UT-39] reactive-utilities/run-with-owner: code after the first await runs without the restored owner", async () => {
    const afterAwait = await createRoot(async () => {
      await Promise.resolve();
      return getOwner();
    });
    expect(afterAwait).toBeNull();
  });
});

describe("reactive-utilities/index-array", () => {
  it("[SOLID-UT-40] reactive-utilities/index-array: maps by index with an item accessor and a numeric index", () => {
    const [source] = useSignal([{ status: "pending" }, { status: "done" }]);
    inRoot(() => {
      const mapped = indexArray(source, (item, index) => ({
        index,
        status: () => item().status,
      }));
      const rows = mapped();
      expect(rows.map((row) => row.index)).toEqual([0, 1]);
      expect(rows.map((row) => typeof row.index)).toEqual(["number", "number"]);
      expect(rows.map((row) => row.status())).toEqual(["pending", "done"]);
    });
  });

  it("[SOLID-UT-41] reactive-utilities/index-array: updating the item at an index keeps the mapped entry and updates its accessor", () => {
    const [source, setSource] = useSignal([{ status: "pending" }, { status: "done" }]);
    inRoot(() => {
      const mapped = indexArray(source, (item) => ({ status: () => item().status }));
      const first = mapped();
      setSource([{ status: "done" }, { status: "done" }]);
      const second = mapped();
      expect(second[0]).toBe(first[0]);
      expect(second[0]?.status()).toBe("done");
    });
  });

  it("[SOLID-UT-42] reactive-utilities/index-array: reordering changes what each index points to instead of moving entries", () => {
    const a = { name: "a" };
    const b = { name: "b" };
    const [source, setSource] = useSignal([a, b]);
    inRoot(() => {
      const mapped = indexArray(source, (item) => ({ name: () => item().name }));
      const before = mapped();
      setSource([b, a]);
      const after = mapped();
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
      expect(after.map((row) => row.name())).toEqual(["b", "a"]);
    });
  });

  it("[SOLID-UT-43] reactive-utilities/index-array: fallback becomes a single entry for an empty or falsy source", () => {
    const [source, setSource] = useSignal<readonly string[] | false>([]);
    inRoot(() => {
      const mapped = indexArray(source, (item) => item(), { fallback: () => "empty" });
      expect(mapped()).toEqual(["empty"]);
      setSource(false);
      expect(mapped()).toEqual(["empty"]);
      setSource(["x"]);
      expect(mapped()).toEqual(["x"]);
    });
  });

  it("[SOLID-UT-44] reactive-utilities/index-array: rows are created and removed only when the length changes", () => {
    const created: number[] = [];
    const removed: number[] = [];
    const [source, setSource] = useSignal([1, 2, 3]);
    inRoot(() => {
      const mapped = indexArray(source, (_item, index) => {
        created.push(index);
        onCleanup(() => {
          removed.push(index);
        });
        return index;
      });
      mapped();
      setSource([9, 8, 7]);
      mapped();
      expect(created).toEqual([0, 1, 2]);
      setSource([9]);
      mapped();
      expect(removed.sort()).toEqual([1, 2]);
    });
  });
});

describe("reactive-utilities/map-array", () => {
  it("[SOLID-UT-45] reactive-utilities/map-array: maps items cached by identity, index is an accessor", () => {
    const [source] = useSignal([
      { id: 1, status: "pending" },
      { id: 2, status: "done" },
    ]);
    inRoot(() => {
      const mapped = mapArray(source, (item, index) => ({
        id: item.id,
        status: item.status,
        position: () => index(),
      }));
      const rows = mapped();
      expect(rows.map((row) => [row.id, row.status, row.position()])).toEqual([
        [1, "pending", 0],
        [2, "done", 1],
      ]);
    });
  });

  it("[SOLID-UT-46] reactive-utilities/map-array: reordering reuses mapped items and updates index accessors", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const created: number[] = [];
    const [source, setSource] = useSignal([a, b]);
    inRoot(() => {
      const mapped = mapArray(source, (item, index) => {
        created.push(item.id);
        return { id: item.id, position: () => index() };
      });
      const first = mapped();
      setSource([b, a]);
      const second = mapped();
      expect(created).toEqual([1, 2]);
      expect(second[0]).toBe(first[1]);
      expect(second[1]).toBe(first[0]);
      expect(second.map((row) => row.position())).toEqual([0, 1]);
    });
  });

  it("[SOLID-UT-47] reactive-utilities/map-array: mapFn is not a tracking scope", () => {
    const runs: number[] = [];
    const [source] = useSignal([1]);
    const [other, setOther] = useSignal(0);
    inRoot(() => {
      const mapped = mapArray(source, (item) => {
        runs.push(item + other());
        return item;
      });
      mapped();
      setOther(1);
      mapped();
    });
    expect(runs).toEqual([1]);
  });

  it("[SOLID-UT-48] reactive-utilities/map-array: fallback becomes a single entry when the source is empty or falsy", () => {
    const [source, setSource] = useSignal<readonly number[] | null | undefined | false>([]);
    inRoot(() => {
      const mapped = mapArray(source, (item) => String(item), { fallback: () => "none" });
      expect(mapped()).toEqual(["none"]);
      setSource(null);
      expect(mapped()).toEqual(["none"]);
      setSource([1, 2]);
      expect(mapped()).toEqual(["1", "2"]);
    });
  });

  it("[SOLID-UT-49] reactive-utilities/map-array: keyed rows receive an item accessor (ShadowJS extension of the doc signature)", () => {
    const [source, setSource] = useSignal([{ id: 1, title: "a" }]);
    inRoot(() => {
      const mapped = mapArray(source, (item) => ({ title: () => item().title }), {
        key: (item) => item.id,
      });
      const first = mapped();
      setSource([{ id: 1, title: "renamed" }]);
      const second = mapped();
      expect(second[0]).toBe(first[0]);
      expect(second[0]?.title()).toBe("renamed");
    });
  });

  it("[SOLID-UT-50] reactive-utilities/map-array: rows whose item left the list are disposed", () => {
    const removed: number[] = [];
    const [source, setSource] = useSignal([1, 2, 3]);
    inRoot(() => {
      const mapped = mapArray(source, (item) => {
        onCleanup(() => {
          removed.push(item);
        });
        return item;
      });
      mapped();
      setSource([1, 3]);
      mapped();
    });
    expect(removed).toEqual([2]);
  });
});

describe("reactive-utilities/merge-props", () => {
  it("[SOLID-UT-51] reactive-utilities/merge-props: Greeting defaults are overridden by props (doc example, JSX)", async () => {
    const mod = await load<{ Greeting: (props: { greeting?: string; name?: string }) => unknown }>(`
      import { mergeProps } from "@shadow-js/core";
      export function Greeting(props) {
        const merged = mergeProps({ greeting: "Hello", name: "Smith" }, props);
        return <div>{merged.greeting} {merged.name}</div>;
      }
    `);
    const host = mountApp(() => mod.Greeting({ name: "Jones" }));
    expect(host.textContent).toBe("Hello Jones");
  });

  it("[SOLID-UT-52] reactive-utilities/merge-props: the last source with a non-undefined value wins", () => {
    const merged = mergeProps({ a: 1, b: 1 }, { a: 2, b: undefined });
    expect(merged.a).toBe(2);
    expect(merged.b).toBe(1);
  });

  it("[SOLID-UT-53] reactive-utilities/merge-props: properties are resolved when read, not copied eagerly", () => {
    let reads = 0;
    const source = {
      get value() {
        reads += 1;
        return reads;
      },
    };
    const merged = mergeProps({ value: 0 }, source);
    expect(reads).toBe(0);
    expect(merged.value).toBe(1);
    expect(merged.value).toBe(2);
  });

  it("[SOLID-UT-54] reactive-utilities/merge-props: function sources are called on each read so reads stay reactive", () => {
    const [color, setColor] = useSignal("red");
    const merged = mergeProps({ size: "md" }, () => ({ color: color() }));
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(merged.color);
      });
    });
    flushSync();
    setColor("blue");
    flushSync();
    expect(seen).toEqual(["red", "blue"]);
    expect(merged.size).toBe("md");
  });

  it("[SOLID-UT-55] reactive-utilities/merge-props: null, undefined and false sources are skipped; merge is shallow", () => {
    const inner = { x: 1 };
    const merged = mergeProps({ a: 1 }, null, undefined, false, { inner });
    expect(Object.keys(merged)).toEqual(["a", "inner"]);
    expect(merged.inner).toBe(inner);
  });
});

describe("reactive-utilities/split-props", () => {
  it("[SOLID-UT-56] reactive-utilities/split-props: local children and forwarded rest (doc example, JSX)", async () => {
    const mod = await load<{ MyComponent: (props: Record<string, unknown>) => unknown }>(`
      import { splitProps } from "@shadow-js/core";
      function Child(props) { return <span class={props.class}>{props.label}</span>; }
      export function MyComponent(props) {
        const [local, others] = splitProps(props, ["children"]);
        return <><div>{local.children}</div><Child {...others} /></>;
      }
    `);
    const host = mountApp(() => mod.MyComponent({ children: "kids", label: "lbl", class: "c" }));
    expect(host.querySelector("div")?.textContent).toBe("kids");
    expect(host.querySelector("span")?.textContent).toBe("lbl");
    expect(host.querySelector("span")?.className).toBe("c");
  });

  it("[SOLID-UT-57] reactive-utilities/split-props: multiple groups and the leftovers", () => {
    const props = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    const [vowels, consonants, leftovers] = splitProps(props, ["a", "e"], ["b", "c", "d"]);
    expect(Object.keys(vowels)).toEqual(["a", "e"]);
    expect(Object.keys(consonants)).toEqual(["b", "c", "d"]);
    expect(Object.keys(leftovers)).toEqual(["f"]);
  });

  // DIFFERENCE from Solid (by design): the doc says a key goes to the first matching group only. ShadowJS puts a key listed twice into
  // every group that lists it (packages/core/src/props.ts, splitProps defineGetter loop per group).
  it("[SOLID-UT-58] reactive-utilities/split-props: a key is assigned to the first matching group only (differs from Solid; ShadowJS: a key listed in two groups goes to both)", () => {
    const [first, second] = splitProps({ a: 1, b: 2 }, ["a"], ["a", "b"]);
    expect(Object.keys(first)).toEqual(["a"]);
    expect(Object.keys(second)).toEqual(["a", "b"]);
  });

  it("[SOLID-UT-59] reactive-utilities/split-props: returned objects stay reactive", () => {
    const [value, setValue] = useSignal(1);
    const props = {
      get value() {
        return value();
      },
      other: "x",
    };
    const [local, rest] = splitProps(props, ["value"]);
    const seen: number[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(local.value);
      });
    });
    flushSync();
    setValue(2);
    flushSync();
    expect(seen).toEqual([1, 2]);
    expect(rest).toEqual({ other: "x" });
  });

  it("[SOLID-UT-60] reactive-utilities/split-props: works on a mergeProps result with a function source", () => {
    const [color, setColor] = useSignal("red");
    const merged = mergeProps({ size: "md" }, () => ({ color: color() }));
    const [local, rest] = splitProps(merged, ["size"]);
    expect(local.size).toBe("md");
    expect(rest.color).toBe("red");
    setColor("blue");
    expect(rest.color).toBe("blue");
  });
});

describe("reactive-utilities/untrack", () => {
  it("[SOLID-UT-61] reactive-utilities/untrack: an untracked read does not make the effect depend on it", () => {
    const log: Array<[string, number]> = [];
    const [count, setCount] = useSignal(0);
    const [label, setLabel] = useSignal("count");
    inRoot(() => {
      useEffect(() => {
        log.push([untrack(() => label()), count()]);
      });
    });
    flushSync();
    setLabel("renamed");
    flushSync();
    expect(log).toEqual([["count", 0]]);
    setCount(1);
    flushSync();
    expect(log).toEqual([
      ["count", 0],
      ["renamed", 1],
    ]);
  });

  it("[SOLID-UT-62] reactive-utilities/untrack: returns the value produced by fn unchanged", () => {
    const value = { x: 1 };
    expect(untrack(() => value)).toBe(value);
  });

  it("[SOLID-UT-63] reactive-utilities/untrack: props.label read inside untrack does not re-run the effect (doc example, JSX)", async () => {
    const mod = await load<{ Component: (props: { id: number; label: string }) => unknown }>(`
      import { useEffect, untrack } from "@shadow-js/core";
      export const log = [];
      export function Component(props) {
        useEffect(() => { log.push([props.id, untrack(() => props.label)]); });
        return <div>{props.id}</div>;
      }
    `);
    const log = Reflect.get(mod, "log") as unknown[];
    const [id, setId] = useSignal(1);
    const [label, setLabel] = useSignal("a");
    const host = mountApp(() =>
      mod.Component({
        get id() {
          return id();
        },
        get label() {
          return label();
        },
      }),
    );
    flushSync();
    setLabel("b");
    flushSync();
    expect(log).toEqual([[1, "a"]]);
    setId(2);
    flushSync();
    expect(log).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    expect(host.textContent).toBe("2");
  });

  it("[SOLID-UT-64] reactive-utilities/untrack: initialName pattern reads the prop once when initializing a signal (doc notes)", async () => {
    const mod = await load<{ Component: (props: { initialName: string }) => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export function Component(props) {
        const [name] = useSignal(props.initialName);
        return <div>{name()}</div>;
      }
    `);
    const [initialName, setInitialName] = useSignal("first");
    const host = mountApp(() =>
      mod.Component({
        get initialName() {
          return initialName();
        },
      }),
    );
    setInitialName("second");
    flushSync();
    expect(host.textContent).toBe("first");
  });
});

describe("lifecycle/on-cleanup", () => {
  it("[SOLID-UT-65] lifecycle/on-cleanup: a component cleanup runs when it is unmounted (document listener example, JSX)", async () => {
    const mod = await load<{ Component: () => unknown }>(`
      import { onCleanup } from "@shadow-js/core";
      export const clicks = [];
      export const Component = () => {
        const handleClick = () => clicks.push("clicked");
        document.addEventListener("click", handleClick);
        onCleanup(() => { document.removeEventListener("click", handleClick); });
        return <main>Listening for document clicks</main>;
      };
    `);
    const clicks = Reflect.get(mod, "clicks") as string[];
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const dispose = render(() => mod.Component(), host);
    document.body.click();
    expect(clicks).toEqual(["clicked"]);
    dispose();
    document.body.click();
    expect(clicks).toEqual(["clicked"]);
  });

  it("[SOLID-UT-66] lifecycle/on-cleanup: an effect cleanup runs before the effect re-runs", () => {
    const log: string[] = [];
    const [topic, setTopic] = useSignal("news");
    inRoot(() => {
      useEffect(() => {
        const currentTopic = topic();
        log.push(`subscribing to ${currentTopic}`);
        onCleanup(() => {
          log.push(`cleaning up ${currentTopic}`);
        });
      });
    });
    flushSync();
    setTopic("sports");
    flushSync();
    expect(log).toEqual(["subscribing to news", "cleaning up news", "subscribing to sports"]);
  });

  it("[SOLID-UT-67] lifecycle/on-cleanup: several cleanups run when the owner is disposed", () => {
    const log: string[] = [];
    createRoot((dispose) => {
      onCleanup(() => {
        log.push("first");
      });
      onCleanup(() => {
        log.push("second");
      });
      dispose();
    });
    expect(log.sort()).toEqual(["first", "second"]);
  });

  it("[SOLID-UT-68] lifecycle/on-cleanup: in a memo the cleanup runs when it re-executes", () => {
    const log: string[] = [];
    const [n, setN] = useSignal(0);
    inRoot(() => {
      const doubled = useMemo(() => {
        const value = n() * 2;
        onCleanup(() => {
          log.push(`cleanup ${value}`);
        });
        return value;
      });
      expect(doubled()).toBe(0);
      setN(1);
      expect(doubled()).toBe(2);
    });
    expect(log).toEqual(["cleanup 0"]);
  });

  it("[SOLID-UT-69] lifecycle/on-cleanup: outside an owner nothing is registered and a dev warning is emitted", () => {
    const warn = vi.mocked(console.warn);
    const cleanup = vi.fn();
    onCleanup(cleanup);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("NO_OWNER_CLEANUP");
    warn.mockClear();
    expect(cleanup).not.toHaveBeenCalled();
  });

  // DIFFERENCE from Solid (by design): Solid's onCleanup returns the function it was given (`onCleanup<T extends () => any>(fn: T): T`).
  // ShadowJS declares `onCleanup(fn: Cleanup): void` (packages/core/src/ownership.ts:90).
  it("[SOLID-UT-70] lifecycle/on-cleanup: returns fn unchanged (differs from Solid; ShadowJS: onCleanup returns nothing)", () => {
    const fn = (): void => undefined;
    createRoot(() => {
      expect(Reflect.apply(onCleanup, undefined, [fn]) as unknown).toBeUndefined();
    });
  });
});

describe("lifecycle/on-mount", () => {
  it("[SOLID-UT-71] lifecycle/on-mount: refs are assigned by the time onMount runs (doc example, JSX)", async () => {
    const mod = await load<{ MyComponent: () => unknown }>(`
      import { onMount } from "@shadow-js/core";
      export function MyComponent() {
        let ref;
        onMount(() => { ref.disabled = true; });
        return <button ref={ref}>Focus me!</button>;
      }
    `);
    const host = mountApp(() => mod.MyComponent());
    flushSync();
    expect(host.querySelector("button")?.disabled).toBe(true);
  });

  it("[SOLID-UT-72] lifecycle/on-mount: runs once after the initial render, not during it", () => {
    const log: string[] = [];
    inRoot(() => {
      onMount(() => {
        log.push("mounted");
      });
      log.push("render");
    });
    expect(log).toEqual(["render"]);
    flushSync();
    expect(log).toEqual(["render", "mounted"]);
  });

  it("[SOLID-UT-73] lifecycle/on-mount: fn does not track reactive dependencies", () => {
    const runs: number[] = [];
    const [count, setCount] = useSignal(0);
    inRoot(() => {
      onMount(() => {
        runs.push(count());
      });
    });
    flushSync();
    setCount(1);
    flushSync();
    expect(runs).toEqual([0]);
  });

  // DIFFERENCE from Solid (by design): Solid does not treat a function returned from onMount as cleanup. ShadowJS does
  // (packages/core/src/effect.ts:103-105, onMount is an effect and its return value is the cleanup).
  it("[SOLID-UT-74] lifecycle/on-mount: returning a function from fn does not register cleanup (differs from Solid; ShadowJS: a function returned from onMount is its cleanup)", () => {
    const cleaned = vi.fn();
    createRoot((dispose) => {
      onMount(() => cleaned);
      flushSync();
      dispose();
    });
    expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it("[SOLID-UT-75] lifecycle/on-mount: onCleanup inside onMount runs on dispose", () => {
    const log: string[] = [];
    createRoot((dispose) => {
      onMount(() => {
        onCleanup(() => {
          log.push("cleaned");
        });
      });
      flushSync();
      dispose();
    });
    expect(log).toEqual(["cleaned"]);
  });

  it("[SOLID-UT-76] lifecycle/on-mount: mounted means evaluated in the reactive tree, even when the JSX is never inserted", async () => {
    const mod = await load<{ Holder: () => unknown }>(`
      import { onMount } from "@shadow-js/core";
      export const log = [];
      function Child() { onMount(() => { log.push("child mounted"); }); return <i>child</i>; }
      export function Holder() {
        const detached = <Child />;
        return <p>no child inserted</p>;
      }
    `);
    const log = Reflect.get(mod, "log") as string[];
    const host = mountApp(() => mod.Holder());
    flushSync();
    expect(host.querySelector("i")).toBeNull();
    expect(log).toEqual(["child mounted"]);
  });
});
