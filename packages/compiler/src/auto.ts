import { SourceMap } from "magic-string";
import type { BackendInfo } from "./backend-info";
import {
  CompileError,
  type CompileOptions,
  type CompileResult,
  compile as compileWithJavaScript,
} from "./javascript";
import {
  type Backend,
  loadNative,
  loadWasm,
  type RawOptions,
  type RawOutput,
} from "./native/backend";

export type { BackendInfo } from "./backend-info";
export type {
  CallExpressionNode,
  CompileOptions,
  CompileResult,
  CompilerPlugin,
  Diagnostic,
  IdentifierNode,
  ImportDeclarationNode,
  JSXAttributeNode,
  JSXElementNode,
  JSXExpressionContainerNode,
  JSXFragmentNode,
  JSXIdentifierNode,
  JSXMemberExpressionNode,
  JSXNamespacedNameNode,
  JSXOpeningElementNode,
  JSXSpreadAttributeNode,
  JSXTextNode,
  LiteralNode,
  MemberExpressionNode,
  NodeFactory,
  NodeMap,
  ObjectExpressionNode,
  PluginContext,
  PluginDiagnostic,
  PluginImport,
  PluginNode,
  PluginRange,
  PluginStage,
  ProgramNode,
  PropertyNode,
  Target,
  TemplateElementNode,
  TemplateLiteralNode,
  Visit,
  Visitor,
  VisitorEntry,
} from "./javascript";
export { CompileError, validatePlugins } from "./javascript";

interface Selected {
  backend: Backend | null;
  info: BackendInfo;
}

let selected: Selected | undefined;

function warn(message: string): void {
  process.emitWarning(message, { code: "SHADOW_COMPILER_BACKEND_FALLBACK" });
}

const REQUESTS = ["auto", "native", "wasm", "javascript"] as const;

/** Whether the unexpected failure of a backend was already reported: one warning per process is enough to find the cause. */
let reportedFailure = false;

/**
 * Called when the Rust or WebAssembly implementation throws something that is not a {@link CompileError}. The call is answered by the
 * TypeScript implementation (the result is the same), and the first such failure is reported once so the cause is not hidden.
 */
function reportBackendFailure(error: unknown): void {
  if (reportedFailure) return;
  reportedFailure = true;
  warn(
    `@shadow-js/compiler: the ${select().info.name} implementation failed (${error instanceof Error ? error.message : String(error)}); the TypeScript implementation answered instead.`,
  );
}

/**
 * Chooses the implementation once. `SHADOW_COMPILER_BACKEND` can ask for one: `auto` (the default) takes the Rust addon, else the
 * WebAssembly build, else the TypeScript implementation; `native`, `wasm` and `javascript` take that one and nothing else.
 */
function select(): Selected {
  if (selected !== undefined) return selected;
  const requested = process.env["SHADOW_COMPILER_BACKEND"] ?? "auto";
  if (!(REQUESTS as readonly string[]).includes(requested)) {
    throw new Error(
      `@shadow-js/compiler: SHADOW_COMPILER_BACKEND must be ${REQUESTS.map((name) => `"${name}"`).join(", ")} (got ${JSON.stringify(requested)}).`,
    );
  }
  if (requested === "javascript") {
    selected = {
      backend: null,
      info: { name: "javascript", source: "@shadow-js/compiler", notes: [] },
    };
    return selected;
  }
  const notes: string[] = [];
  if (requested !== "wasm") {
    const native = loadNative();
    if (native.ok) {
      selected = {
        backend: native.backend,
        info: { name: "native", source: native.backend.source, notes },
      };
      return selected;
    }
    if (requested === "native") {
      throw new Error(`@shadow-js/compiler: the native addon cannot be loaded: ${native.reason}`);
    }
    notes.push(`native addon: ${native.reason}`);
    if (!native.missing) {
      warn(
        `@shadow-js/compiler: the native addon exists but cannot be loaded (${native.reason}); using the next implementation.`,
      );
    }
  }
  const wasm = loadWasm();
  if (wasm.ok) {
    selected = {
      backend: wasm.backend,
      info: { name: "wasm", source: wasm.backend.source, notes },
    };
    return selected;
  }
  if (requested === "wasm") {
    throw new Error(`@shadow-js/compiler: the WebAssembly build cannot be loaded: ${wasm.reason}`);
  }
  notes.push(`WebAssembly build: ${wasm.reason}`);
  selected = {
    backend: null,
    info: { name: "javascript", source: "@shadow-js/compiler", notes },
  };
  return selected;
}

/**
 * Tells which implementation {@link compile} uses on this machine, loading it if it was not loaded yet. The choice is made once per
 * process and does not change.
 *
 * @returns The implementation, where it came from, and why a faster one was not used.
 * @throws Error When `SHADOW_COMPILER_BACKEND` names an implementation that cannot be loaded (`native` or `wasm`), or is not one of
 * `auto`, `native`, `wasm` and `javascript`.
 * @example
 * import { getBackend } from "@shadow-js/compiler";
 *
 * const { name } = getBackend();
 * console.log(["native", "wasm", "javascript"].includes(name)); // true
 * @see compile
 * @since 1.0.0
 */
export function getBackend(): BackendInfo {
  return select().info;
}

/** `String.prototype.isWellFormed` (ES2024): false for a string with an unpaired surrogate. */
function isWellFormed(text: string): boolean {
  return (text as unknown as { isWellFormed(): boolean }).isWellFormed();
}

/** The options for the Rust compiler, or `null` when the JavaScript compiler must handle the call. */
function plan(source: unknown, options: CompileOptions | undefined): RawOptions | null {
  if (typeof source !== "string" || !isWellFormed(source)) {
    return null;
  }
  if (options === undefined || options === null) {
    return {
      generate: "dom",
      dev: false,
      autoReactive: true,
      hmr: false,
      hydratable: true,
      sourceMap: true,
    };
  }
  if (typeof options !== "object") return null;
  const { plugins, filename, moduleName } = options as {
    plugins?: unknown;
    filename?: unknown;
    moduleName?: unknown;
  };
  if (plugins !== undefined && !(Array.isArray(plugins) && plugins.length === 0)) return null;
  if (filename !== undefined && filename !== null && typeof filename !== "string") return null;
  if (moduleName !== undefined && moduleName !== null && typeof moduleName !== "string")
    return null;
  const raw: RawOptions = {
    generate: options.generate === "ssr" ? "ssr" : "dom",
    dev: options.dev === true,
    autoReactive: options.autoReactive !== false,
    hmr: options.hmr === true,
    hydratable: options.hydratable !== false,
    sourceMap: options.sourceMap !== false,
  };
  if (typeof filename === "string") raw.filename = filename;
  if (typeof moduleName === "string") raw.moduleName = moduleName;
  return raw;
}

/** Builds the result the JavaScript compiler would have returned, or `null` to use the JavaScript compiler. */
function finish(output: RawOutput, source: string, raw: RawOptions): CompileResult | null {
  if (output.kind === 0) {
    const mappings = output.mapMappings;
    const map =
      raw.sourceMap && typeof mappings === "string"
        ? new SourceMap({
            sources: [output.mapSource ?? ""],
            sourcesContent: [source],
            names: [],
            mappings,
          })
        : null;
    return { code: output.code, map, diagnostics: [], transformed: output.transformed };
  }
  if (output.kind === 1) {
    throw new CompileError(
      {
        code: output.errorCode ?? "",
        message: output.errorMessage ?? "",
        severity: "error",
        start: output.errorStart ?? 0,
        end: output.errorEnd ?? 0,
        line: output.errorLine ?? 1,
        column: output.errorColumn ?? 0,
      },
      output.errorFrame ?? "",
      raw.filename ?? "module.tsx",
    );
  }
  return null;
}

/**
 * Compiles the JSX in a module into calls to the ShadowJS runtime, with the fastest implementation this machine has: the Rust addon
 * (about ten times faster on large apps), else the same code as WebAssembly, else the TypeScript implementation. Every implementation
 * produces the same output byte for byte, source map included, and throws the same {@link CompileError}. It is a pure function.
 *
 * A call the Rust core cannot answer is answered by the TypeScript implementation, so the result never depends on the backend: a call
 * with `plugins` (they are JavaScript functions that edit the syntax tree in the build), an input with an unpaired surrogate, options
 * of an unusual type, or nesting deeper than the Rust implementation follows.
 *
 * @param source Module text to compile.
 * @param options What to generate and how; see {@link CompileOptions}.
 * @returns The new code, a source map, the plugins' diagnostics and `transformed`.
 * @throws CompileError For source the compiler cannot or refuses to transform.
 * @example
 * import { compile } from "@shadow-js/compiler";
 *
 * const result = compile("export const A = () => <h1>Hello</h1>;", { filename: "a.tsx" });
 * console.log(result.transformed); // true
 * console.log(result.code.includes('from "@shadow-js/web"')); // true
 * @see getBackend
 * @see CompileOptions
 * @since 1.0.0
 */
export function compile(source: string, options?: CompileOptions): CompileResult {
  const raw = plan(source, options);
  if (raw === null) return compileWithJavaScript(source, options);
  const { backend } = select();
  if (backend === null) return compileWithJavaScript(source, options);
  let output: RawOutput;
  try {
    output = backend.compileSync(source, raw);
  } catch (error) {
    if (error instanceof CompileError) throw error;
    reportBackendFailure(error);
    return compileWithJavaScript(source, options);
  }
  return finish(output, source, raw) ?? compileWithJavaScript(source, options);
}

/**
 * Compiles a module without blocking the event loop: the Rust implementation runs on a worker thread of the process and the promise
 * settles with what {@link compile} would have returned or thrown. With the WebAssembly build or the TypeScript implementation the work
 * runs on the calling thread, after the current turn.
 *
 * @param source Module text to compile.
 * @param options What to generate and how; see {@link CompileOptions}.
 * @returns A promise of the result; it rejects with a {@link CompileError} where `compile` throws.
 * @example
 * import { compileAsync } from "@shadow-js/compiler";
 *
 * const result = await compileAsync("export const A = () => <b>x</b>;");
 * console.log(result.transformed); // true
 * @see compile
 * @since 1.0.0
 */
export async function compileAsync(
  source: string,
  options?: CompileOptions,
): Promise<CompileResult> {
  const raw = plan(source, options);
  if (raw === null) return compileWithJavaScript(source, options);
  const { backend } = select();
  if (backend === null) return compileWithJavaScript(source, options);
  let output: RawOutput;
  try {
    output = await backend.compileAsync(source, raw);
  } catch (error) {
    if (error instanceof CompileError) throw error;
    reportBackendFailure(error);
    return compileWithJavaScript(source, options);
  }
  return finish(output, source, raw) ?? compileWithJavaScript(source, options);
}
