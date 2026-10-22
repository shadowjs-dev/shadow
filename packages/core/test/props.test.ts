import fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createRoot, flushSync, onCleanup, useEffect, useSignal } from "../src/index";
import { children, mergeProps, splitProps } from "../src/props";

/** Builds a chain of `depth` nested accessors; calling the top one `depth` times yields `leaf`. */
function accessorChain(depth: number, leaf: unknown): () => unknown {
  let value: () => unknown = () => leaf;
  for (let layer = 1; layer < depth; layer += 1) {
    const inner = value;
    value = () => inner;
  }
  return value;
}

describe("mergeProps", () => {
  it("[PRP-01] the right-most source that has the key wins, evaluated per read", () => {
    const later = { a: 2 as number | undefined };
    const merged = mergeProps({ a: 1, b: 1 }, later);
    expect(merged.a).toBe(2);
    expect(merged.b).toBe(1);
    later.a = undefined;
    expect(merged.a).toBe(1);
  });

  it("[PRP-02] getters are not called at merge time and are called once per merged read", () => {
    let reads = 0;
    const source = {
      get a(): number {
        reads += 1;
        return 1;
      },
    };
    const merged = mergeProps(source);
    expect(reads).toBe(0);
    expect(merged.a).toBe(1);
    expect(reads).toBe(1);
    expect(merged.a).toBe(1);
    expect(reads).toBe(2);
  });

  it("[PRP-03] an effect reading a merged key re-runs only when the winning getter's signal changes", () => {
    const [name, setName] = useSignal("ann");
    const [unrelated, setUnrelated] = useSignal(0);
    const seen: string[] = [];
    createRoot(() => {
      const merged = mergeProps(
        {
          get name(): string {
            return name();
          },
        },
        { other: 1 },
      );
      useEffect(() => {
        seen.push(merged.name);
      });
    });
    flushSync();
    setName("bo");
    flushSync();
    setUnrelated(1);
    flushSync();
    expect(seen).toEqual(["ann", "bo"]);
    expect(unrelated()).toBe(1);
  });

  it("[PRP-04] a later plain value wins over an earlier getter that would throw", () => {
    const merged = mergeProps(
      {
        get a(): number {
          throw new Error("must not run");
        },
      },
      { a: 2 },
    );
    expect(merged.a).toBe(2);
  });

  it("[PRP-05] symbol keys are merged and listed by Object.getOwnPropertySymbols", () => {
    const tag = Symbol("tag");
    const merged = mergeProps({ [tag]: "early" }, { x: 1 });
    expect(merged[tag]).toBe("early");
    expect(Object.getOwnPropertySymbols(merged)).toEqual([tag]);
  });

  it("[PRP-06] undefined falls through while null, 0, empty string and false override", () => {
    const base = { a: "base", b: "base", c: "base", d: "base" };
    const merged = mergeProps(base, { a: undefined, b: 0, c: "", d: false });
    expect(merged.a).toBe("base");
    expect(merged.b).toBe(0);
    expect(merged.c).toBe("");
    expect(merged.d).toBe(false);
    const nulled = mergeProps({ a: "base" }, { a: null });
    expect(nulled.a).toBe(null);
  });

  it("[PRP-07] keys keep first-occurrence order; non-enumerable and inherited keys are ignored", () => {
    const hidden: object = {};
    Object.defineProperty(hidden, "secret", { value: 1, enumerable: false });
    const inherited: object = Object.create({ fromProto: 1 });
    Object.defineProperty(inherited, "own", { value: 1, enumerable: true });
    const merged = mergeProps({ b: 1, a: 1 }, { c: 1, a: 2 }, hidden, inherited);
    expect(Object.keys(merged)).toEqual(["b", "a", "c", "own"]);
  });

  it("[PRP-08] null, undefined and false sources are skipped; other primitives throw", () => {
    const merged = mergeProps(null, undefined, false, { a: 1 });
    expect(merged.a).toBe(1);
    expect(() => mergeProps({ a: 1 }, 5 as unknown as object)).toThrow(TypeError);
  });

  it("[PRP-09] function sources are called on every read and the key set is live", () => {
    const [state, setState] = useSignal<{ a: number; c?: number }>({ a: 1 });
    let calls = 0;
    const merged = mergeProps(
      () => {
        calls += 1;
        return state();
      },
      { b: 2 },
    );
    expect(calls).toBe(0);
    expect(merged.a).toBe(1);
    expect(calls).toBe(1);
    expect("c" in merged).toBe(false);
    setState({ a: 5, c: 3 });
    expect(merged.a).toBe(5);
    expect("c" in merged).toBe(true);
    expect(Object.keys(merged)).toEqual(["a", "c", "b"]);
  });

  it("[PRP-09b] an effect reading a function source's key re-runs when the source signal changes", () => {
    const [state, setState] = useSignal({ a: 1 });
    const seen: number[] = [];
    createRoot(() => {
      const merged = mergeProps(() => state(), { b: 2 });
      useEffect(() => {
        seen.push(merged.a);
      });
    });
    flushSync();
    setState({ a: 7 });
    flushSync();
    expect(seen).toEqual([1, 7]);
  });

  it("[PRP-10] a store proxy is read live on the static path; keys added later need an accessor source", () => {
    const store = new Proxy<{ a: number; b?: number }>({ a: 1 }, {});
    const staticView = mergeProps(store);
    const liveView = mergeProps(() => store);
    store.a = 5;
    expect(staticView.a).toBe(5);
    store.b = 2;
    expect("b" in staticView).toBe(false);
    expect("b" in liveView).toBe(true);
    expect(liveView.b).toBe(2);
  });

  it("[PRP-11] keys named __proto__, constructor or prototype never pollute the merged object", () => {
    const hostile = JSON.parse(
      '{"__proto__": {"polluted": true}, "constructor": "x", "a": 1}',
    ) as object;
    const merges = [mergeProps(hostile, {}), mergeProps(() => hostile, {})];
    for (const merged of merges) {
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
      expect(Object.keys(merged)).toEqual(["a"]);
      expect(Reflect.get(merged, "constructor")).toBe(Object);
    }
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("[PRP-12] property: nested and flat merges read the same values (fixed seed)", () => {
    const sourceArb = fc.record({
      a: fc.option(fc.integer(), { nil: undefined }),
      b: fc.option(fc.integer(), { nil: undefined }),
      c: fc.option(fc.integer(), { nil: undefined }),
    });
    fc.assert(
      fc.property(sourceArb, sourceArb, sourceArb, (x, y, z) => {
        const nested = mergeProps(x, mergeProps(y, z));
        const flat = mergeProps(x, y, z);
        for (const key of ["a", "b", "c"] as const) {
          expect(nested[key]).toBe(flat[key]);
        }
      }),
      { seed: 42, numRuns: 200 },
    );
  });

  it("[PRP-13] a children-style getter on the winning source is read once per merged read", () => {
    let reads = 0;
    const first = {
      get children(): string {
        reads += 1;
        return "child";
      },
    };
    const merged = mergeProps(first, { children: undefined });
    expect(merged.children).toBe("child");
    expect(reads).toBe(1);
  });
});

describe("splitProps", () => {
  it("[PRP-14] groups and rest come back in order and getters are not read at split time", () => {
    let reads = 0;
    const props = {
      get a(): number {
        reads += 1;
        return 1;
      },
      b: "b",
      c: true,
    };
    const [picked, rest] = splitProps(props, ["a"]);
    expect(reads).toBe(0);
    expect(picked.a).toBe(1);
    expect(rest.b).toBe("b");
    expect(Object.keys(rest)).toEqual(["b", "c"]);
    expect(reads).toBe(1);
  });

  it("[PRP-15] several groups; a key listed in two groups appears in both and never in the rest", () => {
    const [first, second, rest] = splitProps({ a: 1, b: 2, c: 3, d: 4 }, ["a", "b"], ["b", "c"]);
    expect(Object.keys(first)).toEqual(["a", "b"]);
    expect(Object.keys(second)).toEqual(["b", "c"]);
    expect(Object.keys(rest)).toEqual(["d"]);
  });

  it("[PRP-16] reactivity is preserved for the group and for mergeProps over the rest", () => {
    const [count, setCount] = useSignal(1);
    const [label, setLabel] = useSignal("first");
    const seen: number[] = [];
    const labels: string[] = [];
    createRoot(() => {
      const props = {
        get count(): number {
          return count();
        },
        get label(): string {
          return label();
        },
      };
      const [local, others] = splitProps(props, ["count"]);
      const forwarded = mergeProps(others, { extra: 1 });
      useEffect(() => {
        seen.push(local.count);
      });
      useEffect(() => {
        labels.push(forwarded.label);
      });
    });
    flushSync();
    setCount(2);
    flushSync();
    setLabel("second");
    flushSync();
    expect(seen).toEqual([1, 2]);
    expect(labels).toEqual(["first", "second"]);
  });

  it("[PRP-17] symbol keys appear in groups and in the rest", () => {
    const tag = Symbol("tag");
    const [picked, rest] = splitProps({ [tag]: 1, a: 2, b: 3 }, ["a"]);
    expect(Object.getOwnPropertySymbols(rest)).toEqual([tag]);
    expect(rest[tag]).toBe(1);
    expect(picked.a).toBe(2);
  });

  it("[PRP-17b] works on Proxy props as well as plain objects", () => {
    const proxied = new Proxy<{ a: number; b: number }>({ a: 1, b: 2 }, {});
    const [picked, rest] = splitProps(proxied, ["a"]);
    expect(picked.a).toBe(1);
    expect(Object.keys(rest)).toEqual(["b"]);
    expect(rest.b).toBe(2);
  });

  it("[PRP-18] a listed key missing from props exists in its group and is excluded from the rest", () => {
    const [picked, rest] = splitProps({ present: 1 } as { present: number; absent?: number }, [
      "absent",
    ]);
    expect(Object.keys(picked)).toEqual(["absent"]);
    expect(picked.absent).toBe(undefined);
    expect(Object.keys(rest)).toEqual(["present"]);
  });

  it("[PRP-19] dynamic props: the rest follows the live key set while group keys stay stable", () => {
    const [extra, setExtra] = useSignal<{ z?: number }>({});
    const props = mergeProps(() => extra(), { a: 1 });
    const [group, rest] = splitProps(props, ["a"]);
    expect(Object.keys(group)).toEqual(["a"]);
    expect(Object.keys(rest)).toEqual([]);
    setExtra({ z: 3 });
    expect(Object.keys(rest)).toEqual(["z"]);
    expect(Object.keys(group)).toEqual(["a"]);
    expect(rest.z).toBe(3);
  });

  it("[PRP-20] prototype pollution: listing or splitting a __proto__ key changes no prototype", () => {
    const bag = JSON.parse('{"__proto__": {"polluted": true}, "a": 1, "b": 2}') as Record<
      string,
      number
    >;
    const [picked, rest] = splitProps(bag, ["__proto__", "a"]);
    expect(Object.getPrototypeOf(rest)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(picked)).toBe(Object.prototype);
    expect(Object.keys(rest)).toEqual(["b"]);
    expect(Object.keys(picked)).toEqual(["a"]);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("[PRP-21] frozen props with a throwing getter split fine; the throw happens only on read", () => {
    const props = Object.freeze({
      get bad(): number {
        throw new Error("boom");
      },
      ok: 1,
    });
    const [picked, rest] = splitProps(props, ["bad"]);
    expect(rest.ok).toBe(1);
    expect(() => picked.bad).toThrow("boom");
  });

  it("[PRP-21b] zero key lists return only the rest, holding every key", () => {
    const [rest] = splitProps({ a: 1, b: 2 });
    expect(Object.keys(rest)).toEqual(["a", "b"]);
  });
});

describe("prop types", () => {
  it("[TYPPRP-01] later keys override earlier keys; undefined-able later keys keep the earlier type", () => {
    const merged = mergeProps({ a: 1, b: "x" }, { b: 2 as number | undefined });
    expectTypeOf(merged.a).toEqualTypeOf<number>();
    expectTypeOf(merged.b).toEqualTypeOf<string | number>();
  });

  it("[TYPPRP-04] function sources contribute their resolved object type; null and false contribute nothing", () => {
    const merged = mergeProps(() => ({ a: 1 }), null, false, { b: "x" });
    expectTypeOf(merged.a).toEqualTypeOf<number>();
    expectTypeOf(merged.b).toEqualTypeOf<string>();
  });

  it("[TYPPRP-06] splitProps returns the picked group and the omitted rest", () => {
    const [picked, rest] = splitProps({ a: 1, b: "x" }, ["a"]);
    expectTypeOf(picked).toEqualTypeOf<{ a: number }>();
    expectTypeOf(rest).toEqualTypeOf<{ b: string }>();
  });

  it("[TYPPRP-08] a key that is not in the props type is a type error", () => {
    // @ts-expect-error "zzz" is not a key of { a: number }
    splitProps({ a: 1 }, ["zzz"]);
  });
});

describe("children", () => {
  it("[CHD-01] nested arrays and accessors resolve to leaves in order", () => {
    const resolved = children(() => [1, () => [2, [() => 3]], [4]]);
    expect(resolved.toArray()).toEqual([1, 2, 3, 4]);
  });

  it("[CHD-01b] a 10,000-deep nested array flattens without overflowing the stack", () => {
    let deep: unknown = "leaf";
    for (let level = 0; level < 10_000; level += 1) deep = [deep];
    const resolved = children(() => deep);
    expect(resolved.toArray()).toEqual(["leaf"]);
    expect(resolved()).toBe("leaf");
  });

  it("[CHD-02] memoized: the children getter is read once however often the result is read", () => {
    let reads = 0;
    const props = {
      get children(): number[] {
        reads += 1;
        return [1, 2];
      },
    };
    const resolved = children(() => props.children);
    expect(resolved.toArray()).toEqual([1, 2]);
    expect(resolved.toArray()).toEqual([1, 2]);
    expect(resolved()).toEqual([1, 2]);
    expect(reads).toBe(1);
  });

  it("[CHD-03] reactive: an effect reading the children re-runs when a nested signal changes", () => {
    const [value, setValue] = useSignal(1);
    const seen: unknown[][] = [];
    createRoot(() => {
      const resolved = children(() => [value(), 2]);
      useEffect(() => {
        seen.push(resolved.toArray());
      });
    });
    flushSync();
    setValue(5);
    flushSync();
    expect(seen).toEqual([
      [1, 2],
      [5, 2],
    ]);
  });

  it("[CHD-04] ownership: effects created by the children getter are disposed on re-run and on owner disposal", () => {
    const [value, setValue] = useSignal(0);
    let created = 0;
    let disposed = 0;
    let dispose: () => void = () => undefined;
    createRoot((disposeRoot) => {
      dispose = disposeRoot;
      const resolved = children(() => {
        const current = value();
        created += 1;
        onCleanup(() => {
          disposed += 1;
        });
        return current;
      });
      useEffect(() => {
        resolved();
      });
    });
    flushSync();
    setValue(1);
    flushSync();
    expect(created).toBe(2);
    expect(disposed).toBe(1);
    dispose();
    expect(disposed).toBe(2);
  });

  it("[CHD-05] toArray drops null, undefined and booleans, keeps 0 and empty strings", () => {
    const resolved = children(() => [null, undefined, true, false, 0, "", "a"]);
    expect(resolved.toArray()).toEqual([0, "", "a"]);
  });

  it("[CHD-06] only typeof function is an accessor; objects are leaves and function names are ignored", () => {
    class Box {
      readonly value = 1;
    }
    const box = new Box();
    const Component = (): string => "rendered";
    expect(children(() => [box]).toArray()).toEqual([box]);
    expect(children(() => Component).toArray()).toEqual(["rendered"]);
  });

  it("[CHD-07] [DIAG3-15] a function child that returns itself throws a TypeError instead of hanging", () => {
    const loop: () => unknown = () => loop;
    const resolved = children(loop);
    expect(() => resolved.toArray()).toThrow(TypeError);
  });

  it("[CHD-07b] 1,000 nested accessors resolve; 1,001 throw a TypeError", () => {
    expect(children(accessorChain(1000, "x")).toArray()).toEqual(["x"]);
    const tooDeep = children(accessorChain(1001, "x"));
    expect(() => tooDeep.toArray()).toThrow(TypeError);
  });

  it("[CHD-07c] an array that contains itself throws a TypeError instead of growing forever", () => {
    const cyclic: unknown[] = [1];
    cyclic.push(cyclic);
    const resolved = children(() => cyclic);
    expect(() => resolved.toArray()).toThrow(TypeError);
  });

  it("[CHD-08] an error thrown by a nested accessor is rethrown to every reader until a dependency changes", () => {
    const [value, setValue] = useSignal(0);
    const resolved = children(() => {
      const current = value();
      if (current === 0) throw new Error("not yet");
      return current;
    });
    expect(() => resolved()).toThrow("not yet");
    expect(() => resolved.toArray()).toThrow("not yet");
    setValue(3);
    expect(resolved()).toBe(3);
    expect(resolved.toArray()).toEqual([3]);
  });

  it("[TYPCHD-01] toArray always returns an array of unknown leaves", () => {
    const resolved = children(() => [1, "two"]);
    expectTypeOf(resolved.toArray()).toEqualTypeOf<unknown[]>();
  });
});
