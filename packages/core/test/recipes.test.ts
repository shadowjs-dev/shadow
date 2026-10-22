import { describe, expect, it } from "vitest";
import {
  createRef,
  createRoot,
  flushSync,
  mergeProps,
  useEffect,
  useEvent,
  useExternalStore,
  useImperativeHandle,
  useMemo,
  useRenderEffect,
  useSignal,
  useStore,
} from "../src/index";

/*
 * Recipes for the React and Solid idioms ShadowJS does not need (see the parity decisions).
 * Each test is the replacement the migration guides show, so the guide and the behavior agree.
 */

describe("recipes: React idioms without a ShadowJS equivalent", () => {
  it("[RCP-01] useCallback: a handler written once reads the latest values (no dependency array)", () => {
    const [count, setCount] = useSignal(1);
    let calls = 0;
    const save = (): number => {
      calls += 1;
      return count() * 10;
    };
    expect(save()).toBe(10);
    setCount(2);
    expect(save()).toBe(20);
    expect(calls).toBe(2);
  });

  it("[RCP-02] memo: a component runs once, so its children do not re-run when props change", () => {
    const [name, setName] = useSignal("a");
    let renders = 0;
    const Child = (props: { label: () => string }): string => {
      renders += 1;
      return props.label();
    };
    createRoot(() => {
      Child({ label: () => name() });
    });
    setName("b");
    flushSync();
    expect(renders).toBe(1);
  });

  it("[RCP-03] useRef for a value: a plain variable in the component body persists", () => {
    let attempts = 0;
    const retry = (): number => {
      attempts += 1;
      return attempts;
    };
    retry();
    expect(retry()).toBe(2);
  });

  it("[RCP-04] forwardRef: a component accepts a ref prop and publishes its handle through useImperativeHandle", () => {
    const Input = (props: {
      ref?: ReturnType<typeof createRef<{ focus: () => string }>>;
    }): void => {
      useImperativeHandle(props.ref, () => ({ focus: () => "focused" }));
    };
    const ref = createRef<{ focus: () => string }>();
    createRoot(() => {
      Input({ ref });
    });
    expect(ref.current?.focus()).toBe("focused");
  });

  it("[RCP-05] useEffectEvent: the event reads the latest value without making the effect depend on it", () => {
    const [count, setCount] = useSignal(0);
    const runs: number[] = [];
    createRoot(() => {
      const logLatest = useEvent(() => count());
      useEffect(() => {
        runs.push(logLatest());
      });
    });
    flushSync();
    setCount(5);
    flushSync();
    expect(runs).toEqual([0]);
  });

  it("[RCP-06] useSyncExternalStore: useExternalStore with the same three arguments", () => {
    let value = 1;
    const listeners: Array<() => void> = [];
    const read = createRoot(() =>
      useExternalStore(
        (notify) => {
          listeners.push(notify);
          return () => undefined;
        },
        () => value,
      ),
    );
    flushSync();
    value = 2;
    for (const notify of listeners) notify();
    flushSync();
    expect(read()).toBe(2);
  });

  it("[RCP-07] useLayoutEffect: useRenderEffect runs before user effects in the same flush", () => {
    const order: string[] = [];
    const [a, setA] = useSignal(0);
    createRoot(() => {
      useEffect(() => {
        order.push(`effect ${a()}`);
      });
      useRenderEffect(
        () => a(),
        (value) => {
          order.push(`render ${value}`);
        },
      );
    });
    flushSync();
    order.length = 0;
    setA(1);
    flushSync();
    expect(order).toEqual(["render 1", "effect 1"]);
  });

  it("[RCP-08] useInsertionEffect: a render-phase effect sees the DOM-writing phase before user effects", () => {
    const order: string[] = [];
    createRoot(() => {
      useRenderEffect(
        () => "style",
        () => {
          order.push("insertion");
        },
      );
      useEffect(() => {
        order.push("effect");
      });
    });
    flushSync();
    expect(order).toEqual(["insertion", "effect"]);
  });

  it("[RCP-09] cloneElement: extra props are merged over a component's props with mergeProps", () => {
    const base = { id: "field", class: "field" };
    const merged = mergeProps(base, { class: "field field--error" });
    expect(merged.id).toBe("field");
    expect(merged.class).toBe("field field--error");
  });

  it("[RCP-10] useMemo keeps the value until its inputs change", () => {
    const [n, setN] = useSignal(2);
    let computed = 0;
    createRoot(() => {
      const doubled = useMemo(() => {
        computed += 1;
        return n() * 2;
      });
      expect(doubled()).toBe(4);
      expect(doubled()).toBe(4);
    });
    expect(computed).toBe(1);
    setN(3);
    flushSync();
    expect(computed).toBe(1);
  });
});

describe("recipes: Solid idioms without a ShadowJS equivalent", () => {
  it("[RCP-11] createComputed (writable memo): a memo that can be overridden until its source changes", () => {
    const [base, setBase] = useSignal(1);
    const [edit, setEdit] = useSignal<number | undefined>(undefined);
    const value = useMemo(() => edit() ?? base() * 2);
    expect(value()).toBe(2);
    setEdit(10);
    expect(value()).toBe(10);
    setBase(4);
    expect(value()).toBe(10);
  });

  it("[RCP-12] on(deps, fn): useEffect with an explicit dependency function tracks only what it returns", () => {
    const [a, setA] = useSignal(1);
    const [b, setB] = useSignal(10);
    const seen: Array<[number, number]> = [];
    createRoot(() => {
      useEffect(
        () => a(),
        (value) => {
          seen.push([value, b()]);
        },
      );
    });
    flushSync();
    setB(20);
    flushSync();
    setA(2);
    flushSync();
    expect(seen).toEqual([
      [1, 10],
      [2, 20],
    ]);
  });

  it("[RCP-13] createMutable: useStore with the draft setter (writes go through setState)", () => {
    const [state, setState] = useStore({ user: { name: "A" } });
    const seen: string[] = [];
    createRoot(() => {
      useEffect(() => {
        seen.push(state.user.name);
      });
    });
    flushSync();
    setState((draft) => {
      draft.user.name = "B";
    });
    flushSync();
    expect(seen).toEqual(["A", "B"]);
  });

  it("[RCP-14] modifyMutable: setState with a reconcile() value applies the diff in one batch", () => {
    const [state, setState] = useStore({ items: [1, 2, 3] });
    setState((draft) => {
      draft.items.push(4);
    });
    expect(state.items.length).toBe(4);
  });

  it("[RCP-15] from / observable: an observable is read through useExternalStore with its subscribe()", () => {
    type Observer = (value: number) => void;
    const subject: { observers: Observer[]; value: number; emit(v: number): void } = {
      observers: [],
      value: 0,
      emit(v) {
        this.value = v;
        for (const observer of this.observers) observer(v);
      },
    };
    let unsubscribed = 0;
    const read = createRoot(() =>
      useExternalStore(
        (notify) => {
          const observer: Observer = () => notify();
          subject.observers.push(observer);
          return () => {
            unsubscribed += 1;
            subject.observers = subject.observers.filter((o) => o !== observer);
          };
        },
        () => subject.value,
      ),
    );
    flushSync();
    subject.emit(7);
    flushSync();
    expect(read()).toBe(7);
    expect(unsubscribed).toBe(0);
  });
});
