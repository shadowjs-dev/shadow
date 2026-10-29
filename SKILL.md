---
name: shadowjs-compiler
description: "Work with @shadow-js/compiler, @shadow-js/core, @shadow-js/web, @shadow-js/vite. The ShadowJS JSX compiler: a Rust addon, WebAssembly and TypeScript, one API and identical output. Use when a project imports one of them, or when asked to add, configure or debug them."
---

# shadow

ShadowJS, a fine-grained reactive UI framework: the reactive core, the DOM and server renderer, the JSX compiler (a Rust addon, WebAssembly and TypeScript) and the Vite plugin. This repository publishes `@shadow-js/compiler`, `@shadow-js/core`, `@shadow-js/web`, `@shadow-js/vite` at version 1.0.3.

## Where to read more

- @shadow-js/compiler: https://shadowjs.net/guides/compiler/
- @shadow-js/core: https://shadowjs.net/reference/core/
- @shadow-js/web: https://shadowjs.net/reference/web/
- @shadow-js/vite: https://shadowjs.net/guides/vite/
- Source and issues: https://github.com/shadowjs-dev/shadow
- The package README is the full reference for options and behavior; read it before changing a configuration.

## @shadow-js/compiler

Version 1.0.3. The ShadowJS JSX compiler: a Rust addon, WebAssembly and TypeScript, one API and identical output.

### Install

```sh
npm install -D @shadow-js/compiler
```

### Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/compiler`
- `@shadow-js/compiler/javascript`

### Quick start

```ts
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

## @shadow-js/core

Version 1.0.3. Signals, stores, memos and effects that update exactly what changed.

### Install

```sh
npm install @shadow-js/core
```

### Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/core`
- `@shadow-js/core/store`
- `@shadow-js/core/extend`

### Quick start

```ts
import { createRoot, flushSync, useEffect, useMemo, useStore } from "@shadow-js/core";

const [count, setCount] = useStore(0);

createRoot((dispose) => {
  const doubled = useMemo(() => count() * 2);

  useEffect(() => {
    console.log(`count ${count()}, doubled ${doubled()}`);
  });

  flushSync();
  setCount((n) => n + 1);
  flushSync();
  setCount(5);
  flushSync();
  dispose();
});
```

## @shadow-js/web

Version 1.0.3. A DOM renderer with no virtual DOM, plus control flow, server rendering and hydration.

### Install

```sh
npm install @shadow-js/web @shadow-js/core
```

### Peer dependencies

| Package | Range | Required |
| --- | --- | --- |
| `@shadow-js/core` | `^1.0.3` | yes |

### Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/web`
- `@shadow-js/web/server`
- `@shadow-js/web/jsx-runtime`
- `@shadow-js/web/jsx-dev-runtime`
- `@shadow-js/web/hmr`
- `@shadow-js/web/extend`

### Quick start

```tsx
import { useStore } from "@shadow-js/core";

export function Counter() {
  const [count, setCount] = useStore(0);

  return (
    <button type="button" onClick={() => setCount((n) => n + 1)}>
      Count: {count()}
    </button>
  );
}
```

## @shadow-js/vite

Version 1.0.3. A Vite plugin that compiles your JSX, builds for server rendering and sets up Vitest.

### Install

```sh
npm install -D @shadow-js/vite
```

### Peer dependencies

| Package | Range | Required |
| --- | --- | --- |
| `vite` | `^7.0.0 || ^8.0.0` | no |
| `@mdx-js/mdx` | `^3.0.0` | no |
| `@shadow-js/web` | `^1.0.3` | no |

### Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/vite`
- `@shadow-js/vite/mdx`

### Quick start

```ts
import shadow from "@shadow-js/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [shadow()],
});
```

## Working rules

- Run `npm run check` before proposing a change; it lints, builds, type-checks and tests.
- Do not add a runtime dependency to `@shadow-js/core` or `@shadow-js/web`.
- Keep a public change documented: TSDoc on every exported symbol, and a CHANGELOG entry.
- To change this repository rather than use the package, read AGENTS.md: the layout, the commands, the rules and how a pull request is reviewed.
