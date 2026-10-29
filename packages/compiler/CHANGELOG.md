# Changelog

## 1.0.2

### Fixed

- The Rust core (the native addon and the WebAssembly build) follows the TypeScript compiler in every case below, so the output no longer depends on the backend and no input is routed around it: conditionals nested n deep cost n, not 2^n (the native default took about 20 seconds at depth 22), a module's own `_el$`, `_c$` and `_ref$` are not shadowed, a tag that starts with a non-ASCII letter is JSX, an exported `enum` or `namespace` is a value export in a hot module, and JSX nested too deep through expressions stops with `JSX_TOO_DEEP`.
- A chain of thousands of conditionals compiles instead of overflowing the stack.
- A component name with a dash (`<Foo-Bar />`) is a `BAD_TAG` error instead of the subtraction `Foo - Bar`; a lowercase custom element (`<my-el />`) is unchanged.
- Dynamic children of `<style>` and `<script>` are written as text on the server, not entity-escaped (`a > b` stays `a > b`), and a closing tag of the element in the text (`</style`, `</script`, and `<!--` in a script) is made harmless as `<\/style`. `<style>`, `<script>`, `<title>` and `<textarea>` get no `<!--[-->` markers inside them, from compiled code, `element()` and `Dynamic` alike, and hydration adopts their text. `@shadow-js/web/server` exports `ssrRawText` for the compiled output.
- `<input value={a} defaultValue={b} />` writes `value` once: the explicit `value` wins (and `checked` over `defaultChecked`).
- A static attribute value the HTML template parser would change (a carriage return, NUL) is set at run time instead of being written into the template.
- A static `xlinkHref="javascript:..."` in SVG is refused at build time, like `xlink:href`.
- The WebAssembly build follows the same limits as the native addon and no longer hands deep input to the TypeScript compiler: JSX nested through expressions up to 400 levels (the 401st is `JSX_TOO_DEEP`), chains of tens of thousands of conditionals, operators, members and calls, and up to 150,000 nested brackets (more is the same `PARSE_ERROR`). The module still runs on the small stack of the JavaScript engine for ordinary input; when deep input overflows it, the loader runs the same module on a worker thread with a 1 GiB stack (the module's own stack is 512 MiB) and waits for the answer, so the output is the addon's, byte for byte. The worker starts on first use and does not keep the process alive. Before, JSX nested past 160 levels, braces past about 1,500 and ternary chains past about 3,000 made `compile()` warn and fall back.
- The compiler no longer overflows the stack on JSX nested deep inside expressions of JSX: it stops with `JSX_TOO_DEEP` after 400 levels.
- The TypeScript implementation compiles conditionals nested n deep in linear time instead of 2^n.
- A module's own `_el$`, `_c$` and `_ref$` are no longer shadowed by the locals of the generated code.
- A component whose name starts with a non-ASCII letter (`<Übersicht />`) is compiled instead of silently left as JSX.
- An exported `enum` or `namespace` stops a module from accepting its own hot update, like any other value export.

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
