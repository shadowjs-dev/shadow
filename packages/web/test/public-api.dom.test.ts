import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "..", "src");

describe("extensibility", () => {
  it("[EXT-W1] control-flow components and head tags use only exported APIs", () => {
    const offenders: string[] = [];
    for (const dir of ["control-flow", "head"]) {
      for (const name of readdirSync(join(src, dir))) {
        if (!name.endsWith(".ts")) continue;
        for (const line of readFileSync(join(src, dir, name), "utf8").split("\n")) {
          if (/^\s*(?:import|export)\b.*from\s+["']\.\.\/(?:internal\/|insert["'])/.test(line)) {
            offenders.push(`${dir}/${name}: ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("[EXT-W2] the extension entry exposes the renderer building blocks", async () => {
    const extend = await import("../src/extend");
    for (const name of [
      "bindRegion",
      "createRegion",
      "removeRegion",
      "reconcileNodes",
      "claimElement",
      "takeRegion",
      "enterComponent",
      "nextKey",
      "withScope",
      "resourceKey",
      "warnOnce",
      "isUnsafeUrlAttribute",
    ]) {
      expect(typeof (extend as Record<string, unknown>)[name], name).toBe("function");
    }
  });
});
