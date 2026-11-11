import { describe, expect, it } from "vitest";
import { compile as compileWithJavaScript } from "../src/javascript";
import type { RawOptions } from "../src/native/backend";
import { backendOf, native, wasm } from "./native/support/backends";

/**
 * `progress` and `meter` have a `value` property that is a number: assigning `undefined ?? ""` made it
 * `0` and wrote `value="0"`, a determinate bar, where the server omits the attribute. The attribute is
 * written instead, by the helper that removes it for `null` and `undefined`, like `li` and `data-*`.
 */

const dom = (source: string): string =>
  compileWithJavaScript(source, { filename: "a.tsx", generate: "dom" }).code;

describe("[CMP-PRG-1] value on progress and meter is an attribute", () => {
  it("a dynamic value is written by setAttribute, which removes it for null and undefined", () => {
    for (const tag of ["progress", "meter"]) {
      const code = dom(`export const A = (p) => <${tag} value={p.v} max="10" />;`);
      expect(code, tag).toContain('_$setAttribute(_el$, "value", p.v)');
      expect(code, tag).not.toContain(".value =");
    }
  });

  it("the other elements with a value property still get the property", () => {
    for (const tag of ["input", "textarea", "option", "button", "data", "output"]) {
      expect(dom(`export const A = (p) => <${tag} value={p.v} />;`), tag).toContain(".value = ");
    }
  });

  it("a literal value stays in the template", () => {
    expect(dom('export const A = () => <progress value="40" max="100" />;')).toContain(
      'value=\\"40\\"',
    );
  });

  for (const [label, attempt] of [
    ["addon", native],
    ["WebAssembly", wasm],
  ] as const) {
    it(`${label}: the code is the TypeScript implementation's`, () => {
      const backend = backendOf(attempt, label);
      const raw: RawOptions = {
        filename: "a.tsx",
        generate: "dom",
        dev: false,
        autoReactive: true,
        hmr: false,
        hydratable: true,
        sourceMap: false,
      };
      for (const tag of ["progress", "meter", "li", "input"]) {
        const input = `export const A = (p) => <div><${tag} value={p.v} max="10" /></div>;`;
        expect(backend.compileSync(input, raw).code, `${label} ${tag}`).toBe(dom(input));
      }
    });
  }
});
