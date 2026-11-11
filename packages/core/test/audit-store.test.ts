import { describe, expect, it } from "vitest";
import { reconcile, snapshot, useStore } from "../src/index";

describe("store: data that carries a __proto__ key as an own property", () => {
  it("[CORE-F01] reconcile() keeps working after the store took in JSON with an own __proto__ key", () => {
    // JSON.parse makes "__proto__" an own data property, so an API payload can put it into a store.
    const payload = JSON.parse('{"__proto__":{"x":1},"a":1}') as { a: number };
    const [store, setStore] = useStore<{ a: number }>(payload);
    // The next payload does not carry the key: reconcile deletes keys that are gone, and used to
    // throw SHADOW_STORE_RESERVED_DELETE half-way through, so no refresh could ever succeed again.
    setStore(reconcile({ a: 2 }));
    expect(snapshot(store)).toEqual({ a: 2 });
    expect(Reflect.get({}, "x")).toBeUndefined();
  });

  it("[CORE-F01] a nested object with an own __proto__ key does not block a later reconcile of its list", () => {
    interface Item {
      id: number;
      title?: string;
    }
    const [store, setStore] = useStore<{ items: Item[] }>({ items: [] });
    setStore("items", reconcile([JSON.parse('{"id":1,"__proto__":{"y":1}}') as Item]));
    const next: Item[] = [{ id: 1, title: "kept" }];
    setStore("items", reconcile(next));
    expect(snapshot(store).items).toEqual([{ id: 1, title: "kept" }]);
  });
});

describe("store path steps over very large arrays", () => {
  it("[CORE-F03] a range step over 300,000 items writes every item instead of overflowing the call stack", () => {
    const size = 300_000;
    const [store, setStore] = useStore<{ rows: Array<{ n: number }> }>({
      rows: Array.from({ length: size }, () => ({ n: 0 })),
    });
    setStore("rows", { from: 0, to: size - 1 }, "n", 1);
    expect(store.rows[0]?.n).toBe(1);
    expect(store.rows[size - 1]?.n).toBe(1);
  });

  it("[CORE-F03] an index-list step of 300,000 positions is applied as well", () => {
    const size = 300_000;
    const [store, setStore] = useStore<{ rows: number[] }>({
      rows: Array.from({ length: size }, () => 0),
    });
    setStore(
      "rows",
      Array.from({ length: size }, (_, index) => index),
      1,
    );
    expect(store.rows[size - 1]).toBe(1);
  });
});
