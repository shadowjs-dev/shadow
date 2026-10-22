import { describe, expect, it } from "vitest";
import shadow from "../src/index";

type Plugin = ReturnType<typeof shadow>;
type Position = { line: number; column: number };
type Failure = { message: string; position: Position | undefined };
type TransformHook = (
  this: { error(message: string, position?: Position): never },
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => unknown;

const CALLER = "const Badge = () => <i>b</i>;\nexport const App = () => <main><Badge /></main>;";
const SOURCE = "export const App = () => <button onClick={() => 1}>hi</button>;";

function configure(plugin: Plugin, command: "serve" | "build", mode = "development"): void {
  const hook = plugin.config;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  (fn as (config: object, env: { command: string; mode: string }) => unknown)(
    {},
    { command, mode },
  );
}

function transformer(plugin: Plugin, failures: Failure[] = []) {
  const hook = plugin.transform;
  const fn = (typeof hook === "function" ? hook : hook?.handler) as TransformHook | undefined;
  if (fn === undefined) throw new Error("plugin has no transform");
  const context = {
    error(message: string, position?: Position): never {
      failures.push({ message, position });
      throw new Error(message);
    },
  };
  return (code: string, id: string, ssr = false): unknown => fn.call(context, code, id, { ssr });
}

function compiledCode(plugin: Plugin, code: string, id: string, ssr = false): string | null {
  const result = transformer(plugin)(code, id, ssr) as { code: string } | null;
  return result === null ? null : result.code;
}

function buildPlugin(options?: Parameters<typeof shadow>[0]): Plugin {
  const plugin = shadow(options);
  configure(plugin, "build", "production");
  return plugin;
}

describe("shadow() Vite plugin contract", () => {
  it("[VIT-16] the plugin is named shadowjs and compiles under both serve and build", () => {
    const plugin = shadow();
    expect(plugin.name).toBe("shadowjs");
    for (const command of ["serve", "build"] as const) {
      const fresh = shadow();
      configure(fresh, command);
      expect(compiledCode(fresh, SOURCE, "/app/a.tsx")).toContain("template");
    }
  });

  it("[VIT-17] the default include matches .tsx and .jsx only", () => {
    const plugin = buildPlugin();
    expect(compiledCode(plugin, SOURCE, "/app/a.tsx")).not.toBeNull();
    expect(compiledCode(plugin, SOURCE, "/app/a.jsx")).not.toBeNull();
    expect(compiledCode(plugin, SOURCE, "/app/a.js")).toBeNull();
    expect(compiledCode(plugin, SOURCE, "/app/a.mjs")).toBeNull();
    expect(compiledCode(plugin, SOURCE, "/app/a.mts")).toBeNull();
  });

  it("[VIT-18] the default exclude also matches Windows path separators", () => {
    const plugin = buildPlugin();
    expect(compiledCode(plugin, SOURCE, "C:\\app\\node_modules\\pkg\\a.tsx")).toBeNull();
    expect(compiledCode(plugin, SOURCE, "C:\\app\\src\\a.tsx")).not.toBeNull();
  });

  it("[VIT-19] exclude is checked before include, so an excluded file that include matches is skipped", () => {
    const plugin = buildPlugin({
      include: /\.tsx$/,
      exclude: /[\\/]generated[\\/]/,
    });
    expect(compiledCode(plugin, SOURCE, "/app/generated/a.tsx")).toBeNull();
    expect(compiledCode(plugin, SOURCE, "/app/src/a.tsx")).not.toBeNull();
  });

  it("[VIT-20] query strings are ignored for matching, and the filename in the output has none", () => {
    const plugin = buildPlugin();
    expect(compiledCode(plugin, SOURCE, "/app/a.tsx?import")).toContain("template");
    expect(compiledCode(plugin, SOURCE, "/app/a.tsx?v=123")).toContain("template");
    expect(compiledCode(plugin, SOURCE, "/app/a.ts?raw")).toBeNull();
    expect(compiledCode(plugin, SOURCE, "/app/node_modules/pkg/a.tsx?import")).toBeNull();
    const result = transformer(plugin)(SOURCE, "/app/a.tsx?import", false) as {
      map: { sources: string[] };
    };
    expect(result.map.sources).toEqual(["/app/a.tsx"]);
  });

  it("[VIT-21] a source map is produced in serve and build, names the file and carries the original source", () => {
    for (const command of ["serve", "build"] as const) {
      const plugin = shadow();
      configure(plugin, command);
      const result = transformer(plugin)(SOURCE, "/app/a.tsx", false) as {
        map: { version: number; sources: string[]; sourcesContent: string[]; mappings: string };
      };
      expect(result.map.version).toBe(3);
      expect(result.map.sources).toEqual(["/app/a.tsx"]);
      expect(result.map.sourcesContent).toEqual([SOURCE]);
      expect(result.map.mappings.length).toBeGreaterThan(0);
    }
  });

  it("[VIT-22] a production build ships no development-only code", () => {
    const plugin = buildPlugin();
    const code = compiledCode(plugin, SOURCE, "/app/a.tsx") ?? "";
    expect(code).toContain("template");
    expect(code).not.toContain("_$component(");
    expect(code).not.toContain("@shadow-js/web/hmr");
    expect(code).not.toContain("import.meta.hot");
  });

  it("[VIT-23] dev: true in a production build changes the output and adds the component name", () => {
    const plugin = shadow({ dev: true });
    configure(plugin, "build", "production");
    const code = compiledCode(plugin, CALLER, "/app/a.tsx") ?? "";
    const plain = compiledCode(buildPlugin(), CALLER, "/app/a.tsx") ?? "";
    expect(code).not.toBe(plain);
    expect(code).toContain('"Badge"');
    expect(plain).not.toContain('"Badge"');
  });

  it("[VIT-24] dev: false in vite dev removes the development output", () => {
    const plugin = shadow({ dev: false });
    configure(plugin, "serve");
    const code = compiledCode(plugin, SOURCE, "/app/a.tsx") ?? "";
    expect(code).not.toContain("_$component(");
    expect(code).not.toContain("_$registry(");
  });

  it("[VIT-25] hmr: false in vite dev keeps hot-update wiring out, even outside a test runner", () => {
    const saved = process.env["VITEST"];
    delete process.env["VITEST"];
    try {
      const plugin = shadow({ hmr: false });
      configure(plugin, "serve");
      const code = compiledCode(plugin, SOURCE, "/app/a.tsx") ?? "";
      expect(code).not.toContain("import.meta.hot");
      expect(code).not.toContain("@shadow-js/web/hmr");
    } finally {
      if (saved !== undefined) process.env["VITEST"] = saved;
    }
  });

  it("[VIT-26] a custom moduleName is the import source of the compiled runtime", () => {
    const plugin = buildPlugin({ moduleName: "@acme/runtime" });
    const code = compiledCode(plugin, SOURCE, "/app/a.tsx") ?? "";
    expect(code).toContain('from "@acme/runtime"');
    expect(code).not.toContain('from "@shadow-js/web"');
  });

  it("[VIT-27] a compile error names the file, the line and the column, and is passed to the plugin context", () => {
    const plugin = buildPlugin();
    const failures: Failure[] = [];
    const source = [
      "export const A = () => 1;",
      "export const B = () => 2;",
      "export const C = () => <div>;",
    ].join("\n");
    expect(() => transformer(plugin, failures)(source, "/app/err.tsx")).toThrow(
      /\/app\/err\.tsx:3:\d+ PARSE_ERROR/,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.position?.line).toBe(3);
    expect(failures[0]?.position?.column).toBeGreaterThan(0);
    expect(failures[0]?.message).toContain("/app/err.tsx:3:");
  });

  it("[VIT-28] compiling the same input twice gives the same code and the same map", () => {
    const plugin = buildPlugin();
    const run = transformer(plugin);
    const first = run(SOURCE, "/app/a.tsx") as { code: string; map: unknown };
    const second = run(SOURCE, "/app/a.tsx") as { code: string; map: unknown };
    expect(second.code).toBe(first.code);
    expect(second.map).toEqual(first.map);
  });

  it("[VIT-29] compiled output is not compiled again: a second pass returns null", () => {
    const plugin = buildPlugin();
    const once = compiledCode(plugin, SOURCE, "/app/a.tsx");
    expect(once).not.toBeNull();
    expect(compiledCode(plugin, once ?? "", "/app/a.tsx")).toBeNull();
  });

  it("[VIT-30] an invalid include value is rejected when the plugin is created, naming include", () => {
    // Without this, the transform would fail later with "include.test is not a function".
    expect(() => shadow({ include: "x" as unknown as RegExp })).toThrow(/include/);
  });

  it("[VIT-31] an invalid exclude value is rejected when the plugin is created, naming exclude", () => {
    expect(() => shadow({ exclude: 5 as unknown as RegExp })).toThrow(/exclude/);
  });

  it("[VIT-32] a non-string moduleName is rejected when the plugin is created, naming moduleName", () => {
    // Without this, the value would be written into the import as `from 5`.
    expect(() => shadow({ moduleName: 5 as unknown as string })).toThrow(/moduleName/);
  });

  it("[VIT-33] a virtual module id (NUL prefix) is never compiled", () => {
    // Vite's convention: plugins skip \0-prefixed virtual ids, although their suffix may look like source.
    const plugin = buildPlugin();
    expect(compiledCode(plugin, SOURCE, "\0/app/v.tsx")).toBeNull();
  });
});
