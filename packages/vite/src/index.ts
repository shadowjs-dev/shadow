import {
  CompileError,
  type CompileOptions,
  type CompileResult,
  type CompilerPlugin,
  compile,
  getBackend,
  validatePlugins,
} from "@shadow-js/compiler";
import { compile as compileWithJavaScript } from "@shadow-js/compiler/javascript";
import type { Plugin } from "vite";
import * as vite from "vite";
import { moduleFile } from "./internal/ids";

/**
 * Options of {@link shadow}. Every member is optional: the defaults compile a ShadowJS app for the
 * browser in `vite dev` and `vite build`, and for the server in SSR builds.
 * @see shadow
 * @since 1.0.0
 */
export interface ShadowPluginOptions {
  /**
   * Files to compile, matched against the module id without its query string. Plain `.ts` and `.js`
   * modules are compiled as well when they call `useStore`, whatever this is set to, so a
   * single-value `useStore` there takes the cell path. Files that `exclude` matches are never compiled,
   * and neither is a `?raw` or `?url` request (it is the file's text or address, not its source).
   * A `g` or `y` flag on the pattern is ignored: the pattern is matched from the start of every id.
   * @default /\.[cm]?[jt]sx$/ (every `.jsx` and `.tsx` file)
   */
  include?: RegExp;
  /**
   * Files to skip. It is checked before `include`, so an excluded file is never compiled.
   * @default /[\\/]node_modules[\\/]/ (any path with a `node_modules` segment)
   */
  exclude?: RegExp;
  /**
   * Module the compiled code imports its runtime helpers from. The HMR runtime is read from
   * `<moduleName>/hmr`.
   * @default "@shadow-js/web" (`"@shadow-js/web/server"` for SSR transforms)
   */
  moduleName?: string;
  /**
   * Turn a `const` computed from reactive reads (`const double = count() * 2`) into a live value
   * inside components, so it updates without a function or `useMemo`. Set `false` to keep such
   * constants as written.
   * @default true
   */
  autoReactive?: boolean;
  /**
   * Hot-update top-level components in place during `vite dev`. It applies to the browser build
   * only: SSR transforms never get it. Test runners never hot-update modules unless this is set.
   * @default true in `vite dev`, false under a test runner
   */
  hmr?: boolean;
  /**
   * Development output: component names in the compiled code and the extra runtime checks.
   * Set `true` to get development output in a production build, or `false` to get it out of `vite dev`.
   * @default true for `vite dev` (command `serve`), false for `vite build`
   */
  dev?: boolean;
  /**
   * Run the browser build of ShadowJS under Vitest, instead of the server build that the `node`
   * condition selects. Tests that render on the server (`renderToString`) want `false`.
   * @default true when the Vitest environment is `happy-dom` or `jsdom`, otherwise false
   */
  domTests?: boolean;
  /**
   * Compiler plugins that run in the build on every module this plugin compiles: `"pre"` plugins
   * (the default) on the syntax tree before the compiler's own passes, `"post"` plugins on the
   * generated code, each group in list order. A plugin can report findings and change the module
   * (strip test attributes, collect translation keys, sort class names); it never reaches the
   * browser. Errors fail the build with the plugin's name and the position in the file; warnings go
   * to Vite's warning log. Only files that `include` matches are compiled, so a plugin sees plain
   * `.ts` modules only when `include` covers them. See `CompilerPlugin` in `@shadow-js/compiler`.
   * @default undefined (no plugins; nothing is added to the build)
   */
  plugins?: readonly CompilerPlugin[];
  /**
   * Which implementation of the compiler runs. `@shadow-js/compiler` holds three of the same compiler: a Rust addon (about ten times
   * faster on large apps), the same Rust code as WebAssembly, and the TypeScript implementation. `"auto"` uses the fastest one the
   * machine has. `"native"` requires the Rust or the WebAssembly implementation and fails, with the reason, when only TypeScript is
   * available; use it in CI to be sure builds are fast. `"javascript"` uses the TypeScript implementation only, for example to compare
   * outputs. The output is identical in every mode. A module compiled with compiler plugins is answered by the TypeScript
   * implementation in every mode. The environment variable `SHADOW_COMPILER_BACKEND` asks for one for the whole process.
   * @default "auto"
   */
  compiler?: "auto" | "javascript" | "native";
}

/** What the transform reports through: the plugin context's `warn` and `error`. */
interface TransformPluginContext {
  warn(message: string, position?: { line: number; column: number }): void;
  error(message: string, position?: { line: number; column: number }): never;
}

/** The part of Vitest's config this plugin reads and contributes. */
interface VitestSection {
  environment?: string;
  server?: { deps?: { inline?: Array<string | RegExp> } };
}

const DEFAULT_INCLUDE = /\.[cm]?[jt]sx$/;
const DEFAULT_EXCLUDE = /[\\/]node_modules[\\/]/;
/**
 * Plain modules the compiler also reads, when they call `useStore`: a single-value `useStore(...)`
 * there becomes the cell path (see the compiler's store-cells pass). Other plain modules are untouched.
 */
const PLAIN_MODULE = /\.[cm]?[jt]s$/;

/**
 * The same pattern without the `g` and `y` flags. `test()` on a global or sticky pattern starts at the `lastIndex` the
 * previous call left, so the same file would match on one call and not on the next.
 */
function stateless(pattern: RegExp): RegExp {
  return pattern.global || pattern.sticky
    ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""))
    : pattern;
}

/**
 * True when this Vite transforms with Oxc (Vite 8 and later, and the Rolldown builds of Vite 7); Vite 7 transforms with
 * esbuild. Found by what the module exports: only a Rolldown based Vite exports `rolldownVersion`.
 */
const transformsWithOxc = "rolldownVersion" in vite;

/** The JSX runtime setting, under the key this Vite's transformer reads (`oxc` on Vite 8, `esbuild` on Vite 7). */
function jsxConfig(): Record<string, unknown> {
  return transformsWithOxc
    ? { oxc: { jsx: { runtime: "automatic", importSource: "@shadow-js/web" } } }
    : { esbuild: { jsx: "automatic", jsxImportSource: "@shadow-js/web" } };
}

/**
 * Creates the Vite plugin that compiles a ShadowJS app's JSX and `useStore` calls with
 * `@shadow-js/compiler`. Add it to the Vite config of every ShadowJS app: it runs before Vite's own
 * TypeScript and JSX handling, so Vite never sees JSX. SSR builds get the server target. It also
 * sets the ShadowJS JSX import source and dedupes `@shadow-js/core` and `@shadow-js/web`. A compile
 * error is reported to Vite with its file, line and column.
 * @param options Include and exclude filters, the runtime module, the dev, HMR and test switches, and
 * the compiler plugins.
 * @returns A Vite plugin named `shadowjs` that runs with `enforce: "pre"`.
 * @throws {TypeError} When `include` or `exclude` is not a `RegExp`, `moduleName` is not a non-empty string, or `plugins` is
 * not a list of valid compiler plugins (a member without a unique `name` or a `transform` function, for example), naming the
 * option. The `transform` hook rethrows any error that is not a `CompileError`, which points at a compiler bug. A `CompileError` goes through Vite's `this.error`
 * instead, which fails the build with the file and position.
 * @example
 * // vite.config.ts
 * import { shadow } from "@shadow-js/vite"; // the default export is the same function
 * export default { plugins: [shadow()] };
 * @see ShadowPluginOptions
 * @since 1.0.0
 */
export function shadow(options: ShadowPluginOptions = {}): Plugin {
  for (const name of ["include", "exclude"] as const) {
    const value = options[name];
    if (value !== undefined && !(value instanceof RegExp)) {
      throw new TypeError(`shadow(): "${name}" must be a RegExp (got ${typeof value}).`);
    }
  }
  if (
    options.moduleName !== undefined &&
    (typeof options.moduleName !== "string" || options.moduleName === "")
  ) {
    throw new TypeError('shadow(): "moduleName" must be a non-empty string.');
  }
  if (
    options.compiler !== undefined &&
    options.compiler !== "auto" &&
    options.compiler !== "javascript" &&
    options.compiler !== "native"
  ) {
    throw new TypeError(
      `shadow(): "compiler" must be "auto", "javascript" or "native" (got ${JSON.stringify(options.compiler)}).`,
    );
  }
  const plugins =
    options.plugins === undefined ? [] : validatePlugins(options.plugins, "shadow(): plugins");
  // `@shadow-js/compiler` chooses its implementation once per process, on the first call. "native" asks it which one it chose and refuses
  // the TypeScript one, so a build that must be fast does not quietly become slow.
  const mode = options.compiler ?? "auto";
  let verified = mode !== "native";
  const requireNative = (): void => {
    if (verified) return;
    const backend = getBackend();
    if (backend.name === "javascript") {
      throw new Error(
        `shadow(): compiler: "native" needs the Rust or WebAssembly implementation of @shadow-js/compiler, and only the TypeScript one is available (${backend.notes.join("; ") || "no reason was recorded"}). Install @shadow-js/compiler with its optional dependencies (do not use --omit=optional), or use compiler: "auto". SHADOW_COMPILER_BACKEND=${process.env["SHADOW_COMPILER_BACKEND"] ?? "auto"}.`,
      );
    }
    verified = true;
  };
  const run = mode === "javascript" ? compileWithJavaScript : compile;
  const include = stateless(options.include ?? DEFAULT_INCLUDE);
  const exclude = stateless(options.exclude ?? DEFAULT_EXCLUDE);
  let dev = options.dev ?? false;
  let hot = options.hmr !== false;
  return {
    name: "shadowjs",
    enforce: "pre",
    config(userConfig, env) {
      if (options.dev === undefined) dev = env.command === "serve";
      const testing = env.mode === "test" || process.env["VITEST"] !== undefined;
      // Test runners serve modules but never hot update them, unless the caller asked for it.
      if (testing && options.hmr === undefined) hot = false;
      const test = (userConfig as { test?: VitestSection }).test;
      const domTests =
        testing &&
        (options.domTests ?? (test?.environment === "happy-dom" || test?.environment === "jsdom"));
      return {
        // `DUSK_PUBLIC_*` variables are readable in client code next to Vite's own `VITE_*` (Dusk
        // and the integration packages document `DUSK_PUBLIC_*`).
        envPrefix: ["VITE_", "DUSK_PUBLIC_"],
        // Dependency scanning and any file this plugin skips are parsed with the ShadowJS JSX
        // runtime types, never React's.
        ...jsxConfig(),
        resolve: {
          dedupe: ["@shadow-js/core", "@shadow-js/web"],
          // Vitest resolves packages with the `node` condition, which selects the inert server
          // build of ShadowJS; DOM tests need the browser build.
          ...(domTests ? { conditions: ["browser"] } : {}),
        },
        // Packages Node would load natively see the `node` condition too, so they go through Vite.
        ...(domTests ? { test: { server: { deps: { inline: [/@shadow-js\//] } } } } : {}),
        optimizeDeps: { exclude: ["@shadow-js/core", "@shadow-js/web"] },
      };
    },
    transform(code, id, transformOptions) {
      // A virtual module (Vite's \0 prefix) and a `?raw` or `?url` request are not source to compile.
      const { file, skip } = moduleFile(id);
      if (skip || exclude.test(file)) return null;
      if (!include.test(file) && !(PLAIN_MODULE.test(file) && code.includes("useStore")))
        return null;
      const compileOptions: CompileOptions = {
        filename: file,
        generate: transformOptions?.ssr === true ? "ssr" : "dom",
        dev,
        autoReactive: options.autoReactive !== false,
        hmr: dev && hot && transformOptions?.ssr !== true,
      };
      if (options.moduleName !== undefined) compileOptions.moduleName = options.moduleName;
      if (plugins.length > 0) compileOptions.plugins = plugins;
      const finish = (
        context: TransformPluginContext,
        run: typeof compile,
      ): { code: string; map: CompileResult["map"] } | null => {
        try {
          const result = run(code, compileOptions);
          for (const diagnostic of result.diagnostics) {
            if (diagnostic.severity === "warning") {
              context.warn(diagnostic.message, {
                line: diagnostic.line,
                column: diagnostic.column,
              });
            }
          }
          if (!result.transformed) return null;
          return { code: result.code, map: result.map };
        } catch (error) {
          if (error instanceof CompileError) {
            const loc = { file, line: error.diagnostic.line, column: error.diagnostic.column };
            return context.error(
              error.message,
              loc.line === 0 ? undefined : { line: loc.line, column: loc.column },
            );
          }
          throw error;
        }
      };
      requireNative();
      return finish(this, run);
    },
  };
}

export default shadow;
