import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RawOptions } from "../../src/native/backend";
import { createBigStack } from "../../src/native/wasm-stack";

const WASM_FILE = join(import.meta.dirname, "../../wasm/shadow-compiler.wasm");

/** The compiled module, or an error that says how to build it: the test never passes without the build. */
function loadModule(): WebAssembly.Module {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(readFileSync(WASM_FILE));
  } catch (error) {
    throw new Error(
      `the WebAssembly build is missing (run npm run build:binaries): ${String(error)}`,
    );
  }
  return new WebAssembly.Module(bytes);
}

const OPTIONS: RawOptions = {
  generate: "dom",
  dev: false,
  autoReactive: true,
  hmr: false,
  hydratable: true,
  sourceMap: false,
};

describe("the large-stack thread of the WebAssembly build", () => {
  it("[CMP-R6-1] compiles deep input on its own thread, keeps the thread for later calls, and answers small input the same as before", () => {
    const stack = createBigStack(loadModule());
    const small = "export const A = () => <b>hi</b>;";
    const deep = `export const A = () => <b>{${"(".repeat(100_000)}1${")".repeat(100_000)}}</b>;`;
    const first = stack.run(small, OPTIONS);
    expect(first.kind).toBe(0);
    for (let round = 0; round < 2; round += 1) {
      expect(stack.run(deep, OPTIONS).kind).toBe(0);
      expect(stack.run(small, OPTIONS)).toEqual(first);
    }
  }, 60_000);

  it("[CMP-R6-2] a compile error is an answer from the thread, not a lost thread: the next call still works", () => {
    const stack = createBigStack(loadModule());
    const broken = stack.run("export const A = () => <b>;", OPTIONS);
    expect(broken.kind).not.toBe(0);
    expect(stack.run("export const A = () => <i />;", OPTIONS).kind).toBe(0);
  }, 60_000);
});
