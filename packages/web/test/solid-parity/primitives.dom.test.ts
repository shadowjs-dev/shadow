import {
  createRoot,
  flushSync,
  onMount,
  type ResourceInfo,
  useEffect,
  useResource,
  useSignal,
} from "@shadow-js/core";
import * as storeApi from "@shadow-js/core/store";
import { reconcile, snapshot, unwrap, useStore } from "@shadow-js/core/store";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "../support/compile";

// Solid-docs parity, area RX (part 2): resources, stores, context, refs, understanding JSX.

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  document.body.replaceChildren();
});

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
  await Promise.resolve();
  flushSync();
};

interface User {
  id: number;
  username: string;
  location: string;
  loggedIn: boolean;
}

const initialState = () => ({
  userCount: 3,
  users: [
    { id: 0, username: "felix909", location: "England", loggedIn: false },
    { id: 1, username: "tracy634", location: "Canada", loggedIn: true },
    { id: 2, username: "johny123", location: "India", loggedIn: true },
  ] as User[],
});

const michael: User = { id: 3, username: "michael584", location: "Nigeria", loggedIn: false };

// A path-syntax setter as documented by Solid; ShadowJS' setStore only accepts a draft function.
type PathSetStore = (...args: unknown[]) => void;
const asPathSetter = (setStore: unknown): PathSetStore => setStore as PathSetStore;

describe("reference/basic-reactivity/create-resource", () => {
  it("[SOLID-RX-74] create-resource: basic usage, undefined while pending then the fetched value", async () => {
    const d = deferred<{ title: string }>();
    const data = inRoot(() => useResource(() => d.promise));
    expect(data()).toBeUndefined();
    expect(data.loading).toBe(true);
    expect(data.state).toBe("pending");
    d.resolve({ title: "hello" });
    await settle();
    expect(data()).toEqual({ title: "hello" });
    expect(data.loading).toBe(false);
    expect(data.state).toBe("ready");
  });

  it("[SOLID-RX-75] create-resource: with a source the fetcher gets the source value and refetches when it changes", async () => {
    const [userId, setUserId] = useSignal(1);
    const calls: number[] = [];
    const user = inRoot(() =>
      useResource(userId, async (id: number) => {
        calls.push(id);
        return { id };
      }),
    );
    await settle();
    expect(user()).toEqual({ id: 1 });
    setUserId(2);
    await settle();
    expect(calls).toEqual([1, 2]);
    expect(user()).toEqual({ id: 2 });
  });

  it("[SOLID-RX-76] create-resource: a false, null or undefined source does not call the fetcher (state stays unresolved)", async () => {
    const [source, setSource] = useSignal<number | false | null | undefined>(false);
    const fetcher = vi.fn(async (id: number) => id);
    const res = inRoot(() => useResource(source, fetcher));
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(res.state).toBe("unresolved");
    setSource(null);
    await settle();
    setSource(undefined);
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    setSource(7);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(res()).toBe(7);
  });

  it("[SOLID-RX-77] create-resource: refetch re-runs the fetcher without changing the source, previous value kept (refreshing)", async () => {
    let n = 0;
    const pending: Array<ReturnType<typeof deferred<string>>> = [];
    const posts = inRoot(() =>
      useResource(() => {
        n += 1;
        const d = deferred<string>();
        pending.push(d);
        return d.promise;
      }),
    );
    pending[0]?.resolve("first");
    await settle();
    expect(posts()).toBe("first");
    posts.refetch();
    expect(posts.state).toBe("refreshing");
    expect(posts.loading).toBe(true);
    expect(posts.latest).toBe("first");
    pending[1]?.resolve("second");
    await settle();
    expect(n).toBe(2);
    expect(posts()).toBe("second");
    expect(posts.state).toBe("ready");
  });

  it("[SOLID-RX-78] create-resource: mutate overwrites the value without calling the fetcher (optimistic update)", async () => {
    const fetcher = vi.fn(async () => ["a", "b"]);
    const posts = inRoot(() => useResource(fetcher));
    await settle();
    posts.mutate((current) => [...(current ?? []), "c"]);
    expect(posts()).toEqual(["a", "b", "c"]);
    expect(posts.state).toBe("ready");
    posts.mutate(["z"]);
    expect(posts()).toEqual(["z"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("[SOLID-RX-79] create-resource: mutate(value) returns the value that was set", async () => {
    const posts = inRoot(() => useResource(async () => ["a"]));
    await settle();
    const returned = (posts.mutate as (value: string[]) => unknown)(["b"]);
    expect(returned).toEqual(["b"]);
  });

  // DIFFERENCE from Solid (by design): refetch() takes no argument; Solid passes refetch(info) to the fetcher as info.refetching (packages/core/src/resource.ts:39,208)
  it("[SOLID-RX-80] create-resource: refetch(info) is passed to the fetcher as info.refetching (differs from Solid; ShadowJS: refetch takes no argument; the fetcher sees refetching as a flag)", async () => {
    const seen: unknown[] = [];
    const res = inRoot(() =>
      useResource(async (info) => {
        seen.push(info.refetching);
        return 1;
      }),
    );
    await settle();
    (res.refetch as (info: string) => void)("manual");
    await settle();
    expect(seen).toEqual([false, true]);
  });

  it("[SOLID-RX-81] create-resource: await refetch() resolves with the new value", async () => {
    let n = 0;
    const res = inRoot(() =>
      useResource(async () => {
        n += 1;
        return n;
      }),
    );
    await settle();
    const returned = await (res.refetch as () => Promise<number>)();
    expect(returned).toBe(2);
  });

  it("[SOLID-RX-82] create-resource: error handling, a rejected fetcher gives state errored, error set, and the read throws", async () => {
    const failure = new Error("Failed to fetch");
    const data = inRoot(() =>
      useResource(async () => {
        throw failure;
      }),
    );
    await settle();
    expect(data.state).toBe("errored");
    expect(data.loading).toBe(false);
    expect(data.error).toBe(failure);
    expect(data.latest).toBeUndefined();
    expect(() => data()).toThrow(failure);
  });

  it("[SOLID-RX-83] create-resource: a resource read inside ErrorBoundary shows the fallback node on failure", async () => {
    const mod = await load<{ App: (props: { promise: Promise<{ title: string }> }) => unknown }>(`
      import { useResource } from "@shadow-js/core";
      import { ErrorBoundary } from "@shadow-js/web";
      function Title(props) {
        const data = useResource(() => props.promise);
        return <div>{data()?.title}</div>;
      }
      export function App(props) {
        return (
          <ErrorBoundary fallback={<div class="fallback">Error loading data</div>}>
            <Title promise={props.promise} />
          </ErrorBoundary>
        );
      }
    `);
    const failing = Promise.reject(new Error("nope"));
    failing.catch(() => undefined);
    const host = mount(() => mod.App({ promise: failing }));
    await settle();
    await settle();
    expect(host.querySelector(".fallback")?.textContent).toBe("Error loading data");
  });

  it("[SOLID-RX-84] create-resource: initialValue makes the resource readable (never undefined) before the fetch settles", async () => {
    const d = deferred<{ name: string; id: number }>();
    const user = inRoot(() =>
      useResource(() => d.promise, { initialValue: { name: "Loading...", id: 0 } }),
    );
    expect(user()?.name).toBe("Loading...");
    d.resolve({ name: "Ada", id: 1 });
    await settle();
    expect(user()?.name).toBe("Ada");
    expect(user.state).toBe("ready");
  });

  it("[SOLID-RX-85] create-resource: state table (unresolved, pending, ready, refreshing, errored) with loading/error/latest", async () => {
    const [source, setSource] = useSignal<number | false>(false);
    const pending: Array<ReturnType<typeof deferred<string>>> = [];
    const res = inRoot(() =>
      useResource(source, () => {
        const d = deferred<string>();
        pending.push(d);
        return d.promise;
      }),
    );
    const view = () => [res.state, res.loading, res.error, res.latest];
    expect(view()).toEqual(["unresolved", false, undefined, undefined]);
    setSource(1);
    flushSync();
    expect(view()).toEqual(["pending", true, undefined, undefined]);
    pending[0]?.resolve("v1");
    await settle();
    expect(view()).toEqual(["ready", false, undefined, "v1"]);
    setSource(2);
    flushSync();
    expect(view()).toEqual(["refreshing", true, undefined, "v1"]);
    const boom = new Error("boom");
    pending[1]?.reject(boom);
    await settle();
    expect(res.state).toBe("errored");
    expect(res.loading).toBe(false);
    expect(res.error).toBe(boom);
  });

  it("[SOLID-RX-86] create-resource: inside Suspense the fallback shows until the first fetch settles", async () => {
    const mod = await load<{
      App: (props: { promise: Promise<string> }) => unknown;
    }>(`
      import { useResource } from "@shadow-js/core";
      import { Suspense } from "@shadow-js/web";
      function Profile(props) {
        const data = useResource(() => props.promise);
        return <p class="data">{data()}</p>;
      }
      export function App(props) {
        return (
          <Suspense fallback={<span class="fallback">Loading...</span>}>
            <Profile promise={props.promise} />
          </Suspense>
        );
      }
    `);
    const d = deferred<string>();
    const host = mount(() => mod.App({ promise: d.promise }));
    expect(host.querySelector(".fallback")?.textContent).toBe("Loading...");
    expect(host.querySelector(".data")).toBeNull();
    d.resolve("loaded");
    await settle();
    await settle();
    expect(host.querySelector(".fallback")).toBeNull();
    expect(q(host, ".data").textContent).toBe("loaded");
  });

  it("[SOLID-RX-87] create-resource: the resource is a single object, there is no [resource, actions] tuple (ADR-008)", async () => {
    const res = inRoot(() => useResource(async () => 1));
    await settle();
    expect(typeof res.refetch).toBe("function");
    expect(typeof res.mutate).toBe("function");
    expect(Symbol.iterator in res).toBe(false);
  });

  it("[SOLID-RX-88] create-resource: options name, key and deferStream are accepted", async () => {
    const res = inRoot(() =>
      useResource(async () => "v", { name: "named", key: "k", deferStream: true }),
    );
    await settle();
    expect(res()).toBe("v");
  });

  it("[SOLID-RX-89] create-resource: the fetcher info exposes the last value, refetching flag and an abort signal", async () => {
    const infos: Array<{ value: number | undefined; refetching: boolean; aborted: boolean }> = [];
    const signals: AbortSignal[] = [];
    let n = 0;
    const res = inRoot(() =>
      useResource(async (info: ResourceInfo<number>) => {
        signals.push(info.signal);
        infos.push({ value: info.value, refetching: info.refetching, aborted: false });
        n += 1;
        return n;
      }),
    );
    await settle();
    res.refetch();
    await settle();
    expect(infos.map(({ value, refetching }) => ({ value, refetching }))).toEqual([
      { value: undefined, refetching: false },
      { value: 1, refetching: true },
    ]);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("reference/basic-reactivity/create-resource (source forms)", () => {
  it("[SOLID-RX-149] create-resource: the source may be a plain non-function value", async () => {
    const useResourcePlain = useResource as unknown as (
      source: number,
      fetcher: (id: number) => Promise<number>,
    ) => { (): number | undefined; state: string };
    const calls: number[] = [];
    const res = inRoot(() =>
      useResourcePlain(5, async (id) => {
        calls.push(id);
        return id * 2;
      }),
    );
    await settle();
    expect(calls).toEqual([5]);
    expect(res()).toBe(10);
  });
});

describe("concepts/stores", () => {
  it("[SOLID-RX-90] concepts/stores: createStore deep reads (store.users[0].username, store.userCount)", () => {
    const [store] = useStore(initialState());
    expect(store.userCount).toBe(3);
    expect(store.users[0]?.username).toBe("felix909");
    expect(store.users.length).toBe(3);
  });

  it("[SOLID-RX-91] concepts/stores: a top-level array store reads by index and length", () => {
    const [users] = useStore(initialState().users);
    expect(users.length).toBe(3);
    expect(users[1]?.location).toBe("Canada");
  });

  it("[SOLID-RX-92] concepts/stores: reads are tracked per property (fine-grained), unrelated writes do not re-run the effect", () => {
    const [store, setStore] = useStore(initialState());
    const seen: string[] = [];
    inRoot(() =>
      useEffect(() => {
        seen.push(store.users[0]?.username ?? "");
      }),
    );
    flushSync();
    setStore((draft) => {
      const second = draft.users[1];
      if (second !== undefined) second.username = "tracy_updated";
      draft.userCount = 99;
    });
    flushSync();
    expect(seen).toEqual(["felix909"]);
    setStore((draft) => {
      const first = draft.users[0];
      if (first !== undefined) first.username = "felix_updated";
    });
    flushSync();
    expect(seen).toEqual(["felix909", "felix_updated"]);
  });

  it("[SOLID-RX-93] concepts/stores: a read outside a tracking scope does not subscribe; the same read in an effect does", () => {
    const [store, setStore] = useStore(initialState());
    const outside: Array<number | undefined> = [store.users.at(-1)?.id];
    const inside: Array<number | undefined> = [];
    inRoot(() =>
      useEffect(() => {
        inside.push(store.users.at(-1)?.id);
      }),
    );
    flushSync();
    setStore((draft) => {
      draft.users.push({ ...michael });
    });
    flushSync();
    expect(outside).toEqual([2]);
    expect(inside).toEqual([2, 3]);
  });

  it("[SOLID-RX-94] concepts/stores: appending with a draft (users.push) re-runs readers of length and the new index only", () => {
    const [store, setStore] = useStore(initialState());
    let lengthRuns = 0;
    let firstRuns = 0;
    inRoot(() => {
      useEffect(() => {
        store.users.length;
        lengthRuns += 1;
      });
      useEffect(() => {
        store.users[0]?.username;
        firstRuns += 1;
      });
    });
    flushSync();
    setStore((draft) => {
      draft.users.push({ ...michael });
    });
    flushSync();
    expect(lengthRuns).toBe(2);
    expect(firstRuns).toBe(1);
    expect(store.users[3]?.username).toBe("michael584");
  });

  it("[SOLID-RX-95] concepts/stores: setStore accepts a draft function, an object to merge, or a path (setStore('userCount', 4))", () => {
    const [store, setStore] = useStore(initialState());
    asPathSetter(setStore)("userCount", 4);
    expect(store.userCount).toBe(4);
    expect(() => asPathSetter(setStore)(5 as never)).toThrow(TypeError);
  });

  // GAP: setStore has no path syntax; setStore("users", cb) throws TypeError (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-96] concepts/stores: setStore(key, updater) replaces a value (append user with spread)", () => {
    const [store, setStore] = useStore(initialState());
    asPathSetter(setStore)("users", (currentUsers: User[]) => [...currentUsers, { ...michael }]);
    expect(store.users).toHaveLength(4);
  });

  // GAP: setStore has no path syntax; setUsers(users.length, value) throws TypeError (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-97] concepts/stores: setUsers(users.length, value) appends to a top-level array store", () => {
    const [users, setUsers] = useStore(initialState().users);
    asPathSetter(setUsers)(users.length, { ...michael });
    expect(users).toHaveLength(4);
  });

  // GAP: setStore has no path syntax; setUsers(0, "username", v) throws TypeError (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-98] concepts/stores: setUsers(0, 'username', v) updates a nested property by path", () => {
    const [users, setUsers] = useStore(initialState().users);
    asPathSetter(setUsers)(0, "username", "felix_updated");
    expect(users[0]?.username).toBe("felix_updated");
  });

  // GAP: setStore has no path syntax or shallow-merge of object values (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-99] concepts/stores: setUsers(1, { location, loggedIn }) shallow-merges into the existing object", () => {
    const [users, setUsers] = useStore(initialState().users);
    asPathSetter(setUsers)(1, { location: "USA", loggedIn: false });
    expect(users[1]).toEqual({ id: 1, username: "tracy634", location: "USA", loggedIn: false });
  });

  // GAP: setStore has no path syntax, so there are no filter-function path segments (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-100] concepts/stores: setUsers(user => user.location === 'Canada', 'loggedIn', false) filters targets", () => {
    const [users, setUsers] = useStore(initialState().users);
    asPathSetter(setUsers)((user: User) => user.location === "Canada", "loggedIn", false);
    expect(users.map((u) => u.loggedIn)).toEqual([false, false, true]);
  });

  // GAP: setStore has no path syntax, so there is no array-of-keys segment (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-101] concepts/stores: setStore('users', [0, 2], 'loggedIn', false) updates several indices at once", () => {
    const [store, setStore] = useStore(initialState());
    asPathSetter(setStore)("users", [0, 2], "loggedIn", true);
    expect(store.users.map((u) => u.loggedIn)).toEqual([true, true, true]);
  });

  // GAP: setStore has no path syntax, so there is no { from, to } range segment (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-102] concepts/stores: setStore('users', { from: 1, to: 2 }, 'loggedIn', false) updates a range", () => {
    const [store, setStore] = useStore(initialState());
    asPathSetter(setStore)("users", { from: 1, to: store.users.length - 1 }, "loggedIn", false);
    expect(store.users.map((u) => u.loggedIn)).toEqual([false, false, false]);
  });

  // GAP: setStore has no path syntax, so there is no { from, to, by } step range segment (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-103] concepts/stores: a range with `by: 2` updates every second element", () => {
    const [store, setStore] = useStore(initialState());
    asPathSetter(setStore)(
      "users",
      { from: 0, to: store.users.length - 1, by: 2 },
      "loggedIn",
      true,
    );
    expect(store.users.map((u) => u.loggedIn)).toEqual([true, true, true]);
  });

  // GAP: setStore has no path syntax, so a leaf updater (setStore('users', 3, 'loggedIn', fn)) is unsupported (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-104] concepts/stores: setStore('users', 0, 'loggedIn', (v) => !v) computes the leaf from the old value", () => {
    const [store, setStore] = useStore(initialState());
    asPathSetter(setStore)("users", 0, "loggedIn", (loggedIn: boolean) => !loggedIn);
    expect(store.users[0]?.loggedIn).toBe(true);
  });

  // GAP: setStore has no path syntax or object shallow-merge; setStore('users', 0, { id: 109 }) throws (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-105] concepts/stores: setStore('users', 0, { id: 109 }) shallow merges the object", () => {
    const [store, setStore] = useStore(initialState());
    asPathSetter(setStore)("users", 0, { id: 109 });
    expect(store.users[0]).toEqual({
      id: 109,
      username: "felix909",
      location: "England",
      loggedIn: false,
    });
  });

  it("[SOLID-RX-106] concepts/stores: draft writes (Object.assign on the draft) shallow merge like path-syntax objects", () => {
    const [store, setStore] = useStore(initialState());
    setStore((draft) => {
      const first = draft.users[0];
      if (first !== undefined) Object.assign(first, { id: 109 });
    });
    expect(store.users[0]).toEqual({
      id: 109,
      username: "felix909",
      location: "England",
      loggedIn: false,
    });
  });

  it("[SOLID-RX-107] concepts/stores: one setStore call is one batch, downstream effects run once", () => {
    const [store, setStore] = useStore(initialState());
    const seen: string[] = [];
    inRoot(() =>
      useEffect(() => {
        const user = store.users[0];
        seen.push(`${user?.username}@${user?.location}`);
      }),
    );
    flushSync();
    setStore((draft) => {
      const user = draft.users[0];
      if (user === undefined) return;
      user.username = "newUsername";
      user.location = "newLocation";
    });
    flushSync();
    expect(seen).toEqual(["felix909@England", "newUsername@newLocation"]);
  });

  it("[SOLID-RX-108] concepts/stores: a nested store over store.users shares data with the parent store", () => {
    const [store] = useStore(initialState());
    const [users, setUsers] = useStore(store.users);
    setUsers((draft) => {
      draft.push({ ...michael });
    });
    expect(users).toHaveLength(4);
    expect(store.users).toHaveLength(4);
    expect(store.users[3]?.username).toBe("michael584");
  });

  // GAP: produce is not exported from @shadow-js/core/store (the draft function is passed to setStore directly)
  it("[SOLID-RX-109] concepts/stores: produce(fn) from the store entry mutates a draft", () => {
    const { produce } = storeApi as unknown as {
      produce: (fn: (draft: ReturnType<typeof initialState>) => void) => (draft: unknown) => void;
    };
    const [store, setStore] = useStore(initialState());
    asPathSetter(setStore)(
      produce((draft) => {
        draft.userCount = 4;
      }),
    );
    expect(store.userCount).toBe(4);
  });

  it("[SOLID-RX-110] concepts/stores: Map and Set values are opaque (returned as is, not proxied)", () => {
    const set = new Set([1]);
    const map = new Map([["a", 1]]);
    const [store] = useStore({ set, map });
    expect(store.set).toBe(set);
    expect(store.map).toBe(map);
  });

  it("[SOLID-RX-111] concepts/stores: reconcile(newData) only notifies readers of the changed entries", () => {
    const [data, setData] = useStore({ animals: ["cat", "dog", "bird", "gorilla"] });
    const runs = [0, 0, 0, 0, 0];
    inRoot(() => {
      for (let i = 0; i < 5; i += 1) {
        useEffect(() => {
          data.animals[i];
          runs[i] = (runs[i] ?? 0) + 1;
        });
      }
    });
    flushSync();
    setData(reconcile({ animals: ["cat", "dog", "bird", "gorilla", "koala"] }));
    flushSync();
    expect(runs).toEqual([1, 1, 1, 1, 2]);
    expect(data.animals).toHaveLength(5);
  });

  // GAP: reconcile only applies to the whole store: setData('animals', reconcile(next)) has no path form (packages/core/src/store/use-store.ts:44)
  it("[SOLID-RX-112] concepts/stores: setData('animals', reconcile(newData)) reconciles a sub-tree", () => {
    const [data, setData] = useStore({ animals: ["cat", "dog"], other: 1 });
    asPathSetter(setData)("animals", reconcile(["cat", "dog", "koala"]));
    expect(data.animals).toEqual(["cat", "dog", "koala"]);
    expect(data.other).toBe(1);
  });

  it("[SOLID-RX-113] concepts/stores: unwrap(store) returns the plain underlying object, not the proxy", () => {
    const initial = { animals: ["cat", "dog", "bird", "gorilla"] };
    const [data, setData] = useStore(initial);
    const rawData = unwrap(data);
    expect(rawData).not.toBe(data);
    expect(rawData).toEqual({ animals: ["cat", "dog", "bird", "gorilla"] });
    expect(rawData).toBe(initial);
    setData((draft) => {
      draft.animals.push("koala");
    });
    expect(snapshot(data).animals).toHaveLength(5);
  });

  it("[SOLID-RX-114] concepts/stores: the store is a read-only view; direct property writes throw in dev", () => {
    const [store] = useStore(initialState());
    const writable = store as unknown as { userCount: number };
    expect(() => {
      writable.userCount = 5;
    }).toThrow();
    expect(store.userCount).toBe(3);
  });

  it("[SOLID-RX-115] concepts/stores: store reads in JSX bind to the exact text (Hello, {store.users[0].username})", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      import { useStore } from "@shadow-js/core/store";
      export const App = () => {
        const [mySignal] = useSignal("This is a signal.");
        const [store, setStore] = useStore({
          userCount: 1,
          users: [{ id: 0, username: "felix909" }],
        });
        const addUser = () => setStore((d) => { d.users.push({ id: 1, username: "new" }); d.userCount = d.users.length; });
        const rename = () => setStore((d) => { d.users[0].username = "renamed"; });
        return (
          <div>
            <h1>Hello, {store.users[0].username}</h1>
            <span>{mySignal()}</span>
            <p>User count: {store.userCount}</p>
            <button class="add" onClick={addUser}>Add user</button>
            <button class="rename" onClick={rename}>Rename</button>
          </div>
        );
      };
    `);
    const host = mount(() => mod.App());
    expect(q(host, "h1").textContent).toBe("Hello, felix909");
    q(host, ".rename").click();
    flushSync();
    expect(q(host, "h1").textContent).toBe("Hello, renamed");
    expect(q(host, "p").textContent).toBe("User count: 1");
    q(host, ".add").click();
    flushSync();
    expect(q(host, "p").textContent).toBe("User count: 2");
  });

  it("[SOLID-RX-116] concepts/stores: an effect that keeps userCount in sync with users.length via setStore", () => {
    const [store, setStore] = useStore(initialState());
    inRoot(() =>
      useEffect(() => {
        const length = store.users.length;
        setStore((draft) => {
          draft.userCount = length;
        });
      }),
    );
    flushSync();
    setStore((draft) => {
      draft.users.push({ ...michael });
    });
    flushSync();
    expect(store.userCount).toBe(4);
  });
});

describe("concepts/context", () => {
  // GAP: the context object is itself the provider; there is no `.Provider` property (packages/core/src/context.ts:25)
  it("[SOLID-RX-117] concepts/context: <MyContext.Provider value> provides a value to descendants", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      const MyContext = createContext();
      const Provider = (props) => (
        <MyContext.Provider value="new value">{props.children}</MyContext.Provider>
      );
      const Child = () => {
        const value = useContext(MyContext);
        return <span>{value}</span>;
      };
      export const App = () => (
        <Provider>
          <Child />
        </Provider>
      );
    `);
    const host = mount(() => mod.App());
    expect(q(host, "span").textContent).toBe("new value");
  });

  it("[SOLID-RX-118] concepts/context: <MyContext value> provides, useContext(MyContext) consumes (Provider/Child/App example)", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      const MyContext = createContext<string>(undefined as unknown as string, { name: "my" });
      const Provider = (props) => (
        <MyContext value="new value">{props.children}</MyContext>
      );
      const Child = () => {
        const value = useContext(MyContext);
        return <span>{value}</span>;
      };
      export const App = () => (
        <Provider>
          <Child />
        </Provider>
      );
    `);
    const host = mount(() => mod.App());
    expect(q(host, "span").textContent).toBe("new value");
  });

  it("[SOLID-RX-119] concepts/context: custom CounterProvider (props.count ?? 0) and a useCounter() utility", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      const CounterContext = createContext<number>(-1);
      function CounterProvider(props) {
        return <CounterContext value={props.count ?? 0}>{props.children}</CounterContext>;
      }
      function useCounter() { return useContext(CounterContext); }
      function Nested() { const count = useCounter(); return <div class="nested">{count}</div>; }
      export function App() {
        return (
          <CounterProvider count={1}>
            <h1>Welcome to Counter</h1>
            <Nested />
          </CounterProvider>
        );
      }
    `);
    const host = mount(() => mod.App());
    expect(q(host, ".nested").textContent).toBe("1");
    expect(q(host, "h1").textContent).toBe("Welcome to Counter");
  });

  it("[SOLID-RX-120] concepts/context: a signal plus actions in the provider value updates all consumers", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { createContext, useContext, useSignal } from "@shadow-js/core";
      const CounterContext = createContext<unknown>(undefined);
      function CounterProvider(props) {
        const [count, setCount] = useSignal(props.count || 0);
        const counter = [
          count,
          {
            increment() { setCount((prev) => prev + 1); },
            decrement() { setCount((prev) => prev - 1); },
          },
        ];
        return <CounterContext value={counter}>{props.children}</CounterContext>;
      }
      function useCounter() { return useContext(CounterContext); }
      function Child() {
        const [count, { increment, decrement }] = useCounter();
        return (
          <>
            <div class="count">{count()}</div>
            <button class="inc" onClick={increment}>+</button>
            <button class="dec" onClick={decrement}>-</button>
          </>
        );
      }
      export function App() {
        return (
          <CounterProvider count={1}>
            <h1>Welcome to Counter App</h1>
            <Child />
          </CounterProvider>
        );
      }
    `);
    const host = mount(() => mod.App());
    expect(q(host, ".count").textContent).toBe("1");
    q(host, ".inc").click();
    q(host, ".inc").click();
    flushSync();
    expect(q(host, ".count").textContent).toBe("3");
    q(host, ".dec").click();
    flushSync();
    expect(q(host, ".count").textContent).toBe("2");
  });

  it("[SOLID-RX-121] concepts/context: createContext(default) is returned when there is no provider", async () => {
    const mod = await load<{ read: () => string; Ctx: unknown }>(`
      import { createContext, createRoot, useContext } from "@shadow-js/core";
      export const Ctx = createContext("fallback");
      export const read = () => createRoot(() => useContext(Ctx));
    `);
    expect(mod.read()).toBe("fallback");
  });

  it("[SOLID-RX-122] concepts/context: useContext without a provider and without a default throws (Solid returns undefined)", async () => {
    const mod = await load<{ read: () => unknown }>(`
      import { createContext, createRoot, useContext } from "@shadow-js/core";
      const Ctx = createContext<string>();
      export const read = () => createRoot(() => useContext(Ctx));
    `);
    expect(() => mod.read()).toThrow(/CONTEXT_MISSING/);
  });

  it("[SOLID-RX-123] concepts/context: the nearest provider wins for nested providers", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      const Level = createContext<string>("none");
      const Read = () => <i>{useContext(Level)}</i>;
      export const App = () => (
        <Level value="outer">
          <b class="outer"><Read /></b>
          <Level value="inner"><b class="inner"><Read /></b></Level>
          <b class="after"><Read /></b>
        </Level>
      );
    `);
    const host = mount(() => mod.App());
    expect(q(host, ".outer").textContent).toBe("outer");
    expect(q(host, ".inner").textContent).toBe("inner");
    expect(q(host, ".after").textContent).toBe("outer");
  });

  it("[SOLID-RX-124] concepts/context: the provider value prop is read once; pass an accessor to share something reactive", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { createContext, useContext, useSignal } from "@shadow-js/core";
      const Ctx = createContext<unknown>(undefined);
      function Reader() {
        const plain = useContext(Ctx) as { plain: number; live: () => number };
        return <p><span class="plain">{plain.plain}</span><span class="live">{plain.live()}</span></p>;
      }
      export function App() {
        const [n, setN] = useSignal(1);
        return (
          <Ctx value={{ plain: n(), live: n }}>
            <Reader />
            <button onClick={() => setN(n() + 1)}>inc</button>
          </Ctx>
        );
      }
    `);
    const host = mount(() => mod.App());
    q(host, "button").click();
    flushSync();
    expect(q(host, ".plain").textContent).toBe("1");
    expect(q(host, ".live").textContent).toBe("2");
  });

  it("[SOLID-RX-125] concepts/context: a consumer helper that guards a missing provider (useMyContext) still works", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { createContext, useContext } from "@shadow-js/core";
      const MyContext = createContext<string>("default");
      function useMyContext() {
        const value = useContext(MyContext);
        if (!value) throw new Error("Missing context Provider");
        return value;
      }
      function Child() { const value = useMyContext(); return <div>{value}</div>; }
      export const App = () => <MyContext value="provided"><Child /></MyContext>;
    `);
    const host = mount(() => mod.App());
    expect(q(host, "div").textContent).toBe("provided");
  });
});

describe("concepts/refs", () => {
  it("[SOLID-RX-126] concepts/refs: JSX as a value, const myElement = <p>..</p> is a DOM element usable in {myElement}", async () => {
    const mod = await load<{ Component: () => unknown; captured: { el?: Element } }>(`
      export const captured: { el?: Element } = {};
      export function Component() {
        const myElement = <p>My Element</p>;
        captured.el = myElement as Element;
        return <div>{myElement}</div>;
      }
    `);
    const host = mount(() => mod.Component());
    expect(mod.captured.el).toBeInstanceOf(HTMLParagraphElement);
    expect(host.querySelector("div > p")).toBe(mod.captured.el);
  });

  it("[SOLID-RX-127] concepts/refs: ref={myElement} with a let variable is assigned at creation, before attachment", async () => {
    const mod = await load<{
      Component: () => unknown;
      state: { el?: HTMLElement; connectedAtUseEffect?: boolean };
    }>(`
      import { useEffect } from "@shadow-js/core";
      export const state: { el?: HTMLElement; connectedAtUseEffect?: boolean } = {};
      export function Component() {
        let myElement: HTMLParagraphElement | undefined;
        state.el = myElement;
        useEffect(() => { state.el = myElement; });
        return (
          <div>
            <p ref={myElement}>My Element</p>
          </div>
        );
      }
    `);
    const host = mount(() => mod.Component());
    expect(mod.state.el).toBe(q(host, "p"));
  });

  it("[SOLID-RX-128] concepts/refs: the callback form ref={(el) => ...} receives an element that is not yet in the document", async () => {
    const mod = await load<{
      Component: () => unknown;
      state: { el?: HTMLElement; connected?: boolean };
    }>(`
      export const state: { el?: HTMLElement; connected?: boolean } = {};
      export function Component() {
        return (
          <p ref={(el) => { state.el = el; state.connected = el.isConnected; }}>My Element</p>
        );
      }
    `);
    const host = mount(() => mod.Component());
    expect(mod.state.el).toBe(q(host, "p"));
    expect(mod.state.connected).toBe(false);
  });

  it("[SOLID-RX-129] concepts/refs: document.querySelector inside onMount finds the attached element", async () => {
    const mod = await load<{ Component: () => unknown; found: { el: Element | null } }>(`
      import { onMount } from "@shadow-js/core";
      export const found: { el: Element | null } = { el: undefined as unknown as null };
      export function Component() {
        onMount(() => { found.el = document.querySelector("#target"); });
        return <p id="target">x</p>;
      }
    `);
    const host = mount(() => mod.Component());
    expect(mod.found.el).toBe(q(host, "#target"));
  });

  it("[SOLID-RX-130] concepts/refs: a ref inside <Show> is assigned once the element is rendered (Signals as refs example)", async () => {
    const mod = await load<{ App: () => unknown; state: { el?: HTMLElement } }>(`
      import { useSignal } from "@shadow-js/core";
      import { Show } from "@shadow-js/web";
      export const state: { el?: HTMLElement } = {};
      export function App() {
        const [show, setShow] = useSignal(false);
        let element!: HTMLParagraphElement;
        return (
          <div>
            <button onClick={() => setShow((isShown) => !isShown)}>Toggle</button>
            <Show when={show()}>
              <p ref={(el) => { state.el = el; element = el; }}>This is the ref element</p>
            </Show>
          </div>
        );
      }
    `);
    const host = mount(() => mod.App());
    expect(mod.state.el).toBeUndefined();
    q(host, "button").click();
    flushSync();
    expect(mod.state.el).toBe(q(host, "p"));
  });

  it("[SOLID-RX-131] concepts/refs: ref={element} (let variable) inside <Show> is assigned when shown", async () => {
    const mod = await load<{ App: () => unknown; probe: () => HTMLElement | undefined }>(`
      import { useSignal } from "@shadow-js/core";
      import { Show } from "@shadow-js/web";
      let element: HTMLParagraphElement | undefined;
      export const probe = () => element;
      export function App() {
        const [show, setShow] = useSignal(false);
        return (
          <div>
            <button onClick={() => setShow((isShown) => !isShown)}>Toggle</button>
            <Show when={show()}>
              <p ref={element}>This is the ref element</p>
            </Show>
          </div>
        );
      }
    `);
    const host = mount(() => mod.App());
    expect(mod.probe()).toBeUndefined();
    q(host, "button").click();
    flushSync();
    expect(mod.probe()).toBe(q(host, "p"));
  });

  it("[SOLID-RX-132] concepts/refs: forwarding refs, <Canvas ref={canvasRef} /> with <canvas ref={props.ref} />", async () => {
    const mod = await load<{ Parent: () => unknown; probe: () => HTMLElement | undefined }>(`
      let canvasRef: HTMLCanvasElement | undefined;
      export const probe = () => canvasRef;
      function Canvas(props) {
        return (
          <div class="canvas-container">
            <canvas ref={props.ref} />
          </div>
        );
      }
      export function Parent() {
        return (
          <div>
            <Canvas ref={canvasRef} />
            <button>Animate Canvas</button>
          </div>
        );
      }
    `);
    const host = mount(() => mod.Parent());
    expect(mod.probe()).toBe(q(host, "canvas"));
  });

  it("[SOLID-RX-133] concepts/refs: forwarding a callback ref to a child element", async () => {
    const mod = await load<{ Parent: () => unknown; state: { el?: HTMLElement } }>(`
      export const state: { el?: HTMLElement } = {};
      function Canvas(props) { return <canvas ref={props.ref} />; }
      export function Parent() { return <Canvas ref={(el) => { state.el = el; }} />; }
    `);
    const host = mount(() => mod.Parent());
    expect(mod.state.el).toBe(q(host, "canvas"));
  });

  // GAP: use:dir={expr} calls dir(el, value) with the value read once; Solid passes an accessor, dir(el, () => value) (packages/web/src/reactive.ts:55)
  it("[SOLID-RX-134] concepts/refs: a use: directive receives (element, accessor) before the element is attached", async () => {
    const mod = await load<{
      App: () => unknown;
      calls: Array<{ connected: boolean; value: string }>;
    }>(`
      import { useSignal } from "@shadow-js/core";
      export const calls: Array<{ connected: boolean; value: string }> = [];
      function tooltip(el: HTMLElement, accessor: () => string) {
        calls.push({ connected: el.isConnected, value: accessor() });
        el.setAttribute("data-tip", accessor());
      }
      export function App() {
        const [text] = useSignal("hello");
        return <p use:tooltip={text()}>x</p>;
      }
    `);
    const host = mount(() => mod.App());
    expect(mod.calls).toEqual([{ connected: false, value: "hello" }]);
    expect(q(host, "p").getAttribute("data-tip")).toBe("hello");
  });

  it("[SOLID-RX-135] concepts/refs: several directives on one element; the directive receives an accessor, before attachment", async () => {
    const mod = await load<{
      App: () => unknown;
      calls: Array<{ connected: boolean; value: string }>;
    }>(`
      export const calls: Array<{ connected: boolean; value: string }> = [];
      function tooltip(el: HTMLElement, value: () => string) {
        calls.push({ connected: el.isConnected, value: value() });
        el.setAttribute("data-tip", value());
      }
      function bold(el: HTMLElement) { el.style.fontWeight = "bold"; }
      export function App() {
        return <p use:tooltip={"hello"} use:bold>x</p>;
      }
    `);
    const host = mount(() => mod.App());
    expect(mod.calls).toEqual([{ connected: false, value: "hello" }]);
    expect(q(host, "p").getAttribute("data-tip")).toBe("hello");
    expect(q(host, "p").style.fontWeight).toBe("bold");
  });

  it("[SOLID-RX-136] concepts/refs: a signal setter can be used as a ref (ref={setEl})", async () => {
    const mod = await load<{ App: () => unknown; probe: () => HTMLElement | undefined }>(`
      import { useSignal } from "@shadow-js/core";
      let current: () => HTMLElement | undefined;
      export const probe = () => current?.();
      export function App() {
        const [el, setEl] = useSignal<HTMLElement | undefined>(undefined);
        current = el;
        return <p ref={setEl}>x</p>;
      }
    `);
    const host = mount(() => mod.App());
    expect(mod.probe()).toBe(q(host, "p"));
  });
});

describe("concepts/understanding-jsx", () => {
  it("[SOLID-RX-137] concepts/understanding-jsx: JSX evaluates to a real DOM element immediately", async () => {
    const mod = await load<{ element: unknown }>(`
      export const element = <h1>I'm JSX!!</h1>;
    `);
    expect(mod.element).toBeInstanceOf(HTMLHeadingElement);
    expect((mod.element as HTMLElement).textContent).toBe("I'm JSX!!");
  });

  it("[SOLID-RX-138] concepts/understanding-jsx: dynamic expressions in curly braces ({animal.breed}, {animal.name})", async () => {
    const mod = await load<{ Component: () => unknown }>(`
      export const Component = () => {
        const animal = { breed: "cat", name: "Midnight" };
        return (
          <p>
            I have a {animal.breed} named {animal.name}!
          </p>
        );
      };
    `);
    const host = mount(() => mod.Component());
    expect(q(host, "p").textContent).toBe("I have a cat named Midnight!");
  });

  it("[SOLID-RX-139] concepts/understanding-jsx: fragments return several top-level nodes (no single-root requirement at runtime)", async () => {
    const mod = await load<{ App: () => unknown }>(`
      export const App = () => (<><h1>a</h1><h2>b</h2></>);
    `);
    const host = mount(() => mod.App());
    expect(host.innerHTML).toBe("<h1>a</h1><h2>b</h2>");
  });

  it("[SOLID-RX-140] concepts/understanding-jsx: self-closing tags and attributes (<img src /> , class, onClick)", async () => {
    const mod = await load<{ App: () => unknown; clicks: number[] }>(`
      export const clicks: number[] = [];
      const handleClick = () => { clicks.push(1); };
      export const App = () => (
        <div>
          <img src="./image-here.png" />
          <button class="myClass" onClick={handleClick}>Click me!</button>
        </div>
      );
    `);
    const host = mount(() => mod.App());
    expect(q(host, "img").getAttribute("src")).toBe("./image-here.png");
    q(host, "button").click();
    expect(mod.clicks).toEqual([1]);
    expect(q(host, "button").className).toBe("myClass");
  });

  it("[SOLID-RX-141] concepts/understanding-jsx: lowercase event attributes (onclick) work like onClick", async () => {
    const mod = await load<{ App: () => unknown; clicks: number[] }>(`
      export const clicks: number[] = [];
      export const App = () => <button onclick={() => { clicks.push(1); }}>go</button>;
    `);
    const host = mount(() => mod.App());
    q(host, "button").click();
    expect(mod.clicks).toEqual([1]);
  });

  it("[SOLID-RX-142] concepts/understanding-jsx: style takes an object in double curly braces", async () => {
    const mod = await load<{ App: () => unknown }>(`
      export const App = () => <button style={{ color: "red", "font-size": "2rem" }}>Click me!</button>;
    `);
    const host = mount(() => mod.App());
    const button = q(host, "button");
    expect(button.style.color).toBe("red");
    expect(button.style.fontSize).toBe("2rem");
  });

  it("[SOLID-RX-143] concepts/understanding-jsx: static props are in the template, dynamic props (value={value()}) update", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export const App = () => {
        const [value, setValue] = useSignal("a");
        return (
          <div>
            <input class="static" type="text" value={value()} />
            <button onClick={() => setValue("b")}>go</button>
          </div>
        );
      };
    `);
    const host = mount(() => mod.App());
    const input = q<HTMLInputElement>(host, "input");
    expect(input.getAttribute("class")).toBe("static");
    expect(input.value).toBe("a");
    q(host, "button").click();
    flushSync();
    expect(input.value).toBe("b");
  });

  it("[SOLID-RX-144] concepts/understanding-jsx: expressions apply in the order written (type='range' before min, max, value)", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useSignal } from "@shadow-js/core";
      export const App = () => {
        const [max] = useSignal(200);
        const [value] = useSignal(150);
        return <input type="range" min={0} max={max()} value={value()} />;
      };
    `);
    const host = mount(() => mod.App());
    const input = q<HTMLInputElement>(host, "input");
    expect(input.type).toBe("range");
    expect(input.value).toBe("150");
  });

  it("[SOLID-RX-145] concepts/understanding-jsx: props carry resource data into the view ({data()?.title})", async () => {
    const mod = await load<{ App: (props: { promise: Promise<{ title: string }> }) => unknown }>(`
      import { useResource } from "@shadow-js/core";
      export function App(props) {
        const data = useResource(() => props.promise);
        return <h1>{data()?.title}</h1>;
      }
    `);
    const d = deferred<{ title: string }>();
    const host = mount(() => mod.App({ promise: d.promise }));
    expect(q(host, "h1").textContent).toBe("");
    d.resolve({ title: "Loaded" });
    await settle();
    expect(q(host, "h1").textContent).toBe("Loaded");
  });

  it("[SOLID-RX-146] concepts/understanding-jsx: onMount inside a component sees the finished DOM", async () => {
    const seen: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => {
      onMount(() => {
        seen.push(host.innerHTML);
      });
      return document.createElement("p");
    }, host);
    disposers.push(dispose);
    expect(seen).toEqual(["<p></p>"]);
  });
});

describe("concepts/refs (directive accessor)", () => {
  // GAP: directive arguments are read once and passed by value, so a directive cannot react to later changes (packages/web/src/reactive.ts:55)
  it("[SOLID-RX-147] concepts/refs: a directive reads reactive data through its accessor and re-runs when it changes", async () => {
    const mod = await load<{ App: () => unknown }>(`
      import { useEffect, useSignal } from "@shadow-js/core";
      function mark(el: HTMLElement, accessor: () => string) {
        useEffect(() => { el.setAttribute("data-mark", accessor()); });
      }
      export function App() {
        const [text, setText] = useSignal("a");
        return (
          <div>
            <p use:mark={text()}>x</p>
            <button onClick={() => setText("b")}>go</button>
          </div>
        );
      }
    `);
    const host = mount(() => mod.App());
    expect(q(host, "p").getAttribute("data-mark")).toBe("a");
    q(host, "button").click();
    flushSync();
    expect(q(host, "p").getAttribute("data-mark")).toBe("b");
  });
});
