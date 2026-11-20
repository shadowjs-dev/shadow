import { describe, expect, it } from "vitest";
import {
  createSignalNode,
  readSignal,
  registerLoading,
  runWithContext,
  writeSignal,
} from "../src/extend";
import {
  createRoot,
  flushSync,
  isPending,
  SuspenseContext,
  useEffect,
  useMemo,
  useResource,
  useSignal,
} from "../src/index";

/** A promise with its resolver, so a test decides when a load ends. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets the promise callbacks of a settled load run, then the effects they woke. */
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

describe("isPending", () => {
  it("[PND-1] is true while a resource the expression reads loads, and the reader runs again when the load ends", async () => {
    const load = deferred<string>();
    const seen: boolean[] = [];
    const dispose = createRoot((end) => {
      const user = useResource(() => load.promise);
      useEffect(() => {
        seen.push(isPending(user));
      });
      return end;
    });
    flushSync();
    expect(seen).toEqual([true]);
    load.resolve("Ada");
    await settled();
    expect(seen).toEqual([true, false]);
    dispose();
  });

  it("[PND-2] sees a resource through memos, and a reload of data that is already shown", async () => {
    const loads = [deferred<number[]>(), deferred<number[]>()];
    let calls = 0;
    const seen: Array<[boolean, number | undefined]> = [];
    let reload: () => unknown = () => undefined;
    const dispose = createRoot((end) => {
      const list = useResource(() => (loads[calls++] as { promise: Promise<number[]> }).promise);
      reload = () => list.refetch();
      const even = useMemo(() => (list.latest ?? []).filter((n) => n % 2 === 0));
      const count = useMemo(() => even().length);
      useEffect(() => {
        seen.push([isPending(count), count()]);
      });
      return end;
    });
    flushSync();
    expect(seen).toEqual([[true, 0]]);
    (loads[0] as { resolve: (value: number[]) => void }).resolve([1, 2, 4]);
    await settled();
    expect(seen.at(-1)).toEqual([false, 2]);

    reload();
    flushSync();
    // Reloading: the count on screen is still the old one, and it is marked pending.
    expect(seen.at(-1)).toEqual([true, 2]);
    (loads[1] as { resolve: (value: number[]) => void }).resolve([2]);
    await settled();
    expect(seen.at(-1)).toEqual([false, 1]);
    dispose();
  });

  it("[PND-3] a pending resource read inside the expression holds no Suspense boundary", () => {
    let held = 0;
    const tracker = {
      increment: () => {
        held += 1;
      },
      decrement: () => {
        held -= 1;
      },
    };
    let answer = false;
    const dispose = createRoot((end) => {
      runWithContext(SuspenseContext, tracker, () => {
        const user = useResource(() => new Promise<string>(() => undefined));
        answer = isPending(() => user());
      });
      return end;
    });
    expect(answer).toBe(true);
    expect(held).toBe(0);
    dispose();
  });

  it("[PND-4] the reader runs again when the expression comes to read another resource", async () => {
    const slow = deferred<string>();
    const seen: boolean[] = [];
    let pick: (next: "a" | "b") => void = () => undefined;
    const dispose = createRoot((end) => {
      const a = useResource(() => "ready at once");
      const b = useResource(() => slow.promise);
      const [which, setWhich] = useSignal<"a" | "b">("a");
      pick = setWhich;
      useEffect(() => {
        seen.push(isPending(() => (which() === "a" ? a() : b())));
      });
      return end;
    });
    flushSync();
    expect(seen).toEqual([false]);
    pick("b");
    flushSync();
    expect(seen).toEqual([false, true]);
    slow.resolve("done");
    await settled();
    expect(seen).toEqual([false, true, false]);
    dispose();
  });

  it("[PND-5] an expression that throws does not throw here: the answer covers what it read first", () => {
    let answer: boolean | undefined;
    const dispose = createRoot((end) => {
      const user = useResource(() => new Promise<string>(() => undefined));
      answer = isPending(() => {
        user();
        throw new Error("after the read");
      });
      return end;
    });
    expect(answer).toBe(true);
    expect(isPending(() => 1)).toBe(false);
    dispose();
  });

  it("[PND-6] a source registered with registerLoading counts, so a custom data primitive is seen too", () => {
    const seen: boolean[] = [];
    const feed = createSignalNode<string | undefined>(undefined, Object.is);
    let setWaiting: (next: boolean) => void = () => undefined;
    const dispose = createRoot((end) => {
      const [waiting, writeWaiting] = useSignal(true);
      setWaiting = writeWaiting;
      registerLoading(feed, waiting);
      useEffect(() => {
        seen.push(isPending(() => readSignal(feed)));
      });
      return end;
    });
    flushSync();
    writeSignal(feed, "first");
    setWaiting(false);
    flushSync();
    expect(seen).toEqual([true, false]);
    dispose();
  });

  it("[PND-7] the walk is bounded: a resource behind more than 10,000 memos is not reached, and nothing overflows", () => {
    let answer: boolean | undefined;
    let near: boolean | undefined;
    const dispose = createRoot((end) => {
      const user = useResource(() => new Promise<string>(() => undefined));
      let chain: () => unknown = () => user.latest;
      for (let i = 0; i < 50; i += 1) {
        const previous = chain;
        chain = useMemo(() => previous());
      }
      near = isPending(chain);
      for (let i = 0; i < 10_050; i += 1) {
        const previous = chain;
        chain = useMemo(() => previous());
      }
      answer = isPending(chain);
      return end;
    });
    expect(near).toBe(true);
    expect(answer).toBe(false);
    dispose();
  });
});
