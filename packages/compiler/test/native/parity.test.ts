import { describe, expect, it } from "vitest";
import { compile, compileAsync } from "../../src/index";
import { CompileError } from "../../src/javascript";
import { type Case, readCorpus } from "./support/corpus";

/** Runs one recorded case and compares everything the JavaScript compiler returned or threw. */
function check(entry: Case, run: typeof compile): void {
  const { expect: expected } = entry;
  if (expected.kind === "ok") {
    const result = run(entry.source, entry.options);
    expect(result.code).toBe(expected.code);
    expect(result.transformed).toBe(expected.transformed);
    expect(result.diagnostics).toEqual(expected.diagnostics);
    if (expected.map === null) {
      expect(result.map).toBeNull();
    } else {
      expect(result.map).not.toBeNull();
      expect(JSON.parse(JSON.stringify(result.map))).toEqual(expected.map);
      expect(typeof result.map?.toUrl()).toBe("string");
    }
    return;
  }
  let thrown: unknown;
  try {
    run(entry.source, entry.options);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CompileError);
  const error = thrown as CompileError;
  if (expected.kind === "error") {
    expect(error.message).toBe(expected.message);
    expect(error.frame).toBe(expected.frame);
    expect(error.id).toBe(expected.id);
    expect(error.name).toBe("CompileError");
    expect({ ...error.diagnostic }).toEqual(expected.diagnostic);
  }
}

/** Why the Rust compiler hands an input to `@shadow-js/compiler` on purpose (COMPILER-11). */
const HANDED_OVER = ["an attribute named like a member of every object"];

const corpora = ["tests", "errors", "options-matrix", "real"] as const;

describe("[COMPILER-10] the output is the output of @shadow-js/compiler", () => {
  for (const name of corpora) {
    it(`native addon: every recorded case of the ${name} corpus`, () => {
      const previous = process.env["SHADOW_COMPILER_BACKEND"];
      process.env["SHADOW_COMPILER_BACKEND"] = "native";
      try {
        const cases = readCorpus(name);
        expect(cases.length).toBeGreaterThan(50);
        for (const entry of cases) check(entry, compile);
      } finally {
        if (previous === undefined) delete process.env["SHADOW_COMPILER_BACKEND"];
        else process.env["SHADOW_COMPILER_BACKEND"] = previous;
      }
    }, 120_000);
  }

  it("the async variant gives the same answers as the sync one", async () => {
    for (const entry of readCorpus("tests").slice(0, 80)) {
      const expected = entry.expect;
      if (expected.kind === "ok") {
        const result = await compileAsync(entry.source, entry.options);
        expect(result.code).toBe(expected.code);
      } else if (expected.kind === "error") {
        await expect(compileAsync(entry.source, entry.options)).rejects.toBeInstanceOf(
          CompileError,
        );
      }
    }
  }, 60_000);

  it("the WebAssembly build reproduces the recorded cases as well", async () => {
    const { loadWasm } = await import("../../src/native/backend");
    const attempt = loadWasm();
    if (!attempt.ok) throw new Error(attempt.reason);
    const cases = [...readCorpus("tests"), ...readCorpus("errors")];
    for (const entry of cases) {
      if (entry.expect.kind !== "ok") continue;
      const output = attempt.backend.compileSync(entry.source, {
        generate: entry.options.generate === "ssr" ? "ssr" : "dom",
        dev: entry.options.dev === true,
        autoReactive: entry.options.autoReactive !== false,
        hmr: entry.options.hmr === true,
        hydratable: entry.options.hydratable !== false,
        sourceMap: entry.options.sourceMap !== false,
        ...(entry.options.filename === undefined ? {} : { filename: entry.options.filename }),
        ...(entry.options.moduleName === undefined ? {} : { moduleName: entry.options.moduleName }),
      });
      // Inputs the Rust compiler hands to the reference by design are answered by the wrapper.
      if (output.kind === 2 && HANDED_OVER.includes(output.errorMessage ?? "")) continue;
      expect(output.kind).toBe(0);
      expect(output.code).toBe(entry.expect.code);
    }
  }, 60_000);
});
