import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import fc from "fast-check";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import { describe, expect, it } from "vitest";
import {
  composeToSource,
  decodeMappings,
  encodeMappings,
  type Segment,
} from "../src/internal/source-maps";
import { type ShadowMdxOptions, shadowMdx } from "../src/mdx";

/**
 * The source map the MDX plugin returns maps the final code to the `.mdx` file, not to the JSX that
 * `@mdx-js/mdx` wrote in between.
 */

const PAGE = new URL("./fixture-mdx/page.mdx", import.meta.url).pathname;
const SOURCE = readFileSync(PAGE, "utf8");

interface Hook {
  transform(
    this: { error(message: string): never; warn(message: string): void },
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ): Promise<{ code: string; map: unknown } | null>;
}

async function transform(
  options: ShadowMdxOptions = {},
  ssr = false,
  text = SOURCE,
  id = PAGE,
): Promise<{ code: string; map: SourceMap | null }> {
  const plugin = shadowMdx({
    remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
    ...options,
  }) as unknown as Hook;
  const result = await plugin.transform.call(
    {
      error: (message) => {
        throw new Error(message);
      },
      warn: () => undefined,
    },
    text,
    id,
    { ssr },
  );
  if (result === null) throw new Error("the plugin skipped the MDX file");
  return {
    code: result.code,
    map: new SourceMap(result.map as ConstructorParameters<typeof SourceMap>[0]),
  };
}

/** 0-based line and column of the first `needle` in `text`. */
function place(text: string, needle: string): { line: number; column: number } {
  const at = text.indexOf(needle);
  if (at === -1) throw new Error(`"${needle}" is not in the text`);
  const before = text.slice(0, at).split("\n");
  return { line: before.length - 1, column: (before.at(-1) ?? "").length };
}

/** The 0-based line of the MDX file that the position of the code maps to. */
function originalLine(map: SourceMap, at: { line: number; column: number }): number {
  const entry = map.findEntry(at.line, at.column);
  if (!("originalLine" in entry)) throw new Error("the position has no mapping");
  return entry.originalLine;
}

describe("[VITE-MDX-MAP-1] the map points at the .mdx file", () => {
  for (const ssr of [false, true]) {
    it(`${ssr ? "server" : "browser"}: a known token of the code maps to its line of the MDX file`, async () => {
      const { code, map } = await transform({}, ssr);
      if (map === null) throw new Error("no map");
      // The import is on line 6 and the export on line 21 of the file; both are copied code.
      const cases: Array<[string, string]> = [
        ['"./note";', '"./note"'],
        ["words: 12", "words: 12"],
        ["meta = {", "meta = {"],
      ];
      for (const [inCode, inFile] of cases) {
        expect(originalLine(map, place(code, inCode)), inCode).toBe(place(SOURCE, inFile).line);
      }
    });
  }

  it("the sources are the MDX file and its text, not the JSX in between", async () => {
    const { map } = await transform();
    const payload = map?.payload;
    expect(payload?.sources).toHaveLength(1);
    expect(payload?.sources[0]).toMatch(/page\.mdx$/);
    expect(payload?.sourcesContent?.[0]).toBe(SOURCE);
  });

  it("no mapping leaves the MDX file: every one is a line and a column of its text", async () => {
    const { map } = await transform();
    const lines = SOURCE.split("\n");
    const decoded = decodeMappings(map?.payload.mappings ?? "");
    let mapped = 0;
    for (const line of decoded) {
      for (const segment of line) {
        if (segment.length === 1) continue;
        mapped += 1;
        expect(segment[1]).toBe(0);
        expect(segment[2]).toBeLessThan(lines.length);
        expect(segment[3]).toBeLessThanOrEqual((lines[segment[2]] ?? "").length);
      }
    }
    expect(mapped).toBeGreaterThan(0);
  });

  it("a module without JSX to compile keeps the map of the mdx function, pointing at the file", async () => {
    const text = "export const answer = 42;\n\nexport const other = answer + 1;\n";
    const mdx = async (): Promise<{ value: string; map: unknown }> => ({
      value: "export const other = 43;\n",
      // `other` of the output is at column 13 and was written on the third line, column 13.
      map: {
        version: 3,
        sources: ["page.mdx"],
        names: [],
        mappings: encodeMappings([[[13, 0, 2, 13]]]),
      },
    });
    const { code, map } = await transform({ mdx }, false, text);
    expect(code).toBe("export const other = 43;\n");
    if (map === null) throw new Error("no map");
    expect(map.payload.sources[0]).toMatch(/page\.mdx$/);
    expect(map.payload.sourcesContent?.[0]).toBe(text);
    expect(originalLine(map, place(code, "other"))).toBe(2);
  });

  it("an mdx function that answers no map leaves the map of the compiler as it was", async () => {
    const mdx = async (): Promise<{ value: string }> => ({
      value: "export const view = () => <p>{1 + Math.random()}</p>;\n",
    });
    const { map } = await transform({ mdx });
    expect(map?.payload.sources[0]).toMatch(/page\.mdx\.tsx$/);
  });
});

describe("[VITE-MDX-MAP-2] the map helpers", () => {
  const segment = fc.oneof(
    fc.tuple(fc.nat(500)).map((t): Segment => [t[0]]),
    fc
      .tuple(fc.nat(500), fc.nat(3), fc.nat(5000), fc.nat(500))
      .map((t): Segment => [t[0], t[1], t[2], t[3]]),
    fc
      .tuple(fc.nat(500), fc.nat(3), fc.nat(5000), fc.nat(500), fc.nat(40))
      .map((t): Segment => [t[0], t[1], t[2], t[3], t[4]]),
  );
  const lines = fc.array(
    fc.array(segment, { maxLength: 8 }).map((list) => [...list].sort((a, b) => a[0] - b[0])),
    { maxLength: 10 },
  );

  it("decoding what was encoded gives the segments back", () => {
    fc.assert(
      fc.property(lines, (input) => {
        const decoded = decodeMappings(encodeMappings(input));
        // No line at all and one empty line are the same string.
        expect(decoded).toEqual(input.length === 0 ? [[]] : input);
      }),
      { seed: 20261111, numRuns: 300 },
    );
  });

  it("decoding agrees with the reader of Node.js", () => {
    const mappings = encodeMappings([
      [
        [0, 0, 0, 0],
        [12, 0, 0, 7, 0],
      ],
      [],
      [
        [3, 0, 4, 2],
        [300, 0, 4, 1000, 1],
        [301, 0, 2, 5],
      ],
    ]);
    const map = new SourceMap({
      version: 3,
      file: "a.js",
      sources: ["a"],
      sourcesContent: [""],
      sourceRoot: "",
      names: ["x", "y"],
      mappings,
    });
    expect(map.findEntry(2, 300)).toMatchObject({
      originalLine: 4,
      originalColumn: 1000,
      name: "y",
    });
    expect(map.findEntry(0, 13)).toMatchObject({ originalLine: 0, originalColumn: 7, name: "x" });
  });

  it("malformed mappings are refused with a SyntaxError", () => {
    expect(() => decodeMappings("A!")).toThrow(SyntaxError);
    expect(() => decodeMappings("g")).toThrow(SyntaxError);
    expect(() => decodeMappings("AA")).toThrow(SyntaxError);
  });

  it("compose follows the last segment at or before the column and drops what the inner map misses", () => {
    const outer = {
      mappings: encodeMappings([
        [
          [0, 0, 0, 4],
          [10, 0, 0, 20, 0],
          [30, 0, 1, 0],
        ],
      ]),
      names: ["outerName"],
    };
    const inner = {
      mappings: encodeMappings([
        [
          [2, 0, 9, 1],
          [8, 0, 9, 6, 0],
        ],
        [[0, 0, 3, 3]],
      ]),
      names: ["innerName"],
    };
    const composed = composeToSource(outer, inner, "a.mdx", "text", "out.js");
    expect(composed).toMatchObject({
      sources: ["a.mdx"],
      sourcesContent: ["text"],
      file: "out.js",
    });
    // Column 0 maps (outer 0,4 -> inner segment at 2? no: 4 is after 2), column 10 and 30 follow the inner lines.
    expect(decodeMappings(composed.mappings)).toEqual([
      [
        [0, 0, 9, 1],
        [10, 0, 9, 6, 0],
        [30, 0, 3, 3],
      ],
    ]);
    expect(composed.names).toEqual(["innerName"]);
  });
});
