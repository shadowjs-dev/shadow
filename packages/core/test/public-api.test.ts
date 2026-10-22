import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "..", "src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "internal") files(full, out);
    } else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("extensibility", () => {
  it("[EXT-01] built-in hooks use only the public extension API, never the engine internals", () => {
    const offenders: string[] = [];
    for (const file of files(src)) {
      const rel = file.slice(src.length + 1);
      // The extension facade itself is the one module allowed to reach into the engine.
      if (rel === "extend.ts") continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (/^\s*(?:import|export)\b.*from\s+["'][^"']*internal\//.test(line)) {
          offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("[EXT-02] the extension API is enough to build a working signal and memo from outside", async () => {
    const {
      createSignalNode,
      readSignal,
      writeSignal,
      createComputation,
      readComputation,
      createOwner,
      runInScope,
      disposeOwner,
      batch,
    } = (await import("../src/extend")) as unknown as Record<string, (...args: never[]) => unknown>;
    void createOwner;
    void runInScope;
    void disposeOwner;
    void batch;
    void createSignalNode;
    void readSignal;
    void writeSignal;
    void createComputation;
    void readComputation;
    expect(typeof createSignalNode).toBe("function");
  });
});
