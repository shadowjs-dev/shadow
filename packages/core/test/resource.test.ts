import { describe, expect, expectTypeOf, it } from "vitest";
import type { Resource, ResourceCache, ResourceInfo, SuspenseTracker } from "../src/index";
import {
  createRoot,
  flushSync,
  ResourceCacheContext,
  SuspenseContext,
  useEffect,
  useMemo,
  useOptimistic,
  useResource,
  useSignal,
} from "../src/index";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
};

describe("useResource", () => {
  it("[RES-01] pending then ready", async () => {
    const d = deferred<number>();
    const seen: Array<[string, number | undefined]> = [];
    createRoot(() => {
      const res = useResource(() => d.promise);
      useEffect(() => void seen.push([res.state, res()]));
    });
    flushSync();
    d.resolve(7);
    await settle();
    expect(seen).toEqual([
      ["pending", undefined],
      ["ready", 7],
    ]);
  });

  it("[RES-02] synchronous fetcher is ready immediately", () => {
    createRoot(() => {
      const res = useResource(() => 5);
      expect(res.state).toBe("ready");
      expect(res()).toBe(5);
    });
  });

  it("[RES-03] source change refetches; stale responses are ignored; previous aborted", async () => {
    const [id, setId] = useSignal(1);
    const calls = new Map<number, ReturnType<typeof deferred<string>>>();
    const signals: AbortSignal[] = [];
    let res!: ReturnType<typeof useResource<number, string>>;
    createRoot(() => {
      res = useResource(id, (value, info) => {
        signals.push(info.signal);
        const d = deferred<string>();
        calls.set(value, d);
        return d.promise;
      });
    });
    flushSync();
    flushSync(() => setId(2));
    expect(signals[0]?.aborted).toBe(true);
    calls.get(2)?.resolve("two");
    await settle();
    calls.get(1)?.resolve("one");
    await settle();
    expect(res()).toBe("two");
    expect(res.state).toBe("ready");
  });

  it("[RES-04] refetch keeps the old value and reports refreshing", async () => {
    let n = 0;
    const pending: Array<ReturnType<typeof deferred<number>>> = [];
    let res!: ReturnType<typeof useResource<number>>;
    createRoot(() => {
      res = useResource(() => {
        const d = deferred<number>();
        pending.push(d);
        n += 1;
        return d.promise;
      });
    });
    pending[0]?.resolve(1);
    await settle();
    res.refetch();
    expect(res.state).toBe("refreshing");
    expect(res()).toBe(1);
    expect(res.loading).toBe(true);
    pending[1]?.resolve(2);
    await settle();
    expect(res()).toBe(2);
    expect(n).toBe(2);
  });

  it("[RES-05] rejection throws on read and exposes error", async () => {
    const d = deferred<number>();
    let res!: ReturnType<typeof useResource<number>>;
    createRoot(() => {
      res = useResource(() => d.promise);
    });
    d.reject(new Error("nope"));
    await settle();
    expect(res.state).toBe("errored");
    expect(() => res()).toThrow("nope");
    expect((res.error as Error).message).toBe("nope");
    expect(res.latest).toBeUndefined();
  });

  it("[RES-06] synchronous throw becomes errored", () => {
    createRoot(() => {
      const res = useResource((): number => {
        throw new Error("sync");
      });
      expect(res.state).toBe("errored");
      expect(() => res()).toThrow("sync");
    });
  });

  it("[RES-07] falsy source keeps it unresolved without fetching", () => {
    let calls = 0;
    createRoot(() => {
      const res = useResource(
        () => false as const,
        () => {
          calls += 1;
          return 1;
        },
      );
      expect(res.state).toBe("unresolved");
    });
    expect(calls).toBe(0);
  });

  it("[RES-08] holds the creating boundary exactly once per first load", async () => {
    const counts = { up: 0, down: 0 };
    const tracker: SuspenseTracker = {
      increment: () => {
        counts.up += 1;
      },
      decrement: () => {
        counts.down += 1;
      },
    };
    const d = deferred<number>();
    createRoot(() => {
      SuspenseContext({
        value: tracker,
        get children() {
          const res = useResource(() => d.promise);
          useEffect(() => void res());
          useEffect(() => void res());
          return null;
        },
      });
    });
    flushSync();
    expect(counts).toEqual({ up: 1, down: 0 });
    d.resolve(1);
    await settle();
    expect(counts).toEqual({ up: 1, down: 1 });
  });

  it("[RES-09] mutate sets the value and ignores the in-flight fetch", async () => {
    const d = deferred<number>();
    let res!: ReturnType<typeof useResource<number>>;
    createRoot(() => {
      res = useResource(() => d.promise);
    });
    res.mutate(9);
    d.resolve(1);
    await settle();
    expect(res()).toBe(9);
    res.mutate((previous) => (previous ?? 0) + 1);
    expect(res()).toBe(10);
  });

  it("[RES-10] disposing the owner aborts and drops late results", async () => {
    const d = deferred<number>();
    let aborted = false;
    let res!: ReturnType<typeof useResource<number>>;
    const dispose = createRoot((dispose) => {
      res = useResource((info) => {
        info.signal.addEventListener("abort", () => {
          aborted = true;
        });
        return d.promise;
      });
      return dispose;
    });
    dispose();
    expect(aborted).toBe(true);
    d.resolve(3);
    await settle();
    expect(res.state).toBe("pending");
  });

  it("[RES-11] initialValue is visible while the first fetch refreshes it", () => {
    createRoot(() => {
      const res = useResource(() => new Promise<number>(() => undefined), { initialValue: 4 });
      expect(res.state).toBe("refreshing");
      expect(res()).toBe(4);
    });
  });
});

describe("useOptimistic", () => {
  it("[OPT-01] applies pending actions then falls back to the source", async () => {
    const [list, setList] = useSignal<string[]>([]);
    const d = deferred<void>();
    let view!: () => string[];
    let add!: (action: string, settled: Promise<unknown>) => void;
    createRoot(() => {
      [view, add] = useOptimistic(list, (state, action: string) => [...state, action]);
    });
    add("a", d.promise);
    expect(view()).toEqual(["a"]);
    setList(["a"]);
    d.resolve();
    await settle();
    expect(view()).toEqual(["a"]);
  });

  it("[OPT-02] rolled back when the promise rejects", async () => {
    const [list] = useSignal<string[]>(["x"]);
    const d = deferred<void>();
    let view!: () => string[];
    let add!: (action: string, settled: Promise<unknown>) => void;
    createRoot(() => {
      [view, add] = useOptimistic(list, (state, action: string) => [...state, action]);
    });
    add("y", d.promise);
    expect(view()).toEqual(["x", "y"]);
    d.reject(new Error("fail"));
    await settle();
    expect(view()).toEqual(["x"]);
  });
});

describe("resource cache bridge", () => {
  const makeCache = (seed: Record<string, unknown> = {}) => {
    const tracked: string[] = [];
    let counter = 0;
    const cache: ResourceCache = {
      key: (explicit) => explicit ?? `auto-${counter++}`,
      read: (key) => (key in seed ? { value: seed[key] } : undefined),
      track: (key) => void tracked.push(key),
    };
    return { cache, tracked };
  };

  it("[RES-20] a cached value skips the first fetch", () => {
    const { cache } = makeCache({ user: { name: "a" } });
    let calls = 0;
    createRoot(() => {
      ResourceCacheContext({
        value: cache,
        get children() {
          const res = useResource(
            () => {
              calls += 1;
              return Promise.resolve({ name: "b" });
            },
            { key: "user" },
          );
          expect(res.state).toBe("ready");
          expect(res()).toEqual({ name: "a" });
          return null;
        },
      });
    });
    expect(calls).toBe(0);
  });

  it("[RES-21] a miss fetches and tracks the promise under the key", () => {
    const { cache, tracked } = makeCache();
    createRoot(() => {
      ResourceCacheContext({
        value: cache,
        get children() {
          useResource(() => Promise.resolve(1));
          useResource(() => Promise.resolve(2), { key: "named" });
          return null;
        },
      });
    });
    expect(tracked).toEqual(["auto-0", "named"]);
  });

  it("[RES-22] refetch ignores the cache", async () => {
    const { cache } = makeCache({ k: 1 });
    let res!: ReturnType<typeof useResource<number>>;
    createRoot(() => {
      ResourceCacheContext({
        value: cache,
        get children() {
          res = useResource(() => Promise.resolve(2), { key: "k" });
          return null;
        },
      });
    });
    expect(res()).toBe(1);
    res.refetch();
    await settle();
    expect(res()).toBe(2);
  });
});

describe("resource typing", () => {
  it("[RES-T1] T is inferred from the fetcher's return even when the fetcher reads info", () => {
    const probe = () =>
      useResource((info) => Promise.resolve({ n: 1, aborted: info.signal.aborted }));
    expectTypeOf(probe).returns.toEqualTypeOf<Resource<{ n: number; aborted: boolean }>>();
    const annotated = () =>
      useResource((info: ResourceInfo<number>) => Promise.resolve((info.value ?? 0) + 1));
    expectTypeOf(annotated).returns.toEqualTypeOf<Resource<number>>();
  });
});

describe("resource cache: deferStream and pending fetches", () => {
  it("[RES-30] a deferStream resource tells the cache its fetch is held; other fetches are not", () => {
    const calls: Array<{ key: string; deferStream: boolean | undefined }> = [];
    const cache: ResourceCache = {
      key: (explicit) => explicit ?? "auto",
      read: () => undefined,
      track: (key, _promise, options) =>
        void calls.push({ key, deferStream: options?.deferStream }),
    };
    createRoot(() => {
      ResourceCacheContext({
        value: cache,
        get children() {
          useResource(() => Promise.resolve(1), { key: "held", deferStream: true });
          useResource(() => Promise.resolve(2), { key: "plain" });
          return null;
        },
      });
    });
    expect(calls).toEqual([
      { key: "held", deferStream: true },
      { key: "plain", deferStream: undefined },
    ]);
  });

  it("[RES-31] a cache with a pending fetch for the key is joined: the fetcher does not run again", async () => {
    const joined = deferred<number>();
    const fetched: string[] = [];
    const cache: ResourceCache = {
      key: (explicit) => explicit ?? "auto",
      read: () => undefined,
      track: (key) => void fetched.push(`track:${key}`),
      pending: (key) => (key === "shared" ? joined.promise : undefined),
    };
    let calls = 0;
    let res!: Resource<number>;
    createRoot(() => {
      ResourceCacheContext({
        value: cache,
        get children() {
          res = useResource(
            () => {
              calls += 1;
              return Promise.resolve(-1);
            },
            { key: "shared" },
          );
          return null;
        },
      });
    });
    expect(calls).toBe(0);
    expect(res.state).toBe("pending");
    joined.resolve(7);
    await settle();
    expect(res.state).toBe("ready");
    expect(res()).toBe(7);
    expect(fetched).toEqual(["track:shared"]);
  });

  it("[RES-32] a pending fetch is not joined by a refetch, which always runs its fetcher", async () => {
    const joined = deferred<number>();
    const cache: ResourceCache = {
      key: (explicit) => explicit ?? "auto",
      read: () => undefined,
      track: () => undefined,
      pending: () => joined.promise,
    };
    let calls = 0;
    let res!: Resource<number>;
    createRoot(() => {
      ResourceCacheContext({
        value: cache,
        get children() {
          res = useResource(
            () => {
              calls += 1;
              return Promise.resolve(calls);
            },
            { key: "k", initialValue: 0 },
          );
          return null;
        },
      });
    });
    expect(calls).toBe(1);
    await res.refetch();
    expect(calls).toBe(2);
  });
});

describe("resource actions", () => {
  it("[RES-R1] refetch() resolves with the new value and never rejects", async () => {
    let n = 0;
    let res: Resource<number> | undefined;
    createRoot(() => {
      res = useResource(() => {
        n += 1;
        return Promise.resolve(n);
      });
    });
    flushSync();
    await settle();
    expect(res?.latest).toBe(1);
    await expect(res?.refetch()).resolves.toBe(2);
    expect(res?.latest).toBe(2);
  });

  it("[RES-R2] refetch() of a failing fetch resolves undefined and records the error", async () => {
    let fail = false;
    let res: Resource<number> | undefined;
    createRoot(() => {
      res = useResource(() => (fail ? Promise.reject(new Error("no")) : Promise.resolve(1)));
    });
    flushSync();
    await settle();
    fail = true;
    await expect(res?.refetch()).resolves.toBeUndefined();
    expect(res?.state).toBe("errored");
  });

  it("[RES-R3] a refetch replaced by a newer one resolves undefined", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const queue = [Promise.resolve(0), first.promise, second.promise];
    let res: Resource<number> | undefined;
    createRoot(() => {
      res = useResource(() => queue.shift() as Promise<number>);
    });
    flushSync();
    await settle();
    const a = res?.refetch();
    const b = res?.refetch();
    second.resolve(2);
    first.resolve(1);
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBe(2);
  });

  it("[RES-R4] mutate() returns the new value (value or updater)", async () => {
    let res: Resource<number> | undefined;
    createRoot(() => {
      res = useResource(() => Promise.resolve(1));
    });
    flushSync();
    await settle();
    expect(res?.mutate(5)).toBe(5);
    expect(res?.mutate((previous) => (previous ?? 0) + 1)).toBe(6);
    expect(res?.latest).toBe(6);
  });

  it("[RES-R5] a plain value is accepted as the source", async () => {
    const calls: string[] = [];
    let res: Resource<string> | undefined;
    createRoot(() => {
      res = useResource("abc", (id) => {
        calls.push(id);
        return Promise.resolve(id.toUpperCase());
      });
    });
    flushSync();
    await settle();
    expect(calls).toEqual(["abc"]);
    expect(res?.latest).toBe("ABC");
  });

  it("[RES-R6] a resource may be created while a memo computes (a router renders routes in memos)", async () => {
    let res: Resource<number> | undefined;
    createRoot(() => {
      const view = useMemo(() => {
        res = useResource(() => Promise.resolve(3));
        return "x";
      });
      expect(view()).toBe("x");
    });
    flushSync();
    await settle();
    expect(res?.latest).toBe(3);
  });
  describe("name option", () => {
    type Reported = { kind: number; a: unknown; b: unknown; c: unknown };
    const KEY = "__SHADOWJS_DEVTOOLS_HOOK__";
    const RESOURCE_STATE = 10;
    /** Installs a devtools hook that records resource state events; returns them and a restore function. */
    function record(): { events: Reported[]; restore: () => void } {
      const events: Reported[] = [];
      const holder = globalThis as unknown as Record<string, unknown>;
      const previous = holder[KEY];
      holder[KEY] = {
        version: 1,
        report(kind: number, a?: unknown, b?: unknown, c?: unknown) {
          if (kind === RESOURCE_STATE) events.push({ kind, a, b, c });
        },
      };
      return {
        events,
        restore: () => {
          if (previous === undefined) delete holder[KEY];
          else holder[KEY] = previous;
        },
      };
    }

    it("[RES-N1] the devtools event carries the resource's name, not its server key", async () => {
      const hook = record();
      try {
        createRoot(() => {
          useResource(() => Promise.resolve(1), { name: "users", key: "server-key-1" });
        });
        flushSync();
        await settle();
        expect(hook.events.length).toBeGreaterThan(0);
        expect(hook.events.every((event) => event.c === "users")).toBe(true);
      } finally {
        hook.restore();
      }
    });

    it("[RES-N2] an unnamed resource reports no name, even with a server key", async () => {
      const hook = record();
      try {
        createRoot(() => {
          useResource(() => Promise.resolve(1), { key: "only-a-key" });
        });
        flushSync();
        await settle();
        expect(hook.events.length).toBeGreaterThan(0);
        expect(hook.events.every((event) => event.c === undefined)).toBe(true);
      } finally {
        hook.restore();
      }
    });
  });
});
