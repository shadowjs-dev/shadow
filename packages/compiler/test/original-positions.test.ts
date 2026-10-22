import { SourceMap } from "node:module";
import { describe, expect, it } from "vitest";
import { CompileError, type CompilerPlugin, compile } from "../src/javascript";

/**
 * Two passes rewrite the module text before the JSX is compiled: the `useStore` cell pass (it adds
 * an import line and renames the callee) and the derived-constant pass (it wraps declarations and
 * moves default values). Every position the compiler reports, in an error or in the source map,
 * must still be a position of the text the caller passed in.
 */

const STORE_IMPORT = 'import { useStore } from "@shadow-js/core";';
const BAD = "<p><div/></p>";

/** A module whose first pass rewrites `useStore(0)` and whose JSX is invalid on line 4. */
const CELL_SOURCE = [
  STORE_IMPORT,
  "const [n] = useStore(0);",
  "export const keep = n;",
  `export const view = ${BAD};`,
  "",
].join("\n");

/** A module whose derived-constant pass moves the invalid JSX into `_$derived(() => (...))`. */
const DERIVE_SOURCE = [
  'import { useSignal } from "@shadow-js/core";',
  "export function C() {",
  "  const [n] = useSignal(0);",
  `  const label = n() > 1 ? ${BAD} : null;`,
  "  return <section>{label}</section>;",
  "}",
  "",
].join("\n");

/** A module whose destructured parameter becomes `_$props` and whose default value moves to the body. */
const PROPS_SOURCE = [
  `export function C({ icon = <b>x</b>, note = ${BAD} }) {`,
  "  return <section>{icon}{note}</section>;",
  "}",
  "",
].join("\n");

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, column: (before[before.length - 1] ?? "").length };
}

function thrown(source: string, options: Parameters<typeof compile>[1]): CompileError {
  try {
    compile(source, options);
  } catch (error) {
    if (error instanceof CompileError) return error;
    throw error;
  }
  throw new Error("the compiler did not throw");
}

/** The place in the module that the diagnostic must name: the invalid element. */
function expectedDiagnostic(source: string, needle: string): Record<string, unknown> {
  const start = source.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  return {
    code: "INVALID_HTML_NESTING",
    severity: "error",
    start,
    end: start + needle.length,
    ...lineAndColumn(source, start),
  };
}

interface Decoded {
  version: number;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

function mapOf(result: { map: unknown }): Decoded {
  if (result.map === null) throw new Error("no map");
  return JSON.parse(String(result.map)) as Decoded;
}

/** 0-based line and column of the first occurrence of `needle` in `text`. */
function where(text: string, needle: string): { line: number; column: number } {
  const index = text.indexOf(needle);
  if (index === -1) throw new Error(`"${needle}" is not in the text`);
  const place = lineAndColumn(text, index);
  return { line: place.line - 1, column: place.column };
}

/** The original place the first occurrence of `needle` in the generated code is mapped to. */
function originOf(
  result: { code: string; map: unknown },
  needle: string,
): { line: number; column: number } {
  const map = new SourceMap(JSON.parse(String(result.map)));
  const at = where(result.code, needle);
  const entry = map.findEntry(at.line, at.column) as {
    originalLine?: number;
    originalColumn?: number;
  };
  if (entry.originalLine === undefined || entry.originalColumn === undefined)
    throw new Error(`no mapping for "${needle}"`);
  return { line: entry.originalLine, column: entry.originalColumn };
}

describe("[POSITIONS] errors name the module as it was written", () => {
  for (const target of ["dom", "ssr"] as const) {
    it(`[POSITIONS-1] an error after the useStore rewrite points into the source (${target})`, () => {
      const error = thrown(CELL_SOURCE, { filename: "view.tsx", generate: target });
      expect({ ...error.diagnostic }).toEqual({
        ...expectedDiagnostic(CELL_SOURCE, BAD),
        message: "<div> cannot be inside <p>: the HTML parser would close the paragraph first.",
      });
      expect(error.diagnostic.line).toBe(4);
      expect(error.diagnostic.column).toBe("export const view = ".length);
      expect(error.frame).toBe(`   4 | export const view = ${BAD};\n     | ${" ".repeat(20)}^`);
      expect(error.message).toBe(
        `view.tsx:4:20 INVALID_HTML_NESTING: ${error.diagnostic.message}\n${error.frame}`,
      );
    });
  }

  it("[POSITIONS-2] the report is the one the module gives without the rewrite", () => {
    const plain = CELL_SOURCE.replace("useStore(0)", "readIt()");
    const withRewrite = thrown(CELL_SOURCE, { filename: "view.tsx" });
    const without = thrown(plain, { filename: "view.tsx" });
    // The two modules differ only in the text of the second line; the error is on the fourth.
    const shift = CELL_SOURCE.length - plain.length;
    expect(withRewrite.diagnostic.start).toBe(without.diagnostic.start + shift);
    expect(withRewrite.diagnostic.line).toBe(without.diagnostic.line);
    expect(withRewrite.frame).toBe(without.frame);
  });

  it("[POSITIONS-3] a name-only options argument and a namespace import are rewritten too", () => {
    const source = [
      'import * as core from "@shadow-js/core";',
      'const [a] = core.useStore("x", { name: "a" });',
      "const [b] = core.useStore(1);",
      `export const view = ${BAD};`,
      "",
    ].join("\n");
    const error = thrown(source, { filename: "view.tsx" });
    expect(error.diagnostic).toMatchObject(expectedDiagnostic(source, BAD));
  });

  it("[POSITIONS-4] columns count UTF-16 code units on the line of the rewrite", () => {
    const source = [
      STORE_IMPORT,
      'const [n] = useStore(0); const s = "\u{1F600}é"; export const view = <p><div/></p>;',
      "",
    ].join("\n");
    const error = thrown(source, { filename: "view.tsx" });
    const start = source.indexOf("<p><div/></p>");
    expect(error.diagnostic).toMatchObject({
      start,
      end: start + "<p><div/></p>".length,
      line: 2,
      column: start - source.indexOf("\n") - 1,
    });
    expect(error.frame.split("\n")[0]).toContain("const [n] = useStore(0);");
  });

  it("[POSITIONS-5] a directive stays first and the error still points at the source", () => {
    const source = [
      '"use client";',
      STORE_IMPORT,
      "const [n] = useStore(0);",
      `const v = ${BAD};`,
      "",
    ].join("\n");
    const error = thrown(source, { filename: "view.tsx" });
    expect(error.diagnostic).toMatchObject(expectedDiagnostic(source, BAD));
  });

  it("[POSITIONS-6] an error inside a derived constant points at the written expression", () => {
    const target = thrown(DERIVE_SOURCE, { filename: "view.tsx" });
    expect(target.diagnostic).toMatchObject(expectedDiagnostic(DERIVE_SOURCE, BAD));
    expect(target.frame).toContain(`const label = n() > 1 ? ${BAD} : null;`);
    expect(target.frame).not.toContain("_$derived");
    const server = thrown(DERIVE_SOURCE, { filename: "view.tsx", generate: "ssr" });
    expect(server.diagnostic).toMatchObject(expectedDiagnostic(DERIVE_SOURCE, BAD));
  });

  it("[POSITIONS-7] an error in a default value that moved into the body points at the parameter", () => {
    const error = thrown(PROPS_SOURCE, { filename: "view.tsx" });
    expect(error.diagnostic).toMatchObject(expectedDiagnostic(PROPS_SOURCE, BAD));
    expect(error.diagnostic.line).toBe(1);
    expect(error.frame).toContain("export function C({ icon = <b>x</b>, note =");
  });

  it("[POSITIONS-8] both passes together: the derived pass reads the text the cell pass wrote", () => {
    const source = [
      'import { useStore } from "@shadow-js/core";',
      "export function C() {",
      "  const [n] = useStore(0);",
      `  const label = n() > 1 ? ${BAD} : null;`,
      "  return <section>{label}</section>;",
      "}",
      "",
    ].join("\n");
    const error = thrown(source, { filename: "view.tsx" });
    expect(error.diagnostic).toMatchObject(expectedDiagnostic(source, BAD));
    expect(error.diagnostic.line).toBe(4);
  });

  it("[POSITIONS-9] a syntax error is reported where it always was", () => {
    const source = [STORE_IMPORT, "const [n] = useStore(0);", "const v = <div>;", ""].join("\n");
    const error = thrown(source, { filename: "view.tsx" });
    expect(error.diagnostic.code).toBe("PARSE_ERROR");
    expect(error.diagnostic.line).toBe(3);
  });

  it("[POSITIONS-10] a pre plugin that edits nothing leaves the report in the source", () => {
    const quiet: CompilerPlugin = { name: "quiet", transform: () => undefined };
    const error = thrown(CELL_SOURCE, { filename: "view.tsx", plugins: [quiet] });
    expect(error.diagnostic).toMatchObject(expectedDiagnostic(CELL_SOURCE, BAD));
  });

  it("[POSITIONS-11] a pre plugin's edit and the cell rewrite compose to the source", () => {
    const rename: CompilerPlugin = {
      name: "rename",
      transform(_ast, context) {
        context.walk({
          Identifier(node) {
            if (node.name === "keep") context.replace(node, "keptAfterRename");
          },
        });
      },
    };
    const error = thrown(CELL_SOURCE, { filename: "view.tsx", plugins: [rename] });
    expect(error.diagnostic).toMatchObject({
      ...expectedDiagnostic(CELL_SOURCE, BAD),
      start: CELL_SOURCE.indexOf(BAD),
    });
    expect(error.diagnostic.line).toBe(4);
  });
});

describe("[POSITIONS] source maps point into the module as it was written", () => {
  it("[POSITIONS-20] the map embeds the source and keeps its lines (useStore rewrite)", () => {
    const source = [
      STORE_IMPORT,
      "const [n] = useStore(0);",
      "export const view = <p>{n()}</p>;",
      "export const tail = 1;",
      "",
    ].join("\n");
    const result = compile(source, { filename: "src/view.tsx" });
    expect(result.code).toContain("useShadowSignal(0)");
    const map = mapOf(result);
    expect(map.sources).toEqual(["src/view.tsx"]);
    expect(map.sourcesContent).toEqual([source]);
    expect(originOf(result, "export const view")).toEqual({ line: 2, column: 0 });
    expect(originOf(result, "export const tail")).toEqual({ line: 3, column: 0 });
    expect(originOf(result, "const [n]")).toEqual({ line: 1, column: 0 });
    // The renamed callee maps to the call the author wrote.
    expect(originOf(result, "useShadowSignal(0)")).toEqual({
      line: 1,
      column: "const [n] = ".length,
    });
  });

  it("[POSITIONS-21] a rewrite alone (no JSX) keeps the code and has no map", () => {
    const source = [STORE_IMPORT, "export const [n] = useStore(0);", ""].join("\n");
    const result = compile(source, { filename: "m.ts" });
    expect(result.transformed).toBe(true);
    expect(result.map).toBeNull();
  });

  it("[POSITIONS-22] the map of a derived-constant rewrite keeps its lines", () => {
    const source = [
      'import { useSignal } from "@shadow-js/core";',
      "export function C() {",
      "  const [n] = useSignal(0);",
      "  const double = n() * 2;",
      "  return <section><i>{double}</i></section>;",
      "}",
      "export const after = 1;",
      "",
    ].join("\n");
    const result = compile(source, { filename: "view.tsx" });
    expect(result.code).toContain("_$derived(");
    const map = mapOf(result);
    expect(map.sourcesContent).toEqual([source]);
    expect(originOf(result, "export function C")).toEqual({ line: 1, column: 0 });
    expect(originOf(result, "export const after")).toEqual({ line: 6, column: 0 });
    // The expression moved inside `_$derived(() => (...))` still maps to where it was written.
    expect(originOf(result, "n() * 2")).toEqual({ line: 3, column: "  const double = ".length });
  });

  it("[POSITIONS-23] both passes and the server target", () => {
    const source = [
      STORE_IMPORT,
      "export function C() {",
      "  const [n] = useStore(0);",
      "  const double = n() * 2;",
      "  return <section>{double}</section>;",
      "}",
      "export const after = 1;",
      "",
    ].join("\n");
    for (const generate of ["dom", "ssr"] as const) {
      const result = compile(source, { filename: "view.tsx", generate });
      expect(result.code).toContain("useShadowSignal(0)");
      expect(result.code).toContain("_$derived(");
      expect(mapOf(result).sourcesContent).toEqual([source]);
      expect(originOf(result, "export const after")).toEqual({ line: 6, column: 0 });
      expect(originOf(result, "n() * 2")).toEqual({ line: 3, column: "  const double = ".length });
    }
  });

  it("[POSITIONS-24] a module that was not rewritten keeps the map it always had", () => {
    const source = "export const view = <p>{1 + 1}</p>;\n";
    const result = compile(source, { filename: "view.tsx" });
    expect(mapOf(result).sourcesContent).toEqual([source]);
    expect(originOf(result, "export const view")).toEqual({ line: 0, column: 0 });
  });

  it("[POSITIONS-25] with a plugin in the list the map is still the source's", () => {
    const quiet: CompilerPlugin = { name: "quiet", transform: () => undefined };
    const result = compile(CELL_SOURCE.replace(BAD, "<p>{n}</p>"), {
      filename: "view.tsx",
      plugins: [quiet],
    });
    const map = mapOf(result);
    expect(map.sourcesContent).toEqual([CELL_SOURCE.replace(BAD, "<p>{n}</p>")]);
    expect(originOf(result, "export const view")).toEqual({ line: 3, column: 0 });
  });
});
