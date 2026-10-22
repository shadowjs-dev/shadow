import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deserialize, serialize } from "../../src/server/index";

/** Deep equality that keeps -0, NaN and object identity (shared references and cycles). */
function sameGraph(left: unknown, right: unknown): boolean {
  const pairs = new Map<object, object>();
  const stack: Array<[unknown, unknown]> = [[left, right]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [unknown, unknown];
    if (typeof a !== "object" || a === null) {
      if (!Object.is(a, b)) return false;
      continue;
    }
    if (typeof b !== "object" || b === null) return false;
    const seen = pairs.get(a);
    if (seen !== undefined) {
      if (seen !== b) return false;
      continue;
    }
    pairs.set(a, b);
    if (a instanceof Date) {
      if (!(b instanceof Date) || !Object.is(a.getTime(), b.getTime())) return false;
    } else if (a instanceof URL) {
      if (!(b instanceof URL) || a.href !== b.href) return false;
    } else if (a instanceof Map) {
      if (!(b instanceof Map) || a.size !== b.size) return false;
      const bEntries = [...b.entries()];
      [...a.entries()].forEach(([key, value], index) => {
        const other = bEntries[index];
        if (other === undefined) throw new Error("size mismatch");
        stack.push([key, other[0]], [value, other[1]]);
      });
    } else if (a instanceof Set) {
      if (!(b instanceof Set) || a.size !== b.size) return false;
      const bValues = [...b.values()];
      let position = 0;
      for (const value of a.values()) {
        stack.push([value, bValues[position]]);
        position += 1;
      }
    } else if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) stack.push([a[index], b[index]]);
    } else {
      if (Array.isArray(b) || b instanceof Map || b instanceof Set) return false;
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      for (const key of keysA) {
        if (!Object.hasOwn(b, key)) return false;
        stack.push([Reflect.get(a, key), Reflect.get(b, key)]);
      }
    }
  }
  return true;
}

/** Arbitrary JSON-like values plus the types serialize supports. */
const leaf = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.double(),
  fc.constant(Number.NaN),
  fc.constant(-0),
  fc.constant(Number.POSITIVE_INFINITY),
  fc.constant(Number.NEGATIVE_INFINITY),
  fc.string(),
  fc.bigInt(),
  fc.date(),
  fc.constant(new Date(Number.NaN)),
  fc.webUrl().map((href) => new URL(href)),
);

const value = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: "small" },
    leaf,
    fc.array(tie("node"), { maxLength: 4 }),
    fc.dictionary(
      fc.constantFrom("__proto__", "constructor", "prototype", "a", "b", "<x>", "a b"),
      tie("node"),
      {
        maxKeys: 4,
      },
    ),
    fc.array(tie("node"), { maxLength: 3 }).map((items) => new Set(items)),
    fc
      .array(fc.tuple(tie("node"), tie("node")), { maxLength: 3 })
      .map((entries) => new Map(entries)),
  ),
})).node;

describe("serialize and deserialize", () => {
  it("[SSR-110] round-trips primitives, special numbers and bigints", () => {
    for (const input of [
      undefined,
      null,
      true,
      "x",
      0,
      -0,
      1.5,
      Number.NaN,
      Infinity,
      -Infinity,
      10n,
      -(2n ** 70n),
    ]) {
      expect(sameGraph(deserialize(serialize(input)), input), String(input)).toBe(true);
    }
    expect(Object.is(deserialize(serialize(-0)), -0)).toBe(true);
  });

  it("[SSR-111] round-trips Date, invalid Date, Map, Set and URL", () => {
    const input = {
      when: new Date(1_700_000_000_000),
      bad: new Date(Number.NaN),
      map: new Map<unknown, unknown>([
        ["k", 1],
        [{ o: true }, undefined],
      ]),
      set: new Set([1, "two"]),
      url: new URL("https://example.com/a?b=1#c"),
    };
    const out = deserialize(serialize(input)) as typeof input;
    expect(out.when.getTime()).toBe(1_700_000_000_000);
    expect(Number.isNaN(out.bad.getTime())).toBe(true);
    expect([...out.map.keys()]).toEqual(["k", expect.any(Object)]);
    expect([...out.set]).toEqual([1, "two"]);
    expect(out.url.href).toBe("https://example.com/a?b=1#c");
  });

  it("[SSR-112] preserves shared references and cycles", () => {
    const shared = { n: 1 };
    const cyclic: { self?: unknown; list: unknown[] } = { list: [shared, shared] };
    cyclic.self = cyclic;
    const out = deserialize(serialize(cyclic)) as typeof cyclic;
    expect(out.self).toBe(out);
    expect(out.list[0]).toBe(out.list[1]);
  });

  it("[SSR-113] __proto__, constructor and prototype are plain data keys, never prototypes", () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"c","prototype":"p"}',
    ) as object;
    const out = deserialize(serialize(input)) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(Object.keys(out)).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Reflect.get(out, "__proto__")).toEqual({ polluted: true });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("[SSR-114] a hostile payload cannot pollute Object.prototype", () => {
    // Entry 0 has an own "__proto__" key pointing at entry 1, which carries "polluted".
    const payload =
      '{"r":{"$":"ref","i":0},"t":[{"$":"obj","e":[["__proto__",{"$":"ref","i":1}]]},{"$":"obj","e":[["polluted",true]]}]}';
    const out = deserialize(payload) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("[SSR-115] output contains no raw <, >, & or U+2028/U+2029, so it is safe inside a script tag", () => {
    const text = serialize({ s: "</script><!-- & \u2028 \u2029", t: ["<", ">", "&"] });
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(deserialize(text)).toEqual({ s: "</script><!-- & \u2028 \u2029", t: ["<", ">", "&"] });
  });

  it("[SSR-116] functions, symbols and class instances cannot be serialized", () => {
    expect(() => serialize(() => 1)).toThrow(TypeError);
    expect(() => serialize(Symbol("s"))).toThrow(TypeError);
    expect(() => serialize({ nested: [new (class Box {})()] })).toThrow(TypeError);
  });

  it("[SSR-117] a deeply nested array is serialized without recursion", () => {
    let nested: unknown = "bottom";
    for (let depth = 0; depth < 20_000; depth += 1) nested = [nested];
    const out = deserialize(serialize(nested));
    let cursor: unknown = out;
    for (let depth = 0; depth < 20_000; depth += 1) {
      expect(Array.isArray(cursor)).toBe(true);
      cursor = (cursor as unknown[])[0];
    }
    expect(cursor).toBe("bottom");
  });

  it("[SSR-118] malformed payloads throw instead of producing values", () => {
    expect(() => deserialize("not json")).toThrow(SyntaxError);
    expect(() => deserialize('{"t":[]}')).toThrow(TypeError);
    expect(() => deserialize('{"r":{"$":"ref","i":9},"t":[]}')).toThrow(TypeError);
    expect(() => deserialize('{"r":{"$":"mystery"},"t":[]}')).toThrow(TypeError);
    expect(() => deserialize('{"r":{"$":"big","v":"x"},"t":[]}')).toThrow(SyntaxError);
  });

  it("[SSR-119] property: deserialize(serialize(v)) keeps the value and its shape", () => {
    fc.assert(
      fc.property(value, (input) => {
        expect(sameGraph(deserialize(serialize(input)), input)).toBe(true);
      }),
      { seed: 11, numRuns: 300 },
    );
  });

  it("[SSR-120] property: serialized text never contains a raw <, >, & or line separator", () => {
    fc.assert(
      fc.property(value, (input) => {
        expect(serialize(input)).not.toMatch(/[<>&\u2028\u2029]/);
      }),
      { seed: 11, numRuns: 300 },
    );
  });

  it("[SER-BIN] typed arrays, DataView and ArrayBuffer round-trip", () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    const floats = new Float64Array([1.5, -0, Number.NaN]);
    const big = new BigInt64Array([-5n, 2n ** 40n]);
    const view = new DataView(new Uint8Array([1, 2, 3, 4]).buffer, 1, 2);
    const back = deserialize(
      serialize({
        bytes,
        floats,
        big,
        view,
        buffer: bytes.buffer,
        nested: [new Int16Array([-2, 7])],
      }),
    ) as Record<string, unknown>;
    expect(back["bytes"]).toEqual(bytes);
    expect(back["bytes"]).toBeInstanceOf(Uint8Array);
    expect(back["floats"]).toBeInstanceOf(Float64Array);
    expect(Object.is((back["floats"] as Float64Array)[1], -0)).toBe(true);
    expect(Number.isNaN((back["floats"] as Float64Array)[2])).toBe(true);
    expect(back["big"]).toEqual(big);
    expect(back["view"]).toBeInstanceOf(DataView);
    expect((back["view"] as DataView).byteLength).toBe(2);
    expect((back["view"] as DataView).getUint8(0)).toBe(2);
    expect(back["buffer"]).toBeInstanceOf(ArrayBuffer);
    expect((back["nested"] as Int16Array[])[0]).toEqual(new Int16Array([-2, 7]));
  });

  it("[SER-BIN2] a large buffer does not overflow the stack, and a view of a slice keeps only its bytes", () => {
    const large = new Uint8Array(3_000_000).map((_, i) => i % 251);
    const back = deserialize(serialize(large)) as Uint8Array;
    expect(back.length).toBe(large.length);
    expect(back[2_999_999]).toBe(large[2_999_999]);
    const slice = new Uint8Array(new Uint8Array([9, 8, 7, 6]).buffer, 1, 2);
    const copy = deserialize(serialize(slice)) as Uint8Array;
    expect(copy.buffer.byteLength).toBe(2);
    expect([...copy]).toEqual([8, 7]);
  });

  it("[SER-BIN3] malformed binary payloads throw TypeError, never return partial data", () => {
    const wire = (entry: object): string => JSON.stringify({ r: { $: "ref", i: 0 }, t: [entry] });
    expect(() => deserialize(wire({ $: "bin", k: "Uint8Array", v: "!!!" }))).toThrow(TypeError);
    expect(() => deserialize(wire({ $: "bin", k: "Function", v: "AA==" }))).toThrow(TypeError);
    expect(() => deserialize(wire({ $: "bin", k: "Uint16Array", v: "AA==" }))).toThrow(TypeError);
    expect(() => deserialize(wire({ $: "buf" }))).toThrow(TypeError);
  });
});
