import { createRoot, flushSync, useEffect } from "@shadow-js/core";
import * as storeApi from "@shadow-js/core/store";
import { reconcile, snapshot, unwrap, useStore } from "@shadow-js/core/store";
import { afterEach, describe, expect, it } from "vitest";

const disposers: Array<() => void> = [];

/** Runs `fn` in a root that the afterEach hook disposes. */
function inRoot<T>(fn: () => T): T {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return fn();
  });
}

/** Solid's path-syntax setter signature, which ShadowJS does not have. */
type PathSetter = (...path: unknown[]) => void;

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe("store-utilities/create-store", () => {
  it("[SOLID-UT-77] store-utilities/create-store: nested store updated through setStore(draft)", () => {
    const [state, setState] = useStore({ user: { firstName: "John", lastName: "Smith" } });
    setState((draft) => {
      draft.user.firstName = "Jane";
    });
    expect(state.user.firstName).toBe("Jane");
    expect(state.user.lastName).toBe("Smith");
  });

  // GAP: Solid path syntax setState("user", "firstName", "Jane"). ShadowJS setStore accepts only a function or a
  // reconcile() result and throws TypeError otherwise (packages/core/src/store/use-store.ts:42-46).
  it("[SOLID-UT-78] store-utilities/create-store: setter supports path syntax for nested updates", () => {
    const [state, setState] = useStore({ user: { firstName: "John", lastName: "Smith" } });
    const setPath = setState as unknown as PathSetter;
    setPath("user", "firstName", "Jane");
    expect(state.user.firstName).toBe("Jane");
  });

  it("[SOLID-UT-79] store-utilities/create-store: getters defined on the initial object stay available", () => {
    const [state, setState] = useStore({
      user: {
        firstName: "John",
        lastName: "Smith",
        get fullName() {
          return `${this.firstName} ${this.lastName}`;
        },
      },
    });
    expect(state.user.fullName).toBe("John Smith");
    setState((draft) => {
      draft.user.firstName = "Jane";
    });
    expect(state.user.fullName).toBe("Jane Smith");
  });

  // GAP: an effect reading a store getter does not re-run when the properties the getter reads change. The read
  // handler calls Reflect.get(target, key) without the proxy as receiver (packages/core/src/store/proxies.ts:83-88,
  // nodes.ts readRaw), so `this` inside the getter is the raw object and its reads are not tracked.
  it("[SOLID-UT-80] store-utilities/create-store: an effect reading a getter re-runs when the properties the getter reads change", () => {
    const [state, setState] = useStore({
      user: {
        firstName: "John",
        lastName: "Smith",
        get fullName() {
          return `${this.firstName} ${this.lastName}`;
        },
      },
    });
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(state.user.fullName);
      });
    });
    flushSync();
    setState((draft) => {
      draft.user.firstName = "Jane";
    });
    flushSync();
    expect(seen).toEqual(["John Smith", "Jane Smith"]);
  });

  it("[SOLID-UT-81] store-utilities/create-store: property reads track at the property level", () => {
    const [state, setState] = useStore({ user: { firstName: "John", lastName: "Smith" } });
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(state.user.firstName);
      });
    });
    flushSync();
    setState((draft) => {
      draft.user.lastName = "Doe";
    });
    flushSync();
    expect(seen).toEqual(["John"]);
    setState((draft) => {
      draft.user.firstName = "Jane";
    });
    flushSync();
    expect(seen).toEqual(["John", "Jane"]);
  });

  it("[SOLID-UT-82] store-utilities/create-store: one setStore call notifies dependents once (setter is batched)", () => {
    const [state, setState] = useStore({ a: 0, b: 0 });
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(`${state.a}/${state.b}`);
      });
    });
    flushSync();
    setState((draft) => {
      draft.a = 1;
      draft.b = 2;
    });
    expect(seen).toEqual(["0/0"]);
    flushSync();
    expect(seen).toEqual(["0/0", "1/2"]);
  });

  it("[SOLID-UT-83] store-utilities/create-store: the store is a read-only view; writes outside setStore throw", () => {
    const [state] = useStore({ count: 0 });
    expect(() => {
      Reflect.set(state, "count", 1);
    }).toThrow(TypeError);
    expect(state.count).toBe(0);
    expect(() => {
      (state as { count: number }).count = 1;
    }).toThrow(TypeError);
  });

  // GAP: Solid shallow-merges an object passed to the setter (setState({ lastName: "Doe" })). ShadowJS throws
  // TypeError for a non-function (packages/core/src/store/use-store.ts:42-46).
  it("[SOLID-UT-84] store-utilities/create-store: setter shallow-merges an object value", () => {
    const [state, setState] = useStore({ firstName: "John", lastName: "Smith" });
    const merge = setState as unknown as (
      value: Partial<{ firstName: string; lastName: string }>,
    ) => void;
    merge({ lastName: "Doe" });
    expect(state.firstName).toBe("John");
    expect(state.lastName).toBe("Doe");
  });

  // GAP: Solid accepts an updater returning a partial (setState(prev => ({ count: prev.count + 1 }))) and merges
  // the return value. ShadowJS calls the function with a draft and ignores the return value
  // (packages/core/src/store/use-store.ts:55).
  it("[SOLID-UT-85] store-utilities/create-store: setter accepts an updater that returns a partial", () => {
    const [state, setState] = useStore({ count: 0, label: "x" });
    const update = setState as unknown as (
      fn: (prev: { count: number; label: string }) => Partial<{ count: number; label: string }>,
    ) => void;
    update((prev) => ({ count: prev.count + 1 }));
    expect(state.count).toBe(1);
    expect(state.label).toBe("x");
  });

  // DIFFERENCE from Solid (by design): Solid deletes a property when it is set to undefined through the setter. In ShadowJS a draft assignment of
  // undefined keeps the key (writeRaw in packages/core/src/store/nodes.ts); only `delete draft.x` removes it.
  it("[SOLID-UT-86] store-utilities/create-store: setting a property to undefined deletes it (differs from Solid; ShadowJS: assigning undefined keeps the key; delete removes it)", () => {
    const [state, setState] = useStore<{ a: number; b?: number }>({ a: 1, b: 2 });
    setState((draft) => {
      Reflect.set(draft, "b", undefined);
    });
    expect("b" in state).toBe(true);
    expect(state.b).toBeUndefined();
    setState((draft) => {
      Reflect.deleteProperty(draft, "b");
    });
    expect("b" in state).toBe(false);
  });

  it("[SOLID-UT-87] store-utilities/create-store: delete draft.x removes the key and notifies key observers", () => {
    const [state, setState] = useStore<{ a: number; b?: number }>({ a: 1, b: 2 });
    const keys: string[][] = [];
    inRoot(() => {
      useEffect(() => {
        keys.push(Object.keys(state));
      });
    });
    flushSync();
    setState((draft) => {
      delete draft.b;
    });
    flushSync();
    expect(keys).toEqual([["a", "b"], ["a"]]);
    expect("b" in state).toBe(false);
  });

  it("[SOLID-UT-88] store-utilities/create-store: array mutators on the draft update length and index readers", () => {
    const [state, setState] = useStore({ list: ["book"] });
    const lengths: number[] = [];
    const firsts: Array<string | undefined> = [];
    inRoot(() => {
      useEffect(() => {
        lengths.push(state.list.length);
      });
      useEffect(() => {
        firsts.push(state.list[0]);
      });
    });
    flushSync();
    setState((draft) => {
      draft.list.push("pen");
    });
    flushSync();
    expect(lengths).toEqual([1, 2]);
    expect(firsts).toEqual(["book"]);
    expect([...state.list]).toEqual(["book", "pen"]);
  });

  it("[SOLID-UT-89] store-utilities/create-store: options.name labels the store in error messages", () => {
    const [, setState] = useStore({ a: 1 }, { name: "todos" });
    const bad = setState as unknown as (value: unknown) => void;
    expect(() => {
      bad(5);
    }).toThrow(/ShadowStore \(todos\)/);
  });

  it("[SOLID-UT-90] store-utilities/create-store: a single value or non-plain object becomes a cell (differs from Solid; ShadowJS: one hook)", () => {
    const [read, write] = useStore(5);
    expect(read()).toBe(5);
    write(6);
    expect(read()).toBe(6);
    expect(useStore(null)[0]()).toBeNull();
  });

  it("[SOLID-UT-91] store-utilities/create-store: only plain objects and arrays are wrapped; class instances and Dates are returned as they are", () => {
    class Point {
      x = 1;
    }
    const point = new Point();
    const date = new Date(0);
    const [state] = useStore({ point, date, plain: { x: 1 } });
    expect(state.point).toBe(point);
    expect(state.date).toBe(date);
    expect(state.plain).not.toBe(unwrap(state).plain);
  });

  it("[SOLID-UT-92] store-utilities/create-store: the store wraps the initial object in place", () => {
    const initial = { count: 0 };
    const [, setState] = useStore(initial);
    setState((draft) => {
      draft.count = 3;
    });
    expect(initial.count).toBe(3);
  });
});

describe("store-utilities/create-mutable and modify-mutable", () => {
  // DIFFERENCE from Solid (by design): createMutable is not exported by @shadow-js/core/store (packages/core/src/store/index.ts has five exports).
  it("[SOLID-UT-93] store-utilities/create-mutable: reads and writes go through one proxy and writes notify (differs from Solid; ShadowJS: there is no createMutable; a store is updated through its setter)", () => {
    expect(Reflect.get(storeApi, "createMutable")).toBeUndefined();
    const [state, setState] = useStore({ someValue: 0, list: [] as string[] });
    const seen: number[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(state.someValue + state.list.length);
      });
    });
    flushSync();
    setState((draft) => {
      draft.someValue = 5;
      draft.list.push("item");
    });
    flushSync();
    expect(seen).toEqual([0, 6]);
  });

  // DIFFERENCE from Solid (by design): createMutable is not exported by @shadow-js/core/store.
  it("[SOLID-UT-94] store-utilities/create-mutable: getters and setters defined on the initial object remain available (differs from Solid; ShadowJS: there is no createMutable; getters of a store object read the store)", () => {
    expect(Reflect.get(storeApi, "createMutable")).toBeUndefined();
    const [user, setUser] = useStore({
      firstName: "John",
      lastName: "Smith",
      get fullName() {
        return `${this.firstName} ${this.lastName}`;
      },
    });
    setUser((draft) => {
      draft.firstName = "Jane";
      draft.lastName = "Doe";
    });
    expect(user.fullName).toBe("Jane Doe");
  });

  // DIFFERENCE from Solid (by design): modifyMutable (and createMutable) are not exported by @shadow-js/core/store.
  it("[SOLID-UT-95] store-utilities/modify-mutable: applies a modifier to a mutable store inside a batch (differs from Solid; ShadowJS: there is no modifyMutable; one setter call is one batch)", () => {
    expect(Reflect.get(storeApi, "modifyMutable")).toBeUndefined();
    const [state, setState] = useStore({ user: { firstName: "John", lastName: "Smith" } });
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(`${state.user.firstName} ${state.user.lastName}`);
      });
    });
    flushSync();
    setState((draft) => {
      draft.user.firstName = "Jane";
      draft.user.lastName = "Doe";
    });
    flushSync();
    expect(seen).toEqual(["John Smith", "Jane Doe"]);
  });
});

describe("store-utilities/produce", () => {
  it("[SOLID-UT-96] store-utilities/produce: mutating the draft inside setStore (produce basic usage)", () => {
    const [state, setState] = useStore({ user: { name: "John" }, list: ["book"] });
    setState((draft) => {
      draft.user.name = "Jane";
      draft.list.push("pen");
    });
    expect(state.user.name).toBe("Jane");
    expect([...state.list]).toEqual(["book", "pen"]);
  });

  it("[SOLID-UT-97] store-utilities/produce: several mutations in one update notify dependents once", () => {
    const [state, setState] = useStore({ user: { name: "John" }, list: ["book"] });
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(`${state.user.name}:${state.list.length}`);
      });
    });
    flushSync();
    setState((draft) => {
      draft.user.name = "Jane";
      draft.list.push("pen");
    });
    flushSync();
    expect(seen).toEqual(["John:1", "Jane:2"]);
  });

  it("[SOLID-UT-98] store-utilities/produce: a draft used after setStore returned throws", () => {
    const [, setState] = useStore({ count: 0 });
    let leaked: { count: number } | undefined;
    setState((draft) => {
      leaked = draft;
    });
    expect(() => {
      if (leaked !== undefined) leaked.count = 1;
    }).toThrow(/after its setStore\(\) call returned/);
  });

  it("[SOLID-UT-99] store-utilities/produce: assigning a store proxy into the draft stores the raw data", () => {
    const [state, setState] = useStore({ a: { n: 1 }, b: { n: 0 } });
    setState((draft) => {
      draft.b = state.a;
    });
    expect(unwrap(state).b).toBe(unwrap(state).a);
  });
});

describe("store-utilities/reconcile", () => {
  type Todo = { id: number; title: string };

  it("[SOLID-UT-100] store-utilities/reconcile: reconciles an incoming snapshot into the store root", () => {
    const [state, setState] = useStore<{ todos: Todo[] }>({ todos: [] });
    setState(reconcile({ todos: [{ id: 1, title: "Write docs" }] }));
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0]?.title).toBe("Write docs");
  });

  // GAP: Solid's doc example reconciles a nested path: setState("todos", reconcile([...])). ShadowJS has no path syntax;
  // reconcile applies to the store root only (packages/core/src/store/use-store.ts:47-51).
  it("[SOLID-UT-101] store-utilities/reconcile: setState('todos', reconcile([...])) reconciles a nested array", () => {
    const [state, setState] = useStore<{ todos: Todo[] }>({ todos: [] });
    const setPath = setState as unknown as PathSetter;
    setPath("todos", reconcile([{ id: 1, title: "Write docs" }]));
    expect(state.todos[0]?.title).toBe("Write docs");
  });

  it("[SOLID-UT-102] store-utilities/reconcile: array items are matched by the default key 'id' and keep their identity", () => {
    const first: Todo = { id: 1, title: "one" };
    const second: Todo = { id: 2, title: "two" };
    const [state, setState] = useStore<Todo[]>([first, second]);
    setState(
      reconcile([
        { id: 2, title: "two" },
        { id: 1, title: "one!" },
        { id: 3, title: "three" },
      ]),
    );
    const raw = unwrap(state);
    expect(raw[0]).toBe(second);
    expect(raw[1]).toBe(first);
    expect(first.title).toBe("one!");
    expect(raw[2]).toEqual({ id: 3, title: "three" });
  });

  it("[SOLID-UT-103] store-utilities/reconcile: only leaves that differ notify their readers", () => {
    const [state, setState] = useStore<Todo[]>([
      { id: 1, title: "one" },
      { id: 2, title: "two" },
    ]);
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(`first:${state[0]?.title}`);
      });
      useEffect(() => {
        seen.push(`second:${state[1]?.title}`);
      });
    });
    flushSync();
    setState(
      reconcile([
        { id: 1, title: "one" },
        { id: 2, title: "two!" },
      ]),
    );
    flushSync();
    expect(seen).toEqual(["first:one", "second:two", "second:two!"]);
  });

  it("[SOLID-UT-104] store-utilities/reconcile: options.key selects the identity field", () => {
    type Row = { sku: string; qty: number };
    const original: Row = { sku: "a", qty: 1 };
    const [state, setState] = useStore<Row[]>([original]);
    setState(
      reconcile(
        [
          { sku: "b", qty: 5 },
          { sku: "a", qty: 2 },
        ],
        { key: "sku" },
      ),
    );
    expect(unwrap(state)[1]).toBe(original);
    expect(original.qty).toBe(2);
  });

  it("[SOLID-UT-105] store-utilities/reconcile: options.key may be a function (ShadowJS extension)", () => {
    const original = { name: "a", n: 1 };
    const [state, setState] = useStore([original]);
    setState(
      reconcile(
        [
          { name: "b", n: 0 },
          { name: "a", n: 2 },
        ],
        { key: (item) => (item as { name: string }).name },
      ),
    );
    expect(unwrap(state)[1]).toBe(original);
    expect(original.n).toBe(2);
  });

  // DIFFERENCE from Solid (by design): Solid's `key: null` disables id matching so items are reconciled by position (reconcile options type
  // `key?: string | null`). ShadowJS maps null to the default "id" (`options?.key ?? "id"`,
  // packages/core/src/store/reconcile.ts:48).
  it("[SOLID-UT-106] store-utilities/reconcile: key null reconciles array items by position (differs from Solid; ShadowJS: key null means the default id, so items are matched by id)", () => {
    const john = { id: 1, name: "John" };
    const ned = { id: 2, name: "Ned" };
    const [state, setState] = useStore([john, ned]);
    const positional = reconcile as unknown as (value: unknown, options: { key: null }) => never;
    setState(
      positional(
        [
          { id: 2, name: "Ned" },
          { id: 1, name: "John" },
        ],
        { key: null },
      ),
    );
    expect(state[0]?.id).toBe(2);
    expect(unwrap(state)[0]).toBe(ned);
  });

  // DIFFERENCE from Solid (by design): ShadowJS gives `merge` a different meaning: it keeps keys absent from the new value
  // (packages/core/src/store/reconcile.ts:14, :125). In Solid merge only chooses diff-in-place over replace and
  // keys missing from the new value are still removed.
  it("[SOLID-UT-107] store-utilities/reconcile: merge: true still removes keys that the new value lacks (differs from Solid; ShadowJS: merge keeps the keys the new value lacks)", () => {
    const [state, setState] = useStore<{ a: number; b?: number }>({ a: 0, b: 2 });
    setState(reconcile({ a: 1 }, { merge: true }));
    expect(state.a).toBe(1);
    expect(state.b).toBe(2);
  });

  it("[SOLID-UT-108] store-utilities/reconcile: default (merge false) removes keys that the new value lacks", () => {
    const [state, setState] = useStore<{ a: number; b?: number }>({ a: 0, b: 2 });
    setState(reconcile({ a: 1 }));
    expect(state.a).toBe(1);
    expect("b" in state).toBe(false);
  });

  it("[SOLID-UT-109] store-utilities/reconcile: ShadowJS merge: true keeps keys that the new value lacks", () => {
    const [state, setState] = useStore<{ a: number; b?: number }>({ a: 0, b: 2 });
    setState(reconcile({ a: 1 }, { merge: true }));
    expect(state.a).toBe(1);
    expect(state.b).toBe(2);
  });

  it("[SOLID-UT-110] store-utilities/reconcile: non-wrappable values are replaced directly", () => {
    const [state, setState] = useStore<{ v: number | { n: number }; d: Date }>({
      v: { n: 1 },
      d: new Date(0),
    });
    const later = new Date(5);
    setState(reconcile<{ v: number | { n: number }; d: Date }>({ v: 7, d: later }));
    expect(state.v).toBe(7);
    expect(state.d).toBe(later);
  });

  it("[SOLID-UT-111] store-utilities/reconcile: shrinking arrays shrinks length and notifies", () => {
    const [state, setState] = useStore<Todo[]>([
      { id: 1, title: "a" },
      { id: 2, title: "b" },
      { id: 3, title: "c" },
    ]);
    const lengths: number[] = [];
    inRoot(() => {
      useEffect(() => {
        lengths.push(state.length);
      });
    });
    flushSync();
    setState(reconcile([{ id: 3, title: "c" }]));
    flushSync();
    expect(lengths).toEqual([3, 1]);
    expect(state[0]?.id).toBe(3);
  });

  it("[SOLID-UT-112] store-utilities/reconcile: a reconcile() result is only valid inside setStore and the root shape must match", () => {
    const apply = reconcile({ a: 1 }) as unknown as (draft: unknown) => void;
    expect(() => {
      apply({});
    }).toThrow(/must be passed to setStore/);
    const [, setState] = useStore<{ a: number }>({ a: 0 });
    const mismatched = reconcile([1, 2]) as unknown as never;
    expect(() => {
      setState(mismatched);
    }).toThrow(/same shape/);
  });

  it("[SOLID-UT-113] store-utilities/reconcile: accepts store proxies in the incoming value and unwraps them", () => {
    const [source] = useStore({ todos: [{ id: 1, title: "from source" }] });
    const [state, setState] = useStore<{ todos: Todo[] }>({ todos: [] });
    setState(reconcile(source as { todos: Todo[] }));
    expect(state.todos[0]?.title).toBe("from source");
    expect(unwrap(state).todos[0]).toBe(unwrap(source).todos[0]);
  });
});

describe("store-utilities/unwrap", () => {
  it("[SOLID-UT-114] store-utilities/unwrap: returns the underlying data; mutating it mutates the store data", () => {
    const [state] = useStore({ user: { name: "John" } });
    const user = unwrap(state.user);
    user.name = "Jane";
    expect(state.user.name).toBe("Jane");
  });

  it("[SOLID-UT-115] store-utilities/unwrap: mutating the unwrapped value does not notify readers", () => {
    const [state] = useStore({ user: { name: "John" } });
    const seen: string[] = [];
    inRoot(() => {
      useEffect(() => {
        seen.push(state.user.name);
      });
    });
    flushSync();
    unwrap(state.user).name = "Jane";
    flushSync();
    expect(seen).toEqual(["John"]);
  });

  it("[SOLID-UT-116] store-utilities/unwrap: the root unwraps to the very object passed to useStore", () => {
    const initial = { user: { name: "John" } };
    const [state] = useStore(initial);
    expect(unwrap(state)).toBe(initial);
    expect(unwrap(state).user).toBe(initial.user);
  });

  it("[SOLID-UT-117] store-utilities/unwrap: non-proxy input is returned unchanged", () => {
    const plain = { a: 1 };
    expect(unwrap(plain)).toBe(plain);
  });

  it("[SOLID-UT-118] store-utilities/unwrap: snapshot (ShadowJS) returns an isolated deep copy, unlike unwrap", () => {
    const [state, setState] = useStore({ user: { name: "John" }, tags: ["a"] });
    const copy = snapshot(state);
    setState((draft) => {
      draft.user.name = "Jane";
      draft.tags.push("b");
    });
    expect(copy).toEqual({ user: { name: "John" }, tags: ["a"] });
    expect(copy).not.toBe(unwrap(state));
  });
});
