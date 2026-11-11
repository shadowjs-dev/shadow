import { describe, expect, it } from "vitest";
import { CompileError, compile as compileWithJavaScript } from "../src/javascript";
import type { RawOptions } from "../src/native/backend";
import { backendOf, native, wasm } from "./native/support/backends";

/**
 * ECMAScript ends a line at LF, CR, U+2028 and U+2029, and counts CR LF as one terminator. An error
 * in a module that uses any of them is reported at the line a reader sees, in the TypeScript
 * implementation, the addon and the WebAssembly build alike.
 */

const TERMINATORS = [
  ["LF", "\n"],
  ["CR LF", "\r\n"],
  ["CR", "\r"],
  ["U+2028", " "],
  ["U+2029", " "],
] as const;

interface Position {
  code: string;
  line: number;
  column: number;
  frame: string;
}

const RAW: RawOptions = {
  filename: "a.tsx",
  generate: "dom",
  dev: false,
  autoReactive: true,
  hmr: false,
  hydratable: true,
  sourceMap: false,
};

function viaJavaScript(source: string): Position {
  try {
    compileWithJavaScript(source, { filename: "a.tsx" });
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    const { code, line, column } = error.diagnostic;
    return { code, line, column, frame: error.frame };
  }
  throw new Error("expected a CompileError");
}

function viaBackend(attempt: typeof native, label: string, source: string): Position {
  const out = backendOf(attempt, label).compileSync(source, RAW);
  expect(out.kind, label).toBe(1);
  return {
    code: String(out.errorCode),
    line: Number(out.errorLine),
    column: Number(out.errorColumn),
    frame: String(out.errorFrame),
  };
}

/** A module with the error on its last line, after non-BMP text that counts two UTF-16 units. */
const lines = (head: string): string[] => [
  'import { useStore } from "@shadow-js/core";',
  `// ${head} \u{1F600}`,
  "const [n] = useStore(0);",
  "export const view = <p><div/></p>;",
];

describe("[CMP-LT-1] an error is located by the line terminators of ECMAScript", () => {
  for (const [name, terminator] of TERMINATORS) {
    const source = lines("x").join(terminator);

    it(`${name}: the line and the column are those of the last line`, () => {
      const expected = { code: "INVALID_HTML_NESTING", line: 4, column: 20 };
      expect(viaJavaScript(source)).toMatchObject(expected);
      expect(viaBackend(native, "addon", source)).toMatchObject(expected);
      expect(viaBackend(wasm, "WebAssembly", source)).toMatchObject(expected);
    });

    it(`${name}: the code frame shows the line of the error`, () => {
      const frame = "   4 | export const view = <p><div/></p>;\n     |                     ^";
      expect(viaJavaScript(source).frame).toBe(frame);
      expect(viaBackend(native, "addon", source).frame).toBe(frame);
      expect(viaBackend(wasm, "WebAssembly", source).frame).toBe(frame);
    });

    it(`${name}: a syntax error is located the same way`, () => {
      const broken = ["const a = 1;", "const b = 2;", "const view = <div>;"].join(terminator);
      const expected = { code: "PARSE_ERROR", line: 3, column: 18 };
      expect(viaJavaScript(broken)).toMatchObject(expected);
      expect(viaBackend(native, "addon", broken)).toMatchObject(expected);
      expect(viaBackend(wasm, "WebAssembly", broken)).toMatchObject(expected);
    });
  }

  it("a module that mixes every terminator is counted terminator by terminator", () => {
    const source = [
      "const a = 1;\r\n",
      "const b = 2;\r",
      "const c = 3; ",
      "const d = 4; ",
      "const e = 5;\n",
      "const view = <div>;",
    ].join("");
    const expected = { code: "PARSE_ERROR", line: 6, column: 18 };
    expect(viaJavaScript(source)).toMatchObject(expected);
    expect(viaBackend(native, "addon", source)).toMatchObject(expected);
    expect(viaBackend(wasm, "WebAssembly", source)).toMatchObject(expected);
  });

  it("an error before the first terminator is still on line 1", () => {
    const source = "export const view = <p><div/></p>;\r\nconst after = 1;";
    const expected = { code: "INVALID_HTML_NESTING", line: 1, column: 20 };
    expect(viaJavaScript(source)).toMatchObject(expected);
    expect(viaBackend(native, "addon", source)).toMatchObject(expected);
    expect(viaBackend(wasm, "WebAssembly", source)).toMatchObject(expected);
  });

  it("a CR LF file keeps its code frame as it was: the line text still ends with the CR", () => {
    const source = "export const view = <p><div/></p>;\r\nconst after = 1;";
    const frame = "   1 | export const view = <p><div/></p>;\r\n     |                     ^";
    expect(viaJavaScript(source).frame).toBe(frame);
    expect(viaBackend(native, "addon", source).frame).toBe(frame);
    expect(viaBackend(wasm, "WebAssembly", source).frame).toBe(frame);
  });
});
