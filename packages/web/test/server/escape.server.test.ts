import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
import { escape, ssr, ssrRaw } from "../../src/server/index";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/** Any text made of Unicode scalar values (surrogate code points are not valid text). */
const codePointText = fc
  .array(
    fc.integer({ min: 0, max: 0x10ffff }).filter((cp) => cp < 0xd800 || cp > 0xdfff),
    { maxLength: 40 },
  )
  .map((codePoints) => String.fromCodePoint(...codePoints));

/** Decodes exactly the entities the escaper produces, in one pass. */
function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (match) => ENTITIES[match] ?? match);
}

describe("escape", () => {
  it("[SSR-01] escapes the five HTML-significant characters", () => {
    expect(escape(`a<b>&"'c`)).toBe("a&lt;b&gt;&amp;&quot;&#39;c");
  });

  it("[SSR-02] numbers and bigints become plain text, special numbers included", () => {
    expect(escape(42)).toBe("42");
    expect(escape(0)).toBe("0");
    expect(escape(-0)).toBe("0");
    expect(escape(Number.NaN)).toBe("NaN");
    expect(escape(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(escape(10n)).toBe("10");
  });

  it("[SSR-03] null, undefined, booleans and the empty string render nothing", () => {
    expect(escape(null)).toBe("");
    expect(escape(undefined)).toBe("");
    expect(escape(true)).toBe("");
    expect(escape(false)).toBe("");
    expect(escape("")).toBe("");
    expect(escape([])).toBe("");
  });

  it("[SSR-04] an SsrNode passes through unchanged", () => {
    const node = ssr(["<b>", "</b>"], escape("<i>"));
    expect(escape(node)).toBe("<b>&lt;i&gt;</b>");
    expect(escape(ssrRaw("<em>x</em>"))).toBe("<em>x</em>");
  });

  it("[SSR-05] an accessor is called and its result escaped", () => {
    expect(escape(() => "x<")).toBe("x&lt;");
    expect(escape(() => null)).toBe("");
  });

  it("[SSR-06] chained accessors are followed; a self-returning accessor throws", () => {
    expect(escape(() => () => () => "deep")).toBe("deep");
    const loop = (): unknown => loop;
    expect(() => escape(loop)).toThrow(TypeError);
  });

  it("[SSR-07] nested arrays are flattened, escaped and kept in order", () => {
    expect(escape([1, [2, [3, null]], "<", () => "x", [[ssrRaw("<br>")]]])).toBe("123&lt;x<br>");
  });

  it("[SSR-08] 20,000 nested arrays render without recursion", () => {
    let nested: unknown = "x";
    for (let depth = 0; depth < 20_000; depth += 1) nested = [nested];
    expect(escape(nested)).toBe("x");
  });

  it("[SSR-09] a cyclic array throws a TypeError instead of looping", () => {
    const cyclic: unknown[] = ["a"];
    cyclic.push(cyclic);
    expect(() => escape(cyclic)).toThrow(TypeError);
  });

  it("[SSR-10] a plain object that is not an SsrNode throws in dev", () => {
    expect(() => escape({ name: "<script>" })).toThrow(TypeError);
    expect(() => escape(new Date(0))).toThrow(TypeError);
  });

  it("[SSR-11] a symbol throws a TypeError, also inside arrays", () => {
    expect(() => escape(Symbol("s"))).toThrow(TypeError);
    expect(() => escape(["ok", Symbol("s")])).toThrow(TypeError);
  });

  it("[SSR-12] a plain { t } object cannot inject raw markup", () => {
    const forged = JSON.parse('{"t":"<img src=x onerror=alert(1)>"}') as unknown;
    expect(() => escape(forged)).toThrow(TypeError);
    expect(() => escape([forged])).toThrow(TypeError);
  });

  it("[SSR-13] property: escape never leaves a raw < > \" ' or a bare &", () => {
    fc.assert(
      fc.property(codePointText, (text) => {
        const out = escape(text);
        expect(out).not.toMatch(/[<>"']/);
        expect(out.replace(/&(amp|lt|gt|quot|#39);/g, "")).not.toContain("&");
      }),
      { seed: 11, numRuns: 300 },
    );
  });

  it("[SSR-14] property: decoding the entities gives back the original string", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        expect(decode(escape(text))).toBe(text);
      }),
      { seed: 11, numRuns: 300 },
    );
  });

  it("[SSR-15] accessors inside accessors inside arrays are all resolved", () => {
    expect(escape([() => [() => "a", () => ["<", () => "b"]]])).toBe("a&lt;b");
  });

  it("[SSR-16] entity-looking text stays literal text", () => {
    expect(escape("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
    expect(escape("&#106;avascript:")).toBe("&amp;#106;avascript:");
  });

  it("[SSR-17] a large flat array escapes every item", () => {
    const items = Array.from({ length: 50_000 }, (_, index) => `<${index}>`);
    const raw = items.join("");
    const out = escape(items);
    expect(out.startsWith("&lt;0&gt;&lt;1&gt;")).toBe(true);
    // Each "<" and ">" grows into a four character entity: "&lt;" and "&gt;".
    expect(out.length).toBe(raw.length + 6 * 50_000);
  });
});
