import { afterEach, describe, expect, it, vi } from "vitest";

interface Context {
  warn(message: string): void;
  error(message: string): never;
}

type Shadow = typeof import("../src/index").shadow;

/** Runs the plugin's transform on a JSX module the way Vite does. */
async function run(
  plugin: ReturnType<Shadow>,
  code: string,
  ssr = false,
): Promise<{ code: string } | null> {
  const hook = plugin.transform;
  const fn = typeof hook === "function" ? hook : hook?.handler;
  if (fn === undefined) throw new Error("no transform");
  const context: Context = {
    warn: () => undefined,
    error(message) {
      throw new Error(message);
    },
  };
  return (await (
    fn as (this: Context, code: string, id: string, options?: { ssr?: boolean }) => unknown
  ).call(context, code, "/src/app.tsx", { ssr })) as { code: string } | null;
}

const SOURCES = [
  "export const App = () => <button onClick={() => 1}>hi</button>;",
  "export function List(props: { rows: string[] }) { return <ul>{props.rows.map((row) => <li class={row}>{row}</li>)}</ul>; }",
  "import { useSignal } from '@shadow-js/core'; export function C() { const [n, set] = useSignal(0); return <p onClick={() => set(n() + 1)}>{n()} clicks</p>; }",
  "export const plain = 1;",
];
const BROKEN = "const view = <div>;";

afterEach(() => {
  vi.doUnmock("@shadow-js/compiler");
  vi.doUnmock("@shadow-js/compiler/javascript");
  vi.resetModules();
});

/** The plugin as a fresh import, with both compiler entries replaced so a test can tell which one was called. */
async function withEntries(backend: "native" | "wasm" | "javascript", notes: string[] = []) {
  const calls: string[] = [];
  const result = (marker: string) => ({
    code: marker,
    map: null,
    transformed: true,
    diagnostics: [],
  });
  vi.resetModules();
  vi.doMock("@shadow-js/compiler", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@shadow-js/compiler")>()),
    compile: () => {
      calls.push("auto");
      return result("AUTO");
    },
    getBackend: () => ({ name: backend, source: "mock", notes }),
  }));
  vi.doMock("@shadow-js/compiler/javascript", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@shadow-js/compiler/javascript")>()),
    compile: () => {
      calls.push("javascript");
      return result("JAVASCRIPT");
    },
  }));
  const { shadow } = await import("../src/index");
  return { shadow, calls };
}

describe("compiler option", () => {
  it("[VITE-COMPILER-01] auto (the default) gives the output of the TypeScript implementation, byte for byte", async () => {
    const { shadow } = await import("../src/index");
    for (const ssr of [false, true]) {
      for (const source of SOURCES) {
        const auto = await run(shadow(), source, ssr);
        const javascript = await run(shadow({ compiler: "javascript" }), source, ssr);
        expect(auto, source).toEqual(javascript);
      }
    }
  });

  it("[VITE-COMPILER-02] auto calls the compiler package's own entry; javascript calls the TypeScript entry only", async () => {
    const auto = await withEntries("native");
    expect((await run(auto.shadow(), SOURCES[0] ?? ""))?.code).toBe("AUTO");
    expect((await run(auto.shadow({ compiler: "auto" }), SOURCES[0] ?? ""))?.code).toBe("AUTO");
    expect(auto.calls).toEqual(["auto", "auto"]);
    const javascript = await withEntries("native");
    expect((await run(javascript.shadow({ compiler: "javascript" }), SOURCES[0] ?? ""))?.code).toBe(
      "JAVASCRIPT",
    );
    expect(javascript.calls).toEqual(["javascript"]);
  });

  it("[VITE-COMPILER-03] native runs when the Rust or WebAssembly implementation loaded, and fails with the reason when only TypeScript is available", async () => {
    for (const backend of ["native", "wasm"] as const) {
      const { shadow, calls } = await withEntries(backend);
      expect((await run(shadow({ compiler: "native" }), SOURCES[0] ?? ""))?.code).toBe("AUTO");
      expect(calls).toEqual(["auto"]);
    }
    const { shadow, calls } = await withEntries("javascript", [
      "native addon: no prebuilt addon exists for plan9-mips",
    ]);
    const failure = run(shadow({ compiler: "native" }), SOURCES[0] ?? "");
    await expect(failure).rejects.toThrow(/compiler: "native"/);
    await expect(failure).rejects.toThrow(/no prebuilt addon exists for plan9-mips/);
    await expect(failure).rejects.toThrow(/SHADOW_COMPILER_BACKEND/);
    expect(calls).toEqual([]);
  });

  it("[VITE-COMPILER-04] a syntax error is the same error in every mode", async () => {
    const { shadow } = await import("../src/index");
    const messages: string[] = [];
    for (const compiler of ["auto", "javascript"] as const) {
      messages.push(
        await run(shadow({ compiler }), BROKEN).then(
          () => "no error",
          (error: Error) => error.message,
        ),
      );
    }
    expect(messages[0]).not.toBe("no error");
    expect(messages[0]).toBe(messages[1]);
  });

  it("[VITE-COMPILER-05] accepts auto, javascript and native, and refuses any other value", async () => {
    const { shadow } = await import("../src/index");
    for (const compiler of ["auto", "javascript", "native"] as const) {
      expect(() => shadow({ compiler })).not.toThrow();
    }
    expect(() => shadow({ compiler: "rust" as never })).toThrow(
      /"compiler" must be "auto", "javascript" or "native"/,
    );
  });
});
