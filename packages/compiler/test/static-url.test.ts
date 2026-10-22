import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const build = (source: string, generate: "dom" | "ssr"): string =>
  compile(source, { filename: "a.tsx", generate }).code;

describe("static script URLs", () => {
  it("[URL-01] a literal javascript: href is not baked into the template (dom)", () => {
    const code = build('export const A = () => <a href="javascript:alert(1)">x</a>;', "dom");
    expect(code).not.toContain('javascript:alert(1)\\"');
    expect(code).not.toContain('href=\\"javascript');
    expect(code).toContain("javascript:alert(1)"); // handed to the checked attribute writer
  });

  it("[URL-02] a literal javascript: href is not baked into the markup (ssr)", () => {
    const code = build('export const A = () => <a href="javascript:alert(1)">x</a>;', "ssr");
    expect(code).not.toContain('href=\\"javascript');
    expect(code).toContain("javascript:alert(1)");
  });

  it("[URL-03] the check ignores case, white space and control characters, like the runtime", () => {
    const code = build('export const A = () => <a href=" JavaScript:alert(1)">x</a>;', "dom");
    expect(code).not.toContain('href=\\" JavaScript');
  });

  it("[URL-04] safe URLs and unrelated attributes stay in the template", () => {
    const code = build(
      'export const A = () => <a href="https://example.com" title="javascript:not a url">x</a>;',
      "dom",
    );
    expect(code).toContain("https://example.com");
    expect(code).toContain("javascript:not a url");
  });

  it("[URL-05] components keep their props untouched", () => {
    const code = build('export const A = () => <Link href="javascript:alert(1)" />;', "dom");
    expect(code).toContain('href: "javascript:alert(1)"');
  });
});
