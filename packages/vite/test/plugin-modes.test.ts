import { describe, expect, it } from "vitest";
import shadow from "../src/index";

type Plugin = ReturnType<typeof shadow>;
type ConfigResult = {
  envPrefix?: string[];
  resolve: { dedupe?: string[]; conditions?: string[] };
  test?: { server?: { deps?: { inline?: Array<string | RegExp> } } };
};
type TransformHook = (
  this: { error(message: string): never },
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => unknown;

const COUNTER =
  "export function Counter() { const [count] = useSignal(0); const double = count() * 2; return <p>{double}</p>; }";
const SOURCE = "export const App = () => <button onClick={() => 1}>hi</button>;";
const STORE = 'import { useStore } from "@shadow-js/core";\nexport const [n] = useStore(0);\n';

function configure(plugin: Plugin, command: "serve" | "build", mode = "development"): void {
  const hook = plugin.config;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  (fn as (config: object, env: { command: string; mode: string }) => unknown)(
    {},
    { command, mode },
  );
}

function resolvedConfig(
  options: Parameters<typeof shadow>[0],
  userConfig: object,
  mode: string,
): ConfigResult {
  const plugin = shadow(options);
  const hook = plugin.config;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  return (fn as (config: object, env: { command: string; mode: string }) => ConfigResult)(
    userConfig,
    { command: "serve", mode },
  );
}

function transformer(plugin: Plugin): (code: string, id: string, ssr?: boolean) => unknown {
  const hook = plugin.transform;
  const fn = (typeof hook === "function" ? hook : hook?.handler) as TransformHook | undefined;
  if (fn === undefined) throw new Error("plugin has no transform");
  const context = {
    error(message: string): never {
      throw new Error(message);
    },
  };
  return (code, id, ssr = false) => fn.call(context, code, id, { ssr });
}

function compiledCode(plugin: Plugin, code: string, id: string, ssr = false): string | null {
  const result = transformer(plugin)(code, id, ssr) as { code: string } | null;
  return result === null ? null : result.code;
}

/** Runs `fn` with an environment variable set to `value` (or unset), then restores it. */
function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

describe("shadow() Vite plugin modes", () => {
  it("[VIT-34] autoReactive false keeps a computed const as written; the default makes it a live value", () => {
    const live = shadow();
    configure(live, "build", "production");
    const liveCode = compiledCode(live, COUNTER, "/app/counter.tsx");
    expect(liveCode).not.toBeNull();
    expect(liveCode).not.toContain("const double = count() * 2");
    expect(liveCode).toContain("_$derived");

    const literal = shadow({ autoReactive: false });
    configure(literal, "build", "production");
    const literalCode = compiledCode(literal, COUNTER, "/app/counter.tsx");
    expect(literalCode).toContain("const double = count() * 2");
    expect(literalCode).not.toContain("_$derived");
    expect(literalCode).not.toBe(liveCode);
  });

  it("[VIT-35] an SSR transform emits the server target and never contains hot-update code", () => {
    withEnv("VITEST", undefined, () => {
      // Serve mode with the default hot updates: the browser transform is hot-updatable, the SSR one is not.
      const plugin = shadow();
      configure(plugin, "serve");
      const dom = compiledCode(plugin, SOURCE, "/app/a.tsx", false);
      expect(dom).toContain("import.meta.hot");
      const ssr = compiledCode(plugin, SOURCE, "/app/a.tsx", true);
      expect(ssr).not.toBeNull();
      expect(ssr).toContain("@shadow-js/web/server");
      expect(ssr).not.toContain("import.meta.hot");
      expect(ssr).not.toContain("@shadow-js/web/hmr");
    });
  });

  it("[VIT-36] with dev true and hmr at its default, components register with the hmr runtime; hmr false does not", () => {
    withEnv("VITEST", undefined, () => {
      const hot = shadow({ dev: true });
      configure(hot, "build", "production");
      const hotCode = compiledCode(hot, SOURCE, "/app/a.tsx");
      expect(hotCode).toContain('"@shadow-js/web/hmr"');
      expect(hotCode).toContain("import.meta.hot");
      expect(hotCode).toContain("import.meta.hot?.accept()");

      const cold = shadow({ dev: true, hmr: false });
      configure(cold, "build", "production");
      const coldCode = compiledCode(cold, SOURCE, "/app/a.tsx");
      expect(coldCode).not.toContain("@shadow-js/web/hmr");
      expect(coldCode).not.toContain("import.meta.hot");
    });
  });

  it("[VIT-37] a plain .ts module that calls useStore is compiled; a plain .ts without useStore returns null", () => {
    const plugin = shadow();
    configure(plugin, "build", "production");
    const store = compiledCode(plugin, STORE, "/app/count.ts");
    expect(store).not.toBeNull();
    expect(store).toContain("useShadowSignal(0)");
    expect(compiledCode(plugin, "export const x = 1;\n", "/app/plain.ts")).toBeNull();
    expect(compiledCode(plugin, "export const x = 1;\n", "/app/plain.mts")).toBeNull();
  });

  it("[VIT-38] the config hook sets envPrefix to VITE_ and DUSK_PUBLIC_ and dedupes @shadow-js/core and @shadow-js/web", () => {
    withEnv("VITEST", undefined, () => {
      const config = resolvedConfig({}, {}, "development");
      expect(config.envPrefix).toEqual(["VITE_", "DUSK_PUBLIC_"]);
      expect(config.resolve.dedupe).toEqual(["@shadow-js/core", "@shadow-js/web"]);
    });
  });

  it("[VIT-39] under the test mode, resolve.conditions is browser only for a happy-dom or jsdom environment", () => {
    withEnv("VITEST", undefined, () => {
      expect(
        resolvedConfig({}, { test: { environment: "happy-dom" } }, "test").resolve.conditions,
      ).toEqual(["browser"]);
      expect(
        resolvedConfig({}, { test: { environment: "jsdom" } }, "test").resolve.conditions,
      ).toEqual(["browser"]);
      expect(
        resolvedConfig({}, { test: { environment: "node" } }, "test").resolve.conditions,
      ).toBeUndefined();
      expect(resolvedConfig({}, {}, "test").resolve.conditions).toBeUndefined();
      // Outside a test mode and outside Vitest the environment alone does not select the browser build.
      expect(
        resolvedConfig({}, { test: { environment: "jsdom" } }, "development").resolve.conditions,
      ).toBeUndefined();
    });
  });
});
