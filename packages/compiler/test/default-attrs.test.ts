import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const ssr = (source: string): string =>
  compile(source, { filename: "a.tsx", generate: "ssr" }).code;

describe("static attributes that are properties (SSR)", () => {
  it("[DEF-02] defaultValue on an input is the value attribute; defaultChecked is checked", () => {
    const code = ssr(
      'export const A = () => <div><input defaultValue="x" /><input type="checkbox" defaultChecked /></div>;',
    );
    expect(code).toContain('<input value=\\"x\\">');
    expect(code).toContain("checked");
    expect(code).not.toContain("defaultValue");
    expect(code).not.toContain("defaultChecked");
  });

  it("[DEF-03] a textarea's value is its content; innerHTML and textContent literals are children", () => {
    const code = ssr(
      'export const A = () => <div><textarea defaultValue="n&o" /><p innerHTML="<b>x</b>" /><p textContent="a<b" /></div>;',
    );
    expect(code).toContain('_$ssrTextArea("n&o")');
    expect(code).toContain('_$ssrRaw("<b>x</b>")');
    expect(code).toContain('_$escape("a<b")');
    expect(code).not.toContain("innerHTML=");
    expect(code).not.toContain("textContent=");
    expect(code).not.toContain('value=\\"n');
  });

  it("[DEF-04] components keep their props untouched (defaultValue is just a prop)", () => {
    const code = compile('export const A = () => <Field defaultValue="x" innerHTML="y" />;', {
      filename: "a.tsx",
      generate: "dom",
    }).code;
    expect(code).toContain('defaultValue: "x"');
    expect(code).toContain('innerHTML: "y"');
  });
});

describe("attribute names that are members of every object (SSR)", () => {
  it("[DEF-10] constructor, toString, valueOf and __proto__ are plain attributes, not the text of a function", () => {
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      const code = ssr(`export const A = () => <div ${name}="0" />;`);
      expect(code, name).not.toContain("native code");
      expect(code, name).not.toContain("function");
      // HTML attribute names are case-insensitive; the compiler writes them lowercase.
      expect(code, name).toContain(`${name.toLowerCase()}=`);
    }
  });
});
