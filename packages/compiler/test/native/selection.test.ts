import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Backend, RawOutput } from "../../src/native/backend";

const SOURCE = "export const A = () => <b>hi</b>;";
/**
 * Listens for process warnings in place of the default printer (so an expected warning does not reach the test output) until the returned
 * function puts the printer back.
 */
function listenAlone(listener: (warning: Error & { code?: string }) => void): () => void {
  const previous = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", listener);
  return () => {
    process.off("warning", listener);
    for (const entry of previous) process.on("warning", entry);
  };
}

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** The modules a source file reaches through relative imports, as paths under `src/`. */
function reachable(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const text = readFileSync(join(src, file), "utf8");
    seen.set(file, text);
    for (const match of text.matchAll(/(?:from|import\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      queue.push(`${normalize(join(dirname(file), match[1] as string))}.ts`);
    }
  }
  return seen;
}

describe("the entries", () => {
  it("[COMPILER-01] the TypeScript entry reaches no loader, no auto entry and no Node.js module", () => {
    const graph = reachable("javascript.ts");
    expect(graph.size).toBeGreaterThan(10);
    for (const [file, text] of graph) {
      expect(file.startsWith("native/"), file).toBe(false);
      expect(file, file).not.toBe("auto.ts");
      expect(file, file).not.toBe("index.ts");
      expect(text, file).not.toMatch(/from\s+["']node:/);
      expect(text, file).not.toMatch(/\bprocess\.(?:env|emitWarning|platform)\b/);
    }
  });

  it("[COMPILER-02] the package is side-effect free and builds one file per module", () => {
    const root = join(src, "..");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      sideEffects?: unknown;
    };
    expect(manifest.sideEffects).toBe(false);
    // One output file per source module: the built JavaScript entry is small and the modules it imports are files of their own.
    const entry = join(root, "dist", "prod", "javascript.js");
    if (!existsSync(entry)) return;
    expect(readFileSync(entry, "utf8").length).toBeLessThan(2_000);
    expect(
      readdirSync(join(root, "dist", "prod"), { recursive: true }).filter((file) =>
        String(file).endsWith(".js"),
      ).length,
    ).toBeGreaterThan(10);
  });

  it("[COMPILER-04] both entries answer getBackend with the same shape; the TypeScript entry always says javascript", async () => {
    const javascript = await import("../../src/javascript");
    expect(javascript.getBackend()).toEqual({
      name: "javascript",
      source: "@shadow-js/compiler",
      notes: [],
    });
    const auto = await import("../../src/index");
    expect(Object.keys(auto.getBackend()).sort()).toEqual(["name", "notes", "source"]);
    // Same names on both entries, so code written for one runs on the other.
    for (const name of [
      "compile",
      "compileAsync",
      "getBackend",
      "CompileError",
      "validatePlugins",
    ]) {
      expect(typeof (javascript as Record<string, unknown>)[name], name).toBe(
        typeof (auto as Record<string, unknown>)[name],
      );
    }
  });

  it("[COMPILER-05] compileAsync of the TypeScript entry gives what compile gives, and rejects with the same error", async () => {
    const { compile, compileAsync, CompileError } = await import("../../src/javascript");
    expect((await compileAsync(SOURCE, { filename: "a.tsx" })).code).toBe(
      compile(SOURCE, { filename: "a.tsx" }).code,
    );
    await expect(compileAsync("const v = <div>;")).rejects.toBeInstanceOf(CompileError);
  });
});

/** The auto entry as a fresh import with both loaders replaced, and the environment variable set. */
async function autoWith(
  options: {
    native?: "missing" | "broken" | Backend;
    wasm?: "missing" | Backend;
    request?: string;
  } = {},
) {
  const loads = { native: 0, wasm: 0 };
  vi.resetModules();
  if (options.request === undefined) delete process.env["SHADOW_COMPILER_BACKEND"];
  else process.env["SHADOW_COMPILER_BACKEND"] = options.request;
  vi.doMock("../../src/native/backend", () => ({
    loadNative: () => {
      loads.native += 1;
      const native = options.native ?? "missing";
      if (typeof native !== "string") return { ok: true, backend: native };
      return {
        ok: false,
        reason: native === "missing" ? "no addon here" : "the addon is corrupt",
        missing: native === "missing",
      };
    },
    loadWasm: () => {
      loads.wasm += 1;
      const wasm = options.wasm ?? "missing";
      if (typeof wasm !== "string") return { ok: true, backend: wasm };
      return { ok: false, reason: "no wasm here", missing: true };
    },
  }));
  const mod = await import("../../src/index");
  return { mod, loads };
}

/** A backend that throws `error()` on every call; a function, so the error can be made from the module under test. */
const failing = (error: () => unknown): Backend => ({
  name: "native",
  source: "mock",
  compileSync: () => {
    throw error();
  },
  compileAsync: () => Promise.reject(error()),
});

const answering = (name: "native" | "wasm", code: string): Backend => {
  const output: RawOutput = { kind: 0, code, transformed: true, mapMappings: null };
  return {
    name,
    source: "mock",
    compileSync: () => output,
    compileAsync: () => Promise.resolve(output),
  };
};

afterEach(() => {
  delete process.env["SHADOW_COMPILER_BACKEND"];
  vi.doUnmock("../../src/native/backend");
  vi.resetModules();
});

describe("choosing an implementation", () => {
  it("[COMPILER-03] importing loads nothing; the first call chooses once and the choice stays", async () => {
    const { mod, loads } = await autoWith({ native: answering("native", "NATIVE") });
    expect(loads).toEqual({ native: 0, wasm: 0 });
    expect(mod.compile(SOURCE, { sourceMap: false }).code).toBe("NATIVE");
    mod.compile(SOURCE);
    mod.getBackend();
    expect(loads).toEqual({ native: 1, wasm: 0 });
  });

  it("[COMPILER-06] the order is the addon, then WebAssembly, then TypeScript, and the notes say why", async () => {
    const first = await autoWith({
      native: answering("native", "N"),
      wasm: answering("wasm", "W"),
    });
    expect(first.mod.getBackend()).toMatchObject({ name: "native", notes: [] });
    const second = await autoWith({ native: "missing", wasm: answering("wasm", "W") });
    expect(second.mod.getBackend().name).toBe("wasm");
    expect(second.mod.getBackend().notes).toEqual(["native addon: no addon here"]);
    expect(second.mod.compile(SOURCE).code).toBe("W");
    const third = await autoWith({});
    const info = third.mod.getBackend();
    expect(info.name).toBe("javascript");
    expect(info.notes).toEqual(["native addon: no addon here", "WebAssembly build: no wasm here"]);
    // Nothing native loads: the answer is the TypeScript implementation's, without an error.
    expect(third.mod.compile(SOURCE).code).toContain("_$template");
  });

  it("[COMPILER-07] SHADOW_COMPILER_BACKEND demands one: javascript skips the loaders, native and wasm throw when they cannot load, other values throw", async () => {
    const javascript = await autoWith({ native: answering("native", "N"), request: "javascript" });
    expect(javascript.mod.getBackend().name).toBe("javascript");
    expect(javascript.loads).toEqual({ native: 0, wasm: 0 });
    const native = await autoWith({
      native: "missing",
      wasm: answering("wasm", "W"),
      request: "native",
    });
    expect(() => native.mod.compile(SOURCE)).toThrow(
      /the native addon cannot be loaded: no addon here/,
    );
    const wasm = await autoWith({ wasm: "missing", request: "wasm" });
    expect(() => wasm.mod.getBackend()).toThrow(/the WebAssembly build cannot be loaded/);
    expect(wasm.loads.native).toBe(0);
    const wrong = await autoWith({ request: "rust" });
    expect(() => wrong.mod.getBackend()).toThrow(
      /SHADOW_COMPILER_BACKEND must be "auto", "native", "wasm", "javascript" \(got "rust"\)/,
    );
  });

  it("[COMPILER-08] an addon that exists but cannot load is reported once as a process warning and the next implementation is used", async () => {
    const warnings: Array<{ code?: string; message: string }> = [];
    const listener = (warning: Error & { code?: string }) => {
      const entry: { code?: string; message: string } = { message: warning.message };
      if (warning.code !== undefined) entry.code = warning.code;
      warnings.push(entry);
    };
    const restore = listenAlone(listener);
    try {
      const { mod } = await autoWith({ native: "broken", wasm: answering("wasm", "W") });
      expect(mod.compile(SOURCE).code).toBe("W");
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnings.map((entry) => entry.code)).toEqual(["SHADOW_COMPILER_BACKEND_FALLBACK"]);
      expect(warnings[0]?.message).toContain("the addon is corrupt");
    } finally {
      restore();
    }
  });

  it("[COMPILER-09] a backend that throws something other than a CompileError is answered by TypeScript, once warned; a CompileError passes through", async () => {
    const warnings: string[] = [];
    const listener = (warning: Error & { code?: string }) => {
      if (warning.code === "SHADOW_COMPILER_BACKEND_FALLBACK") warnings.push(warning.message);
    };
    const restore = listenAlone(listener);
    try {
      const { mod } = await autoWith({ native: failing(() => new Error("trap")) });
      expect(mod.compile(SOURCE).code).toContain("_$template");
      expect((await mod.compileAsync(SOURCE)).code).toContain("_$template");
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("trap");
      const holder: { mod?: typeof mod } = {};
      const passing = await autoWith({
        native: failing(
          () =>
            new (holder.mod as typeof mod).CompileError(
              { code: "X", message: "m", severity: "error", start: 0, end: 1, line: 1, column: 0 },
              "",
              "a.tsx",
            ),
        ),
      });
      holder.mod = passing.mod;
      expect(() => passing.mod.compile(SOURCE)).toThrow(passing.mod.CompileError);
    } finally {
      restore();
    }
  });
});
