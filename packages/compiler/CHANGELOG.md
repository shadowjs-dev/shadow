# Changelog

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

## 1.0.0

### Added

- One package for every implementation of the compiler: the Rust addon (prebuilt for macOS, Linux with glibc or musl, and Windows, x64 and arm64, as optional `@shadow-js/compiler-<platform>` packages), the same Rust code as WebAssembly, and the TypeScript implementation. `compile`, `compileAsync` and `getBackend` pick the fastest one the machine has, with identical output, source maps and errors; `@shadow-js/compiler/javascript` is the TypeScript implementation alone, for browsers, workers and bundles that must not carry a loader. `SHADOW_COMPILER_BACKEND`, `SHADOW_COMPILER_NATIVE_PATH` and `SHADOW_COMPILER_WASM_PATH` configure the choice.
- AST-based JSX and TypeScript compilation for DOM and server targets.
- Forgiving reactive transforms for derived values, props and component output.
- Static template generation and specialization of single-value stores.
- Compiler plugin API: `plugins` option with `"pre"` plugins on the syntax tree of the source and `"post"` plugins on the generated code, a typed visitor, edits with composed source maps, declared imports, located errors, and `validatePlugins`. Documented in the Compiler guide.
- `Diagnostic.plugin` and the `"info"` severity for findings that plugins report.

### Changed

- Smaller and faster output: literal children (`{" "}`, `{2026}`, `{"text"}`, arithmetic on literals) are folded into the template text, with neighboring text merged and `null`, `true` and `false` children dropped, in both targets; arithmetic on literals in attributes and component props is computed at build time; an element that is the whole body of a function (`return <el />`, `() => <el />`, render callbacks, compiler-written getters) is built without a wrapping function call. No runtime behavior changes; components still receive their children as written.
