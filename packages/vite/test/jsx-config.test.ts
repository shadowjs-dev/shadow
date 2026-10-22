import { afterEach, describe, expect, it, vi } from "vitest";

/** Loads the plugin against a stand-in for the `vite` module with the given release (the real one is fixed at install). */
async function configFor(version: string) {
  vi.resetModules();
  // Only a Rolldown based Vite (8 and later) exports `rolldownVersion`.
  vi.doMock("vite", () =>
    Number.parseInt(version, 10) >= 8 ? { rolldownVersion: "1.0.0" } : { rollupVersion: "4.0.0" },
  );
  const { shadow } = await import("../src/index");
  const plugin = shadow();
  const hook = plugin.config as (
    config: object,
    env: { command: string; mode: string },
  ) => Record<string, unknown>;
  return hook.call({}, {}, { command: "build", mode: "production" });
}

afterEach(() => {
  vi.doUnmock("vite");
  vi.resetModules();
});

describe("[VITE-JSX-CONFIG] the JSX runtime reaches the transformer of each Vite", () => {
  it("[VITE-JSX-CONFIG-1] Vite 8 reads it under oxc", async () => {
    const config = await configFor("8.3.3");
    expect(config["oxc"]).toEqual({
      jsx: { runtime: "automatic", importSource: "@shadow-js/web" },
    });
    expect(config["esbuild"]).toBeUndefined();
  });

  it("[VITE-JSX-CONFIG-2] Vite 7 reads it under esbuild", async () => {
    const config = await configFor("7.3.7");
    expect(config["esbuild"]).toEqual({ jsx: "automatic", jsxImportSource: "@shadow-js/web" });
    expect(config["oxc"]).toBeUndefined();
  });
});
