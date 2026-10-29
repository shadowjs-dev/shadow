import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platformKey, requireNode } from "./platform";
import { createBigStack } from "./wasm-stack";

/**
 * What a backend returns for one module: the fields of the Rust `NativeOutput`. `kind` 0 is code,
 * 1 a `CompileError`, 2 and 3 mean the input must go to the JavaScript compiler.
 * @since 1.0.0
 */
export interface RawOutput {
  kind: number;
  code: string;
  transformed: boolean;
  mapSource?: string | null;
  mapMappings?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorStart?: number | null;
  errorEnd?: number | null;
  errorLine?: number | null;
  errorColumn?: number | null;
  errorFrame?: string | null;
}

/**
 * The options a backend takes: the compile options without the plugin list, already normalized.
 * @since 1.0.0
 */
export interface RawOptions {
  filename?: string;
  generate: "dom" | "ssr";
  moduleName?: string;
  dev: boolean;
  autoReactive: boolean;
  hmr: boolean;
  hydratable: boolean;
  sourceMap: boolean;
}

/**
 * A loaded implementation of the compiler core.
 * @since 1.0.0
 */
export interface Backend {
  /** `"native"` for the addon, `"wasm"` for the WebAssembly build. */
  readonly name: "native" | "wasm";
  /** Where it was loaded from. */
  readonly source: string;
  /** Compiles on the calling thread. */
  compileSync(source: string, options: RawOptions): RawOutput;
  /** Compiles on another thread when the backend can (the addon), else on the calling thread. */
  compileAsync(source: string, options: RawOptions): Promise<RawOutput>;
}

interface AddonModule {
  compileSync(source: string, options: RawOptions): RawOutput;
  compileAsync(source: string, options: RawOptions): Promise<RawOutput>;
}

/** The directory of this package (the nearest ancestor with a `package.json` named after it). */
function packageRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name;
      if (name === "@shadow-js/compiler") return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("@shadow-js/compiler: cannot find the package directory.");
}

/**
 * The result of looking for one backend. `missing` is true when nothing was found to load (the
 * normal case on a platform without a prebuilt addon), false when a file exists and failed to load.
 * @since 1.0.0
 */
export type Attempt =
  | { ok: true; backend: Backend }
  | { ok: false; reason: string; missing: boolean };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads the native addon: the file named by `SHADOW_COMPILER_NATIVE_PATH`, else the platform package
 * (`@shadow-js/compiler-<platform>`), else a local build in `npm/<platform>/`.
 * @returns The backend, or the reason there is none.
 * @internal
 * @since 1.0.0
 */
export function loadNative(): Attempt {
  const tried: string[] = [];
  let missing = true;
  const candidates: Array<{ label: string; load: () => AddonModule }> = [];
  const explicit = process.env["SHADOW_COMPILER_NATIVE_PATH"];
  if (explicit !== undefined && explicit !== "") {
    candidates.push({ label: explicit, load: () => requireNode(explicit) as AddonModule });
  }
  // The explicit file comes first and does not depend on the platform: a platform without a prebuilt
  // addon is exactly where a self-built one is pointed at.
  const key = platformKey();
  if (key === null) {
    if (candidates.length === 0) {
      return {
        ok: false,
        reason: `no prebuilt addon exists for ${process.platform}-${process.arch}`,
        missing: true,
      };
    }
  } else {
    const packageName = `@shadow-js/compiler-${key}`;
    candidates.push({ label: packageName, load: () => requireNode(packageName) as AddonModule });
    let root: string | undefined;
    try {
      root = packageRoot();
    } catch {
      root = undefined;
    }
    if (root !== undefined) {
      const local = join(root, "npm", key, "shadow-compiler.node");
      if (existsSync(local)) {
        candidates.push({ label: local, load: () => requireNode(local) as AddonModule });
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const addon = candidate.load();
      if (typeof addon.compileSync !== "function") {
        missing = false;
        tried.push(`${candidate.label}: not a ShadowJS compiler addon`);
        continue;
      }
      return {
        ok: true,
        backend: {
          name: "native",
          source: candidate.label,
          compileSync: (source, options) => addon.compileSync(source, options),
          compileAsync: (source, options) => addon.compileAsync(source, options),
        },
      };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") missing = false;
      tried.push(`${candidate.label}: ${describe(error)}`);
    }
  }
  return { ok: false, reason: tried.join("; "), missing };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface WasmExports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  compile(source: number, sourceLength: number, options: number, optionsLength: number): number;
}

/** Runs the module once: the host writes the input into its memory and reads the JSON result back. */
function runWasm(exports: WasmExports, source: string, options: RawOptions): RawOutput {
  const sourceBytes = encoder.encode(source);
  const optionBytes = encoder.encode(JSON.stringify(options));
  const sourcePointer = exports.alloc(sourceBytes.length);
  const optionsPointer = exports.alloc(optionBytes.length);
  new Uint8Array(exports.memory.buffer, sourcePointer, sourceBytes.length).set(sourceBytes);
  new Uint8Array(exports.memory.buffer, optionsPointer, optionBytes.length).set(optionBytes);
  const resultPointer = exports.compile(
    sourcePointer,
    sourceBytes.length,
    optionsPointer,
    optionBytes.length,
  );
  const length = new DataView(exports.memory.buffer).getUint32(resultPointer, true);
  const json = decoder.decode(new Uint8Array(exports.memory.buffer, resultPointer + 4, length));
  exports.dealloc(sourcePointer, sourceBytes.length);
  exports.dealloc(optionsPointer, optionBytes.length);
  exports.dealloc(resultPointer, length + 4);
  return JSON.parse(json) as RawOutput;
}

/**
 * Loads the WebAssembly build shipped in this package (`wasm/shadow-compiler.wasm`), or the file named
 * by `SHADOW_COMPILER_WASM_PATH`.
 * @returns The backend, or the reason there is none.
 * @internal
 * @since 1.0.0
 */
export function loadWasm(): Attempt {
  try {
    const explicit = process.env["SHADOW_COMPILER_WASM_PATH"];
    const file =
      explicit !== undefined && explicit !== ""
        ? explicit
        : join(packageRoot(), "wasm", "shadow-compiler.wasm");
    const module = new WebAssembly.Module(readFileSync(file));
    let exports = new WebAssembly.Instance(module, {}).exports as unknown as WasmExports;
    const bigStack = createBigStack(module);
    const run = (source: string, options: RawOptions): RawOutput => {
      try {
        return runWasm(exports, source, options);
      } catch (error) {
        // A trap leaves the instance in an unknown state: start from a fresh one.
        exports = new WebAssembly.Instance(module, {}).exports as unknown as WasmExports;
        // Input nested deeper than the stack of this thread holds overflows it (the engine raises a RangeError, or the shadow stack
        // in the module's memory is exhausted): the same module answers on a thread with a stack as large as the addon's.
        if (error instanceof RangeError || error instanceof WebAssembly.RuntimeError) {
          return bigStack.run(source, options);
        }
        throw error;
      }
    };
    return {
      ok: true,
      backend: {
        name: "wasm",
        source: file,
        compileSync: run,
        compileAsync: (source, options) =>
          new Promise<RawOutput>((resolve, reject) => {
            queueMicrotask(() => {
              try {
                resolve(run(source, options));
              } catch (error) {
                reject(error);
              }
            });
          }),
      },
    };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { ok: false, reason: describe(error), missing: code === "ENOENT" };
  }
}
