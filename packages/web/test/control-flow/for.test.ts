import {
  type Accessor,
  createRoot,
  flushSync,
  onCleanup,
  untrack,
  useEffect,
  useSignal,
} from "@shadow-js/core";
import { describe, expect, it, vi } from "vitest";
import { For, Show } from "../../src/control-flow/index";

interface Todo {
  readonly id: number;
  readonly title: string;
}

/** Unwraps accessors the way the DOM insert does: a function value is read until a plain value appears. */
function unwrap(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") current = (current as () => unknown)();
  return current;
}

/**
 * Builds the view inside its own root (mapArray needs an owner) and records the unwrapped value
 * after every flush.
 */
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

/** The most recent value recorded by {@link mount}, as a row array. */
function last(values: readonly unknown[]): unknown[] {
  const row = values.at(-1);
  if (!Array.isArray(row)) throw new Error("expected a row array");
  return row;
}

/** Row values with accessor rows read (keyed rows whose child returns an accessor). */
function texts(values: readonly unknown[]): unknown[] {
  return last(values).map((row) => unwrap(row));
}

describe("For: unkeyed rows", () => {
  it("[FOR-01] renders one row per item, in order, passing the item value and an index accessor", () => {
    const [list, setList] = useSignal<readonly string[]>(["a", "b"]);
    const indexes: number[] = [];
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        children: (item: string, index: () => number) => {
          indexes.push(untrack(index));
          return () => `${item}:${String(index())}`;
        },
      }),
    );
    expect(texts(values)).toEqual(["a:0", "b:1"]);
    expect(indexes).toEqual([0, 1]);
    flushSync(() => setList(["x", "a", "b"]));
    expect(texts(values)).toEqual(["x:0", "a:1", "b:2"]);
    dispose();
  });

  it("[FOR-02] the index accessor follows the row when items move", () => {
    const [list, setList] = useSignal<readonly string[]>(["a", "b"]);
    const readers: Array<() => number> = [];
    const { dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        children: (item: string, index: () => number) => {
          readers.push(index);
          return item;
        },
      }),
    );
    const rowA = readers[0];
    expect(rowA?.()).toBe(0);
    flushSync(() => setList(["z", "a", "b"]));
    expect(rowA?.()).toBe(1);
    dispose();
  });

  it("[FOR-03] an unchanged item keeps its row: the callback is not called again for it", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const c = { id: 3 };
    const [list, setList] = useSignal<readonly { id: number }[]>([a, b]);
    const built: number[] = [];
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        children: (item: { id: number }) => {
          built.push(item.id);
          return item;
        },
      }),
    );
    flushSync(() => setList([c, a, b]));
    expect(built).toEqual([1, 2, 3]);
    expect(last(values)[1]).toBe(a);
    expect(last(values)[2]).toBe(b);
    dispose();
  });

  it("[FOR-04] removed items have their rows disposed exactly once", () => {
    const [list, setList] = useSignal<readonly number[]>([1, 2, 3]);
    const cleaned: number[] = [];
    const { dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        children: (item: number) => {
          onCleanup(() => {
            cleaned.push(item);
          });
          return item;
        },
      }),
    );
    flushSync(() => setList([1, 3]));
    expect(cleaned).toEqual([2]);
    flushSync(() => setList([3]));
    expect(cleaned).toEqual([2, 1]);
    dispose();
  });

  it("[FOR-05] appended items create rows without touching the existing ones", () => {
    const [list, setList] = useSignal<readonly number[]>([1]);
    let created = 0;
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        children: (item: number) => {
          created += 1;
          return item;
        },
      }),
    );
    flushSync(() => setList([1, 2, 3]));
    expect(created).toBe(3);
    expect(last(values)).toEqual([1, 2, 3]);
    dispose();
  });

  it("[FOR-06] duplicate primitive items pair up in order of occurrence", () => {
    const [list, setList] = useSignal<readonly string[]>(["a", "a"]);
    let created = 0;
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        children: (item: string) => {
          created += 1;
          return item;
        },
      }),
    );
    flushSync(() => setList(["a", "a", "a"]));
    expect(created).toBe(3);
    flushSync(() => setList(["a"]));
    expect(created).toBe(3);
    expect(last(values)).toEqual(["a"]);
    dispose();
  });

  it("[FOR-07] reads the children getter once per row: a grown list reads it only for the new row", () => {
    const [list, setList] = useSignal<readonly number[]>([1, 2]);
    let reads = 0;
    const { dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        get children() {
          reads += 1;
          return (item: number) => item;
        },
      }),
    );
    expect(reads).toBe(2);
    flushSync(() => setList([1, 2, 3]));
    expect(reads).toBe(3);
    dispose();
  });
});

describe("For: empty lists and the fallback", () => {
  it("[FOR-08] shows the fallback when the list is empty", () => {
    const { values, dispose } = mount(() =>
      For({
        each: [],
        fallback: "empty",
        children: (item: number) => item,
      }),
    );
    expect(last(values)).toEqual(["empty"]);
    dispose();
  });

  it("[FOR-09] null, undefined and false are empty lists", () => {
    for (const each of [null, undefined, false] as const) {
      const { values, dispose } = mount(() =>
        For({ each, fallback: "empty", children: (item: number) => item }),
      );
      expect(last(values)).toEqual(["empty"]);
      dispose();
    }
  });

  it("[FOR-10] reads the fallback lazily, only while the list is empty", () => {
    const [list, setList] = useSignal<readonly number[]>([1]);
    let reads = 0;
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        get fallback() {
          reads += 1;
          return "empty";
        },
        children: (item: number) => item,
      }),
    );
    expect(reads).toBe(0);
    flushSync(() => setList([]));
    expect(reads).toBe(1);
    expect(last(values)).toEqual(["empty"]);
    flushSync(() => setList([2]));
    expect(last(values)).toEqual([2]);
    dispose();
  });

  it("[FOR-11] cycles between rows and fallback, rebuilding rows each time", () => {
    const [list, setList] = useSignal<readonly number[]>([1]);
    let created = 0;
    let cleaned = 0;
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        fallback: "empty",
        children: (item: number) => {
          created += 1;
          onCleanup(() => {
            cleaned += 1;
          });
          return item;
        },
      }),
    );
    flushSync(() => setList([]));
    flushSync(() => setList([5]));
    flushSync(() => setList([]));
    flushSync(() => setList([6]));
    expect(created).toBe(3);
    expect(cleaned).toBe(2);
    expect(values.map((row) => (Array.isArray(row) ? row[0] : row))).toEqual([
      1,
      "empty",
      5,
      "empty",
      6,
    ]);
    dispose();
  });

  it("[FOR-12] an empty list without a fallback yields a row that renders nothing", () => {
    const { values, dispose } = mount(() => For({ each: [], children: (item: number) => item }));
    expect(last(values)).toEqual([undefined]);
    dispose();
  });
});

describe("For: keyed rows", () => {
  it("[FOR-13] keyed callbacks receive an accessor of the item that follows its key", () => {
    const todos: Todo[] = [
      { id: 1, title: "a" },
      { id: 2, title: "b" },
    ];
    const [list, setList] = useSignal<readonly Todo[]>(todos);
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        key: (todo: Todo) => todo.id,
        children: (todo: () => Todo) => () => todo().title,
      }),
    );
    expect(texts(values)).toEqual(["a", "b"]);
    flushSync(() =>
      setList([
        { id: 2, title: "B" },
        { id: 1, title: "a" },
      ]),
    );
    expect(texts(values)).toEqual(["B", "a"]);
    dispose();
  });

  it("[FOR-14] a new object under the same key updates item() without rebuilding the row", () => {
    const [list, setList] = useSignal<readonly Todo[]>([{ id: 1, title: "old" }]);
    let built = 0;
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        key: (todo: Todo) => todo.id,
        children: (todo: () => Todo) => {
          built += 1;
          return () => todo().title;
        },
      }),
    );
    flushSync(() => setList([{ id: 1, title: "new" }]));
    expect(built).toBe(1);
    expect(texts(values)).toEqual(["new"]);
    dispose();
  });

  it("[FOR-15] keyed rows keep their identity across reorders", () => {
    const first = { id: 1 };
    const second = { id: 2 };
    const [list, setList] = useSignal<readonly { id: number }[]>([first, second]);
    const created: number[] = [];
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        key: (item: { id: number }) => item.id,
        children: (item: () => { id: number }) => {
          const row = { value: untrack(item).id };
          created.push(row.value);
          return row;
        },
      }),
    );
    const before = last(values);
    flushSync(() => setList([{ id: 2 }, { id: 1 }]));
    const after = last(values);
    expect(created).toEqual([1, 2]);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    dispose();
  });

  it("[FOR-16] keyed rows for removed keys are disposed; kept keys keep their cleanups", () => {
    const [list, setList] = useSignal<readonly number[]>([1, 2, 3]);
    const cleaned: number[] = [];
    const { dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        key: (item: number) => item,
        children: (item: () => number) => {
          onCleanup(() => {
            cleaned.push(untrack(item));
          });
          return item();
        },
      }),
    );
    flushSync(() => setList([3, 1]));
    expect(cleaned).toEqual([2]);
    dispose();
  });

  it("[FOR-17] warns once about a duplicate key and gives later copies fresh rows", () => {
    vi.mocked(console.warn).mockClear();
    const [list, setList] = useSignal<readonly number[]>([1, 1]);
    let created = 0;
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        key: (item: number) => item,
        children: (item: () => number) => {
          created += 1;
          return item();
        },
      }),
    );
    expect(vi.mocked(console.warn).mock.calls.length).toBe(1);
    vi.mocked(console.warn).mockClear();
    expect(created).toBe(2);
    flushSync(() => setList([1, 1]));
    // The first copy keeps its row; the second copy is fresh on every update.
    expect(created).toBe(3);
    expect(last(values)).toEqual([1, 1]);
    dispose();
  });
});

describe("For: nesting and scale", () => {
  it("[FOR-18] a For inside a For keeps the inner rows per outer row", () => {
    const [outer, setOuter] = useSignal<readonly number[]>([1, 2]);
    const innerBuilt: string[] = [];
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return outer();
        },
        children: (group: number) =>
          For({
            each: [group, group * 10],
            children: (value: number) => {
              innerBuilt.push(`${String(group)}/${String(value)}`);
              return value;
            },
          }),
      }),
    );
    expect(last(values).map((row) => unwrap(row))).toEqual([
      [1, 10],
      [2, 20],
    ]);
    expect(innerBuilt).toEqual(["1/1", "1/10", "2/2", "2/20"]);
    flushSync(() => setOuter([2]));
    expect(last(values).map((row) => unwrap(row))).toEqual([[2, 20]]);
    dispose();
  });

  it("[FOR-19] a For inside a Show disposes its rows when the Show hides", () => {
    const [visible, setVisible] = useSignal<boolean>(true);
    let cleaned = 0;
    const { values, dispose } = mount(() =>
      Show({
        get when() {
          return visible();
        },
        children: (_value: unknown) =>
          For({
            each: [1, 2, 3],
            children: (_item: number) => {
              onCleanup(() => {
                cleaned += 1;
              });
              return "row";
            },
          }),
        fallback: "hidden",
      }),
    );
    expect(values.at(-1)).toEqual(["row", "row", "row"]);
    flushSync(() => setVisible(false));
    expect(cleaned).toBe(3);
    expect(values.at(-1)).toBe("hidden");
    dispose();
  });

  it("[FOR-20] a 10,000-row list maps, updates and reverses correctly", () => {
    const rows = Array.from({ length: 10_000 }, (_unused, index) => ({ id: index }));
    const [list, setList] = useSignal<readonly { id: number }[]>(rows);
    let built = 0;
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        key: (row: { id: number }) => row.id,
        children: (row: () => { id: number }) => {
          built += 1;
          return row().id;
        },
      }),
    );
    expect(built).toBe(10_000);
    expect(last(values).length).toBe(10_000);
    flushSync(() => setList([...rows].reverse()));
    expect(built).toBe(10_000);
    expect(last(values)[0]).toBe(9_999);
    expect(last(values)[9_999]).toBe(0);
    flushSync(() => setList(rows.slice(0, 5_000)));
    expect(built).toBe(10_000);
    expect(last(values).length).toBe(5_000);
    dispose();
  });

  it("[FOR-21] disposing the owner disposes every row exactly once", () => {
    let cleaned = 0;
    const dispose = createRoot((dispose) => {
      const view = For({
        each: [1, 2, 3],
        children: (_item: number) => {
          onCleanup(() => {
            cleaned += 1;
          });
          return "row";
        },
      });
      untrack(view);
      return dispose;
    });
    expect(cleaned).toBe(0);
    dispose();
    expect(cleaned).toBe(3);
  });

  it("[FOR-22] a batch of many list updates builds rows for the final list only", () => {
    const [list, setList] = useSignal<readonly number[]>([]);
    let built = 0;
    const { values, dispose } = mount(() =>
      For({
        get each() {
          return list();
        },
        children: (item: number) => {
          built += 1;
          return item;
        },
      }),
    );
    flushSync(() => {
      setList([1]);
      setList([1, 2]);
      setList([3]);
    });
    expect(built).toBe(1);
    expect(last(values)).toEqual([3]);
    dispose();
  });
});
