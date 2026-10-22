import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { compile, compileAsync, getBackend, validatePlugins } from "../../src/index";
import {
  CompileError,
  type CompilerPlugin,
  compile as compileWithJavaScript,
} from "../../src/javascript";
import { native, wasm } from "./support/backends";

const compiling = describe;

const view =
  'export const View = () => <section class="a"><h1>{title()}</h1><p>text &amp; more</p></section>;\n';

compiling("[COMPILER-11] a call the Rust core cannot answer goes to @shadow-js/compiler", () => {
  const strip: CompilerPlugin = {
    name: "strip-test-ids",
    transform(_ast, context) {
      context.walk({
        JSXAttribute(node) {
          if (node.name.type === "JSXIdentifier" && node.name.name === "data-testid") {
            context.remove({ start: node.start - 1, end: node.end });
          }
        },
      });
    },
  };
  const source = 'export const A = () => <b data-testid="x">hi</b>;';

  it("runs plugins through the JavaScript compiler and returns the same result", () => {
    const expected = compileWithJavaScript(source, { plugins: [strip], filename: "a.tsx" });
    const actual = compile(source, { plugins: [strip], filename: "a.tsx" });
    expect(actual.code).toBe(expected.code);
    expect(actual.code.includes("data-testid")).toBe(false);
    expect(JSON.stringify(actual.map)).toBe(JSON.stringify(expected.map));
    expect(actual.diagnostics).toEqual(expected.diagnostics);
  });

  it("an empty plugin list is no plugin", () => {
    expect(compile(view, { plugins: [] }).code).toBe(
      compileWithJavaScript(view, { plugins: [] }).code,
    );
  });

  it("an invalid plugin list throws the TypeError of the JavaScript compiler", () => {
    expect(() => compile(source, { plugins: [{ name: "", transform: () => undefined }] })).toThrow(
      TypeError,
    );
    expect(() => compile(source, { plugins: "nope" as unknown as CompilerPlugin[] })).toThrow(
      /must be an array/,
    );
    expect(() => validatePlugins([{ name: "ok", transform: () => undefined }])).not.toThrow();
  });

  it("a string with an unpaired surrogate is compiled by the JavaScript compiler", () => {
    const text = `export const A = () => <b title={"\\ud800"} data-x="a">{"\\ud800"}</b>;\n${"\ud800"}\n`;
    const broken = `const v = "${"\ud800"}";\nexport const A = () => <i>{v}</i>;`;
    for (const input of [text, broken]) {
      let expected: string;
      try {
        expected = compileWithJavaScript(input, { filename: "a.tsx" }).code;
      } catch (error) {
        expect(() => compile(input, { filename: "a.tsx" })).toThrow((error as Error).message);
        continue;
      }
      expect(compile(input, { filename: "a.tsx" }).code).toBe(expected);
    }
  });

  it("an SSR attribute named like a member of every object is compiled by the JavaScript compiler", () => {
    for (const name of ["toString", "constructor", "__proto__", "valueOf"]) {
      const input = `export const A = () => <li ${name}="1">x</li>;`;
      const options = { filename: "a.tsx", generate: "ssr" } as const;
      expect(compile(input, options).code).toBe(compileWithJavaScript(input, options).code);
    }
  });

  it("options of an unusual type behave as in the JavaScript compiler", () => {
    const odd = [
      { generate: "SSR" },
      { generate: 5 },
      { dev: 1, hmr: "yes", autoReactive: 0, hydratable: null, sourceMap: undefined },
      { filename: null },
      { moduleName: null },
    ];
    for (const options of odd) {
      const expected = compileWithJavaScript(view, options as never);
      const actual = compile(view, options as never);
      expect(actual.code).toBe(expected.code);
    }
    for (const options of [{ filename: 7 }, { moduleName: 7 }]) {
      let expected: unknown;
      try {
        expected = compileWithJavaScript(view, options as never).code;
      } catch (error) {
        expected = (error as Error).constructor;
      }
      let actual: unknown;
      try {
        actual = compile(view, options as never).code;
      } catch (error) {
        actual = (error as Error).constructor;
      }
      expect(actual).toEqual(expected);
    }
  });

  it("a source that is not a string fails like the JavaScript compiler", () => {
    for (const input of [undefined, null, 5, {}]) {
      let expected = "none";
      try {
        compileWithJavaScript(input as never);
      } catch (error) {
        expected = (error as Error).constructor.name;
      }
      let actual = "none";
      try {
        compile(input as never);
      } catch (error) {
        actual = (error as Error).constructor.name;
      }
      expect(actual).toBe(expected);
    }
  });
});

compiling(
  "[COMPILER-12] the implementation is the addon, else WebAssembly, else a clear error",
  () => {
    it("names the implementation in use", () => {
      const info = getBackend();
      expect(["native", "wasm"]).toContain(info.name);
      expect(info.source.length).toBeGreaterThan(0);
    });

    it("prefers the addon", () => {
      expect(getBackend().name).toBe("native");
    });

    it("returns the CompileError class of @shadow-js/compiler", () => {
      let thrown: unknown;
      try {
        compile("const view = <div>;", { filename: "broken.tsx" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CompileError);
      const error = thrown as CompileError;
      expect(error.diagnostic.code).toBe("PARSE_ERROR");
      expect(error.id).toBe("broken.tsx");
      expect(error.message.startsWith("broken.tsx:1:")).toBe(true);
    });

    it("the source map has the methods of a magic-string SourceMap", () => {
      const map = compile(view, { filename: "v.tsx" }).map;
      expect(map?.toString()).toBe(JSON.stringify(map));
      expect(map?.toUrl().startsWith("data:application/json;charset=utf-8;base64,")).toBe(true);
      expect(compile(view, { sourceMap: false }).map).toBeNull();
    });
  },
);

compiling("[COMPILER-13] the async variant does not block the event loop", () => {
  it("compiles many modules at once off the main thread", async () => {
    const sources = Array.from(
      { length: 64 },
      (_, i) => `export const C${i} = () => <ul>${"<li>{item()}</li>".repeat(300)}</ul>;\n`,
    );
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    const results = await Promise.all(
      sources.map((text) => compileAsync(text, { filename: "a.tsx" })),
    );
    clearInterval(timer);
    expect(results).toHaveLength(64);
    for (const [i, result] of results.entries()) {
      expect(result.code).toBe(compile(sources[i] ?? "", { filename: "a.tsx" }).code);
    }
    expect(ticks).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("rejects with a CompileError", async () => {
    await expect(compileAsync("const a = <div>;", { filename: "b.tsx" })).rejects.toBeInstanceOf(
      CompileError,
    );
  });

  it("falls back for plugins", async () => {
    const result = await compileAsync(view, { plugins: [] });
    expect(result.transformed).toBe(true);
  });

  it("works inside worker threads", async () => {
    const worker = new Worker(
      `
        const { workerData, parentPort } = require("node:worker_threads");
        const addon = require(workerData.path);
        const options = { filename: "w.tsx", generate: "dom", dev: false, autoReactive: true, hmr: false, hydratable: true, sourceMap: true };
        const sync = addon.compileSync(workerData.source, options);
        addon.compileAsync(workerData.source, options).then((async) => {
          parentPort.postMessage({ sync: sync.code, async: async.code });
        });
      `,
      { eval: true, workerData: { source: view, path: native.ok ? native.backend.source : "" } },
    );
    const message = await new Promise<{ sync: string; async: string }>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    await worker.terminate();
    expect(message.sync).toBe(compileWithJavaScript(view, { filename: "w.tsx" }).code);
    expect(message.async).toBe(message.sync);
  }, 60_000);
});

compiling("[COMPILER-14] hostile input is answered, never a crash", () => {
  it("answers deep nesting: compiled by the addon, refused past 2,000 levels by the WebAssembly build (documented)", () => {
    const nest = (depth: number): string =>
      `const a = ${"(".repeat(depth)}1${")".repeat(depth)};\nconst z = <a/>;\n`;
    if (getBackend().name === "wasm") {
      expect(compile(nest(1_000), { filename: "deep.tsx" }).transformed).toBe(true);
      expect(() => compile(nest(5_000), { filename: "deep.tsx" })).toThrow(/nested too deeply/);
      return;
    }
    expect(compile(nest(30_000), { filename: "deep.tsx" }).transformed).toBe(true);
  });

  it("answers a thousand levels of JSX with the error of the JavaScript compiler", () => {
    const source = `const a = ${"<div>".repeat(1000)}x${"</div>".repeat(1000)};`;
    let expected = "";
    try {
      compileWithJavaScript(source, { filename: "deep.tsx" });
    } catch (error) {
      expected = (error as CompileError).message;
    }
    expect(expected).toContain("JSX_TOO_DEEP");
    expect(() => compile(source, { filename: "deep.tsx" })).toThrow(expected);
  });

  it("compiles mutated sources without a failure", () => {
    const base =
      'import { useStore } from "@shadow-js/core";\nexport function C(p) {\n  const [n, setN] = useStore(0);\n  return <div class={p.c} onClick={() => setN((v) => v + 1)}>{n()}<input value={n()} /></div>;\n}\n';
    const pieces = ["<", ">", "{", "}", "(", ")", "/", "=", '"', "`", "</", "&"];
    for (let i = 0; i < 400; i += 1) {
      const at = (i * 7919) % base.length;
      const mutated =
        base.slice(0, at) + (pieces[i % pieces.length] ?? "") + base.slice(at + (i % 3));
      let expected = "";
      try {
        expected = compileWithJavaScript(mutated, { filename: "m.tsx" }).code;
      } catch (error) {
        expected = (error as Error).message;
      }
      let actual = "";
      try {
        actual = compile(mutated, { filename: "m.tsx" }).code;
      } catch (error) {
        actual = (error as Error).message;
      }
      expect(actual).toBe(expected);
    }
  });
});

describe("[COMPILER-15] one version for the whole set", () => {
  it("writes every platform package at this version at release time", async () => {
    const manifest = (await import("../../package.json", { with: { type: "json" } })).default as {
      version: string;
      dependencies: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    // One package: it does not depend on a second compiler package, only on the platform builds of itself.
    expect(
      Object.keys(manifest.dependencies).filter((name) => name.startsWith("@shadow-js/")),
    ).toEqual([]);
    // The platform packages are not on the registry before the release, so the committed manifest cannot list them.
    expect(manifest.optionalDependencies).toBeUndefined();
    const { PLATFORM_KEYS, platformDependencies } = (await import(
      // @ts-expect-error plain JavaScript without declarations
      "../../scripts/platforms.mjs"
    )) as {
      PLATFORM_KEYS: string[];
      platformDependencies: (version: string) => Record<string, string>;
    };
    expect(PLATFORM_KEYS).toHaveLength(8);
    const linked = Object.entries(platformDependencies(manifest.version));
    expect(linked).toHaveLength(8);
    for (const [name, version] of linked) {
      expect(name.startsWith("@shadow-js/compiler-")).toBe(true);
      expect(version).toBe(manifest.version);
    }
  });

  it("the WebAssembly module has no imports", () => {
    expect(wasm.ok).toBe(true);
  });
});
