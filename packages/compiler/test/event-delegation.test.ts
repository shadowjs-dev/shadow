import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const dom = (source: string): string =>
  compile(source, { filename: "a.tsx", generate: "dom" }).code;

describe("event delegation (DOM output)", () => {
  it("[DEL-01] change is bound on its element, never delegated: it is not composed", () => {
    // The lower-case spelling is the native change event (the React spelling maps to input, see RC-EVT-01).
    const code = dom("export const A = (p) => <select onchange={() => p.log()} />;");
    expect(code).not.toContain("$$change");
    expect(code).not.toContain('"change"]');
    expect(code).toMatch(/addEventListener\(_el\$\d*, "change", /);
  });

  it("[DEL-02] composed events such as input and click stay delegated", () => {
    const code = dom(
      "export const A = (p) => <input onInput={() => p.log()} onClick={() => p.log()} />;",
    );
    expect(code).toContain("$$input = ");
    expect(code).toContain("$$click = ");
  });
});
