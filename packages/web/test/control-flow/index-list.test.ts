import {
  type Accessor,
  createRoot,
  flushSync,
  onCleanup,
  untrack,
  useEffect,
  useSignal,
} from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { Index, Show } from "../../src/control-flow/index";

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

/** Row texts: each row is an accessor returning its text. */
function texts(values: readonly unknown[]): unknown[] {
  const row = values.at(-1);
  if (!Array.isArray(row)) throw new Error("expected a row array");
  return row.map((cell) => unwrap(cell));
}

describe("Index: positions", () => {
  it("[IDX-01] renders one row per position, with the item accessor and a numeric index", () => {
    const [list, setList] = useSignal<readonly string[]>(["a", "b"]);
    const indexes: number[] = [];
    const { values, dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (item: () => string, index: number) => {
          indexes.push(index);
          return () => `${String(index)}:${item()}`;
        },
      }),
    );
    expect(texts(values)).toEqual(["0:a", "1:b"]);
    expect(indexes).toEqual([0, 1]);
    flushSync(() => setList(["x", "y"]));
    expect(texts(values)).toEqual(["0:x", "1:y"]);
    dispose();
  });

  it("[IDX-02] a value change at the same position updates item() without rebuilding the row", () => {
    const [list, setList] = useSignal<readonly number[]>([1, 2]);
    let built = 0;
    const { values, dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (item: () => number) => {
          built += 1;
          return () => item() * 10;
        },
      }),
    );
    flushSync(() => setList([5, 6]));
    expect(built).toBe(2);
    expect(texts(values)).toEqual([50, 60]);
    dispose();
  });

  it("[IDX-03] the item accessor of a row keeps reading its own position after a replacement", () => {
    const [list, setList] = useSignal<readonly string[]>(["a"]);
    const readers: Array<() => string> = [];
    const { dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (item: () => string) => {
          readers.push(item);
          return item();
        },
      }),
    );
    flushSync(() => setList(["z"]));
    expect(readers[0]?.()).toBe("z");
    dispose();
  });

  it("[IDX-04] growing the list creates rows only for the new positions", () => {
    const [list, setList] = useSignal<readonly number[]>([1]);
    let built = 0;
    const { values, dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (item: () => number) => {
          built += 1;
          return item;
        },
      }),
    );
    flushSync(() => setList([1, 2, 3]));
    expect(built).toBe(3);
    expect(values.at(-1)).toHaveLength(3);
    dispose();
  });

  it("[IDX-05] shrinking the list disposes the trailing rows", () => {
    const [list, setList] = useSignal<readonly number[]>([1, 2, 3]);
    const cleaned: number[] = [];
    const { values, dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (item: () => number, index: number) => {
          onCleanup(() => {
            cleaned.push(index);
          });
          return item;
        },
      }),
    );
    flushSync(() => setList([9]));
    expect(cleaned.sort()).toEqual([1, 2]);
    expect(values.at(-1)).toHaveLength(1);
    dispose();
  });

  it("[IDX-06] a list that changes length and back does not leak rows", () => {
    const [list, setList] = useSignal<readonly number[]>([1, 2]);
    let created = 0;
    let cleaned = 0;
    const { dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (item: () => number) => {
          created += 1;
          onCleanup(() => {
            cleaned += 1;
          });
          return item;
        },
      }),
    );
    flushSync(() => setList([1]));
    flushSync(() => setList([1, 2]));
    expect(created).toBe(3);
    expect(cleaned).toBe(1);
    dispose();
  });

  it("[IDX-07] passes the index as a plain number, read untracked", () => {
    const [list] = useSignal<readonly string[]>(["a"]);
    const seen: unknown[] = [];
    const { dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (_item: () => string, index: number) => {
          seen.push(typeof index);
          return index;
        },
      }),
    );
    expect(seen).toEqual(["number"]);
    dispose();
  });

  it("[IDX-08] reads the children getter once per row", () => {
    const [list, setList] = useSignal<readonly number[]>([1, 2]);
    let reads = 0;
    const { dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        get children() {
          reads += 1;
          return (item: () => number) => item();
        },
      }),
    );
    expect(reads).toBe(2);
    flushSync(() => setList([3, 4, 5]));
    expect(reads).toBe(3);
    dispose();
  });
});

describe("Index: empty lists and the fallback", () => {
  it("[IDX-09] shows the fallback for an empty list", () => {
    const { values, dispose } = mount(() =>
      Index({
        each: [],
        fallback: "empty",
        children: (item: () => number) => item,
      }),
    );
    expect(values.at(-1)).toEqual(["empty"]);
    dispose();
  });

  it("[IDX-10] null, undefined and false are empty lists with the fallback", () => {
    for (const each of [null, undefined, false] as const) {
      const { values, dispose } = mount(() =>
        Index({ each, fallback: "empty", children: (item: () => number) => item }),
      );
      expect(values.at(-1)).toEqual(["empty"]);
      dispose();
    }
  });

  it("[IDX-11] reads the fallback lazily, only while the list is empty", () => {
    const [list, setList] = useSignal<readonly number[]>([1]);
    let reads = 0;
    const { values, dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        get fallback() {
          reads += 1;
          return "empty";
        },
        children: (item: () => number) => item,
      }),
    );
    expect(reads).toBe(0);
    flushSync(() => setList([]));
    expect(reads).toBe(1);
    expect(values.at(-1)).toEqual(["empty"]);
    dispose();
  });

  it("[IDX-12] disposing the owner disposes every row once", () => {
    let cleaned = 0;
    const dispose = createRoot((dispose) => {
      const view = Index({
        each: [1, 2],
        children: (_item: () => number, _index: number) => {
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
    expect(cleaned).toBe(2);
  });

  it("[IDX-13] a batch of list updates builds rows for the final list only", () => {
    const [list, setList] = useSignal<readonly number[]>([]);
    let built = 0;
    const { values, dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (item: () => number) => {
          built += 1;
          return item;
        },
      }),
    );
    flushSync(() => {
      setList([1, 2]);
      setList([3, 4, 5]);
    });
    expect(built).toBe(3);
    expect(values.at(-1)).toHaveLength(3);
    dispose();
  });

  it("[IDX-14] a 10,000-position list builds and updates in one pass", () => {
    const [list, setList] = useSignal<readonly number[]>(
      Array.from({ length: 10_000 }, (_u, i) => i),
    );
    let built = 0;
    const { values, dispose } = mount(() =>
      Index({
        get each() {
          return list();
        },
        children: (item: () => number) => {
          built += 1;
          return item;
        },
      }),
    );
    expect(built).toBe(10_000);
    flushSync(() => setList(Array.from({ length: 10_000 }, (_u, i) => i + 1)));
    expect(built).toBe(10_000);
    expect(values.at(-1)).toHaveLength(10_000);
    dispose();
  });

  it("[IDX-15] an Index inside a Show is disposed with the branch", () => {
    const [visible, setVisible] = useSignal<boolean>(true);
    let cleaned = 0;
    const { values, dispose } = mount(() =>
      Show({
        get when() {
          return visible();
        },
        children: (_value: unknown) =>
          Index({
            each: [1, 2],
            children: (_item: () => number) => {
              onCleanup(() => {
                cleaned += 1;
              });
              return "row";
            },
          }),
        fallback: "hidden",
      }),
    );
    expect(values.at(-1)).toEqual(["row", "row"]);
    flushSync(() => setVisible(false));
    expect(cleaned).toBe(2);
    expect(values.at(-1)).toBe("hidden");
    dispose();
  });
});
