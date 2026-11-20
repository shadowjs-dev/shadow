import { describe, expect, it } from "vitest";
import { runWithContext } from "../src/extend";
import {
  createRoot,
  flushSync,
  type MergeSource,
  mergeProps,
  SuspenseContext,
  useEffect,
  useResource,
  useSignal,
  useStore,
} from "../src/index";

/** One macrotask: the transition lane is scheduled with a timer, so awaiting a timer lets it run. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("review 1.2.0: resources", () => {
  it("[CORE-G01] a source that turns empty after a failed load clears the error with the state", async () => {
    let setId: (next: number | null) => void = () => undefined;
    let state = "";
    let error: unknown;
    const dispose = createRoot((end) => {
      const [id, writeId] = useSignal<number | null>(1);
      setId = writeId;
      const user = useResource(id, async (): Promise<string> => {
        throw new Error("load failed");
      });
      useEffect(() => {
        state = user.state;
        error = user.error;
      });
      return end;
    });
    await tick();
    flushSync();
    expect(state).toBe("errored");
    expect(error).toBeInstanceOf(Error);

    setId(null);
    flushSync();
    expect(state).toBe("unresolved");
    expect(error).toBeUndefined();
    dispose();
  });
});

describe("review 1.2.0: stores", () => {
  it("[CORE-G02] the descriptor of a sealed object's property carries the store view, not the raw object", () => {
    const inner = { count: 1 };
    const [store] = useStore({ sealed: Object.seal({ inner }) });
    const viaGet = store.sealed.inner;
    const viaDescriptor = Object.getOwnPropertyDescriptor(store.sealed, "inner")?.value;
    expect(viaGet).not.toBe(inner);
    expect(viaDescriptor).toBe(viaGet);
  });

  it("[CORE-G02b] a frozen object's property still reports its own value (a proxy must not lie about it)", () => {
    const inner = { count: 1 };
    const [store] = useStore({ frozen: Object.freeze({ inner }) });
    expect(Object.getOwnPropertyDescriptor(store.frozen, "inner")?.value).toBe(inner);
    expect(store.frozen.inner).toBe(inner);
  });

  it("[CORE-G11] an async update function is refused with a message that names the mistake", () => {
    const [store, setStore] = useStore({ count: 0, name: "a" });
    let thrown: unknown;
    let late: Promise<void> | undefined;
    try {
      // The cast stands for JavaScript callers and loosely typed code: the types refuse a promise.
      (setStore as (update: (draft: { count: number; name: string }) => unknown) => void)(
        (draft) => {
          draft.count = 1;
          late = Promise.resolve().then(() => {
            draft.name = "b";
          });
          return late;
        },
      );
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toContain("returned a promise");
    // What ran before the first `await` was written in place; nothing after it can be.
    expect(store.count).toBe(1);
    expect(late).toBeInstanceOf(Promise);
    return expect(late).rejects.toThrow(/draft was used after/);
  });
});

describe("review 1.2.0: mergeProps", () => {
  it("[CORE-G10] a source function that returns 0, an empty string or NaN is skipped, as an object spread skips it", () => {
    const [count, setCount] = useSignal(0);
    const extra = { title: "shown" };
    const merged = mergeProps({ id: "a" }, () => count() && extra) as {
      id: string;
      title?: string;
    };
    expect(merged.title).toBeUndefined();
    expect(Object.keys(merged)).toEqual(["id"]);
    setCount(2);
    expect(merged.title).toBe("shown");

    // Typed as a source on purpose: `Number.NaN` and `0n` have no literal type that says "nothing".
    const nothing = (value: unknown) => (): MergeSource => value as MergeSource;
    const empty = mergeProps(nothing(""), nothing(Number.NaN), nothing(0n), nothing(-0), {
      id: "b",
    }) as { id: string };
    expect(Object.keys(empty)).toEqual(["id"]);
  });

  it("[CORE-G10b] a source function that returns a non-empty string or a number other than 0 is still an error", () => {
    const source = (value: unknown) => (): MergeSource => value as MergeSource;
    const text = mergeProps({ id: "a" }, source("text")) as { id: string };
    expect(() => text.id).toThrow(TypeError);
    const number = mergeProps({ id: "a" }, source(3)) as { id: string };
    expect(() => number.id).toThrow(TypeError);
  });
});

describe("review 1.2.0: the boundaries a pending resource holds", () => {
  /** A tracker that counts, as a Suspense boundary does. */
  function boundary(): { tracker: { increment(): void; decrement(): void }; held: () => number } {
    let held = 0;
    return {
      tracker: {
        increment: () => {
          held += 1;
        },
        decrement: () => {
          held -= 1;
        },
      },
      held: () => held,
    };
  }

  it("[CORE-G12] a boundary is given back one microtask after its last reader was disposed, not when a reader only runs again", async () => {
    const { tracker, held } = boundary();
    let rerun: (next: number) => void = () => undefined;
    let dropReader: () => void = () => undefined;
    const dispose = createRoot((end) => {
      const never = useResource(() => new Promise<string>(() => undefined));
      runWithContext(SuspenseContext, tracker, () => {
        dropReader = createRoot((endReader) => {
          const [tick, setTick] = useSignal(0);
          rerun = setTick;
          useEffect(() => {
            tick();
            never();
          });
          return endReader;
        });
      });
      return end;
    });
    flushSync();
    expect(held()).toBe(1);

    rerun(1);
    flushSync();
    await Promise.resolve();
    // The reader ran again and read again: the boundary was never let go.
    expect(held()).toBe(1);

    dropReader();
    expect(held()).toBe(1);
    await Promise.resolve();
    expect(held()).toBe(0);
    dispose();
  });

  it("[CORE-G12b] a read with no owner holds its boundary until the load settles, and disposing the resource gives every boundary back", () => {
    const { tracker, held } = boundary();
    let read: () => unknown = () => undefined;
    const dispose = createRoot((end) => {
      const never = useResource(() => new Promise<string>(() => undefined));
      read = () => runWithContext(SuspenseContext, tracker, () => never());
      return end;
    });
    flushSync();
    // `runWithContext` gives the read an owner of its own (a scope nobody disposes before the root).
    read();
    read();
    expect(held()).toBe(1);
    dispose();
    expect(held()).toBe(0);
  });
});
