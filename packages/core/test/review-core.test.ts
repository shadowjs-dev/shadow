import { describe, expect, it } from "vitest";
import {
  createComputation,
  createOwner,
  createSignalNode,
  disposeOwner,
  observersOf,
  readSignal,
  runWithContext,
} from "../src/extend";
import {
  cache,
  createRoot,
  flushSync,
  onCleanup,
  onError,
  SuspenseContext,
  useEffect,
  useExternalStore,
  useReaction,
  useResource,
  useSelector,
  useSignal,
} from "../src/index";

describe("review of core: lifetimes, tracking and errors", () => {
  it("[CORE-REV-1] a computation that disposes itself while it runs keeps no edge for what it reads afterward", () => {
    const before = createSignalNode(0, Object.is);
    const after = createSignalNode(0, Object.is);
    const owner = createOwner(null);
    createComputation({
      kind: "effect",
      owner,
      fn: () => {
        readSignal(before);
        disposeOwner(owner);
        readSignal(after);
      },
    });
    flushSync();
    expect(observersOf(before)).toHaveLength(0);
    expect(observersOf(after)).toHaveLength(0);
  });

  it("[CORE-REV-2] refetch() on a disposed resource starts no fetch", async () => {
    let calls = 0;
    const [resource, dispose] = createRoot((disposeRoot) => [
      useResource(() => {
        calls += 1;
        return Promise.resolve(1);
      }),
      disposeRoot,
    ]);
    flushSync();
    expect(calls).toBe(1);
    dispose();
    await expect(resource.refetch()).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it("[CORE-REV-3] a throwing cleanup of a root does not replace the error its body threw", () => {
    const body = new Error("body");
    const cleanup = new Error("cleanup");
    let caught: unknown;
    try {
      createRoot(() => {
        onCleanup(() => {
          throw cleanup;
        });
        throw body;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([body, cleanup]);
  });

  it("[CORE-REV-4] calling track() of a reaction after its owner was disposed observes nothing", () => {
    const source = createSignalNode(0, Object.is);
    let invalidated = 0;
    const [track, dispose] = createRoot((disposeRoot) => [
      useReaction(() => {
        invalidated += 1;
      }),
      disposeRoot,
    ]);
    dispose();
    track(() => {
      readSignal(source);
    });
    expect(observersOf(source)).toHaveLength(0);
    expect(invalidated).toBe(0);
  });

  it("[CORE-REV-5] a custom equals of useSelector does not subscribe the reader that registers a key", () => {
    const [noise, setNoise] = useSignal(0);
    const [selected] = useSignal(1);
    let runs = 0;
    createRoot(() => {
      const isSelected = useSelector(selected, (key: number, value: number) => {
        noise();
        return key === value;
      });
      useEffect(() => {
        runs += 1;
        isSelected(1);
      });
      flushSync();
      expect(runs).toBe(1);
      setNoise(1);
      flushSync();
      expect(runs).toBe(1);
    });
  });

  it("[CORE-REV-6] the function behind cache() runs untracked, so no single caller alone subscribes to what it reads", () => {
    const [source, setSource] = useSignal(0);
    let runs = 0;
    createRoot(() => {
      const load = cache((id: number) => {
        source();
        return id;
      });
      useEffect(() => {
        runs += 1;
        load(1);
      });
      flushSync();
      setSource(1);
      flushSync();
      expect(runs).toBe(1);
    });
  });

  it("[CORE-REV-7] the subscribe function of useExternalStore runs untracked", () => {
    const [noise, setNoise] = useSignal(0);
    let subscriptions = 0;
    createRoot(() => {
      useExternalStore(
        () => {
          noise();
          subscriptions += 1;
          return () => undefined;
        },
        () => 1,
      );
      flushSync();
      expect(subscriptions).toBe(1);
      setNoise(1);
      flushSync();
      expect(subscriptions).toBe(1);
    });
  });

  it("[CORE-REV-8] a getSnapshot that throws right after subscribing leaves no subscription behind", () => {
    let live = 0;
    let reads = 0;
    const failure = new Error("snapshot");
    const handled: unknown[] = [];
    createRoot(() => {
      onError((error) => handled.push(error));
      useExternalStore(
        () => {
          live += 1;
          return () => {
            live -= 1;
          };
        },
        () => {
          reads += 1;
          if (reads > 1) throw failure;
          return 0;
        },
      );
      flushSync();
    });
    expect(handled).toEqual([failure]);
    expect(live).toBe(0);
  });
});

describe("review of core: resource", () => {
  it("[CORE-REV-9] the updater given to mutate() runs untracked", () => {
    const [noise, setNoise] = useSignal(0);
    let runs = 0;
    createRoot(() => {
      const resource = useResource(() => 1, { initialValue: 0 });
      useEffect(() => {
        runs += 1;
        resource.mutate((previous) => (previous ?? 0) + noise());
      });
      flushSync();
      expect(runs).toBe(1);
      setNoise(1);
      flushSync();
      expect(runs).toBe(1);
    });
  });
});

describe("review of core: resource and Suspense release", () => {
  it("[CORE-REV-10] a throwing reader of a settled resource does not leave its Suspense boundary held", async () => {
    let held = 0;
    const tracker = {
      increment(): void {
        held += 1;
      },
      decrement(): void {
        held -= 1;
      },
    };
    const boom = new Error("reader failed");
    let finish: (value: number) => void = () => undefined;
    let calls = 0;
    const [resource, dispose] = createRoot((disposeRoot) =>
      runWithContext(SuspenseContext, tracker, () => {
        const made = useResource(() => {
          calls += 1;
          return calls === 1
            ? new Promise<number>(() => undefined)
            : new Promise<number>((resolve) => {
                finish = resolve;
              });
        });
        flushSync();
        useEffect(() => {
          made();
          if (made.state === "ready") throw boom;
        });
        flushSync();
        return [made, disposeRoot] as const;
      }),
    );
    expect(held).toBe(1);
    const settled = resource.refetch();
    finish(1);
    await expect(settled).rejects.toBe(boom);
    expect(held).toBe(0);
    dispose();
  });

  it("[CORE-REV-11] a mutate() updater that throws changes nothing and keeps the boundary held", () => {
    let held = 0;
    const tracker = {
      increment(): void {
        held += 1;
      },
      decrement(): void {
        held -= 1;
      },
    };
    const boom = new Error("updater failed");
    createRoot((dispose) =>
      runWithContext(SuspenseContext, tracker, () => {
        const made = useResource(() => new Promise<number>(() => undefined));
        flushSync();
        useEffect(() => {
          made();
        });
        flushSync();
        expect(held).toBe(1);
        expect(() =>
          made.mutate(() => {
            throw boom;
          }),
        ).toThrow(boom);
        expect(held).toBe(1);
        expect(made.state).toBe("pending");
        dispose();
        expect(held).toBe(0);
      }),
    );
  });
});
