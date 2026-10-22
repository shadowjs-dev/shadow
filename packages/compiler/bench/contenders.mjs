/**
 * The compilers the benchmark compares. Each contender has a `prepare()` that loads it (outside the
 * timing) and returns `compile(filename, source) -> string`, the generated code.
 *
 * - `js`: `@shadow-js/compiler`, the TypeScript compiler (its built output, as published).
 * - `native`: `@shadow-js/compiler` through its public API (addon, source map object included).
 * - `addon`: the Rust addon called directly, without the JavaScript wrapper.
 * - `wasm`: `@shadow-js/compiler` running its WebAssembly build.
 * - `solid`: `@babel/core` with `babel-preset-solid`, the transform of Solid, on the same JSX.
 * - `oxc`: `oxc-transform`, a Rust JSX transform with the React-style output, the floor of "parse,
 *   transform JSX, print".
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(here, "..");
const repository = resolve(packageDirectory, "../..");
const requireFromBench = createRequire(join(here, "package.json"));

async function importBuilt(path) {
  return await import(pathToFileURL(join(repository, path)).href);
}

export const CONTENDERS = {
  js: {
    label: "@shadow-js/compiler (TypeScript)",
    async prepare() {
      const { compile } = await importBuilt("packages/compiler/dist/prod/index.js");
      return (filename, source) => compile(source, { filename }).code;
    },
  },
  native: {
    label: "@shadow-js/compiler (Rust addon)",
    async prepare() {
      process.env.SHADOW_COMPILER_BACKEND = "native";
      const { compile } = await importBuilt("packages/compiler/dist/prod/index.js");
      return (filename, source) => compile(source, { filename }).code;
    },
  },
  addon: {
    label: "Rust addon, no JavaScript wrapper",
    async prepare() {
      const require = createRequire(import.meta.url);
      const addon = require(
        join(packageDirectory, "npm", platformDirectory(), "shadow-compiler.node"),
      );
      const options = {
        generate: "dom",
        dev: false,
        autoReactive: true,
        hmr: false,
        hydratable: true,
        sourceMap: true,
      };
      return (filename, source) => addon.compileSync(source, { ...options, filename }).code;
    },
  },
  wasm: {
    label: "@shadow-js/compiler (WebAssembly)",
    async prepare() {
      process.env.SHADOW_COMPILER_BACKEND = "wasm";
      const { compile } = await importBuilt("packages/compiler/dist/prod/index.js");
      return (filename, source) => compile(source, { filename }).code;
    },
  },
  solid: {
    label: "@babel/core + babel-preset-solid",
    async prepare() {
      const babel = requireFromBench("@babel/core");
      const preset = requireFromBench("babel-preset-solid");
      return (filename, source) =>
        babel.transformSync(source, {
          filename,
          presets: [preset],
          babelrc: false,
          configFile: false,
          sourceMaps: false,
          compact: false,
        }).code;
    },
  },
  oxc: {
    label: "oxc-transform (React-style JSX)",
    async prepare() {
      const { transformSync } = requireFromBench("oxc-transform");
      return (filename, source) =>
        transformSync(filename, source, { jsx: { runtime: "automatic" }, sourcemap: false }).code;
    },
  },
};

function platformDirectory() {
  const key = { darwin: "darwin", linux: "linux", win32: "win32" }[process.platform];
  return `${key}-${process.arch}`
    .replace("linux-x64", "linux-x64-gnu")
    .replace("linux-arm64", "linux-arm64-gnu")
    .replace("win32-x64", "win32-x64-msvc")
    .replace("win32-arm64", "win32-arm64-msvc");
}
