import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createRoot, flushSync, useEffect, useMemo } from "../src/index";
import {
  reconcile,
  type Store,
  snapshot,
  unwrap,
  useStore as useStoreDeferred,
} from "../src/store/index";

/**
 * A store write schedules its effects like a signal write does (one microtask). These tests assert
 * what readers saw after each write, so the setter here drains the queue right away; the deferral
 * itself is covered by STO-D1 in unified-store.test.ts.
 */
const useStore = ((initial: unknown, options?: object) => {
  const [value, set] = (useStoreDeferred as (i: unknown, o?: object) => [unknown, unknown])(
    initial,
    options,
  );
  if (typeof set !== "function") return [value, set];
  const sync = (...args: unknown[]): unknown => {
    const result = (set as (...a: unknown[]) => unknown)(...args);
    flushSync();
    return result;
  };
  return [value, sync];
}) as typeof useStoreDeferred;

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

interface Model {
  todos: Todo[];
  user: { name: string; prefs: { theme: string } };
  count: number;
}

interface Keys {
  a?: number;
  b?: number;
  c?: number;
}

interface Deep {
  child?: Deep;
  leaf: number;
}

type Bag = Record<string, unknown>;

function model(): Model {
  return {
    todos: [
      { id: 1, title: "a", done: false },
      { id: 2, title: "b", done: false },
    ],
    user: { name: "Ada", prefs: { theme: "light" } },
    count: 0,
  };
}

function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

/** Runs `fn` and asserts it threw a TypeError whose message starts with "ShadowStore". */
function expectStoreError(fn: () => void): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TypeError);
  expect(caught instanceof Error ? caught.message : "").toMatch(/^ShadowStore/);
}

function chain(depth: number, leaf: number): Deep {
  let node: Deep = { leaf };
  for (let i = 0; i < depth; i += 1) node = { leaf: 0, child: node };
  return node;
}

function descend(start: Deep, depth: number): Deep {
  let cursor = start;
  for (let i = 0; i < depth; i += 1) {
    const next = cursor.child;
    if (next === undefined) throw new Error("chain is shorter than expected");
    cursor = next;
  }
  return cursor;
}

describe("store: reads are tracked per property", () => {
  it("[STO-01] an effect reading one item ignores writes to a sibling item", () => {
    const [store, setStore] = useStore(model());
    const seen: boolean[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(at(store.todos, 0).done);
      });
    });
    flushSync();
    setStore((draft) => {
      at(draft.todos, 1).done = true;
    });
    expect(seen).toEqual([false]);
    setStore((draft) => {
      at(draft.todos, 0).done = true;
    });
    expect(seen).toEqual([false, true]);
  });

  it("[STO-02] many writes inside one setStore run each reader effect once", () => {
    const [store, setStore] = useStore(model());
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(store.count + store.todos.length + store.user.name.length);
      });
    });
    flushSync();
    setStore((draft) => {
      draft.count += 1;
      draft.count += 1;
      draft.todos.push({ id: 3, title: "c", done: false });
      draft.user.name = "Grace";
    });
    expect(seen).toEqual([5, 10]);
  });

  it("[STO-03] writing an equal value does not notify readers", () => {
    const [store, setStore] = useStore(model());
    let runs = 0;
    createRoot(() => {
      useEffect(() => {
        runs += store.count;
        runs += 1;
      });
    });
    flushSync();
    expect(runs).toBe(1);
    setStore((draft) => {
      draft.count = 0;
      at(draft.todos, 0).title = "a";
    });
    expect(runs).toBe(1);
  });

  it("[STO-04] nested reads subscribe to the exact leaf path only", () => {
    const [store, setStore] = useStore(model());
    const theme: string[] = [];
    createRoot(() => {
      useEffect(() => {
        theme.push(store.user.prefs.theme);
      });
    });
    flushSync();
    setStore((draft) => {
      draft.user.name = "Grace";
    });
    expect(theme).toEqual(["light"]);
    setStore((draft) => {
      draft.user.prefs.theme = "dark";
    });
    expect(theme).toEqual(["light", "dark"]);
  });

  it("[STO-05] array mutators write the right values and leave the length correct", () => {
    const [store, setStore] = useStore({ list: [3, 1, 2] });
    const seen: string[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(`${store.list.length}:${store.list.join(",")}`);
      });
    });
    flushSync();
    setStore((draft) => {
      draft.list.push(4);
    });
    setStore((draft) => {
      draft.list.pop();
    });
    setStore((draft) => {
      draft.list.unshift(9);
    });
    setStore((draft) => {
      draft.list.shift();
    });
    setStore((draft) => {
      draft.list.splice(1, 1, 7, 8);
    });
    setStore((draft) => {
      draft.list.sort((x, y) => x - y);
    });
    setStore((draft) => {
      draft.list.reverse();
    });
    setStore((draft) => {
      draft.list.length = 1;
    });
    expect(seen).toEqual([
      "3:3,1,2",
      "4:3,1,2,4",
      "3:3,1,2",
      "4:9,3,1,2",
      "3:3,1,2",
      "4:3,7,8,2",
      "4:2,3,7,8",
      "4:8,7,3,2",
      "1:8",
    ]);
  });

  it("[STO-06] a length reader is not notified by an index write that keeps the length", () => {
    const [store, setStore] = useStore({ list: [3, 1, 2] });
    let lengthRuns = 0;
    createRoot(() => {
      useEffect(() => {
        lengthRuns += store.list.length;
        lengthRuns += 1;
      });
    });
    flushSync();
    expect(lengthRuns).toBe(4);
    setStore((draft) => {
      draft.list[0] = 9;
    });
    expect(lengthRuns).toBe(4);
    setStore((draft) => {
      draft.list.push(5);
    });
    expect(lengthRuns).toBe(4 + 4 + 1);
  });

  it("[STO-07] reading a missing index subscribes to that index", () => {
    const [store, setStore] = useStore({ list: [3, 1, 2] });
    const seen: string[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(String(store.list[3] ?? "none"));
      });
    });
    flushSync();
    setStore((draft) => {
      draft.list.push(42);
    });
    expect(seen).toEqual(["none", "42"]);
  });
});

describe("store: key enumeration", () => {
  it("[STO-08] Object.keys and `in` readers follow key additions and deletions only", () => {
    const [store, setStore] = useStore<Keys>({ a: 1, b: 2 });
    const keys: string[] = [];
    const has: boolean[] = [];
    createRoot(() => {
      useEffect(() => {
        keys.push(Object.keys(store).join(","));
      });
      useEffect(() => {
        has.push("c" in store);
      });
    });
    flushSync();
    setStore((draft) => {
      draft.a = 10;
    });
    expect(keys).toEqual(["a,b"]);
    setStore((draft) => {
      draft.c = 3;
    });
    expect(keys).toEqual(["a,b", "a,b,c"]);
    expect(has).toEqual([false, true]);
    setStore((draft) => {
      delete draft.b;
    });
    expect(keys).toEqual(["a,b", "a,b,c", "a,c"]);
  });
});

describe("store: identity and raw access", () => {
  it("[STO-09] proxies are stable per object and assigning a proxy stores its raw target", () => {
    const [store, setStore] = useStore(model());
    expect(store.user).toBe(store.user);
    const raw = unwrap(store);
    expect(raw.user).toBe(unwrap(store.user));

    setStore((draft) => {
      draft.todos.push(at(store.todos, 0) as Todo);
    });
    expect(at(unwrap(store).todos, 2)).toBe(at(unwrap(store).todos, 0));
    expect(at(store.todos, 2)).toBe(at(store.todos, 0));
  });

  it("[STO-10] unwrap returns the raw initial object and snapshot is an untracked deep clone", () => {
    const initial = model();
    const [store, setStore] = useStore(initial);
    expect(unwrap(store)).toBe(initial);

    const copy = snapshot(store);
    expect(copy).toEqual(initial);
    expect(copy).not.toBe(initial);
    expect(copy.todos).not.toBe(initial.todos);
    copy.count = 99;
    expect(initial.count).toBe(0);

    let runs = 0;
    createRoot(() => {
      useEffect(() => {
        runs += snapshot(store).count;
        runs += 1;
      });
    });
    flushSync();
    expect(runs).toBe(1);
    setStore((draft) => {
      draft.count = 5;
    });
    expect(runs).toBe(1);
  });

  it("[STO-11] non-plain values are returned untouched and not tracked deeply", () => {
    const when = new Date(0);
    const bag = new Map<string, number>([["x", 1]]);
    const fn = (): number => 1;
    const shape = new Set([1]);
    const [store] = useStore({ when, bag, fn, shape });
    expect(store.when).toBe(when);
    expect(store.bag).toBe(bag);
    expect(store.fn).toBe(fn);
    expect(store.shape).toBe(shape);
    expect(store.bag.get("x")).toBe(1);
  });

  it("[STO-12] frozen input objects read without invariant errors", () => {
    const frozen = Object.freeze({ inner: Object.freeze({ value: 1 }) });
    const [store] = useStore(frozen);
    expect(store.inner.value).toBe(1);
    expect(store.inner).toBe(store.inner);
  });

  it("[STO-13] a non-plain value (Map) becomes a single-value cell, not a store", () => {
    const map = new Map();
    const [read, write] = useStore(map);
    expect(read()).toBe(map);
    const next = new Map();
    write(() => next);
    expect(read()).toBe(next);
  });

  it("[STO-27] Store<T> is a deep readonly view of T", () => {
    expectTypeOf<Store<{ a: number; list: string[] }>>().toEqualTypeOf<{
      readonly a: number;
      readonly list: readonly string[];
    }>();
  });
});

describe("store: writes", () => {
  it("[STO-14] writing through the store outside setStore throws a ShadowStore TypeError", () => {
    const [store, setStore] = useStore(model());
    expectStoreError(() => {
      Reflect.set(store, "count", 2);
    });
    expectStoreError(() => {
      Reflect.deleteProperty(store.user, "name");
    });
    expectStoreError(() => {
      (store.todos as unknown as Todo[]).push({ id: 9, title: "x", done: false });
    });
    expect(unwrap(store).count).toBe(0);
    expect(unwrap(store).todos).toHaveLength(2);
    setStore((draft) => {
      draft.count = 1;
    });
    expect(unwrap(store).count).toBe(1);
  });

  it("[STO-15] a draft that escapes its setStore call throws when written", () => {
    const [store, setStore] = useStore(model());
    const holder: { draft?: Model } = {};
    setStore((draft) => {
      holder.draft = draft;
    });
    const escaped = holder.draft;
    expectStoreError(() => {
      if (escaped !== undefined) escaped.count = 5;
    });
    expect(unwrap(store).count).toBe(0);
  });

  it("[STO-16] assigning __proto__, constructor or prototype in a draft throws and pollutes nothing", () => {
    const [, setStore] = useStore(model());
    for (const key of ["__proto__", "constructor", "prototype"]) {
      expectStoreError(() => {
        setStore((draft) => {
          (draft as unknown as Bag)[key] = { polluted: true };
        });
      });
    }
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "x")).toBe(false);
  });

  it("[STO-17] a memo reading the store recomputes only for the properties it read", () => {
    const [store, setStore] = useStore(model());
    let memoRuns = 0;
    const seen: string[] = [];
    createRoot(() => {
      const label = useMemo(() => {
        memoRuns += 1;
        return `${store.user.name}!`;
      });
      useEffect(() => {
        seen.push(label());
      });
    });
    flushSync();
    setStore((draft) => {
      draft.user.name = "Grace";
    });
    expect(seen).toEqual(["Ada!", "Grace!"]);
    expect(memoRuns).toBe(2);
    setStore((draft) => {
      draft.count = 1;
    });
    expect(memoRuns).toBe(2);
  });

  it("[STO-18] effects disposed with their root stop reacting to the store", () => {
    const [store, setStore] = useStore(model());
    const seen: number[] = [];
    const dispose = createRoot((disposeRoot) => {
      useEffect(() => {
        seen.push(store.count);
      });
      return disposeRoot;
    });
    flushSync();
    setStore((draft) => {
      draft.count = 1;
    });
    dispose();
    setStore((draft) => {
      draft.count = 2;
    });
    expect(seen).toEqual([0, 1]);
  });
});

describe("store: reconcile", () => {
  interface Row {
    id: number;
    label: string;
    done: boolean;
  }

  it("[STO-19] keyed rows keep identity and only the changed row's readers rerun", () => {
    const [store, setStore] = useStore({
      rows: [
        { id: 1, label: "a", done: false },
        { id: 2, label: "b", done: false },
      ] as Row[],
    });
    const rowZero: boolean[] = [];
    const rowOne: boolean[] = [];
    createRoot(() => {
      useEffect(() => {
        rowZero.push(at(store.rows, 0).done);
      });
      useEffect(() => {
        rowOne.push(at(store.rows, 1).done);
      });
    });
    flushSync();
    const first = at(unwrap(store).rows, 0);
    setStore(
      reconcile<{ rows: Row[] }>({
        rows: [
          { id: 1, label: "a", done: false },
          { id: 2, label: "b", done: true },
        ],
      }),
    );
    expect(at(unwrap(store).rows, 0)).toBe(first);
    expect(rowZero).toEqual([false]);
    expect(rowOne).toEqual([false, true]);
  });

  it("[STO-20] reordering keyed rows moves their identities", () => {
    const [store, setStore] = useStore({
      rows: [
        { id: 1, label: "a", done: false },
        { id: 2, label: "b", done: false },
      ] as Row[],
    });
    const one = at(unwrap(store).rows, 0);
    const two = at(unwrap(store).rows, 1);
    setStore(
      reconcile<{ rows: Row[] }>({
        rows: [
          { id: 2, label: "b", done: false },
          { id: 1, label: "a", done: false },
        ],
      }),
    );
    expect(at(unwrap(store).rows, 0)).toBe(two);
    expect(at(unwrap(store).rows, 1)).toBe(one);
  });

  it("[STO-21] items without a key fall back to index matching", () => {
    const [store, setStore] = useStore({
      tags: ["a", "b", "c"],
      items: [{ v: 1 }, { v: 2 }] as { v: number }[],
    });
    const item = at(unwrap(store).items, 1);
    const tagZero: string[] = [];
    const tagOne: string[] = [];
    createRoot(() => {
      useEffect(() => {
        tagZero.push(at(store.tags, 0));
      });
      useEffect(() => {
        tagOne.push(at(store.tags, 1));
      });
    });
    flushSync();
    setStore(
      reconcile({
        tags: ["a", "x", "c"],
        items: [{ v: 1 }, { v: 3 }],
      }),
    );
    expect(tagZero).toEqual(["a"]);
    expect(tagOne).toEqual(["b", "x"]);
    expect(at(unwrap(store).items, 1)).toBe(item);
    expect(item.v).toBe(3);
  });

  it("[STO-22] merge keeps keys and trailing items that are absent from next", () => {
    const [store, setStore] = useStore<Keys>({ a: 1, b: 2, c: 3 });
    setStore(reconcile<Keys>({ a: 5 }));
    expect(unwrap(store)).toEqual({ a: 5 });

    const [list, setList] = useStore({ list: [1, 2, 3] });
    setList(reconcile({ list: [9] }, { merge: true }));
    expect(unwrap(list).list).toEqual([9, 2, 3]);
    setStore(reconcile<Keys>({ b: 7 }, { merge: true }));
    expect(unwrap(store)).toEqual({ a: 5, b: 7 });
  });

  it("[STO-23] a key option by field name or by function matches items", () => {
    interface Item {
      code: string;
      qty: number;
    }
    const [store, setStore] = useStore({
      items: [
        { code: "A", qty: 1 },
        { code: "B", qty: 1 },
      ] as Item[],
    });
    const rowA = at(unwrap(store).items, 0);
    setStore(
      reconcile(
        {
          items: [
            { code: "B", qty: 2 },
            { code: "A", qty: 1 },
          ],
        },
        { key: "code" },
      ),
    );
    expect(at(unwrap(store).items, 1)).toBe(rowA);

    setStore(reconcile({ items: [{ code: "A", qty: 4 }] }, { key: (item) => (item as Item).code }));
    expect(at(unwrap(store).items, 0)).toBe(rowA);
    expect(rowA.qty).toBe(4);
  });

  it("[STO-24] reconcile skips __proto__, constructor and prototype keys from parsed input", () => {
    const [store, setStore] = useStore<Keys>({ a: 1 });
    const payload = JSON.parse(
      '{"__proto__":{"polluted":1},"a":2,"constructor":{"prototype":{"x":1}},"prototype":{"y":1}}',
    ) as Keys;
    setStore(reconcile(payload));
    expect(store.a).toBe(2);
    expect(Object.keys(unwrap(store))).toEqual(["a"]);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "x")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "y")).toBe(false);
  });

  it("[STO-25] a reconciler is only accepted by setStore and a mismatched root throws", () => {
    const [, setStore] = useStore(model());
    expectStoreError(() => {
      setStore(reconcile([] as unknown as Model));
    });
    const direct = reconcile(model());
    expectStoreError(() => {
      direct(model());
    });
  });

  it("[STO-26] cyclic data terminates in reconcile and snapshot", () => {
    const root: { name: string; self?: unknown } = { name: "loop" };
    root.self = root;
    const [store, setStore] = useStore(root);
    const copy = snapshot(store);
    expect(copy.self).toBe(copy);

    const other: { name: string; self?: unknown } = { name: "other" };
    other.self = other;
    setStore(reconcile(other));
    expect(store.name).toBe("other");
  });
});

describe("store: updates run untracked and inside the engine's rules", () => {
  it("[STO-29] writing the store inside a memo throws WRITE_IN_MEMO and leaves the store usable", () => {
    const [store, setStore] = useStore(model());
    createRoot(() => {
      const broken = useMemo(() => {
        setStore((draft) => {
          draft.count = 1;
        });
        return 0;
      });
      expect(() => broken()).toThrow("WRITE_IN_MEMO");
    });
    expect(unwrap(store).count).toBe(0);
    setStore((draft) => {
      draft.count = 2;
    });
    expect(unwrap(store).count).toBe(2);
  });

  it("[STO-30] the updater runs untracked, so the effect that calls setStore ignores what it reads", () => {
    const [store, setStore] = useStoreDeferred({ count: 0, doubled: 0 });
    let runs = 0;
    createRoot(() => {
      useEffect(() => {
        runs += 1;
        setStore((draft) => {
          draft.doubled = draft.count * 2;
        });
      });
    });
    flushSync();
    expect(store.doubled).toBe(0);
    setStore((draft) => {
      draft.count = 5;
    });
    flushSync();
    // If the updater were tracked, the effect would rerun and write 10 here.
    expect(store.doubled).toBe(0);
    expect(runs).toBe(1);
  });

  it("[STO-31] property: after reconcile, the store snapshot equals the next data (fixed seed)", () => {
    interface Entry {
      id: number;
      name: string;
      tags: string[];
    }
    const entry = fc.record({
      id: fc.integer({ min: 0, max: 5 }),
      name: fc.string({ maxLength: 4 }),
      tags: fc.array(fc.string({ maxLength: 3 }), { maxLength: 3 }),
    });
    const entries = fc.array(entry, { maxLength: 8 });
    fc.assert(
      fc.property(entries, entries, (before, after) => {
        const [store, setStore] = useStore({ items: before as Entry[] });
        setStore(reconcile({ items: after as Entry[] }));
        expect(snapshot(store)).toEqual({ items: after });
      }),
      { seed: 20261009, numRuns: 200 },
    );
  });
});

describe("store: deep data", () => {
  it("[STO-28] 10,000 levels of nesting read, write, reconcile and snapshot without recursion", () => {
    const depth = 10_000;
    const [store, setStore] = useStore(chain(depth, 0));
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(descend(store, depth).leaf);
      });
    });
    flushSync();
    expect(seen).toEqual([0]);

    setStore((draft) => {
      descend(draft, depth).leaf = 1;
    });
    expect(seen).toEqual([0, 1]);

    // Identity is compared with Object.is: toBe() would run a deep comparison on 10,000-level data.
    const midway = descend(unwrap(store), 5_000);
    setStore(reconcile(chain(depth, 2)));
    expect(descend(store, depth).leaf).toBe(2);
    expect(seen).toEqual([0, 1, 2]);
    expect(Object.is(descend(unwrap(store), 5_000), midway)).toBe(true);

    const copy = snapshot(store);
    expect(descend(copy, depth).leaf).toBe(2);
    expect(Object.is(copy, unwrap(store))).toBe(false);
  });
});
