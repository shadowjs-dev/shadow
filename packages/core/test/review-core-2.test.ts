import { describe, expect, it } from "vitest";
import {
  beginHold,
  createSignalNode,
  endHold,
  registerTransitionLane,
  writeSignal,
} from "../src/extend";
import {
  createRoot,
  flushSync,
  mergeProps,
  startTransition,
  useEffect,
  useMemo,
  useSignal,
  useStore,
} from "../src/index";
import { rt } from "../src/internal/state";
import { unwrap } from "../src/store/index";
import { NODES } from "../src/store/nodes";

describe("review of core, round two: store signals", () => {
  it("[CORE-R2-1] reading many transient keys does not keep one signal per key for the life of the store", () => {
    const [store, setStore] = useStore<{ byId: Record<string, number> }>({ byId: {} });
    const raw = unwrap(store.byId);
    // Observed keys must survive every sweep: they are the ones whose writes must still notify.
    const seen: number[] = [];
    const disposers: Array<() => void> = [];
    for (let id = 0; id < 300; id += 1) {
      disposers.push(
        createRoot((dispose) => {
          useEffect(() => {
            seen.push(store.byId[`live${id}`] ?? -1);
          });
          return dispose;
        }),
      );
    }
    flushSync();
    // Churn: each transient id is read by an effect that is disposed right away.
    for (let id = 0; id < 5000; id += 1) {
      createRoot((dispose) => {
        useEffect(() => {
          void store.byId[`transient${id}`];
        });
        flushSync();
        dispose();
      });
    }
    const size = NODES.get(raw)?.signals?.size ?? 0;
    // 300 observed keys plus at most the headroom of the sweep, far below the 5300 keys read.
    expect(size).toBeLessThan(1500);
    // A key read again after its signal was released sees the current value and stays reactive.
    const rereadKey = "transient7";
    setStore("byId", rereadKey, 7);
    let reread = -1;
    let rereadRuns = 0;
    createRoot(() => {
      useEffect(() => {
        rereadRuns += 1;
        reread = store.byId[rereadKey] ?? -1;
      });
    });
    flushSync();
    expect(reread).toBe(7);
    setStore("byId", rereadKey, 8);
    flushSync();
    expect(reread).toBe(8);
    expect(rereadRuns).toBe(2);
    // Every observed key still reacts after the sweeps.
    seen.length = 0;
    for (let id = 0; id < 300; id += 1) setStore("byId", `live${id}`, id);
    flushSync();
    expect(seen).toHaveLength(300);
    for (const dispose of disposers) dispose();
  });
});

describe("review of core, round two: transitions", () => {
  it("[CORE-R2-2] transitions started while a hold is engaged share one waiter, and all resolve when it ends", async () => {
    registerTransitionLane();
    beginHold();
    const applied: Array<Promise<void>> = [];
    for (let call = 0; call < 20000; call += 1) applied.push(startTransition(() => undefined));
    // One shared promise: the number of waiters does not grow with the number of calls.
    expect(new Set(applied).size).toBe(1);
    endHold();
    await Promise.all(applied);
    // A transition after the lane went idle gets a fresh, already settled promise.
    const next = startTransition(() => undefined);
    expect(next).not.toBe(applied[0]);
    await next;
  });
});

describe("review of core, round two: user equals runs untracked", () => {
  it("[CORE-R2-3] a custom memo equals does not subscribe the reader that pulled the memo", () => {
    const [noise, setNoise] = useSignal(0);
    const [source, setSource] = useSignal(1);
    const [other, setOther] = useSignal(0);
    let runs = 0;
    createRoot(() => {
      const doubled = useMemo(() => source() * 2, {
        equals: (a, b) => {
          noise();
          return a === b;
        },
      });
      useEffect(() => {
        runs += 1;
        other();
        doubled();
      });
      flushSync();
      // The effect is dirty itself, so it pulls the stale memo from inside its own run: the memo's
      // equals runs while the effect is the current listener.
      setSource(2);
      setOther(1);
      flushSync();
      expect(runs).toBe(2);
      setNoise(1);
      flushSync();
      expect(runs).toBe(2);
    });
  });

  it("[CORE-R2-3] a custom signal equals does not subscribe the computation that writes", () => {
    const [noise, setNoise] = useSignal(0);
    const node = createSignalNode<number>(0, (a, b) => {
      noise();
      return a === b;
    });
    let runs = 0;
    createRoot(() => {
      useEffect(() => {
        runs += 1;
        writeSignal(node, 1);
      });
      flushSync();
      expect(runs).toBe(1);
      setNoise(1);
      flushSync();
      expect(runs).toBe(1);
    });
  });

  it("[CORE-R2-3] a memo whose equals throws still restores the tracking context", () => {
    const [source, setSource] = useSignal(0);
    createRoot(() => {
      const value = useMemo(() => source(), {
        equals: () => {
          throw new Error("boom");
        },
      });
      useEffect(() => {
        value();
      });
      flushSync();
      setSource(1);
      expect(() => flushSync()).toThrow("boom");
      expect(rt.listener).toBeNull();
    });
  });
});

describe("review of core, round two: props reads", () => {
  it("[CORE-R2-4] a getter that throws mid-read leaves no stale key set for the next read", () => {
    const [wide, setWide] = useSignal(false);
    let explode = true;
    const props = mergeProps(() =>
      wide()
        ? { a: 1, b: 2 }
        : {
            get a(): number {
              if (explode) throw new Error("getter");
              return 1;
            },
          },
    );
    expect(() => props.a).toThrow("getter");
    explode = false;
    // The view cached its key set during the read that threw; the cache must be gone by now, or this
    // read would still see the narrow key set computed before the signal changed.
    setWide(true);
    expect(Object.keys(props)).toEqual(["a", "b"]);
    expect("b" in props).toBe(true);
    expect(props.a).toBe(1);
  });
});
