import { SourceMap } from "node:module";
import { describe, expect, it } from "vitest";
import { type CompileResult, type CompilerPlugin, compile } from "../src/javascript";

const SOURCE = [
  "const foo = 1;",
  "export const A = () => <p>{foo}</p>;",
  "export const last = foo + 2;",
  "",
].join("\n");

interface Spot {
  line: number;
  column: number;
  name: string | undefined;
}

/** 0-based line and column of the `nth` occurrence of `needle` in `text`. */
function where(text: string, needle: string, nth = 0): { line: number; column: number } {
  let index = -1;
  for (let i = 0; i <= nth; i += 1) {
    index = text.indexOf(needle, index + 1);
    if (index === -1) throw new Error(`"${needle}" #${nth} is not in the text`);
  }
  const before = text.slice(0, index).split("\n");
  return { line: before.length - 1, column: (before[before.length - 1] ?? "").length };
}

/** Where the `nth` occurrence of `needle` in the generated code comes from, by the result's map. */
function origin(result: CompileResult, needle: string, nth = 0): Spot {
  if (result.map === null) throw new Error("no map");
  const map = new SourceMap(JSON.parse(String(result.map)));
  const at = where(result.code, needle, nth);
  const entry = map.findEntry(at.line, at.column) as {
    originalLine?: number;
    originalColumn?: number;
    name?: string;
  };
  if (entry.originalLine === undefined || entry.originalColumn === undefined) {
    throw new Error(`no mapping for "${needle}"`);
  }
  return { line: entry.originalLine, column: entry.originalColumn, name: entry.name };
}

const renameFoo: CompilerPlugin = {
  name: "rename-foo",
  transform(_ast, context) {
    context.walk({
      Identifier(node) {
        if (node.name === "foo") context.replace(node, "renamedValue");
      },
    });
  },
};

const insertNodes: CompilerPlugin = {
  name: "insert-nodes",
  transform(_ast, context) {
    const at = context.source.indexOf("export const last");
    context.insertBefore({ start: at, end: at }, "/* added */\nconst added = [1, 2, 3];\n");
    context.walk({
      JSXOpeningElement(node) {
        context.insertAfter(node.name, ` ${context.create.jsxAttribute("data-added", '"1"')}`);
      },
    });
  },
};

const banner: CompilerPlugin = {
  name: "banner",
  enforce: "post",
  transform(_ast, context) {
    context.insertBefore({ start: 0, end: 0 }, "// generated\n// by a plugin\n");
  },
};

describe("source maps through plugins", () => {
  it("[PLG-SM-01] a renamed identifier maps to the original name and place, and records the name", () => {
    const result = compile(SOURCE, { filename: "a.tsx", plugins: [renameFoo] });
    expect(result.code).toContain("const renamedValue = 1;");
    expect(result.code).toContain("export const last = renamedValue + 2;");
    expect(origin(result, "renamedValue", 0)).toEqual({ line: 0, column: 6, name: "foo" });
    // The use on the third line: the generated line is not the first occurrence in the code.
    const generated = where(result.code, "export const last = renamedValue");
    const entry = new SourceMap(JSON.parse(String(result.map))).findEntry(
      generated.line,
      generated.column + "export const last = ".length,
    ) as { originalLine: number; originalColumn: number; name: string };
    expect(entry.originalLine).toBe(2);
    expect(entry.originalColumn).toBe("export const last = ".length);
    expect(entry.name).toBe("foo");
  });

  it("[PLG-SM-02] text after the rename still maps to its own original place", () => {
    const result = compile(SOURCE, { filename: "a.tsx", plugins: [renameFoo] });
    expect(origin(result, "last")).toEqual({ line: 2, column: 13, name: undefined });
    expect(origin(result, "export const A")).toMatchObject({ line: 1, column: 0 });
  });

  it("[PLG-SM-03] inserted nodes shift the text after them without breaking its mapping", () => {
    const result = compile(SOURCE, { filename: "a.tsx", plugins: [insertNodes] });
    expect(result.code).toContain("/* added */\nconst added = [1, 2, 3];\nexport const last");
    expect(result.code).toContain('<p data-added=\\"1\\">');
    expect(origin(result, "last")).toEqual({ line: 2, column: 13, name: undefined });
    expect(origin(result, "foo + 2")).toMatchObject({ line: 2, column: 20 });
    // The generated line of `last` is two lines below its original line: the inserted lines.
    expect(where(result.code, "export const last").line).toBeGreaterThan(2);
    // The inserted text has no mapping of its own: it resolves to where it was inserted.
    expect(origin(result, "added = [1, 2, 3]")).toMatchObject({ line: 1 });
  });

  it("[PLG-SM-04] the map has one source, the module, and embeds the text as it was written", () => {
    const result = compile(SOURCE, { filename: "src/a.tsx", plugins: [renameFoo, insertNodes] });
    const map = JSON.parse(String(result.map)) as {
      sources: string[];
      sourcesContent: string[];
      version: number;
      names: string[];
    };
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(["src/a.tsx"]);
    expect(map.sourcesContent).toEqual([SOURCE]);
    expect(map.names).toContain("foo");
  });

  it("[PLG-SM-05] a post plugin's edit composes with the compiler's map", () => {
    const result = compile(SOURCE, { filename: "a.tsx", plugins: [banner] });
    expect(result.code.startsWith("// generated\n// by a plugin\n")).toBe(true);
    expect(origin(result, "last")).toEqual({ line: 2, column: 13, name: undefined });
    expect(origin(result, "export const A")).toMatchObject({ line: 1, column: 0 });
    expect(where(result.code, "export const last").line).toBeGreaterThanOrEqual(2 + 2);
  });

  it("[PLG-SM-06] pre and post edits compose into one map to the original", () => {
    const result = compile(SOURCE, {
      filename: "a.tsx",
      plugins: [banner, renameFoo, insertNodes],
    });
    expect(origin(result, "last")).toEqual({ line: 2, column: 13, name: undefined });
    expect(origin(result, "renamedValue", 0)).toEqual({ line: 0, column: 6, name: "foo" });
    const map = JSON.parse(String(result.map)) as { sourcesContent: string[] };
    expect(map.sourcesContent[0]).toBe(SOURCE);
  });

  it("[PLG-SM-07] edits compose in the server output too", () => {
    const result = compile(SOURCE, {
      filename: "a.tsx",
      generate: "ssr",
      plugins: [renameFoo, banner],
    });
    expect(origin(result, "last")).toEqual({ line: 2, column: 13, name: undefined });
  });

  it("[PLG-SM-08] sourceMap: false builds no map, with or without edits", () => {
    const result = compile(SOURCE, {
      filename: "a.tsx",
      sourceMap: false,
      plugins: [renameFoo, banner],
    });
    expect(result.map).toBeNull();
    expect(result.code).toContain("renamedValue");
  });

  it("[PLG-SM-09] a plugin that edits a module without JSX still gets a map", () => {
    const text = "export const a = foo;\n";
    const result = compile(text, { filename: "a.ts", plugins: [renameFoo] });
    expect(result.code).toBe("export const a = renamedValue;\n");
    expect(origin(result, "renamedValue")).toEqual({ line: 0, column: 17, name: "foo" });
  });

  it("[PLG-SM-10] a plugin that changes nothing leaves the compiler's own map untouched", () => {
    const idle: CompilerPlugin = { name: "idle", transform: () => undefined };
    const base = compile(SOURCE, { filename: "a.tsx" });
    const withIdle = compile(SOURCE, {
      filename: "a.tsx",
      plugins: [idle, { ...idle, name: "later", enforce: "post" }],
    });
    expect(String(withIdle.map)).toBe(String(base.map));
  });
});
