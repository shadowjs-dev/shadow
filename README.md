<p align="center"><img src="https://raw.githubusercontent.com/shadowjs-dev/shadow/main/.github/banner.png" alt="ShadowJS" width="100%"></p>

# ShadowJS

[![npm](https://img.shields.io/npm/v/@shadow-js/compiler.svg)](https://www.npmjs.com/package/@shadow-js/compiler)
[![npm](https://img.shields.io/npm/v/@shadow-js/core.svg)](https://www.npmjs.com/package/@shadow-js/core)
[![npm](https://img.shields.io/npm/v/@shadow-js/web.svg)](https://www.npmjs.com/package/@shadow-js/web)
[![npm](https://img.shields.io/npm/v/@shadow-js/vite.svg)](https://www.npmjs.com/package/@shadow-js/vite)
[![CI](https://github.com/shadowjs-dev/shadow/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowjs-dev/shadow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/shadowjs-dev/shadow/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

Fine-grained reactive UI. No virtual DOM: a compiler turns JSX into real DOM operations and signals
update exactly the text, attribute or node that depends on them.

Documentation, guides and the API reference: [shadowjs.net](https://shadowjs.net).

```tsx
import { useStore } from "@shadow-js/core";
import { render } from "@shadow-js/web";

function Counter() {
  const [count, setCount] = useStore(0);
  const double = count() * 2; // stays live: the compiler derives it

  return (
    <button type="button" onClick={() => setCount((n) => n + 1)}>
      {count()} × 2 = {double}
    </button>
  );
}

render(() => <Counter />, document.getElementById("app")!);
```

## Principles

- **Strict where it matters, forgiving where mistakes are common.** Signals are explicit functions.
  Constants computed from signals, destructured props and accessors passed as values still work.
- **Real DOM, no comments, no placeholders.** The live DOM contains only what you wrote.
- **Same code on client and server.** `renderToString` / `renderToStringAsync` and `hydrate`
  reuse the server's nodes; the compiled output is identical for client rendering and hydration.
- **Scales.** Generated multi-file apps of 400 components are checked against an independent
  oracle; 20,000-row lists move nodes, never recreate them; mount/unmount cycles do not leak.
- **Secure by construction.** Escaping in the compiler and in the runtime, URL scheme blocking,
  no `eval`, prototype-pollution-safe parsers.

## What is in this repository

The packages whose contract is one change: the compiler writes what the renderer runs, and the Vite plugin wires them. They are built, tested and released
together, with the Rust workspace of the compiler (`crates/`) beside them.

| Package | What it is |
| --- | --- |
| [`@shadow-js/compiler`](packages/compiler/README.md) | The ShadowJS JSX compiler: a Rust addon, WebAssembly and TypeScript, one API and identical output |
| [`@shadow-js/core`](packages/core/README.md) | Signals, stores, memos and effects that update exactly what changed |
| [`@shadow-js/web`](packages/web/README.md) | A DOM renderer with no virtual DOM, plus control flow, server rendering and hydration |
| [`@shadow-js/vite`](packages/vite/README.md) | A Vite plugin that compiles your JSX, builds for server rendering and sets up Vitest |

## The other packages

Each of these has its own repository.

| Repository | Packages | What it is |
| --- | --- | --- |
| [router](https://github.com/shadowjs-dev/router) | [`@shadow-js/router`](https://www.npmjs.com/package/@shadow-js/router) | A type-safe router with nested routes, loaders and link prefetching |
| [dusk](https://github.com/shadowjs-dev/dusk) | [`@shadow-js/dusk`](https://www.npmjs.com/package/@shadow-js/dusk) | A full-stack framework with file routes, loaders, server functions and secure request handling |
| [realtime](https://github.com/shadowjs-dev/realtime) | [`@shadow-js/realtime`](https://www.npmjs.com/package/@shadow-js/realtime) | Typed channels, presence and resumable delivery over WebSocket or server-sent events |
| [create-shadow-app](https://github.com/shadowjs-dev/create-shadow-app) | [`create-shadow-app`](https://www.npmjs.com/package/create-shadow-app) | Create a new app from a starter template, with optional Tailwind, Biome, Vitest, Convex and Clerk |
| [forms](https://github.com/shadowjs-dev/forms) | [`@shadow-js/forms`](https://www.npmjs.com/package/@shadow-js/forms) | Forms with fine-grained values, schema validation, field arrays and server errors |
| [i18n](https://github.com/shadowjs-dev/i18n) | [`@shadow-js/i18n`](https://www.npmjs.com/package/@shadow-js/i18n) | Typed translations with ICU messages, lazy catalogs and server rendering that hydrates cleanly |
| [query](https://github.com/shadowjs-dev/query) | [`@shadow-js/query`](https://www.npmjs.com/package/@shadow-js/query) | Fetch, cache and update server data with queries, mutations and optimistic updates |
| [table](https://github.com/shadowjs-dev/table) | [`@shadow-js/table`](https://www.npmjs.com/package/@shadow-js/table) | A headless data table with sorting, filtering, pagination, selection and grouping |
| [virtual](https://github.com/shadowjs-dev/virtual) | [`@shadow-js/virtual`](https://www.npmjs.com/package/@shadow-js/virtual) | Headless list and grid virtualization that renders only the rows in view |
| [motion](https://github.com/shadowjs-dev/motion) | [`@shadow-js/motion`](https://www.npmjs.com/package/@shadow-js/motion) | Tween and spring values, exit animations and animated list reordering, driven by signals |
| [primitives](https://github.com/shadowjs-dev/primitives) | [`@shadow-js/primitives`](https://www.npmjs.com/package/@shadow-js/primitives) | Unstyled, accessible building blocks such as dialog, popover, menu, select and tabs |
| [ui](https://github.com/shadowjs-dev/ui) | [`@shadow-js/ui`](https://www.npmjs.com/package/@shadow-js/ui) | shadcn-style components you add to your project with a CLI, styled with Tailwind v4 |
| [testing](https://github.com/shadowjs-dev/testing) | [`@shadow-js/testing`](https://www.npmjs.com/package/@shadow-js/testing) | Testing helpers to render components, query the DOM like a user, fire events and test hooks |
| [devtools](https://github.com/shadowjs-dev/devtools) | [`@shadow-js/devtools`](https://www.npmjs.com/package/@shadow-js/devtools) | A development panel that shows the components, signals, effects and updates of a running app |
| [eslint-plugin](https://github.com/shadowjs-dev/eslint-plugin) | [`@shadow-js/eslint-plugin`](https://www.npmjs.com/package/@shadow-js/eslint-plugin) | ESLint rules for reactivity, ownership and security, and for migrating code from React or Solid |
| [convex](https://github.com/shadowjs-dev/convex) | [`@shadow-js/convex`](https://www.npmjs.com/package/@shadow-js/convex) | Use Convex from your app with live queries, mutations, pagination, auth and server rendering |
| [clerk](https://github.com/shadowjs-dev/clerk) | [`@shadow-js/clerk`](https://www.npmjs.com/package/@shadow-js/clerk) | Clerk authentication for your app, with a provider, hooks, UI components and server helpers |

## Install

```bash
npm create shadow-app@latest
```

or add the packages you need to an existing project, for example `npm install @shadow-js/core @shadow-js/web @shadow-js/vite`.

## Work on it

```bash
npm install
npm run build:binaries   # the compiler's Rust addon and WebAssembly build (needs the Rust toolchain that rust-toolchain.toml pins)
npm run check            # lint, build, type check and every test
```

[CONTRIBUTING.md](CONTRIBUTING.md) says what a good change looks like. Questions and ideas go to the Discussions tab; security problems to
[SECURITY.md](SECURITY.md), never to a public issue.

## Using, changing and contributing

- **Use the package** (a person or a coding agent that builds with it): this README, and [SKILL.md](SKILL.md), the short page an agent reads first.
- **Change the package** (fix a bug, add a feature): [AGENTS.md](AGENTS.md) says how the repository is laid out, how to implement and test a change, and how a pull request is reviewed. It is written for people and coding agents alike.
- **Take part**: [CONTRIBUTING.md](CONTRIBUTING.md) is the short guide; [SECURITY.md](SECURITY.md) is for vulnerabilities.

## License

MIT
