import { describe, expect, it } from "vitest";
import { specializeStoreCells } from "../src/internal/store-cells";
import { compile } from "../src/javascript";
import { load } from "./support/load";

const IMPORT = 'import { useStore } from "@shadow-js/core";\n';
const ALIAS_IMPORT = 'import { useSignal as useShadowSignal } from "@shadow-js/core";\n';

function rewrite(source: string, filename = "m.ts"): string {
  return specializeStoreCells(source, filename).code;
}

describe("useStore(<single value>) takes the cell path", () => {
  it("[SC-1] a primitive initial is rewritten, the import is added, the original import stays", () => {
    const input = `${IMPORT}const [n, setN] = useStore(0);\n`;
    expect(rewrite(input)).toBe(`${ALIAS_IMPORT}${IMPORT}const [n, setN] = useShadowSignal(0);\n`);
    expect(specializeStoreCells(input, "m.ts").changed).toBe(true);
  });

  const cases: Array<[string, string]> = [
    ["string literal", '"ready"'],
    ["boolean literal", "false"],
    ["negative number", "-1"],
    ["bigint literal", "1n"],
    ["null", "null"],
    ["undefined", "undefined"],
    ["template literal", "`n" + "$" + "{1}`"],
    ["arrow function", "() => 0"],
    ["function expression", "function () { return 0; }"],
    ["Date", "new Date(0)"],
  ];
  for (const [label, init] of cases) {
    it(`[SC-1] ${label} is a single value`, () => {
      const out = rewrite(`${IMPORT}const [v] = useStore(${init});\n`);
      expect(out).toContain("useShadowSignal(");
      expect(out).not.toContain("= useStore(");
    });
  }

  it("[SC-2] object and array literals keep useStore (they need the deep store)", () => {
    for (const init of ["{ items: [] }", "[1, 2]", "{}"]) {
      const input = `${IMPORT}const [v] = useStore(${init});\n`;
      expect(rewrite(input)).toBe(input);
    }
  });

  it("[SC-2] dynamic initial values keep useStore (only the run-time value decides)", () => {
    for (const init of ["initial", "make()", "flag ? 1 : 2", "cache.value", "a as number"]) {
      const input = `${IMPORT}const [v] = useStore(${init});\n`;
      expect(rewrite(input)).toBe(input);
    }
  });

  it("[SC-3] a primitive type argument keeps the generic and the cell path", () => {
    expect(rewrite(`${IMPORT}const [v] = useStore<number>(0);\n`)).toContain(
      "useShadowSignal<number>(0)",
    );
    expect(rewrite(`${IMPORT}const [v] = useStore<string | null>(null);\n`)).toBe(
      `${IMPORT}const [v] = useStore<string | null>(null);\n`,
    );
  });

  it("[SC-3] a mixed or object type argument keeps useStore (plain data may be written later)", () => {
    for (const type of ["Todo[] | null", "{ done: boolean }", "number | Todo"]) {
      const input = `${IMPORT}const [v] = useStore<${type}>(null);\n`;
      expect(rewrite(input)).toBe(input);
    }
  });

  it("[SC-4] an aliased import is followed", () => {
    const input = 'import { useStore as store } from "@shadow-js/core";\nconst [v] = store(0);\n';
    expect(rewrite(input)).toContain("const [v] = useShadowSignal(0);");
  });

  it("[SC-5] a namespace import is followed", () => {
    const input = 'import * as core from "@shadow-js/core";\nconst [v] = core.useStore(0);\n';
    expect(rewrite(input)).toContain("const [v] = useShadowSignal(0);");
  });

  it("[SC-6] the /store entry is followed; the cell import comes from the core entry", () => {
    const input = 'import { useStore } from "@shadow-js/core/store";\nconst [v] = useStore(0);\n';
    const out = rewrite(input);
    expect(out.startsWith(ALIAS_IMPORT)).toBe(true);
    expect(out).toContain("const [v] = useShadowSignal(0);");
  });

  it("[SC-7] a shadowing parameter or declaration leaves the call alone", () => {
    const parameter = `${IMPORT}function f(useStore) { return useStore(0); }\n`;
    expect(rewrite(parameter)).toBe(parameter);
    const declaration = `${IMPORT}const useStore = (x) => x;\nconst v = useStore(0);\n`;
    expect(rewrite(declaration)).toBe(declaration);
  });

  it("[SC-8] a wrapper from another package, or a re-export, is left alone", () => {
    const wrapper = 'import { useStore } from "@shadow-js/dusk";\nconst [v] = useStore(0);\n';
    expect(rewrite(wrapper)).toBe(wrapper);
    const reexport = 'export { useStore } from "@shadow-js/core";\n';
    expect(rewrite(reexport)).toBe(reexport);
  });

  it("[SC-9] an options object with only `name` is kept; other options are not", () => {
    expect(rewrite(`${IMPORT}const [v] = useStore(0, { name: "count" });\n`)).toContain(
      'useShadowSignal(0, { name: "count" })',
    );
    const other = `${IMPORT}const [v] = useStore(0, { equals: same });\n`;
    expect(rewrite(other)).toBe(other);
    const variable = `${IMPORT}const [v] = useStore(0, opts);\n`;
    expect(rewrite(variable)).toBe(variable);
  });

  it("[SC-10] a directive prologue and a shebang keep their meaning", () => {
    const directive = `"use client";\n${IMPORT}const [v] = useStore(0);\n`;
    expect(
      rewrite(directive).startsWith('"use client";\nimport { useSignal as useShadowSignal }'),
    ).toBe(true);
    const shebang = `#!/usr/bin/env node\n${IMPORT}const [v] = useStore(0);\n`;
    expect(rewrite(shebang).startsWith("#!/usr/bin/env node\nimport { useSignal as")).toBe(true);
  });

  it("[SC-11] the alias never collides with a name the module already uses", () => {
    const input = `${IMPORT}const useShadowSignal = 1;\nconst [v] = useStore(0);\n`;
    const out = rewrite(input);
    expect(out).toContain("import { useSignal as useShadowSignal2 }");
    expect(out).toContain("const [v] = useShadowSignal2(0);");
  });

  it("[SC-12] a module that does not import useStore from the core is untouched", () => {
    const input = "const [v] = useStore(0);\n";
    expect(specializeStoreCells(input, "m.ts")).toEqual({
      code: input,
      changed: false,
      origin: null,
    });
  });

  it("[SC-13] a JSX module is specialized and still compiled", () => {
    const input = `${IMPORT}export const view = () => { const [n] = useStore(0); return <p>{n()}</p>; };\n`;
    const out = compile(input, { filename: "app.tsx" });
    expect(out.transformed).toBe(true);
    expect(out.code).toContain("useShadowSignal(0)");
    expect(out.code).toContain('_$template("<p></p>")');
  });

  it("[SC-13] a plain module with a store call reports that it changed", () => {
    const out = compile(`${IMPORT}export const [v] = useStore(0);\n`, { filename: "store.ts" });
    expect(out.transformed).toBe(true);
    const untouched = compile("export const x = 1;\n", { filename: "plain.ts" });
    expect(untouched.transformed).toBe(false);
  });

  it("[SC-13] a plain module with generics and a store call is rewritten, and no JSX pass runs on it", () => {
    const source = `${IMPORT}export function first<T>(items: Array<T>): T | undefined { return items[0]; }\nexport const [n] = useStore<number>(0);\n`;
    const out = compile(source, { filename: "generic.ts" });
    expect(out.transformed).toBe(true);
    expect(out.code).toContain("useShadowSignal<number>(0)");
    // Nothing else changes: the generics and the function survive byte for byte.
    expect(out.code).toContain(
      "export function first<T>(items: Array<T>): T | undefined { return items[0]; }",
    );
    expect(out.code).not.toContain("_$");
  });
});

describe("the cell path behaves like the generic path", () => {
  // Two modules that differ only in the initial value's form: a literal (rewritten to the cell path)
  // and an identifier (the generic useStore). They must record the same reads, writes and runs.
  async function scenario(initialForm: string, initialValue: string): Promise<unknown[]> {
    const mod = await load<{ run: () => unknown[] }>(`
      import { createRoot, flushSync, useEffect, useStore } from "@shadow-js/core";
      const seed = ${initialValue};
      export function run() {
        const log = [];
        const dispose = createRoot((done) => {
          const [value, setValue] = useStore(${initialForm});
          useEffect(() => { log.push(["effect", value()]); });
          log.push(["read", value()]);
          log.push(["set", setValue((previous) => previous === seed ? seed : previous)]);
          log.push(["set-null", setValue(null)]);
          log.push(["set-fn", typeof setValue(() => 1)]);
          return done;
        });
        flushSync();
        dispose();
        return log;
      }
    `);
    return mod.run();
  }

  it("[SC-14] numeric cell: same reads, writes and effect runs as the generic path", async () => {
    const literal = await scenario("0", "0");
    const generic = await scenario("seed", "0");
    expect(literal).toEqual(generic);
    expect(literal).toEqual([
      ["read", 0],
      ["set", 0],
      ["set-null", null],
      ["set-fn", "number"],
      ["effect", 1],
    ]);
  });

  it("[SC-14] a null cell: same behavior through the cell path", async () => {
    const literal = await scenario("null", "null");
    const generic = await scenario("seed", "null");
    expect(literal).toEqual(generic);
  });
});
