import { describe, expect, expectTypeOf, it } from "vitest";
import type { SetStore, Store } from "../src/index";
import {
  type Accessor,
  batch,
  createRoot,
  flushSync,
  mapArray,
  produce,
  reconcile,
  type Setter,
  useEffect,
  useMemo,
  useSignal,
  useStore,
} from "../src/index";
import { unwrap } from "../src/store/index";

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

function track<T>(read: () => T): { runs: T[] } {
  const runs: T[] = [];
  createRoot(() => {
    useEffect(() => {
      runs.push(read());
    });
  });
  flushSync();
  return { runs };
}

describe("useStore: one hook for values and data", () => {
  it("[UST-01] a single value behaves like a signal", () => {
    const [count, setCount] = useStore(0);
    const seen = track(count);
    setCount(1);
    setCount((n) => n + 1);
    flushSync();
    expect(count()).toBe(2);
    expect(seen.runs).toEqual([0, 2]);
  });

  it("[UST-02] strings, booleans, null, undefined, functions, Date and Map are single values", () => {
    expect(useStore("a")[0]()).toBe("a");
    expect(useStore(false)[0]()).toBe(false);
    expect(useStore(null)[0]()).toBeNull();
    expect(useStore<number | undefined>(undefined)[0]()).toBeUndefined();
    const fn = () => 1;
    expect(useStore(fn)[0]()).toBe(fn);
    const date = new Date(0);
    expect(useStore(date)[0]()).toBe(date);
  });

  it("[UST-03] plain data becomes a deep store with property-level tracking", () => {
    const [state, setState] = useStore({ user: { name: "a", age: 1 }, tags: ["x"] });
    const name = track(() => state.user.name);
    const age = track(() => state.user.age);
    setState((draft) => {
      draft.user.age = 2;
    });
    flushSync();
    expect(name.runs).toEqual(["a"]);
    expect(age.runs).toEqual([1, 2]);
  });

  it("[UST-04] types: single values give accessors, data gives stores", () => {
    const cell = useStore(0);
    expectTypeOf(cell).toEqualTypeOf<[Accessor<number>, Setter<number>]>();
    const store = useStore({ a: 1 });
    expectTypeOf(store[0]).toEqualTypeOf<Store<{ a: number }>>();
    expectTypeOf(store[1]).toEqualTypeOf<SetStore<{ a: number }>>();
    const list = useStore<Todo[]>([]);
    expectTypeOf(list[0]).toEqualTypeOf<Store<Todo[]>>();
    // A union of plain data and null is a single value: replaced as a whole, read through proxies.
    const mixed = useStore<Todo[] | null>(null);
    expectTypeOf(mixed[0]).toEqualTypeOf<Accessor<Store<Todo[]> | null>>();
    expectTypeOf(mixed[1]).toEqualTypeOf<Setter<Todo[] | null>>();
    // Data as the initial value would make a store at run time, so the type refuses it.
    // @ts-expect-error a union of data and null starts as null (or undefined, or a primitive)
    useStore<Todo[] | null>([]);
    // @ts-expect-error the same for an inferred union
    useStore(Math.random() > 0.5 ? { a: 1 } : null);
    const nullable = useStore<Todo | undefined>(undefined);
    expectTypeOf(nullable[0]).toEqualTypeOf<Accessor<Store<Todo> | undefined>>();
  });

  it("[UST-05] a nullable plain-data value is one cell, and what is assigned to it is fine-grained", () => {
    const [todos, setTodos] = createRoot(() => useStore<Todo[] | null>(null));
    expect(todos()).toBeNull();
    const first = track(() => todos()?.[0]?.title ?? "none");
    const count = track(() => todos()?.length ?? 0);
    setTodos([
      { id: 1, title: "a", done: false },
      { id: 2, title: "b", done: false },
    ]);
    flushSync();
    expect(first.runs).toEqual(["none", "a"]);
    expect(count.runs).toEqual([0, 2]);
    setTodos((previous) =>
      previous === null ? [] : [...previous, { id: 3, title: "c", done: true }],
    );
    flushSync();
    expect(count.runs).toEqual([0, 2, 3]);
    setTodos(null);
    flushSync();
    expect(todos()).toBeNull();
    expect(first.runs).toEqual(["none", "a", "a", "none"]);
  });

  it("[UST-06] a single value that is a union of primitives and objects works either way round", () => {
    const [value, setValue] = createRoot(() => useStore<{ n: number } | string>("x"));
    expect(value()).toBe("x");
    setValue({ n: 1 });
    expect((value() as { n: number }).n).toBe(1);
    setValue("y");
    expect(value()).toBe("y");
  });
});

describe("useStore: setter forms", () => {
  const make = () =>
    useStore({
      todos: [
        { id: 1, title: "a", done: false },
        { id: 2, title: "b", done: false },
        { id: 3, title: "c", done: false },
      ] as Todo[],
      filter: "all",
      meta: { count: 3, tags: ["x"] },
    });

  it("[UST-10] an object argument merges keys", () => {
    const [state, set] = make();
    set({ filter: "done" });
    expect(state.filter).toBe("done");
    expect(state.todos.length).toBe(3);
  });

  it("[UST-11] a function that returns a value merges/replaces; returning nothing means mutation", () => {
    const [state, set] = make();
    set((draft) => ({ filter: `${draft.filter}!` }));
    expect(state.filter).toBe("all!");
    set((draft) => {
      draft.filter = "x";
    });
    expect(state.filter).toBe("x");
  });

  it("[UST-12] path form: key, index, nested key", () => {
    const [state, set] = make();
    set("filter", "active");
    set("todos", 1, "done", true);
    set("meta", "count", (n) => n + 1);
    expect(state.filter).toBe("active");
    expect(state.todos[1]?.done).toBe(true);
    expect(state.meta.count).toBe(4);
  });

  it("[UST-13] path form: array filter, several indices and ranges", () => {
    const [state, set] = make();
    set("todos", (t) => t.id !== 2, "done", true);
    expect(state.todos.map((t) => t.done)).toEqual([true, false, true]);
    set("todos", [0, 1], "title", "z");
    expect(state.todos.map((t) => t.title)).toEqual(["z", "z", "c"]);
    set("todos", { from: 1, to: 2 }, "done", false);
    expect(state.todos.map((t) => t.done)).toEqual([true, false, false]);
    set("todos", { from: 0, to: 2, by: 2 }, "title", "e");
    expect(state.todos.map((t) => t.title)).toEqual(["e", "z", "e"]);
  });

  it("[UST-14] a partial object at the end of a path merges into the existing object", () => {
    const [state, set] = make();
    set("todos", 0, { title: "renamed" });
    expect(state.todos[0]).toEqual({ id: 1, title: "renamed", done: false });
  });

  it("[UST-15] an array store is replaced by an array and keeps identity of matching items", () => {
    const [list, set] = useStore([{ id: 1, v: 1 }]);
    const first = list[0];
    set([
      { id: 1, v: 2 },
      { id: 2, v: 1 },
    ]);
    expect(list.length).toBe(2);
    expect(list[0]?.v).toBe(2);
    expect(list[0]).toBe(first);
  });

  it("[UST-16] path steps cannot reach prototypes", () => {
    const [, set] = make();
    const untyped = set as unknown as (...path: unknown[]) => void;
    expect(() => untyped("__proto__", "polluted", true)).toThrow(TypeError);
    expect(() => untyped("meta", "constructor", 1)).toThrow(TypeError);
    expect(Reflect.get({}, "polluted")).toBeUndefined();
  });

  it("[UST-17] a path through a non-object, or a wrong container, is a TypeError", () => {
    const [, set] = make();
    expect(() => set("filter" as never, "x" as never, 1 as never)).toThrow(TypeError);
    const [list, setList] = useStore([1, 2]);
    expect(() => setList({ a: 1 } as never)).toThrow(TypeError);
    void list;
  });

  it("[UST-18] writes are batched: many changes, one effect run", () => {
    const [state, set] = make();
    const seen = track(() => `${state.todos.map((t) => t.done).join()}|${state.filter}`);
    set((draft) => {
      const [first, second] = draft.todos;
      if (first !== undefined) first.done = true;
      if (second !== undefined) second.done = true;
      draft.filter = "done";
    });
    flushSync();
    expect(seen.runs.length).toBe(2);
  });

  it("[UST-19] writing inside a memo is still an error", () => {
    const [, set] = make();
    const bad = useMemo(
      () => {
        set("filter", "x");
        return 1;
      },
      { lazy: true },
    );
    expect(() => bad()).toThrow(/WRITE_IN_MEMO/);
  });
});

describe("useStore: fine-grained lists", () => {
  it("[UST-20] mapArray over a store array reacts to push, splice and item replacement", () => {
    const [list, set] = useStore<{ id: number }[]>([{ id: 1 }]);
    let rows: Accessor<string[]> = () => [];
    createRoot(() => {
      rows = mapArray(
        () => list,
        (item) => `r${item.id}`,
      );
    });
    const seen = track(() => rows().join());
    set((draft) => {
      draft.push({ id: 2 });
    });
    flushSync();
    set((draft) => {
      draft.splice(0, 1);
    });
    flushSync();
    expect(seen.runs).toEqual(["r1", "r1,r2", "r2"]);
  });

  it("[UST-21] a store inside a signal-free module scope works without an owner", () => {
    const [state, set] = useStore({ n: 1 });
    set("n", 5);
    expect(state.n).toBe(5);
    const [, setCell] = useSignal(0);
    expect(typeof setCell).toBe("function");
  });
});

describe("useStore: getters and reconcile at a path", () => {
  it("[UST-30] getters on store objects are tracked through the store view", () => {
    const [state, set] = useStore({
      firstName: "Ada",
      lastName: "L",
      get fullName(): string {
        return `${this.firstName} ${this.lastName}`;
      },
    });
    const seen = track(() => state.fullName);
    set("firstName", "Grace");
    flushSync();
    expect(seen.runs).toEqual(["Ada L", "Grace L"]);
  });

  it("[UST-31] reconcile at a path diffs only that sub-tree", () => {
    const [state, set] = useStore({
      animals: [{ id: 1, name: "cat" }],
      other: { v: 1 },
    });
    const other = track(() => state.other.v);
    const first = state.animals[0];
    set(
      "animals",
      reconcile([
        { id: 1, name: "dog" },
        { id: 2, name: "bird" },
      ]),
    );
    flushSync();
    expect(state.animals.map((a) => a.name)).toEqual(["dog", "bird"]);
    expect(state.animals[0]).toBe(first);
    expect(other.runs).toEqual([1]);
  });

  it("[UST-32] produce is the draft updater itself", () => {
    const [state, set] = useStore({ n: 1 });
    set(
      produce((d: { n: number }) => {
        d.n += 1;
      }),
    );
    expect(state.n).toBe(2);
  });
});

describe("write timing", () => {
  it("[STO-D1] a store write defers its effects to the microtask, like a signal write", async () => {
    const [state, setState] = createRoot(() => useStore({ n: 0 }));
    const seen: number[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(state.n);
      });
    });
    flushSync();
    setState((draft) => {
      draft.n = 1;
    });
    expect(state.n).toBe(1);
    expect(seen).toEqual([0]);
    await Promise.resolve();
    expect(seen).toEqual([0, 1]);
  });

  it("[STO-D2] inside batch() the effects run once, when the batch ends", () => {
    const [state, setState] = createRoot(() => useStore({ a: 0, b: 0 }));
    const seen: string[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(`${state.a}/${state.b}`);
      });
    });
    flushSync();
    batch(() => {
      setState("a", 1);
      setState("b", 2);
      expect(seen).toEqual(["0/0"]);
    });
    expect(seen).toEqual(["0/0", "1/2"]);
  });
});

describe("drafts inside assigned data", () => {
  const make = () =>
    useStore({
      items: [
        { id: 1, done: false },
        { id: 2, done: false },
        { id: 3, done: false },
      ],
      meta: { tags: [{ t: "a" }] },
    });

  it("[UST-DR1] data built from draft items (filter, map, spread, slice) is stored as plain data", () => {
    const [state, set] = createRoot(() => make());
    set((draft) => {
      draft.items = draft.items.filter((item) => item.id !== 1);
    });
    set((draft) => {
      draft.items = draft.items.map((item) => item);
    });
    set((draft) => {
      draft.items = [...draft.items].reverse();
    });
    // The stored items are real data again: a later update can write to them.
    set((draft) => {
      const first = draft.items[0];
      if (first !== undefined) first.done = true;
    });
    expect(state.items.map((item) => `${item.id}${item.done ? "!" : ""}`)).toEqual(["3!", "2"]);
  });

  it("[UST-DR2] drafts nested deeper inside assigned objects are replaced too, and shared parts stay shared", () => {
    const [state, set] = createRoot(() => make());
    set((draft) => {
      const tag = draft.meta.tags[0];
      draft.meta = { tags: [tag as { t: string }, tag as { t: string }] };
    });
    set((draft) => {
      const first = draft.meta.tags[0];
      if (first !== undefined) first.t = "z";
    });
    expect(state.meta.tags.map((tag) => tag.t)).toEqual(["z", "z"]);
  });

  it("[UST-DR3] a very deep structure of drafts is unwrapped without recursion", () => {
    const [state, set] = createRoot(() => useStore({ node: { next: null as unknown } }));
    set((draft) => {
      let cursor: { next: unknown } = { next: null };
      const head = cursor;
      for (let i = 0; i < 50_000; i += 1) {
        const link = { next: null as unknown };
        cursor.next = link;
        cursor = link;
      }
      cursor.next = draft.node;
      draft.node = head as typeof draft.node;
    });
    expect(state.node.next).not.toBeNull();
  });

  it("[UST-DR4] plain data with no proxies inside is stored by reference, not copied", () => {
    const [state, set] = createRoot(() => make());
    const incoming = [{ id: 9, done: false }];
    set((draft) => {
      draft.items = incoming;
    });
    expect(unwrap(state.items)).toBe(incoming);
  });
});
