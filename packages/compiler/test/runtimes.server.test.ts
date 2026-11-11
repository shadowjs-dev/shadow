import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile as compileWithJavaScript } from "../src/javascript";

/**
 * The built package under each runtime its README names: Node.js, Bun and Deno. Each runtime compiles one component with
 * every implementation (the TypeScript one, WebAssembly and the Rust addon), asked for through
 * `SHADOW_COMPILER_BACKEND`, and the answers must be the same code, the same source map support and the same
 * `CompileError` everywhere. A runtime or a binary that is missing here fails its test with the way to get it; nothing is
 * skipped.
 */

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = join(PACKAGE_DIR, "test", "support", "runtime-probe.mjs");
const BUILT = join(PACKAGE_DIR, "dist", "prod", "index.js");
const BACKENDS = ["javascript", "wasm", "native"] as const;

const SOURCE = `import { useStore } from "@shadow-js/core";
export function Counter() {
  const [count, setCount] = useStore(0);
  return <button type="button" onClick={() => setCount((n) => n + 1)}>{count()} &amp; more</button>;
}
`;

interface Answer {
  runtime: string;
  backend: string;
  dom: string;
  ssr: string;
  asyncSame: boolean;
  transformed: boolean;
  mapped: boolean;
  error: { isCompileError: boolean; code: string; position: string } | null;
}

/** Whether a command runs here: it exits 0 with `--version`. */
function runsOnPath(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore", timeout: 15_000 }).status === 0;
}

const COMMANDS: Record<string, { command: string; args: string[]; install: string }> = {
  node: { command: process.execPath, args: [], install: "Node.js" },
  bun: { command: "bun", args: [], install: "Bun (https://bun.sh)" },
  // Deno resolves the package's dependencies from node_modules, which `--node-modules-dir=manual` allows.
  deno: {
    command: "deno",
    args: ["run", "-A", "--no-prompt", "--node-modules-dir=manual"],
    install: "Deno (https://deno.com)",
  },
};

/** Runs the probe under one runtime with one implementation and returns what it printed. */
function probe(runtime: string, backend: string): Answer {
  const spec = COMMANDS[runtime];
  if (spec === undefined) throw new Error(`unknown runtime ${runtime}`);
  expect(runsOnPath(spec.command), `${spec.install} must be on the PATH`).toBe(true);
  expect(existsSync(BUILT), "run npm run build -w @shadow-js/compiler first").toBe(true);
  const run = spawnSync(spec.command, [...spec.args, PROBE], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, SHADOW_COMPILER_BACKEND: backend },
  });
  expect(
    run.status,
    `${runtime} with the ${backend} implementation failed (the addon and the WebAssembly build come from npm run build:binaries):\n${run.stderr}`,
  ).toBe(0);
  return JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "") as Answer;
}

const reference = compileWithJavaScript(SOURCE, { filename: "counter.tsx" });
const referenceSsr = compileWithJavaScript(SOURCE, { filename: "counter.tsx", generate: "ssr" });

function check(runtime: string): void {
  for (const backend of BACKENDS) {
    const answer = probe(runtime, backend);
    const label = `${runtime} / ${backend}`;
    expect(answer.runtime, label).toBe(runtime);
    expect(answer.backend, label).toBe(backend);
    expect(answer.transformed, label).toBe(true);
    expect(answer.dom, label).toBe(reference.code);
    expect(answer.ssr, label).toBe(referenceSsr.code);
    expect(answer.asyncSame, label).toBe(true);
    expect(answer.mapped, label).toBe(true);
    expect(answer.error, label).toEqual({
      isCompileError: true,
      code: "PARSE_ERROR",
      position: "1:18",
    });
  }
}

describe("[RTM] the built package runs in each runtime with each implementation", () => {
  it("[RTM-01] Node.js: a child process compiles with the TypeScript, WebAssembly and Rust implementations", () => {
    check("node");
  }, 300_000);

  it("[RTM-02] Bun: the same, through the package's bun condition", () => {
    check("bun");
  }, 300_000);

  it("[RTM-03] Deno: the same, through the package's deno condition", () => {
    check("deno");
  }, 300_000);
});
