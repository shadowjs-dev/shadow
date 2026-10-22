# @shadow-js/vite

The Vite plugin for ShadowJS. It runs [`@shadow-js/compiler`](../compiler/README.md) on every
`.jsx` and `.tsx` file before Vite's own JSX handling, so the code Vite sees contains no JSX. In an
SSR build it emits the server target. It also points Vite's dependency scanning at the ShadowJS JSX
runtime types, de-duplicates `@shadow-js/core` and `@shadow-js/web`, and configures Vitest for
DOM tests. Vite is the only supported host in 1.0.0; this is a plain Vite plugin, not an unplugin.

## Install

```sh
npm install -D @shadow-js/vite vite
```

Requires Vite 7 or 8 (`vite` is an optional peer dependency, `^7.0.0 || ^8.0.0`). `@shadow-js/compiler` is installed
as a dependency. ShadowJS 1.0.0 is not on npm yet; until it is published, install it from a local
checkout of this repository.

## Example

Add the plugin to `vite.config.ts`. The named export `shadow` and the default export are the same
function.

```ts title="vite.config.ts" typecheck
import shadow from "@shadow-js/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [shadow()],
});
```

The plugin is an ordinary Vite plugin object, so its behavior can be checked without starting a
server: call its `config` and `transform` hooks the way Vite does. In a production build a `.tsx`
file comes back compiled, files the plugin does not handle come back as `null`, and an SSR
transform imports from `@shadow-js/web/server`.

```ts title="plugin.ts" run output="shadowjs pre\ncompiled: true\nplain ts: null\nssr: true"
import shadow from "@shadow-js/vite";

type Config = (config: object, env: { command: string; mode: string }) => unknown;
type Transform = (
  this: { error(message: string): never },
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => { code: string } | null;

const plugin = shadow();
const config = plugin.config as Config;
const transform = plugin.transform as Transform;
const context = {
  error(message: string): never {
    throw new Error(message);
  },
};

config({}, { command: "build", mode: "production" });

const source = "export const App = () => <button>hi</button>;";
const compiled = transform.call(context, source, "/app/app.tsx");
const server = transform.call(context, source, "/app/app.tsx", { ssr: true });

console.log(plugin.name, plugin.enforce);
console.log(`compiled: ${compiled?.code.includes("template(") === true}`);
console.log(`plain ts: ${transform.call(context, "export const n = 1;", "/app/n.ts")}`);
console.log(`ssr: ${server?.code.includes("@shadow-js/web/server") === true}`);
```

### Testing with Vitest

Tests need the compiler too. Use the same plugin in `vitest.config.ts`. When the test environment
is `happy-dom` or `jsdom` the plugin selects the browser build of ShadowJS and inlines it; with a
`node` environment it keeps the server build. Set `domTests` explicitly if you pick the environment
per file; tests that call `renderToString` want `domTests: false`.

```ts title="vitest.config.ts" typecheck
import shadow from "@shadow-js/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [shadow()],
  test: { environment: "happy-dom" },
});
```

With Vitest `projects` the environment is set per project, and a plugin in the root `plugins` cannot
see it. Give the DOM project its own plugin with `domTests: true` (it then also inlines `@shadow-js/*`
for that project only); a node project keeps the server build:

```ts title="vitest.config.ts" typecheck
import shadow from "@shadow-js/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [shadow()],
  test: {
    projects: [
      { extends: true, test: { name: "node", environment: "node", include: ["src/**/*.test.ts"] } },
      {
        extends: true,
        plugins: [shadow({ domTests: true })],
        test: { name: "dom", environment: "happy-dom", include: ["src/**/*.dom.test.tsx"] },
      },
    ],
  },
});
```

## Options

`shadow(options?)` takes a `ShadowPluginOptions` object.

| Option | Default | Description |
| --- | --- | --- |
| `include` | `/\.[cm]?[jt]sx$/` | Files to compile. A `g` or `y` flag is ignored. |
| `exclude` | `node_modules` | Files to skip. |
| `moduleName` | `@shadow-js/web` | Module the compiled code imports runtime helpers from. |
| `autoReactive` | `true` | Keep constants computed from reactive reads live without a function (forgiving reactivity). |
| `hmr` | `true` | Hot-update components in place during `vite dev`. |
| `dev` | Vite dev mode | Force development output (component names, extra checks). |
| `domTests` | detected | Run the browser build under Vitest. On by default for `happy-dom` and `jsdom`. |
| `plugins` | none | [Compiler plugins](https://shadowjs.net/guides/compiler/) (`CompilerPlugin` from `@shadow-js/compiler`) that run in the build on every compiled module. Validated when `shadow()` is called; errors fail the build with the plugin's name and the position, warnings go to Vite's log. |

## Hot updates

The plugin turns on the compiler's `hmr` option in `vite dev` (never in a build, for SSR transforms
or under a test runner). The compiled module registers its top-level components with
`@shadow-js/web/hmr`, so an edit re-renders the instances of the edited component while parents and
siblings keep their state; a module that exports only components accepts its own update. This is
covered by the unit tests of the compiler and of the plugin (`[HMR-01]` to `[HMR-06]`, `[VIT-04]`).
The browser test tier also exercises hot updates in a real browser.

## MDX

`@shadow-js/vite/mdx` compiles `.mdx` files into components. Install `@mdx-js/mdx` (an optional peer) and list `shadowMdx()` next to `shadow()`:

```ts typecheck
import shadow from "@shadow-js/vite";
import { shadowMdx } from "@shadow-js/vite/mdx";

export default { plugins: [shadowMdx(), shadow()] };
```

`shadowMdx(options?)` takes `include` (default `.mdx`), `exclude`, `remarkPlugins`, `rehypePlugins`, `recmaPlugins`, `remarkRehypeOptions`, `providerImportSource`, `elements` (`"overridable"` looks up each Markdown element in the `components` prop; `"static"` renders them from the template), `mdx` (the compiler's module name or your own function), `plugins` and `moduleName`. The [MDX guide](https://shadowjs.net/guides/mdx/) covers components, frontmatter and content collections. For types, add `/// <reference types="@shadow-js/vite/mdx-env" />` to a `.d.ts` file.

## API

Entry `@shadow-js/vite`. The exports are:

| Export | Description |
| --- | --- |
| `shadow` | Returns the Vite plugin: name `shadowjs`, `enforce: "pre"`, with `config` and `transform` hooks. |
| `default` | The same function as `shadow`. |
| `ShadowPluginOptions` | The options type. |

Entry `@shadow-js/vite/mdx`:

| Export | Description |
| --- | --- |
| `shadowMdx` | Returns the MDX plugin: name `shadowjs-mdx`, `enforce: "pre"`. |
| `ShadowMdxOptions`, `MdxCompile` | The options type and the shape of the `mdx` function. |

`@shadow-js/vite/mdx-env` holds types only (`*.mdx` and `*.md` modules).

## Links

- [`@shadow-js/compiler`](../compiler/README.md), [`@shadow-js/web`](../web/README.md), [`@shadow-js/testing`](https://testing.shadowjs.net)
- [Vite plugin guide](https://shadowjs.net/guides/vite/), [MDX guide](https://shadowjs.net/guides/mdx/)

## Dependencies

- Runtime `@shadow-js/compiler` `1.0.0`: compiles component sources in the Vite plugin (`src/index.ts`).
- Optional peers: `vite` `^7.0.0 || ^8.0.0`: the host for the plugin and the `Plugin` type (`src/index.ts`, `src/mdx.ts`); `@mdx-js/mdx` `^3.0.0`: compiles MDX (`src/mdx.ts`).

## Types

- Names from the root: `ShadowPluginOptions`. Names from `@shadow-js/vite/mdx`: `ShadowMdxOptions`, `MdxCompile`.

## Support

- Node.js `>=22.12.0`. ESM only: use `import`; `require` is not supported.
- Browsers: not applicable; the package has no browser target.
- Versioning: every `@shadow-js/*` package releases together at one version. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).
