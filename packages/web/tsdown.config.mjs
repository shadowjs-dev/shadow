import { readFileSync } from "node:fs";
import { createConfig } from "../../tools/build/tsdown-preset.mjs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default [
  ...createConfig({
    packageDir: import.meta.dirname,
    entries: {
      index: "src/index.ts",
      server: "src/server.ts",
      hmr: "src/hmr.ts",
      extend: "src/extend.ts",
    },
    serverEntries: {
      index: "src/index.ts",
      server: "src/server.ts",
      extend: "src/extend.ts",
    },
  }),
  ...jsxRuntimeConfigs(),
];

/**
 * Builds for the JSX entries, `@shadow-js/web/jsx-runtime` and `@shadow-js/web/jsx-dev-runtime`. They
 * are kept out of the preset. Its bundled dts build would move the augmentable `CustomEvents` and
 * `Directives` interfaces into a shared chunk and re-export them, and apps could no longer merge into
 * them. The unbundled dts build keeps each module's declarations where they are. The JS is empty:
 * these entries are types only.
 *
 * @returns Two builds per format: dev (declarations) and prod (JS).
 */
function jsxRuntimeConfigs() {
  const base = {
    entry: { "jsx-runtime": "src/jsx-runtime.ts", "jsx-dev-runtime": "src/jsx-dev-runtime.ts" },
    format: "esm",
    platform: "neutral",
    target: "es2022",
    sourcemap: false,
    clean: false,
  };
  const define = (dev) => ({
    __DEV__: JSON.stringify(dev),
    __SERVER__: "false",
    __TEST__: "false",
    __VERSION__: JSON.stringify(pkg.version),
  });
  return [
    { ...base, outDir: "dist/dev", define: define(true), dts: true, unbundle: true },
    { ...base, outDir: "dist/prod", define: define(false), minify: true, dts: false },
  ];
}
