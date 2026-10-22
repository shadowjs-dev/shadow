import { describe, expect, it } from "vitest";
import {
  CompileError,
  type CompilerPlugin,
  compile,
  type PluginContext,
  validatePlugins,
} from "../src/javascript";

const SOURCE = `import { useSignal } from "@shadow-js/core";
export const A = () => {
  const [n] = useSignal(0);
  return <p class="x">{n()}</p>;
};
`;

const nothing = (): void => undefined;

const noop = (name: string, enforce?: "pre" | "post"): CompilerPlugin =>
  enforce === undefined ? { name, transform: nothing } : { name, enforce, transform: nothing };

/** The error a compilation throws. */
function failure(run: () => unknown): CompileError {
  try {
    run();
  } catch (error) {
    if (error instanceof CompileError) return error;
    throw error;
  }
  throw new Error("expected a CompileError");
}

describe("validatePlugins", () => {
  it("[PLG-01] returns a frozen copy and accepts it again", () => {
    const list = [noop("a"), noop("b", "post")];
    const checked = validatePlugins(list);
    expect(checked).toEqual(list);
    expect(checked).not.toBe(list);
    expect(Object.isFrozen(checked)).toBe(true);
    expect(validatePlugins(checked)).toBe(checked);
  });

  it("[PLG-02] names the member and the problem", () => {
    const cases: Array<[unknown, RegExp]> = [
      [undefined, /must be an array/],
      [{}, /must be an array/],
      [[null], /plugins\[0\] must be a plugin object/],
      [[{ transform: nothing }], /plugins\[0\]\.name/],
      [[{ name: " x", transform: nothing }], /plugins\[0\]\.name/],
      [[{ name: "x".repeat(101), transform: nothing }], /plugins\[0\]\.name/],
      [[{ name: "a\nb", transform: nothing }], /plugins\[0\]\.name/],
      [[{ name: "x" }], /plugins\[0\]\.transform/],
      [[noop("x"), noop("x")], /plugins\[1\]\.name "x" is already the name of .*\[0\]/],
      [[{ name: "x", transform: nothing, enforce: "mid" }], /plugins\[0\]\.enforce/],
      [[{ name: "x", transform: nothing, imports: {} }], /plugins\[0\]\.imports must be an array/],
      [
        [{ name: "x", transform: nothing, imports: [{ from: "", names: [] }] }],
        /imports\[0\]\.from/,
      ],
      [
        [{ name: "x", transform: nothing, imports: [{ from: "m", names: ["a b"] }] }],
        /imports\[0\]\.names/,
      ],
    ];
    for (const [value, pattern] of cases) {
      expect(() => validatePlugins(value), String(pattern)).toThrow(TypeError);
      expect(() => validatePlugins(value), String(pattern)).toThrow(pattern);
    }
    expect(() => validatePlugins(null, "shadow(): plugins")).toThrow(
      /^shadow\(\): plugins must be an array/,
    );
  });

  it("[PLG-03] compile rejects a bad list before it reads the module", () => {
    expect(() => compile(SOURCE, { plugins: [noop("x"), noop("x")] })).toThrow(TypeError);
  });
});

describe("zero cost without plugins", () => {
  it("[PLG-04] no plugins, an empty list and a plugin that does nothing give the same module", () => {
    const base = compile(SOURCE, { filename: "a.tsx" });
    const empty = compile(SOURCE, { filename: "a.tsx", plugins: [] });
    const idle = compile(SOURCE, {
      filename: "a.tsx",
      plugins: [noop("idle"), noop("late", "post")],
    });
    for (const other of [empty, idle]) {
      expect(other.code).toBe(base.code);
      expect(other.transformed).toBe(base.transformed);
      expect(other.diagnostics).toEqual([]);
      expect(String(other.map)).toBe(String(base.map));
    }
  });

  it("[PLG-05] a plugin that records nothing does not re-parse or change a module without JSX", () => {
    const text = "export const n: number = 1;\n";
    const result = compile(text, { filename: "a.ts", plugins: [noop("idle")] });
    expect(result.code).toBe(text);
    expect(result.transformed).toBe(false);
    expect(result.map).toBeNull();
  });
});

describe("stages and ordering", () => {
  it("[PLG-06] pre plugins read the source tree, post plugins read the generated code", () => {
    const seen: Record<string, string[]> = { pre: [], post: [] };
    const probe = (enforce: "pre" | "post"): CompilerPlugin => ({
      name: `probe-${enforce}`,
      enforce,
      transform(ast, context) {
        const types = new Set<string>();
        context.walk({ enter: (node) => void types.add(node.type) });
        seen[enforce] = [...types];
        expect(ast.type).toBe("Program");
        expect(context.stage).toBe(enforce);
        expect(context.filename).toBe("a.tsx");
        expect(context.target).toBe("dom");
        expect(context.dev).toBe(false);
        expect(context.source.length).toBeGreaterThan(0);
      },
    });
    compile(SOURCE, { filename: "a.tsx", plugins: [probe("post"), probe("pre")] });
    expect(seen["pre"]).toContain("JSXElement");
    expect(seen["post"]).not.toContain("JSXElement");
    expect(seen["post"]).toContain("CallExpression");
  });

  it("[PLG-07] stages run pre, passes, post; inside a stage the list order decides", () => {
    const log: string[] = [];
    const named = (name: string, enforce?: "pre" | "post"): CompilerPlugin => ({
      name,
      ...(enforce === undefined ? {} : { enforce }),
      transform(_ast, context) {
        log.push(`${name}:${context.stage}`);
      },
    });
    compile(SOURCE, {
      filename: "a.tsx",
      plugins: [
        named("p1", "post"),
        named("a"),
        named("p2", "post"),
        named("b", "pre"),
        named("c"),
      ],
    });
    expect(log).toEqual(["a:pre", "b:pre", "c:pre", "p1:post", "p2:post"]);
  });

  it("[PLG-08] a plugin sees the module as the plugins before it left it", () => {
    const rename: CompilerPlugin = {
      name: "rename",
      transform(_ast, context) {
        context.walk({
          Identifier(node) {
            if (node.name === "n") context.replace(node, "count");
          },
        });
      },
    };
    let seen = "";
    const spy: CompilerPlugin = {
      name: "spy",
      transform(_ast, context) {
        seen = context.source;
      },
    };
    const result = compile(SOURCE, { filename: "a.tsx", plugins: [rename, spy] });
    expect(seen).toContain("const [count] = useSignal(0)");
    expect(seen).not.toContain("[n]");
    expect(result.code).toContain("count");
  });

  it("[PLG-09] the same list gives the same output every time", () => {
    const rename: CompilerPlugin = {
      name: "rename",
      transform(_ast, context) {
        context.walk({
          Identifier(node) {
            if (node.name === "n") context.replace(node, "count");
          },
        });
      },
    };
    const first = compile(SOURCE, { filename: "a.tsx", plugins: [rename] });
    const second = compile(SOURCE, { filename: "a.tsx", plugins: [rename] });
    expect(second.code).toBe(first.code);
    expect(String(second.map)).toBe(String(first.map));
  });

  it("[PLG-10] a plugin edit makes a module without JSX transformed", () => {
    const add: CompilerPlugin = {
      name: "add",
      transform(ast, context) {
        context.insertAfter(ast, "export const added = 1;\n");
      },
    };
    const result = compile("export const a = 1;\n", { filename: "a.ts", plugins: [add] });
    expect(result.transformed).toBe(true);
    expect(result.code).toBe("export const a = 1;\nexport const added = 1;\n");
    expect(result.map).not.toBeNull();
  });

  it("[PLG-11] the target and dev flags reach the plugin", () => {
    const seen: string[] = [];
    const probe: CompilerPlugin = {
      name: "probe",
      transform(_ast, context) {
        seen.push(`${context.stage}:${context.target}:${context.dev}`);
      },
    };
    compile(SOURCE, {
      filename: "a.tsx",
      generate: "ssr",
      dev: true,
      plugins: [probe, { ...probe, name: "late", enforce: "post" }],
    });
    expect(seen).toEqual(["pre:ssr:true", "post:ssr:true"]);
  });

  it("[PLG-12] post plugins also run on the server output", () => {
    const post: CompilerPlugin = {
      name: "banner",
      enforce: "post",
      transform(_ast, context) {
        context.insertBefore({ start: 0, end: 0 }, "/* server */\n");
      },
    };
    const result = compile(SOURCE, { filename: "a.tsx", generate: "ssr", plugins: [post] });
    expect(result.code.startsWith("/* server */\nimport")).toBe(true);
    expect(result.code).toContain("@shadow-js/web/server");
  });
});

describe("edits", () => {
  const edit = (run: (context: PluginContext) => void, text = "let abc = 12;\n"): string =>
    compile(text, {
      filename: "a.ts",
      plugins: [
        {
          name: "edit",
          transform(_ast, context) {
            run(context);
          },
        },
      ],
    }).code;

  it("[PLG-13] replace, insertBefore, insertAfter and remove", () => {
    expect(edit((c) => c.replace({ start: 4, end: 7 }, "xyz"))).toBe("let xyz = 12;\n");
    expect(edit((c) => c.insertBefore({ start: 4, end: 7 }, "/*a*/"))).toBe("let /*a*/abc = 12;\n");
    expect(edit((c) => c.insertAfter({ start: 4, end: 7 }, "/*a*/"))).toBe("let abc/*a*/ = 12;\n");
    expect(edit((c) => c.remove({ start: 7, end: 12 }))).toBe("let abc;\n");
    expect(edit((c) => c.replace({ start: 4, end: 4 }, "_"))).toBe("let _abc = 12;\n");
    expect(edit((c) => c.insertBefore({ start: 4, end: 7 }, ""))).toBe("let abc = 12;\n");
  });

  it("[PLG-14] inserts at one position keep their call order; edges stay outside a replacement", () => {
    const code = edit((c) => {
      c.insertAfter({ start: 4, end: 7 }, "/*2*/");
      c.insertBefore({ start: 10, end: 12 }, "/*3*/");
      c.insertAfter({ start: 4, end: 7 }, "/*4*/");
      c.replace({ start: 4, end: 7 }, "X");
      c.insertBefore({ start: 4, end: 7 }, "/*1*/");
    });
    expect(code).toBe("let /*1*/X/*2*//*4*/ = /*3*/12;\n");
  });

  it("[PLG-15] edits made in any order apply to the original offsets", () => {
    const code = edit((c) => {
      c.replace({ start: 10, end: 12 }, "99");
      c.replace({ start: 4, end: 7 }, "name");
    });
    expect(code).toBe("let name = 99;\n");
  });

  it("[PLG-16] replacing the same span twice keeps the last text", () => {
    expect(
      edit((c) => {
        c.replace({ start: 4, end: 7 }, "one");
        c.replace({ start: 4, end: 7 }, "two");
      }),
    ).toBe("let two = 12;\n");
  });

  it("[PLG-17] overlapping edits are PLUGIN_EDIT_CONFLICT with the plugin and the place", () => {
    const error = failure(() =>
      edit((c) => {
        c.replace({ start: 4, end: 7 }, "x");
        c.replace({ start: 6, end: 10 }, "y");
      }),
    );
    expect(error.diagnostic.code).toBe("PLUGIN_EDIT_CONFLICT");
    expect(error.diagnostic.plugin).toBe("edit");
    expect(error.message).toContain('plugin "edit"');
    expect(error.diagnostic.line).toBe(1);
    expect(error.diagnostic.column).toBe(6);
    const inside = failure(() =>
      edit((c) => {
        c.replace({ start: 4, end: 7 }, "x");
        c.insertBefore({ start: 5, end: 5 }, "y");
      }),
    );
    expect(inside.diagnostic.code).toBe("PLUGIN_EDIT_CONFLICT");
  });

  it("[PLG-18] a range outside the source is a PLUGIN_ERROR, not an edit", () => {
    for (const range of [
      { start: -1, end: 2 },
      { start: 3, end: 2 },
      { start: 0, end: 999 },
      { start: 1.5, end: 2 },
    ]) {
      const error = failure(() => edit((c) => c.replace(range, "x")));
      expect(error.diagnostic.code).toBe("PLUGIN_ERROR");
      expect(error.message).toContain("not inside the source");
    }
  });

  it("[PLG-19] context.text reads a span of the source", () => {
    let text = "";
    edit((c) => {
      text = c.text({ start: 4, end: 7 });
    });
    expect(text).toBe("abc");
  });

  it("[PLG-20] the number of edits is limited", () => {
    const error = failure(() =>
      edit((c) => {
        for (let i = 0; i <= 100_000; i += 1) c.insertBefore({ start: 0, end: 0 }, " ");
      }),
    );
    expect(error.diagnostic.code).toBe("PLUGIN_TOO_MANY_EDITS");
  });

  it("[PLG-21] edited text that does not parse is PLUGIN_INVALID_OUTPUT at the original place", () => {
    const error = failure(() =>
      compile("const a = 1;\nconst b = 2;\n", {
        filename: "a.ts",
        plugins: [
          {
            name: "break",
            transform(_ast, context) {
              context.replace({ start: 13, end: 18 }, "const const");
            },
          },
        ],
      }),
    );
    expect(error.diagnostic.code).toBe("PLUGIN_INVALID_OUTPUT");
    expect(error.diagnostic.plugin).toBe("break");
    expect(error.diagnostic.line).toBeGreaterThanOrEqual(1);
    expect(error.message).toContain("does not parse");
  });
});

describe("errors and reports", () => {
  const withPlugin = (transform: CompilerPlugin["transform"], source = SOURCE): CompileError =>
    failure(() => compile(source, { filename: "a.tsx", plugins: [{ name: "boom", transform }] }));

  it("[PLG-22] a thrown error becomes a CompileError with the plugin name and the visited node", () => {
    const cause = new Error("bad thing");
    const error = withPlugin((_ast, context) => {
      context.walk({
        JSXElement() {
          throw cause;
        },
      });
    });
    expect(error.diagnostic.code).toBe("PLUGIN_ERROR");
    expect(error.diagnostic.plugin).toBe("boom");
    expect(error.message).toContain('plugin "boom": bad thing');
    expect(error.diagnostic.line).toBe(4);
    expect(error.diagnostic.column).toBe(9);
    expect(error.id).toBe("a.tsx");
    expect(error.frame).toContain("<p class=");
    expect(error.cause).toBe(cause);
  });

  it("[PLG-23] a thrown value that is not an Error is reported too, at the start of the file", () => {
    const error = withPlugin(() => {
      throw "plain text";
    });
    expect(error.diagnostic.code).toBe("PLUGIN_ERROR");
    expect(error.message).toContain("plain text");
    expect(error.diagnostic.line).toBe(1);
  });

  it("[PLG-24] report with severity error stops the compilation after transform returns", () => {
    let after = false;
    const error = withPlugin((_ast, context) => {
      context.walk({
        Literal(node) {
          if (node.value !== 0) return;
          context.report({
            code: "NO_ZERO",
            message: "zero is not allowed",
            severity: "error",
            node,
          });
        },
      });
      after = true;
    });
    expect(after).toBe(true);
    expect(error.diagnostic.code).toBe("NO_ZERO");
    expect(error.diagnostic.severity).toBe("error");
    expect(error.diagnostic.plugin).toBe("boom");
    expect(error.diagnostic.line).toBe(3);
    expect(error.diagnostic.column).toBe((SOURCE.split("\n")[2] ?? "").indexOf("0"));
  });

  it("[PLG-25] warnings and info are collected in the result with the plugin name", () => {
    const result = compile(SOURCE, {
      filename: "a.tsx",
      plugins: [
        {
          name: "note",
          transform(_ast, context) {
            context.walk({
              JSXElement(node) {
                context.report({ message: "look at this", node });
                context.report({ code: "FYI", message: "fyi", severity: "info" });
              },
            });
          },
        },
      ],
    });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({
      code: "PLUGIN_DIAGNOSTIC",
      severity: "warning",
      plugin: "note",
      line: 4,
      column: 9,
      message: 'plugin "note": look at this',
    });
    expect(result.diagnostics[1]).toMatchObject({
      code: "FYI",
      severity: "info",
      line: 1,
      column: 0,
    });
  });

  it("[PLG-26] a plugin returns nothing: a value or a promise is PLUGIN_BAD_RETURN", () => {
    const value = withPlugin((() => 1) as unknown as CompilerPlugin["transform"]);
    expect(value.diagnostic.code).toBe("PLUGIN_BAD_RETURN");
    const promise = withPlugin((async () => undefined) as unknown as CompilerPlugin["transform"]);
    expect(promise.diagnostic.code).toBe("PLUGIN_BAD_RETURN");
    expect(promise.message).toContain("promise");
  });

  it("[PLG-27] a diagnostic from a later plugin points at the original source after earlier edits", () => {
    const grow: CompilerPlugin = {
      name: "grow",
      transform(ast, context) {
        context.insertBefore(ast, "// a comment that moves everything down\n// and another\n");
      },
    };
    const find: CompilerPlugin = {
      name: "find",
      transform(_ast, context) {
        context.walk({
          JSXElement(node) {
            context.report({ message: "here", node });
          },
        });
      },
    };
    const result = compile(SOURCE, { filename: "a.tsx", plugins: [grow, find] });
    expect(result.diagnostics[0]).toMatchObject({ line: 4, column: 9 });
  });

  it("[PLG-28] a compiler error on text a plugin changed points at the original source", () => {
    const tag: CompilerPlugin = {
      name: "retag",
      transform(_ast, context) {
        context.walk({
          JSXIdentifier(node) {
            if (node.name === "span") context.replace(node, "div");
          },
        });
      },
    };
    const source = `// header\n// more\nexport const A = () => (\n  <p>\n    <span>x</span>\n  </p>\n);\n`;
    const error = failure(() => compile(source, { filename: "a.tsx", plugins: [tag] }));
    expect(error.diagnostic.code).toBe("INVALID_HTML_NESTING");
    expect(error.diagnostic.plugin).toBeUndefined();
    expect(error.diagnostic.line).toBe(4);
    expect(error.frame).toContain("<p>");
    // Without the plugin the same module is fine.
    expect(() => compile(source, { filename: "a.tsx" })).not.toThrow();
  });

  it("[PLG-29] a parse error in the source is the usual PARSE_ERROR, before any plugin runs", () => {
    let ran = false;
    const error = failure(() =>
      compile("const = ;", {
        filename: "a.ts",
        plugins: [
          {
            name: "x",
            transform() {
              ran = true;
            },
          },
        ],
      }),
    );
    expect(error.diagnostic.code).toBe("PARSE_ERROR");
    expect(ran).toBe(false);
  });
});

describe("the context after transform", () => {
  it("[PLG-45] a context kept past the end of transform refuses further use", () => {
    let kept: PluginContext | undefined;
    compile("const a = 1;\n", {
      filename: "a.ts",
      plugins: [
        {
          name: "keeper",
          transform(_ast, context) {
            kept = context;
          },
        },
      ],
    });
    if (kept === undefined) throw new Error("no context");
    expect(() => kept?.replace({ start: 0, end: 1 }, "x")).toThrow(
      /only valid while transform runs/,
    );
    expect(() => kept?.report({ message: "late" })).toThrow(/only valid while transform runs/);
    expect(() => kept?.walk({})).toThrow(/only valid while transform runs/);
    expect(() => kept?.addImport("m", "x")).toThrow(/only valid while transform runs/);
    expect(kept.is(null, "Literal")).toBe(false);
  });
});

describe("walk and the node helpers", () => {
  it("[PLG-30] enter and leave run in source order, the typed callback after the untyped one", () => {
    const log: string[] = [];
    compile("const a = f(1);\n", {
      filename: "a.ts",
      plugins: [
        {
          name: "walk",
          transform(_ast, context) {
            context.walk({
              enter: (node) => void log.push(`>${node.type}`),
              leave: (node) => void log.push(`<${node.type}`),
              CallExpression: {
                enter: () => void log.push("typed-enter"),
                leave: () => void log.push("typed-leave"),
              },
            });
          },
        },
      ],
    });
    const call = log.indexOf(">CallExpression");
    expect(log[call + 1]).toBe("typed-enter");
    expect(log.indexOf("<CallExpression")).toBe(log.indexOf("typed-leave") + 1);
    expect(log.indexOf(">Identifier")).toBeLessThan(log.indexOf(">CallExpression"));
    expect(log.slice(0, 2)).toEqual([">Program", ">VariableDeclaration"]);
    expect(log[log.length - 1]).toBe("<Program");
  });

  it("[PLG-31] returning false skips the children but still leaves the node", () => {
    const seen: string[] = [];
    compile("const a = f(g(1));\n", {
      filename: "a.ts",
      plugins: [
        {
          name: "skip",
          transform(_ast, context) {
            context.walk({
              CallExpression: {
                enter(node) {
                  seen.push(`enter ${context.text(node)}`);
                  return false;
                },
                leave: (node) => void seen.push(`leave ${context.text(node)}`),
              },
            });
          },
        },
      ],
    });
    expect(seen).toEqual(["enter f(g(1))", "leave f(g(1))"]);
  });

  it("[PLG-32] walk can start at a node and passes the parent", () => {
    const parents: Array<string | null> = [];
    compile("const a = f(g(1));\n", {
      filename: "a.ts",
      plugins: [
        {
          name: "root",
          transform(_ast, context) {
            let outer: import("../src/javascript").PluginNode | null = null;
            context.walk({
              CallExpression(node) {
                outer ??= node;
              },
            });
            if (outer === null) throw new Error("no call");
            context.walk(
              { enter: (_node, parent) => void parents.push(parent?.type ?? null) },
              outer,
            );
          },
        },
      ],
    });
    expect(parents[0]).toBeNull();
    expect(parents.slice(1).every((type) => type !== null)).toBe(true);
  });

  it("[PLG-33] a deeply nested module does not overflow the stack", () => {
    const depth = 20_000;
    const source = `const a = ${Array.from({ length: depth }, () => "1").join(" + ")};\n`;
    let count = 0;
    compile(source, {
      filename: "a.ts",
      plugins: [
        {
          name: "deep",
          transform(_ast, context) {
            context.walk({
              Literal() {
                count += 1;
              },
            });
          },
        },
      ],
    });
    expect(count).toBe(depth);
  });

  it("[PLG-34] a visitor key that is not an own property of the visitor is ignored", () => {
    const inherited = Object.create({ Literal: () => 1 }) as object;
    expect(() =>
      compile("const a = 1;\n", {
        filename: "a.ts",
        plugins: [
          {
            name: "proto",
            transform(_ast, context) {
              context.walk(inherited);
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("[PLG-35] context.is narrows by type and rejects null", () => {
    const results: boolean[] = [];
    compile("const a = f(1);\n", {
      filename: "a.ts",
      plugins: [
        {
          name: "is",
          transform(ast, context) {
            results.push(
              context.is(ast, "Program"),
              context.is(ast, "Literal"),
              context.is(null, "Literal"),
              context.is(undefined, "Literal"),
            );
          },
        },
      ],
    });
    expect(results).toEqual([true, false, false, false]);
  });

  it("[PLG-36] create builds validated text", () => {
    let made: string[] = [];
    let errors: string[] = [];
    compile("const a = 1;\n", {
      filename: "a.ts",
      plugins: [
        {
          name: "create",
          transform(_ast, { create }) {
            made = [
              create.identifier("abc"),
              create.string('a"b\n'),
              create.call("console.log", [create.string("x"), "1"]),
              create.call("f"),
              create.jsxAttribute("data-x"),
              create.jsxAttribute("xlink:href", create.string("#a")),
              create.jsxText("<b>&{}"),
              create.jsxElement("div", [create.jsxAttribute("id", create.string("a"))], ["x"]),
              create.jsxElement("my-element"),
            ];
            const bad = [
              () => create.identifier("1a"),
              () => create.identifier("class"),
              () => create.call("a b"),
              () => create.call("a(); b"),
              () => create.jsxAttribute("a b"),
              () => create.jsxAttribute("a=b"),
              () => create.jsxElement("a b"),
              () => create.jsxElement("<x"),
            ];
            errors = bad.map((run) => {
              try {
                run();
                return "no error";
              } catch (error) {
                return error instanceof TypeError ? "TypeError" : String(error);
              }
            });
          },
        },
      ],
    });
    expect(made).toEqual([
      "abc",
      '"a\\"b\\n"',
      'console.log("x", 1)',
      "f()",
      "data-x",
      'xlink:href={"#a"}',
      '{"<b>&{}"}',
      '<div id={"a"}>x</div>',
      "<my-element />",
    ]);
    expect(errors).toEqual(Array(8).fill("TypeError"));
  });
});

describe("imports", () => {
  const importing = (
    imports: CompilerPlugin["imports"],
    transform: CompilerPlugin["transform"],
    enforce?: "pre" | "post",
  ): CompilerPlugin => ({
    name: "importer",
    ...(imports === undefined ? {} : { imports }),
    ...(enforce === undefined ? {} : { enforce }),
    transform,
  });

  it("[PLG-37] addImport returns a collision-free local name and writes one declaration per module", () => {
    const names: string[] = [];
    const plugin = importing(
      [{ from: "@my/lib", names: ["track", "default"] }],
      (_ast, context) => {
        names.push(
          context.addImport("@my/lib", "track"),
          context.addImport("@my/lib", "track"),
          context.addImport("@my/lib", "default"),
        );
      },
    );
    const result = compile("const _$p_track = 1;\n", { filename: "a.ts", plugins: [plugin] });
    expect(names).toEqual(["_$p_track2", "_$p_track2", "_$p_default"]);
    expect(result.code).toBe(
      'import { track as _$p_track2, default as _$p_default } from "@my/lib";\nconst _$p_track = 1;\n',
    );
  });

  it("[PLG-44] an import comes before an insert at the same position", () => {
    const plugin = importing([{ from: "@my/lib", names: ["track"] }], (ast, context) => {
      context.insertAfter(ast, `${context.addImport("@my/lib", "track")}();\n`);
    });
    const result = compile("", { filename: "a.ts", plugins: [plugin] });
    expect(result.code).toBe('import { track as _$p_track } from "@my/lib";\n_$p_track();\n');
  });

  it("[PLG-38] a declared addImport is added after the directive prologue", () => {
    const plugin = importing([{ from: "@my/lib", names: ["track"] }], (ast, context) => {
      const track = context.addImport("@my/lib", "track");
      context.insertAfter(ast, `${track}("loaded");\n`);
    });
    const result = compile('"use client";\nconst _$p_track = 1;\nexport const a = 1;\n', {
      filename: "a.ts",
      plugins: [plugin],
    });
    expect(result.code).toBe(
      '"use client";\nimport { track as _$p_track2 } from "@my/lib";\nconst _$p_track = 1;\nexport const a = 1;\n_$p_track2("loaded");\n',
    );
  });

  it("[PLG-39] a pair that is not declared is PLUGIN_UNDECLARED_IMPORT", () => {
    const wrongName = failure(() =>
      compile("export const a = 1;\n", {
        filename: "a.ts",
        plugins: [
          importing(
            [{ from: "@my/lib", names: ["track"] }],
            (_ast, c) => void c.addImport("@my/lib", "other"),
          ),
        ],
      }),
    );
    expect(wrongName.diagnostic.code).toBe("PLUGIN_UNDECLARED_IMPORT");
    const none = failure(() =>
      compile("export const a = 1;\n", {
        filename: "a.ts",
        plugins: [importing(undefined, (_ast, c) => void c.addImport("@my/lib", "track"))],
      }),
    );
    expect(none.diagnostic.code).toBe("PLUGIN_UNDECLARED_IMPORT");
    expect(none.diagnostic.plugin).toBe("importer");
  });

  it("[PLG-40] an import written in an edit must be declared too", () => {
    const sneaky = (imports?: CompilerPlugin["imports"]): CompilerPlugin =>
      importing(imports, (ast, context) => {
        context.insertBefore(ast, 'import { evil } from "evil";\n');
      });
    const error = failure(() =>
      compile("export const a = 1;\n", { filename: "a.ts", plugins: [sneaky()] }),
    );
    expect(error.diagnostic.code).toBe("PLUGIN_UNDECLARED_IMPORT");
    expect(error.message).toContain('"evil"');
    const declared = compile("export const a = 1;\n", {
      filename: "a.ts",
      plugins: [sneaky([{ from: "evil", names: ["evil"] }])],
    });
    expect(declared.code).toContain('import { evil } from "evil";');
    const sideEffect = failure(() =>
      compile("export const a = 1;\n", {
        filename: "a.ts",
        plugins: [importing(undefined, (ast, c) => c.insertBefore(ast, 'import "side";\n'))],
      }),
    );
    expect(sideEffect.diagnostic.code).toBe("PLUGIN_UNDECLARED_IMPORT");
  });

  it("[PLG-41] a post plugin may not remove or change the runtime imports of the generated code", () => {
    const strip = (replacement: string): CompilerPlugin => ({
      name: "strip",
      enforce: "post",
      transform(_ast, context) {
        context.walk({
          ImportDeclaration(node) {
            if (node.source.value === "@shadow-js/web") context.replace(node, replacement);
          },
        });
      },
    });
    const removed = failure(() => compile(SOURCE, { filename: "a.tsx", plugins: [strip("")] }));
    expect(removed.diagnostic.code).toBe("PLUGIN_IMPORT_MODIFIED");
    expect(removed.diagnostic.plugin).toBe("strip");
    const changed = failure(() =>
      compile(SOURCE, {
        filename: "a.tsx",
        plugins: [strip('import { template } from "@shadow-js/web";')],
      }),
    );
    expect(changed.diagnostic.code).toBe("PLUGIN_IMPORT_MODIFIED");
  });

  it("[PLG-42] a post plugin may add a declared import, even from the runtime module", () => {
    const plugin = importing(
      [{ from: "@shadow-js/web", names: ["mergeProps"] }],
      (ast, context) => {
        const merge = context.addImport("@shadow-js/web", "mergeProps");
        context.insertAfter(ast, `export const merged = ${merge};\n`);
      },
      "post",
    );
    const result = compile(SOURCE, { filename: "a.tsx", plugins: [plugin] });
    expect(result.code).toContain('import { mergeProps as _$p_mergeProps } from "@shadow-js/web";');
    expect(result.code).toContain("export const merged = _$p_mergeProps;");
  });

  it("[PLG-43] a type-only import is not an import of the runtime", () => {
    const plugin: CompilerPlugin = {
      name: "types",
      transform(ast, context) {
        context.insertBefore(ast, 'import type { T } from "types-only";\n');
      },
    };
    const result = compile("export const a = 1;\n", { filename: "a.ts", plugins: [plugin] });
    expect(result.code).toContain('import type { T } from "types-only";');
  });
});
