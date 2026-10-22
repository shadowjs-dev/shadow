# AGENTS.md: working on shadow

This file is for anyone who changes this repository, people and coding agents alike. It says how the repository is laid out, how to implement
and test a change, and how a pull request is reviewed. To **use** the released package, read [README.md](README.md) and [SKILL.md](SKILL.md)
instead; to take part in the project, read [CONTRIBUTING.md](CONTRIBUTING.md).

ShadowJS, a fine-grained reactive UI framework: the reactive core, the DOM and server renderer, the JSX compiler (a Rust addon, WebAssembly and TypeScript) and the Vite plugin.

## What is in this repository

| Package | Folder | What it is | Documentation |
| --- | --- | --- | --- |
| `@shadow-js/compiler` | `packages/compiler` | The ShadowJS JSX compiler: a Rust addon, WebAssembly and TypeScript, one API and identical output | https://shadowjs.net/guides/compiler/ |
| `@shadow-js/core` | `packages/core` | Signals, stores, memos and effects that update exactly what changed | https://shadowjs.net/reference/core/ |
| `@shadow-js/web` | `packages/web` | A DOM renderer with no virtual DOM, plus control flow, server rendering and hydration | https://shadowjs.net/reference/web/ |
| `@shadow-js/vite` | `packages/vite` | A Vite plugin that compiles your JSX, builds for server rendering and sets up Vitest | https://shadowjs.net/guides/vite/ |

`@shadow-js/compiler`, `@shadow-js/core`, `@shadow-js/web`, `@shadow-js/vite` are built, tested and released together. Source and issues:
https://github.com/shadowjs-dev/shadow. Every package of the project has the same version number.

## Set up

You need Node.js 22.12 or newer and npm (pnpm and Yarn are not used).

The tests also need:

- The Rust toolchain that `rust-toolchain.toml` pins, for the compiler's native addon and WebAssembly build.

A test whose tool or account is missing **fails** with instructions; it is never skipped.

```sh
npm install
npm run check   # lint, build, type check and every test
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run lint` | Biome: lint and format check (`npx biome check --write <path>` fixes what it can) |
| `npm run build` | builds the packages in dependency order with tsdown |
| `npm run typecheck` | TypeScript 7 in strict mode, tests included |
| `npm test` | unit, DOM and server tests (Vitest) |
| `npx vitest run <path>` | one test file |
| `npm run test:gc` | memory and leak tests |
| `npm run test:perf` | wall-clock budgets; run alone, never in parallel with other work |
| `npm run build:binaries` | the compiler's Rust addon and WebAssembly build; `check` runs it before the tests |
| `npm run check` | all of the above; a change is ready when it passes |

## Layout

- `.github/`: workflows, issue and pull request templates, code owners.
- `crates/`: the Rust workspace of the compiler.
- `packages/`: one folder per package of this repository.
- `scripts/`: build and release scripts; `release.mjs` is run by the workflows.
- `tools/`: scripts the build and the tests use.
- `types/`: ambient declarations shared with the build.
- `Cargo.toml`: the Rust workspace.
- `biome.json`: lint and format rules.
- `package.json`: the manifest; `version` is changed only by a release.
- `vitest.config.ts`: the test projects (unit, DOM, server, gc, perf).
- `vitest.setup.ts`: test setup: an unasserted `console.warn` or `console.error` fails a test.

## How to implement a change

1. **Find where the behavior lives.** Search `test/` and `src/` for the name of the behavior or its invariant id, then read the source the tests exercise. The invariants below say what must stay true.
2. **Write the failing test first.** A bug fix reproduces the bug; a feature states the behavior it promises. Name the test with an invariant id in square brackets, the way the neighboring tests do, then the behavior in words. The test asserts what the code does and is never skipped, marked as todo or marked as an expected failure.
3. **Make it pass with the smallest change** that keeps the invariants. Match the code around it.
4. **Keep the surface honest.** A public symbol has TSDoc (summary, parameters, return value, an example and `@since`). An error says what happened and how to fix it. User-visible behavior gets a documentation update and a line under `## Unreleased` in CHANGELOG.md.
5. **Run `npm run check`** and read its output; do not report a change as done without it passing.

### Rules every change keeps

- No `any`, `@ts-ignore` or non-null assertion. Use `unknown` and narrow.
- Compare indices, lengths and counts explicitly (`=== undefined`, `=== -1`, `> 0`), never by truthiness.
- No empty `catch`: every catch rethrows, passes the error to the owner's handler, or reports it. Every "set the current X" register is restored in `finally`.
- User callbacks run untracked unless the API says otherwise. No stack parsing, no `fn.name` sniffing, no flags stamped on user functions.
- Traversals whose depth the user controls are iterative. Caches, queues and recursion are bounded, and a test hits the bound.
- Code meant for development only sits behind `__DEV__`. No import-time side effects and no module-level mutable state beyond the registers the core owns (bounded caches and `WeakMap`s excepted).
- No sleeps in tests (flush the scheduler); a `console.warn` or `console.error` that a test does not assert fails the test. Property tests use `fast-check` with a fixed seed.
- Files are kebab-case, tests are `*.test.ts`, internals live in `src/internal/`. American English in code, comments and documentation. Comments explain why, not what.
- The reactive core and the DOM renderer have no runtime dependencies.

## Pull requests

1. **Open an issue first** for anything that adds or changes public API, behavior, supported platforms or dependencies. A small fix needs no issue.
2. **Fork, then branch from `main`** (`fix/<topic>`, `feat/<topic>`, `docs/<topic>`). One concern per pull request.
3. **Commit in small steps** with a message that says what changed and why: a short type prefix (`fix:`, `feat:`, `docs:`, `test:`, `chore:`), then the subject. Commit under your own identity; do not add trailers or notes about tools.
4. **Open the pull request against `main`** and fill in the template: what changes, why, and the checks you ran. The CI workflow (`.github/workflows/ci.yml`) runs lint, build, type check and all tests; it must be green.
5. **Review.** A maintainer (see `.github/CODEOWNERS`) reviews every pull request. Expect questions about the test, the public surface and the error messages. Push fixes to the same branch; the pull request is squash-merged.
6. **Releases are not part of a pull request.** Do not change `version`, `.github/workflows/release.yml` or `scripts/release.mjs`, and do not create tags or publish. A maintainer releases by renaming `## Unreleased` in the changelog to the version and pushing a version that is not yet on npm to `main`; the workflow publishes it with provenance.

Security problems never go in a public issue or pull request: follow [SECURITY.md](SECURITY.md).

## Architecture and invariants

What each package keeps true. A change that breaks one of these is a bug in the change.

### @shadow-js/compiler

One package holds three implementations of one compiler and the code that chooses between them.

```
src/index.ts        node, bun, deno   compile, compileAsync, getBackend: the entry that chooses (src/auto.ts)
src/javascript.ts   everything else   the TypeScript implementation alone, and the same names (`@shadow-js/compiler/javascript`)
src/native/         loaders for the Rust addon and the WebAssembly build (node:module, node:fs; never imported by javascript.ts)
src/internal/       the TypeScript implementation
crates/             the Rust implementation: shadow-compiler, shadow-compiler-node (addon), shadow-compiler-wasm
```

The output of the three is identical, byte for byte; the TypeScript implementation is the reference and the oracle of the tests.

#### Selection and tree shaking

- [COMPILER-01] `src/javascript.ts` imports nothing from `src/auto.ts` or `src/native/`, and nothing that needs Node.js: a bundler
  that follows the `browser`, `worker` or default condition reaches no loader, no addon path and no WebAssembly. A test reads the
  built `dist/prod/javascript.js` graph and fails on a `node:` import.
- [COMPILER-02] The package is `sideEffects: false` and ships one file per source module (`unbundle`), so an application that imports
  only `compile` from the JavaScript entry pays for that entry's modules and nothing else.
- [COMPILER-03] The choice is made once per process, lazily, on the first call or the first `getBackend()`; importing the package
  loads nothing.
- [COMPILER-04] `getBackend()` is the same shape on both entries: `{ name, source, notes }`, with `name` "javascript" on the entry that
  has no loader.

### The TypeScript implementation

#### Pipeline

```
source ─▶ pre plugins ─▶ useStore cells ─▶ derive ─▶ lower (IR) ─▶ generate (dom | ssr) ─▶ post plugins ─▶ code + map
```

Everything is text to text over `magic-string`: code outside JSX keeps its exact text, and each JSX root
is replaced by generated code. The two passes before lowering (`store-cells.ts`, `derive.ts`) return new
text (it can have more lines than the module) built as a `Rope`; its output is parsed again. Every later stage
reads that text, so the `Origin` of each rewrite (`origin.ts`) traces its offsets back to the module.

#### Invariants

- `lower.ts` is the only place that decides what is static text. Literal children are folded there (never in
  `dom.ts` or `ssr.ts`), so both targets lay out the same text nodes and hydration matches. Parents where HTML
  parsing differs from inserting (`NO_TEXT_FOLD`) and component children are never folded.
- `classify.ts` is the only authority on "dynamic" and on constant values (`constantValue`). Folding in
  attributes and in children uses the same function.
- `DomContext.blocks` maps the text of an element root's wrapping function to its statements. A site that is a
  function body (`assemble.ts` `place`, `dom.ts` `returnStatement`) uses the statements; no other code reads the
  map, and the `ssr` target leaves it empty.
- A module with no plugins takes the same path as before: `compile` enters `runWithPlugins` only for a
  non-empty `plugins` list. Plugin code lives in `internal/plugins.ts` and `internal/sourcemap.ts`.
- Plugin edits are applied with `magic-string` and the module is parsed again after each plugin that edited,
  so a plugin cannot hand malformed text to a later stage. Maps compose by line and column
  (`composeMaps`); `pre` edit maps are character precise, the rest has the granularity of the compiler's map.
- A position that leaves the compiler is a position of the text the caller passed in. Errors of the passes
  after a rewrite go through `errorInSource` and the source map of the rewritten text through `mapInSource`
  (`assemble.ts` `run`), so `sourcesContent` is the module and the lines are its lines. A pass that rewrites
  text builds it with `Rope`/`splice` (copied runs are exact, written runs resolve to where they were written)
  and hands the `Origin` to `run`; the Rust code does the same in `origin.rs`, with the same rules.
- The contract for plugins and for the generated code is written in the Compiler guide (https://shadowjs.net/guides/compiler/).

### The Rust implementation

##### Pipeline

```
source ─▶ parse (oxc) ─▶ useStore cells ─▶ derived constants ─▶ lower to IR ─▶ generate (dom | ssr) ─▶ edits + map
```

- `tree.rs` rebuilds the ESTree shape that `oxc-parser` returns to JavaScript from the Rust syntax tree: one entry per
  ESTree node with its type, span, parent and subtree size. Every generic pass (is this expression dynamic, which
  names does a pattern bind, where is JSX) is a linear scan over it.
- `classify.rs`, `lower.rs`, `dom.rs`, `ssr.rs`, `store_cells.rs`, `derive.rs` and `hmr.rs` follow the modules of
  the TypeScript implementation one for one, including the order in which helpers, templates and names are registered.
- `magic.rs` is a port of the part of `magic-string` the compiler uses, including its source map encoder.
- `origin.rs` records where the text of the two rewriting passes comes from (`Rope`, `Origin`) and retraces the
  positions of errors and of the source map.
- `api.rs` is the one entry the bindings use: loose options in, a flat outcome out, no panic and no stack overflow.

##### Invariants

- [COMPILER-10] The code, the `transformed` flag, the source map and the thrown `CompileError` of `compile`
  are those of the TypeScript implementation, byte for byte; the Rust view of the syntax tree equals the one the reference
  walks. The corpus, the tree fixtures, the live differential and the fuzzers prove it. Positions (errors and
  the source map) are those of the module as written, also after the `useStore` and derived-constant rewrites:
  `origin.rs` traces them back, as `origin.ts` does in the reference.
- [COMPILER-11] A call the Rust core cannot answer exactly (plugins, a string with an unpaired surrogate,
  options of an unusual type, input the core marks as unsupported) is answered by the TypeScript implementation, so the
  caller never sees a difference.
- [COMPILER-12] The implementation is the native addon, else the WebAssembly build, else the TypeScript implementation;
  `getBackend()` names the one in use and `notes` says why a faster one was not. `SHADOW_COMPILER_BACKEND` can demand one: `native` and
  `wasm` throw when it cannot load, any value outside the four names throws.
- [COMPILER-13] `compileAsync` does not run the compiler on the calling thread when the addon is in use, and
  concurrent calls are safe, also from worker threads.
- [COMPILER-14] No input makes the compiler crash or fail internally: deep nesting is compiled on a thread
  with a large stack or refused with an error, and a panic is caught at the boundary and handed to the reference.
- [COMPILER-15] The package and its platform packages (`@shadow-js/compiler-<platform>`) carry one version.
- Offsets inside the Rust code are UTF-8 byte offsets; they become UTF-16 code unit offsets only where a position is
  reported (diagnostics) or counted (source map columns).
- The Rust tests decide nothing alone: the reference's recorded output is the oracle.
- [COMPILER-16] The benchmark gate (`bench/check-speedup.mjs`) measures the speedup as the median compile time of the
  TypeScript compiler over the native one, per input size; the nightly run fails when the large input drops below 8.

### @shadow-js/core

- Graph: push-dirty / pull-clean. States CLEAN < CHECK < DIRTY. Memos recompute lazily on read;
  effects are queued and drained by `flush()` (render effects first, then user effects, parents
  before children, siblings by creation).
- Source files: `internal/` is not exported. `state.ts` holds the only mutable registers.
- Diagnostics: add a code to `internal/messages.ts`, throw `ShadowError(code)` or call `warn(code)`.
- Exported signatures are the public API. Changing one is a breaking change.

### @shadow-js/web

Package-specific invariants are listed here.

### @shadow-js/vite

Package-specific invariants are listed here.

## Where to look next

- [README.md](README.md): what the package does and every option.
- [SKILL.md](SKILL.md): how to use the released package (install, import paths, a quick start).
- [CONTRIBUTING.md](CONTRIBUTING.md): the short guide to taking part.
- [CHANGELOG.md](packages/compiler/CHANGELOG.md): what each release changed.
- [ShadowJS hub](https://github.com/shadowjs-dev/shadow): every repository of the project.
