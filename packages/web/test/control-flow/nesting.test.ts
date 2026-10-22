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
import { ErrorBoundary, For, Fragment, Match, Show, Switch } from "../../src/control-flow/index";

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

/** Row texts: each row is an accessor (a Show branch) that is read here. */
function rowsOf(values: readonly unknown[]): unknown[] {
  const row = values.at(-1);
  if (!Array.isArray(row)) throw new Error("expected a row array");
  return row.map((cell) => unwrap(cell));
}

describe("nesting: control-flow components combined", () => {
  it("[NST-01] Show inside For inside Switch inside ErrorBoundary: each layer updates independently", () => {
    const [mode, setMode] = useSignal<"list" | "none">("list");
    const [items, setItems] = useSignal<readonly number[]>([1, 2]);
    const [flag, setFlag] = useSignal<boolean>(true);
    let showBuilds = 0;
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: "boundary failed",
        get children() {
          return Switch({
            fallback: "no mode",
            children: [
              Match({
                get when() {
                  return mode() === "list";
                },
                children: (_value: unknown) =>
                  For({
                    get each() {
                      return items();
                    },
                    key: (item: number) => item,
                    children: (item: () => number) =>
                      Show({
                        get when() {
                          return flag();
                        },
                        children: (_value: unknown) => {
                          showBuilds += 1;
                          return () => `row ${String(item())}`;
                        },
                        fallback: "hidden",
                      }),
                  }),
              }),
            ],
          });
        },
      }),
    );
    expect(rowsOf(values)).toEqual(["row 1", "row 2"]);
    expect(showBuilds).toBe(2);

    // A new item builds exactly one new Show branch; the existing rows keep theirs.
    flushSync(() => setItems([1, 2, 3]));
    expect(rowsOf(values)).toEqual(["row 1", "row 2", "row 3"]);
    expect(showBuilds).toBe(3);

    // Hiding every Show keeps the rows but swaps their content.
    flushSync(() => setFlag(false));
    expect(rowsOf(values)).toEqual(["hidden", "hidden", "hidden"]);

    // Leaving the Switch branch tears down the whole For.
    flushSync(() => setMode("none"));
    expect(values.at(-1)).toBe("no mode");
    dispose();
  });

  it("[NST-02] a late error in a deeply nested row is caught by the outermost boundary", () => {
    const [boom, setBoom] = useSignal<boolean>(false);
    const { values, dispose } = mount(() =>
      ErrorBoundary({
        fallback: (error: unknown) =>
          `boundary: ${error instanceof Error ? error.message : String(error)}`,
        get children() {
          return Switch({
            fallback: "none",
            children: [
              Match({
                when: true,
                children: (_value: unknown) =>
                  For({
                    each: [1],
                    children: (_item: number) =>
                      Show({
                        when: true,
                        children: (_value2: unknown) => {
                          useEffect(() => {
                            if (boom()) throw new Error("deep");
                          });
                          return "deep ok";
                        },
                      }),
                  }),
              }),
            ],
          });
        },
      }),
    );
    expect(rowsOf(values)).toEqual(["deep ok"]);
    flushSync(() => setBoom(true));
    expect(values.at(-1)).toBe("boundary: deep");
    dispose();
  });

  it("[NST-03] a Show nested in a For row is disposed when its row is removed", () => {
    const [items, setItems] = useSignal<readonly string[]>(["a", "b"]);
    let cleaned = 0;
    const { dispose } = mount(() =>
      For({
        get each() {
          return items();
        },
        children: (item: string) =>
          Show({
            when: true,
            children: (_value: unknown) => {
              onCleanup(() => {
                cleaned += 1;
              });
              return item;
            },
          }),
      }),
    );
    flushSync(() => setItems(["a"]));
    expect(cleaned).toBe(1);
    dispose();
  });

  it("[NST-04] an ErrorBoundary nested in a Show re-creates its children when the Show re-shows", () => {
    const [visible, setVisible] = useSignal<boolean>(true);
    let built = 0;
    const { values, dispose } = mount(() =>
      Show({
        get when() {
          return visible();
        },
        children: (_value: unknown) =>
          ErrorBoundary({
            fallback: "failed",
            get children() {
              built += 1;
              return "child";
            },
          }),
        fallback: "hidden",
      }),
    );
    expect(values.at(-1)).toBe("child");
    flushSync(() => setVisible(false));
    flushSync(() => setVisible(true));
    expect(built).toBe(2);
    expect(values.at(-1)).toBe("child");
    dispose();
  });

  it("[NST-05] a Switch inside a Switch selects independently at each level", () => {
    const [outer, setOuter] = useSignal<boolean>(true);
    const [inner, setInner] = useSignal<boolean>(false);
    const { values, dispose } = mount(() =>
      Switch({
        fallback: "outer none",
        children: [
          Match({
            get when() {
              return outer();
            },
            children: (_value: unknown) =>
              Switch({
                fallback: "inner none",
                children: [
                  Match({
                    get when() {
                      return inner();
                    },
                    children: "inner match",
                  }),
                ],
              }),
          }),
        ],
      }),
    );
    expect(values.at(-1)).toBe("inner none");
    flushSync(() => setInner(true));
    expect(values.at(-1)).toBe("inner match");
    flushSync(() => setOuter(false));
    expect(values.at(-1)).toBe("outer none");
    dispose();
  });
});

describe("Fragment", () => {
  it("[FRG-01] returns props.children untouched", () => {
    const children = { tag: "x" };
    expect(Fragment({ children })).toBe(children);
  });

  it("[FRG-02] reads the children getter exactly once", () => {
    let reads = 0;
    const props = {
      get children() {
        reads += 1;
        return "value";
      },
    };
    expect(Fragment(props)).toBe("value");
    expect(reads).toBe(1);
  });

  it("[FRG-03] an array of children passes through as the same array", () => {
    const children = ["a", "b"];
    expect(Fragment({ children })).toBe(children);
    expect(untrack(() => Fragment({ children: undefined }))).toBeUndefined();
  });
});
