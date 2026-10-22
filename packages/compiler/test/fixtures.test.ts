import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const dir = join(import.meta.dirname, "fixtures");
const inputs = readdirSync(dir)
  .filter((f) => f.endsWith(".input.tsx"))
  .sort();

describe("dom fixtures", () => {
  for (const file of inputs) {
    const name = file.replace(".input.tsx", "");
    it(`[FIX-DOM] ${name}`, async () => {
      const source = readFileSync(join(dir, file), "utf8");
      const result = compile(source, { filename: file });
      await expect(result.code).toMatchFileSnapshot(join(dir, `${name}.dom.js`));
    });
    it(`[FIX-SSR] ${name}`, async () => {
      const source = readFileSync(join(dir, file), "utf8");
      const result = compile(source, { filename: file, generate: "ssr" });
      await expect(result.code).toMatchFileSnapshot(join(dir, `${name}.ssr.js`));
    });
  }
});
