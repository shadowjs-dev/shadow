import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const exact = (entries: [string, string][]) =>
  entries.map(([specifier, path]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`),
    replacement: source(path),
  }));

// This repository's own packages are imported from source, so a test run needs no build.
const own: [string, string][] = [
  ["@shadow-js/compiler/javascript", "./packages/compiler/src/javascript.ts"],
  ["@shadow-js/core/extend", "./packages/core/src/extend.ts"],
  ["@shadow-js/core/store", "./packages/core/src/store/index.ts"],
  ["@shadow-js/web/extend", "./packages/web/src/extend.ts"],
  ["@shadow-js/web/server", "./packages/web/src/server.ts"],
  ["@shadow-js/compiler", "./packages/compiler/src/index.ts"],
  ["@shadow-js/vite/mdx", "./packages/vite/src/mdx.ts"],
  ["@shadow-js/core", "./packages/core/src/index.ts"],
  ["@shadow-js/web", "./packages/web/src/index.ts"],
];
// The other ShadowJS packages come from node_modules, as the build an app would get: the browser development build for DOM and unit
// tests, the server development build for server tests. Naming the files keeps every package on one build, so there is one copy of core.
const fromClient: [string, string][] = [];
const fromServer: [string, string][] = [];

const define = { __DEV__: "true", __SERVER__: "false", __TEST__: "true", __VERSION__: '"0.0.0"' };
const serverDefine = { ...define, __SERVER__: "true" };
// Matched against the file path, not the specifier: every ShadowJS package in node_modules goes through Vite, so they all share one copy of core.
const inline = {
  deps: { inline: [/[/]node_modules[/]@shadow-js[/]/, /[/]node_modules[/]create-shadow-app[/]/] },
};
const client = { alias: exact([...own, ...fromClient]) };
const serverSide = { alias: exact([...own, ...fromServer]) };

export default defineConfig({
  test: {
    // A snapshot that is missing fails the test; it is never written silently.
    snapshotOptions: { updateSnapshot: "none" },
    projects: [
      {
        define,
        resolve: client,
        test: {
          name: "unit",
          environment: "node",
          server: inline,
          testTimeout: 30_000,
          hookTimeout: 30_000,
          include: [
            "packages/compiler/test/**/*.test.ts",
            "packages/core/test/**/*.test.ts",
            "packages/web/test/**/*.test.ts",
            "packages/vite/test/**/*.test.ts",
          ],
          exclude: [
            "**/*.dom.test.ts",
            "**/*.server.test.ts",
            "**/*.gc.test.ts",
            "**/*.perf.test.ts",
            "**/*.dist.test.ts",
            "**/node_modules/**",
          ],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        define,
        resolve: client,
        test: {
          name: "dom",
          environment: "happy-dom",
          server: inline,
          testTimeout: 30_000,
          include: [
            "packages/compiler/test/**/*.dom.test.ts",
            "packages/core/test/**/*.dom.test.ts",
            "packages/web/test/**/*.dom.test.ts",
            "packages/vite/test/**/*.dom.test.ts",
          ],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        define: serverDefine,
        resolve: serverSide,
        test: {
          name: "server",
          environment: "node",
          server: inline,
          include: [
            "packages/compiler/test/**/*.server.test.ts",
            "packages/core/test/**/*.server.test.ts",
            "packages/web/test/**/*.server.test.ts",
            "packages/vite/test/**/*.server.test.ts",
          ],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        define,
        resolve: client,
        test: {
          name: "perf",
          environment: "happy-dom",
          server: inline,
          // Wall-clock budgets run alone, in their own invocation, so parallel correctness tests do not consume their frame.
          include: [
            "packages/compiler/test/**/*.perf.test.ts",
            "packages/core/test/**/*.perf.test.ts",
            "packages/web/test/**/*.perf.test.ts",
            "packages/vite/test/**/*.perf.test.ts",
          ],
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        define,
        resolve: client,
        test: {
          name: "gc",
          environment: "node",
          server: inline,
          include: [
            "packages/compiler/test/**/*.gc.test.ts",
            "packages/core/test/**/*.gc.test.ts",
            "packages/web/test/**/*.gc.test.ts",
            "packages/vite/test/**/*.gc.test.ts",
          ],
          execArgv: ["--expose-gc"],
          pool: "forks",
        },
      },
    ],
  },
});
