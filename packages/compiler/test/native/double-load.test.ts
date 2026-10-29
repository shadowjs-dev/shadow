import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requireNode } from "../../src/native/platform";
import { backendOf, native } from "./support/backends";

// Two copies of the addon in one process happen when two versions of @shadow-js/compiler are installed, or when the npm build sits
// beside a cargo build. The allocator once kept its per-thread heap in a pthread slot that every copy shares, so the second load
// crashed the process (exit 139).
const CHILD = `
const { createRequire } = require("node:module");
const load = createRequire(process.cwd() + "/");
const options = { filename: "a.tsx", generate: "dom", dev: false, autoReactive: true, hmr: false, hydratable: false, sourceMap: true };
const source = "export const A = () => <p class='a'>{count()}</p>;";
// Both are loaded before either compiles: the crash was on the second load while the first had not allocated yet.
const addons = process.argv.slice(1).map((path) => load(path));
const outputs = addons.map((addon) => {
  const sync = addon.compileSync(source, options);
  return addon.compileAsync(source, options).then((async) => JSON.stringify([sync, async]));
});
Promise.all(outputs).then((all) => process.stdout.write(JSON.stringify(all)));
`;

describe("[COMPILER-12] two copies of the native addon load into one process", () => {
  it("loads both, compiles with each and gets the same output", () => {
    const addon = backendOf(native, "the native addon");
    // `source` is the file the backend was loaded from, or the name of the platform package.
    const original = requireNode.resolve(addon.source);
    const directory = mkdtempSync(join(tmpdir(), "shadow-double-load-"));
    try {
      const copies = ["first", "second"].map((name) => {
        mkdirSync(join(directory, name));
        const path = join(directory, name, "shadow-compiler.node");
        copyFileSync(original, path);
        return path;
      });
      const stdout = execFileSync(process.execPath, ["-e", CHILD, ...copies], {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [first, second] = JSON.parse(stdout) as [string, string];
      const [sync, async] = JSON.parse(first) as [{ kind: number; code: string }, unknown];
      expect(sync.kind).toBe(0);
      expect(sync.code).toContain("count");
      expect(async).toEqual(sync);
      expect(second).toBe(first);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
