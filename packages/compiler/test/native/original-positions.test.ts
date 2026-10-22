import { SourceMap } from "node:module";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/index";
import { CompileError } from "../../src/javascript";
import type { Backend, RawOptions, RawOutput } from "../../src/native/backend";
import { backendOf, native, wasm } from "./support/backends";

/**
 * The `useStore` pass and the derived-constant pass rewrite the module before the JSX is compiled.
 * Every position the compiler reports, in an error or in the source map, is a position of the module
 * as it was written, in the addon and in the WebAssembly build alike.
 */

const BAD = "<p><div/></p>";
const STORE_IMPORT = 'import { useStore } from "@shadow-js/core";';

const CELL_SOURCE = [
  STORE_IMPORT,
  "const [n] = useStore(0);",
  "export const keep = n;",
  `export const view = ${BAD};`,
  "",
].join("\n");

const DERIVE_SOURCE = [
  'import { useSignal } from "@shadow-js/core";',
  "export function C() {",
  "  const [n] = useSignal(0);",
  `  const label = n() > 1 ? ["\u{1F600}", ${BAD}] : null;`,
  "  return <section>{label}</section>;",
  "}",
  "",
].join("\n");

const PROPS_SOURCE = [
  `export function C({ icon = <b>x</b>, note = ${BAD} }) {`,
  "  return <section>{icon}{note}</section>;",
  "}",
  "",
].join("\n");

const MAP_SOURCE = [
  '"use client";',
  STORE_IMPORT,
  'export function C({ title = "t" }) {',
  "  const [n] = useStore(0);",
  "  const double = n() * 2;",
  "  return <section class={title}>{double}</section>;",
  "}",
  "export const after = <p>{1 + 1}</p>;",
  "",
].join("\n");

const options = (extra: Partial<RawOptions> = {}): RawOptions => ({
  filename: "view.tsx",
  generate: "dom",
  dev: false,
  autoReactive: true,
  hmr: false,
  hydratable: true,
  sourceMap: true,
  ...extra,
});

/** 1-based line and 0-based column of an offset. */
function place(text: string, offset: number): { line: number; column: number } {
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length, column: (lines[lines.length - 1] ?? "").length };
}

function expectedError(source: string): Record<string, unknown> {
  const start = source.indexOf(BAD);
  return { start, end: start + BAD.length, ...place(source, start) };
}

function failure(backend: Backend, source: string, extra: Partial<RawOptions> = {}): RawOutput {
  const output = backend.compileSync(source, options(extra));
  expect(output.kind).toBe(1);
  return output;
}

function originOf(
  backend: Backend,
  source: string,
  needle: string,
  extra: Partial<RawOptions> = {},
): { line: number; column: number } {
  const output = backend.compileSync(source, options(extra));
  expect(output.kind).toBe(0);
  const map = new SourceMap({
    version: 3,
    sources: [output.mapSource ?? ""],
    sourcesContent: [source],
    names: [],
    mappings: output.mapMappings ?? "",
  } as never);
  const at = place(output.code, output.code.indexOf(needle));
  const entry = map.findEntry(at.line - 1, at.column) as {
    originalLine?: number;
    originalColumn?: number;
  };
  expect(entry.originalLine).toBeDefined();
  return { line: (entry.originalLine ?? 0) + 1, column: entry.originalColumn ?? 0 };
}

const backends: Array<[string, () => Backend]> = [
  ["the native addon", () => backendOf(native, "the native addon")],
  ["the WebAssembly build", () => backendOf(wasm, "the WebAssembly build")],
];

for (const [label, get] of backends) {
  const backend = get();

  describe(`[COMPILER-10] ${label}: positions are those of the module as it was written`, () => {
    const use = (): Backend => {
      return backend;
    };

    for (const generate of ["dom", "ssr"] as const) {
      it(`an error after the useStore rewrite points into the source (${generate})`, () => {
        const output = failure(use(), CELL_SOURCE, { generate });
        expect(output.errorCode).toBe("INVALID_HTML_NESTING");
        expect({
          start: output.errorStart,
          end: output.errorEnd,
          line: output.errorLine,
          column: output.errorColumn,
        }).toEqual(expectedError(CELL_SOURCE));
        expect(output.errorLine).toBe(4);
        expect(output.errorFrame).toBe(
          `   4 | export const view = ${BAD};\n     | ${" ".repeat("export const view = ".length)}^`,
        );
      });
    }

    it("an error inside a derived constant points at the written expression", () => {
      const output = failure(use(), DERIVE_SOURCE);
      expect({
        start: output.errorStart,
        end: output.errorEnd,
        line: output.errorLine,
        column: output.errorColumn,
      }).toEqual(expectedError(DERIVE_SOURCE));
      expect(output.errorFrame).toContain(`const label = n() > 1 ? ["\u{1F600}", ${BAD}]`);
      expect(output.errorFrame).not.toContain("_$derived");
    });

    it("an error in a default value that moved into the body points at the parameter", () => {
      const output = failure(use(), PROPS_SOURCE);
      expect({
        start: output.errorStart,
        end: output.errorEnd,
        line: output.errorLine,
        column: output.errorColumn,
      }).toEqual(expectedError(PROPS_SOURCE));
    });

    it("the source map keeps the lines of the module through both rewrites", () => {
      const output = use().compileSync(MAP_SOURCE, options());
      expect(output.code).toContain("useShadowSignal(0)");
      expect(output.code).toContain("_$derived(");
      expect(originOf(use(), MAP_SOURCE, "export const after")).toEqual({ line: 8, column: 0 });
      expect(originOf(use(), MAP_SOURCE, "export function C")).toEqual({ line: 3, column: 0 });
      expect(originOf(use(), MAP_SOURCE, "useShadowSignal(0)")).toEqual({
        line: 4,
        column: "  const [n] = ".length,
      });
      expect(originOf(use(), MAP_SOURCE, "n() * 2")).toEqual({
        line: 5,
        column: "  const double = ".length,
      });
    });
  });
}

describe("[COMPILER-10] the result of compile() embeds the module as it was written", () => {
  it("has the source as the content of the map and throws positions of the source", () => {
    if (!native.ok && !wasm.ok) return;
    const result = compile(MAP_SOURCE, { filename: "src/view.tsx" });
    expect(result.map?.sourcesContent).toEqual([MAP_SOURCE]);
    expect(result.map?.sources).toEqual(["src/view.tsx"]);
    let thrown: unknown;
    try {
      compile(CELL_SOURCE, { filename: "view.tsx" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CompileError);
    const error = thrown as CompileError;
    expect({ ...error.diagnostic }).toMatchObject({
      code: "INVALID_HTML_NESTING",
      severity: "error",
      ...expectedError(CELL_SOURCE),
    });
  });
});
