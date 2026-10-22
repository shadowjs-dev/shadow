import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

/** DOM output for one expression exported as `A` from a component that reads `p`. */
const dom = (jsx: string): string =>
  compile(`export const A = (p) => ${jsx};`, { filename: "a.tsx", generate: "dom" }).code;

/** SSR output for the same shape. */
const ssr = (jsx: string): string =>
  compile(`export const A = (p) => ${jsx};`, { filename: "a.tsx", generate: "ssr" }).code;

describe("autoFocus (React parity): compiled output", () => {
  it("[AF-C01] a static autoFocus is a focus request, not template markup", () => {
    const code = dom("<input autoFocus />");
    expect(code).toMatch(/_\$autoFocus\(_el\$\d*, true\);/);
    expect(code).toContain('_$template("<input>")');
  });

  it("[AF-C02] a dynamic autoFocus is read once at creation, not wrapped in an effect", () => {
    const code = dom("<input autoFocus={p.on} />");
    expect(code).toMatch(/_\$autoFocus\(_el\$\d*, p\.on\);/);
    expect(code).not.toMatch(/effect\(\(\) => p\.on/);
    expect(code).not.toContain("setAttribute");
  });

  it("[AF-C03] a module without autoFocus imports nothing for it (zero cost when unused)", () => {
    const code = dom('<input type="text" value={p.v} />');
    expect(code).not.toContain("autoFocus");
  });

  it("[AF-C04] SSR writes the autofocus boolean attribute (hydration keeps the server markup)", () => {
    const code = ssr("<input autoFocus />");
    expect(code).toContain("autofocus");
    expect(code).not.toContain("autoFocus");
  });

  it("[AF-C05] SSR writes autofocus for a truthy dynamic value only", () => {
    const code = ssr("<input autoFocus={p.on} />");
    expect(code).toContain('_$ssrAttribute("autofocus", p.on)');
  });

  it("[AF-C06] lower-case autofocus keeps the plain HTML property path (React warns and sets the attribute)", () => {
    const code = dom("<input autofocus={p.on} />");
    expect(code).toContain(".autofocus = ");
    expect(code).not.toContain("_$autoFocus");
  });
});
