# @shadow-js/compiler

The ShadowJS JSX compiler. It parses a module with an AST parser, lowers each JSX tree to an intermediate form, and rewrites the JSX in
place into calls to the `@shadow-js/web` runtime: a cloned static template, reactive `insert` and attribute bindings, and delegated
events. Code outside JSX keeps its exact text and position. There are two targets: `dom` (client rendering and hydration) and `ssr`
(server strings with hydration keys).

**One package, one API, three implementations of the same compiler**, chosen once per process: a **Rust addon** (prebuilt for eight
platforms, about ten times faster than the TypeScript implementation on large apps and able to use every core), the same Rust code as
**WebAssembly** (about half as fast, for every other platform), and the **TypeScript** implementation (the reference, and the only one
that runs where there is no Node.js). They produce the same code, the same source map and the same errors, byte for byte; only the
speed differs. You never choose: `compile` takes the fastest one the machine has.

You rarely call it directly: [`@shadow-js/vite`](https://shadowjs.net/guides/vite/) runs it for every `.tsx` and `.jsx` file. Use it
directly for other bundlers, build scripts and tests.

## Install

```sh
npm install -D @shadow-js/compiler
```

npm installs one small extra package with the prebuilt addon for the platform (macOS, Linux with glibc or musl, Windows; x64 and arm64).
Do not install with `--omit=optional`: that removes the addon, and the compiler falls back to WebAssembly.

## Example

`compile(source, options)` is a pure function. It returns the new code, a source map, a `transformed` flag (false when the module
contains no JSX and is returned as it was), and diagnostics. The `dom` target imports its helpers from `@shadow-js/web`; the `ssr`
target imports from `@shadow-js/web/server`.

```ts title="compile.ts" run output='true\nimport { insert as _$insert, template as _$template, delegateEvents as _$delegateEvents } from "@shadow-js/web";\nimport { ssrHydrationKey as _$ssrHydrationKey, escape as _$escape, ssr as _$ssr } from "@shadow-js/web/server";\nfalse\ntrue'
import { compile, getBackend } from "@shadow-js/compiler";

const source = `import { useStore } from "@shadow-js/core";

export function Counter() {
  const [count, setCount] = useStore(0);
  return <button type="button" onClick={() => setCount((n) => n + 1)}>{count()}</button>;
}
`;

const runtimeImports = (code: string): string =>
  code
    .split("\n")
    .filter((line) => /from "@shadow-js\/web/.test(line))
    .join("\n");

const dom = compile(source, { filename: "counter.tsx" });
console.log(dom.transformed);
console.log(runtimeImports(dom.code));

const ssr = compile(source, { filename: "counter.tsx", generate: "ssr" });
console.log(runtimeImports(ssr.code));

console.log(compile("export const answer = 42;").transformed);
console.log(["native", "wasm", "javascript"].includes(getBackend().name));
```

A syntax error throws a `CompileError` that carries the diagnostic: a code, a message and the position (1-based line, 0-based column)
in the original source. It is the same class whichever implementation ran, so `instanceof` always works.

```ts title="errors.ts" run output="PARSE_ERROR 1:18"
import { CompileError, compile } from "@shadow-js/compiler";

try {
  compile("const view = <div>;", { filename: "broken.tsx" });
} catch (error) {
  if (!(error instanceof CompileError)) throw error;
  const { code, line, column } = error.diagnostic;
  console.log(`${code} ${line}:${column}`);
}
```

`compileAsync` runs the Rust addon on a worker thread of the process, so a build tool can compile many modules at once without blocking
the event loop (with WebAssembly or TypeScript the work runs on the calling thread, after the current turn):

```ts title="async.ts" run output="3"
import { compileAsync } from "@shadow-js/compiler";

const modules = ["a", "b", "c"].map((name) => `export const ${name} = () => <i>{${name}()}</i>;`);
const results = await Promise.all(modules.map((text) => compileAsync(text, { filename: "m.tsx" })));
console.log(results.filter((result) => result.transformed).length);
```

## Implementations and how one is chosen

| Implementation | Where it comes from | When it is used |
| --- | --- | --- |
| Rust addon (`native`) | `@shadow-js/compiler-<platform>`, installed as an optional dependency | Node.js, Bun and Deno on a supported platform |
| WebAssembly (`wasm`) | `wasm/shadow-compiler.wasm` in this package | the addon is missing or cannot load |
| TypeScript (`javascript`) | this package, `@shadow-js/compiler/javascript` | the two above are missing, and always in browsers, workers and any environment without Node.js |

The package conditions do the choosing for bundlers: `node`, `bun` and `deno` resolve `@shadow-js/compiler` to the entry that picks an
implementation; `browser`, `worker` and any unknown environment resolve it to the TypeScript implementation alone, with no Node.js API,
no addon loader and no WebAssembly in the bundle. Import `@shadow-js/compiler/javascript` to ask for that entry yourself.

`getBackend()` returns `{ name, source, notes }`: the implementation in use, where it was loaded from, and why a faster one was not used.
The environment can ask for one:

| Variable | Effect |
| --- | --- |
| `SHADOW_COMPILER_BACKEND` | `auto` (default), `native`, `wasm` or `javascript`. `native` and `wasm` throw when that implementation cannot load; `javascript` never loads the others. Any other value throws. |
| `SHADOW_COMPILER_NATIVE_PATH` | A `.node` file to load instead of the platform package (a local build). |
| `SHADOW_COMPILER_WASM_PATH` | A `.wasm` file to load instead of the one in this package. |

A call the Rust core cannot answer exactly goes to the TypeScript implementation, so the result never differs: a call with `plugins`
(they are JavaScript functions that edit the syntax tree), an input with an unpaired surrogate, options of an unusual type, or nesting
deeper than the Rust implementation follows. An addon that exists but fails to load is reported once as a process warning
(`SHADOW_COMPILER_BACKEND_FALLBACK`) and the next implementation is used.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `filename` | `module.tsx` | Name used in diagnostics; its extension selects the parser language. |
| `generate` | `"dom"` | `"dom"` or `"ssr"`. Hydration uses the `dom` output. |
| `moduleName` | `@shadow-js/web` (`@shadow-js/web/server` for `ssr`) | Module the runtime helpers are imported from. |
| `dev` | `false` | Development output: on the `dom` target, component calls pass the component name for devtools. |
| `autoReactive` | `true` | Keep constants computed from reactive reads live without a function (forgiving reactivity). |
| `hmr` | `false` | `dom` target only: wrap top-level components so an edit swaps them in place. It does not depend on `dev`; `@shadow-js/vite` passes it only in development. |
| `hydratable` | `true` | `ssr` target: stamp hydration keys on template roots. |
| `sourceMap` | `true` | Produce a source map. |
| `plugins` | none | Compiler plugins that run in the build: `"pre"` on the syntax tree of the source, `"post"` on the generated code. See [Plugins](#plugins). |

## Output

Static markup becomes one hoisted `template(...)` string. The compiler keeps the output small without
changing what the page does:

- A literal child (`{2026}`, `{" "}`, `{"text"}`, a template literal without holes, arithmetic on
  literals) is part of the template text, and neighboring text merges into one text node. `null`,
  `true` and `false` children are dropped. The server output folds the same text, so server markup
  and client template stay in step. A component still sees its children as written.
- An element that is the whole body of a function (`return <el />;`, `() => <el />`, a render
  callback, a getter the compiler writes) is built by the statements themselves, with no function
  created and called to run them.
- Arithmetic on literals in an attribute value or a component prop is computed at build time.

The guide [Compiler](https://shadowjs.net/guides/compiler/) lists what is folded, what is deliberately not, and
why.

## Plugins

A compiler plugin is `{ name, enforce?, imports?, transform(ast, context) }`. It runs in the build, on
one module at a time, reads the syntax tree, reports findings and edits the module through
`context`. It never reaches a browser, and an absent `plugins` option costs nothing.

```ts title="plugin.ts" run output="false\ntrue"
import { type CompilerPlugin, compile } from "@shadow-js/compiler";

const stripTestIds: CompilerPlugin = {
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
console.log(compile(source, { plugins: [stripTestIds] }).code.includes("data-testid"));
console.log(compile(source).code.includes("data-testid"));
```

`"pre"` plugins (the default) run in list order on the tree of the source before every compiler pass,
`"post"` plugins run in list order on the tree of the generated code. A plugin sees the module as the
plugins before it left it. Errors are a `CompileError` with the plugin's name and the position in the
original source; `context.report` collects warnings and info in `result.diagnostics`; every edit is
tracked in the source map, which points at the module as it was written. A plugin declares each import
it adds. Check a list with `validatePlugins`. The contract and the guide are
[Compiler](https://shadowjs.net/guides/compiler/), and `@shadow-js/vite` takes the same list in its `plugins`
option.

## Single-value `useStore`

`useStore(<single value>)` builds a reactive cell, and a cell needs none of the deep store (proxies,
reconciler, draft transactions). The compiler therefore rewrites those calls to `useSignal` from
`@shadow-js/core`, the primitive `useStore` builds the cell from:

```ts typecheck
import { useStore } from "@shadow-js/core";
const [count, setCount] = useStore(0);        // emitted as useShadowSignal(0)
const [items, setItems] = useStore([]);        // unchanged: deep store
```

The rewrite applies when the initial value is a primitive, `null`, `undefined`, a function, a template
literal or a `Date`, and the call has no type argument or only a primitive one. It also needs the callee
to be an unshadowed `useStore` imported from `@shadow-js/core` (or `@shadow-js/core/store`, or a namespace
member), and an options argument, if any, that carries only `name`. Dynamic initial values, object and array
literals, mixed types and re-exported wrappers keep `useStore`. Behavior is the same: `useStore` wraps
plain data only when it is written into a single-value cell, and a cell typed as a primitive cannot hold
plain data in typed code. The pass runs on JSX modules and on plain `.ts`/`.js` modules that call `useStore`
(the Vite plugin reads those too). Source `useStore` stays in the import; the bundler drops it when unused.

## Speed

Compiling the same JSX modules to the DOM target. Medians of repeated runs, each contender in its own Node.js process after
a warm-up; "vs TS" is the median of the TypeScript implementation divided by the median of the row.

| Input | TypeScript implementation | Rust addon | vs TS | WebAssembly | vs TS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 component (110 lines, 7 KiB) | 2.05 ms | 0.20 ms | 10.4x | 0.38 ms | 5.4x |
| 50 components (3,830 lines, 199 KiB) | 56.9 ms | 6.0 ms | 9.5x | 11.7 ms | 4.9x |
| 1,000 components (101,316 lines, 5.1 MiB) | 1,662 ms | 162 ms | 10.2x | 300 ms | 5.5x |
| 200 modules of 10 components, one after the other | 2,793 ms | 268 ms | 10.4x | 269 ms | 10.4x |
| the same 200 modules, `compileAsync` on all cores | | 70 ms | 40x | | |

Peak memory of the process on the 1,000 components: 972 MiB with the addon, 556 MiB with WebAssembly, 1,624 MiB with the
TypeScript compiler (Node.js itself is about 100 MiB of that).

Two other tools did the same jobs on the same modules, for scale:

| Input | `@babel/core` with `babel-preset-solid` | `oxc-transform` (React-style JSX) |
| --- | ---: | ---: |
| 1 component | 6.99 ms | 0.06 ms |
| 50 components | 369 ms | 1.6 ms |
| 1,000 components | 121,865 ms (5 runs) | 42.5 ms |

`babel-preset-solid` makes Solid's output, which is the closest thing to what this compiler makes, and it is slower than
the TypeScript implementation on these inputs. `oxc-transform` only parses, rewrites JSX to function calls and prints; it does
not build templates or analyze reactivity, so it is faster than this compiler by about four times, and it shows how
fast "parse, transform and print" can be on this machine.

Method. Apple M5 Pro, 15 cores, 48 GiB, macOS 27.0, Node.js 26.10.0, Rust 1.97.0, `@babel/core` 7.29.7,
`babel-preset-solid` 1.9.16, `oxc-transform` 0.154.0. The machine was shared with other work (load average between 3 and
20 during the run). The inputs are generated by `bench/inputs.mjs` from twelve component shapes (counter, list, form, table,
card, navigation, dialog, chart, tabs, pricing grid, footer, dashboard) in plain JSX, so every tool accepts them. Runs per
row: 3,000 (small), 60 (medium), 21 (large), warm-up 500, 15 and 4; the Babel row on the large input is 5 runs after one
warm-up. Command, from the folder of this package: `node bench/run.mjs` (build the compiler and run
`npm run build:binaries` first, and `npm install` in `bench/` for the other two tools). The run also reports the 95th
percentiles and the CPU time of each run.

## API

| Export | Description |
| --- | --- |
| `compile` | Compiles the JSX in a source string and returns `{ code, map, diagnostics, transformed }`, or throws a `CompileError`. |
| `compileAsync` | The same, as a promise; on a worker thread when the Rust addon is in use. |
| `getBackend` | `{ name: "native" \| "wasm" \| "javascript", source, notes }`: the implementation in use and why a faster one was not used. |
| `CompileError` | Thrown for source the compiler cannot or refuses to transform; has `diagnostic`, `frame` and `id`. |
| `CompileOptions`, `CompileResult`, `Target`, `Diagnostic`, `BackendInfo` | The option, result, target (`"dom" \| "ssr"`), diagnostic and backend types. |
| `validatePlugins` | Checks a plugin list and returns a frozen copy; throws a `TypeError` that names the bad member. |
| `CompilerPlugin`, `PluginContext`, `PluginDiagnostic`, `PluginImport`, `PluginStage`, `NodeFactory` | Types of the plugin API: the plugin, the context it receives, a reported finding, a declared import, the two stages, and the builders for edit text. |
| `Visitor`, `VisitorEntry`, `Visit`, `NodeMap`, `PluginNode`, `PluginRange`, `ProgramNode` and the typed nodes (`IdentifierNode`, `LiteralNode`, `CallExpressionNode`, `JSXElementNode`, ...) | Types of the tree and the walk. |

Entries: `@shadow-js/compiler` (every export above) and `@shadow-js/compiler/javascript` (the same names, always the TypeScript
implementation). There are no other entries. The generated code imports its runtime helpers from `@shadow-js/web` for the `dom` target
and from `@shadow-js/web/server` for the `ssr` target.

## Status

The `dom` and `ssr` targets are complete: AST based, with HTML nesting validation, fixture tests and execution tests, for every option,
source maps and errors. The Rust output is compared with the TypeScript implementation on the compiler's own test inputs, a sample of
real components, an option matrix, every error code, every JSX file and documentation example of the project, and several hundred
thousand generated and mutated modules; none differs. Nesting thousands of levels deep, which stops the TypeScript implementation's
process, is answered by the Rust one.

## Links

- [ShadowJS documentation](https://shadowjs.net/guides/compiler/)

## Dependencies

- Runtime `entities` `^8.1.0`: decodes HTML entities in JSX text (`src/internal/lower.ts`).
- Runtime `oxc-parser` `0.153.0`: parses source into an AST (`src/internal/parse.ts`) in the TypeScript implementation.
- Runtime `magic-string` `^1.4.3`: applies source edits (the compiler's and the plugins') and is the class of the source map in the result.
- Optional, one per platform: `@shadow-js/compiler-<platform>` `1.0.0`, the prebuilt addon.
- Peers: none.

## Types

- Declarations ship in `dist/dev`; the repo builds them under `strict: true`.
- Names from the root: the exports above.

## Support

- Node.js `>=22.12.0`, Bun and Deno for the Rust and WebAssembly implementations. ESM only: use `import`; `require` is not supported.
- Browsers and workers: the TypeScript implementation, through the package conditions or `@shadow-js/compiler/javascript`.
- Versioning: every `@shadow-js/*` package releases together at one version, and so do the platform packages. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).
