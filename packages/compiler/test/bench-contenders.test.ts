import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error the script is plain JavaScript without declarations
import { CONTENDERS } from "../bench/contenders.mjs";

type Prepared = ((filename: string, source: string) => string) & { backend: string };
const contenders = CONTENDERS as Record<string, { prepare(): Promise<Prepared> }>;

describe("benchmark contenders", () => {
  it("[COMPILER-17] the js contender is the TypeScript implementation, whatever addon is installed", async () => {
    const built = new URL("../dist/prod/javascript.js", import.meta.url);
    if (!existsSync(built)) {
      throw new Error("packages/compiler is not built: run npm run build -w @shadow-js/compiler");
    }
    const compile = await contenders["js"]?.prepare();
    expect(compile?.backend).toBe("javascript");
    expect(compile?.("a.tsx", "export const A = () => <b>{x()}</b>;")).toContain("template");
  });
});
