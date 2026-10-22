import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const ssr = (source: string): string =>
  compile(source, { filename: "a.tsx", generate: "ssr" }).code;
const dom = (source: string): string =>
  compile(source, { filename: "a.tsx", generate: "dom" }).code;

describe("form controls (SSR)", () => {
  it("[DEF-05] select value marks its options: no value attribute, the children go through ssrSelectValue", () => {
    const code = ssr(
      'export const A = (p) => <select name="c" value={p.v()}><option value="a">A</option><option>B</option></select>;',
    );
    expect(code).toContain("_$ssrSelectValue(p.v(), _$ssr(");
    expect(code).toContain('<option value=\\"a\\">A</option><option>B</option>');
    expect(code).not.toContain('ssrAttribute("value"');
    expect(code).toContain('<select"');
    expect(code).toContain('name=\\"c\\">');
  });

  it("[DEF-06] a static select value, defaultValue and a multiple array all mark options", () => {
    expect(
      ssr('export const A = () => <select value="b"><option value="b">B</option></select>;'),
    ).toContain('_$ssrSelectValue("b"');
    expect(
      ssr(
        'export const A = (p) => <select defaultValue={p.d}><option value="b">B</option></select>;',
      ),
    ).toContain("_$ssrSelectValue(p.d");
    const code = ssr(
      'export const A = (p) => <select multiple value={p.list()}><option value="b">B</option></select>;',
    );
    expect(code).toContain("_$ssrSelectValue(p.list()");
    expect(code).toContain("multiple");
  });

  it("[DEF-07] option children keep their order with dynamic options, components and slots", () => {
    const code = ssr(
      "export const A = (p) => <select value={p.v}><option value={p.a}>{p.label}</option><Opt /></select>;",
    );
    expect(code).toContain("_$ssrSelectValue(p.v,");
    expect(code.indexOf('ssrAttribute("value", p.a)')).toBeGreaterThan(
      code.indexOf("ssrSelectValue"),
    );
    expect(code).toContain("_$createComponent(Opt");
  });

  it("[DEF-08] a select without a value, and a select with a spread, are not rewritten by the compiler", () => {
    const plain = ssr(
      'export const A = () => <select name="x"><option selected>A</option></select>;',
    );
    expect(plain).not.toContain("ssrSelectValue");
    const spread = ssr(
      "export const A = (p) => <select {...p.attrs} value={p.v}><option>A</option></select>;",
    );
    expect(spread).toContain('_$ssrElement("select"');
    expect(spread).not.toContain("ssrSelectValue");
  });

  it("[DEF-09] a textarea's value and defaultValue are its content, with the leading newline kept", () => {
    const value = ssr("export const A = (p) => <textarea value={p.v()} />;");
    expect(value).toContain("_$ssrTextArea(p.v())");
    expect(value).not.toContain("ssrAttribute");
    const fallback = ssr("export const A = (p) => <textarea defaultValue={p.d} />;");
    expect(fallback).toContain("_$ssrTextArea(p.d)");
    const literal = ssr('export const A = () => <textarea value="\\nx" />;');
    expect(literal).toContain("_$ssrTextArea(");
  });

  it("[DEF-10] inputs keep value and checked as attributes", () => {
    const code = ssr(
      'export const A = (p) => <div><input type="radio" value="a" checked={p.c()} /><input type="number" value={p.n()} /><input type="checkbox" checked={p.k} /></div>;',
    );
    expect(code).toContain('_$ssrAttribute("checked", p.c(), true)');
    expect(code).toContain('_$ssrAttribute("value", p.n())');
    expect(code).toContain('_$ssrAttribute("checked", p.k, true)');
    expect(code).toContain('value=\\"a\\"');
  });
});

describe("form controls (DOM)", () => {
  it("[DEF-11] a select value is applied by setSelectValue (arrays select options of a multiple select)", () => {
    const code = dom(
      'export const A = (p) => <select multiple value={p.v()}><option value="a">A</option></select>;',
    );
    expect(code).toContain("_$setSelectValue(");
    expect(code).not.toMatch(/\.value = /);
  });

  it("[DEF-12] other elements keep assigning the value property", () => {
    const code = dom(
      "export const A = (p) => <div><input value={p.v()} /><textarea value={p.t()} /></div>;",
    );
    expect(code).not.toContain("setSelectValue");
    expect(code).toMatch(/\.value = /);
  });
});

describe("textarea children", () => {
  it("[DEF-13] a dynamic textarea child is its value: no insert, no markers, same on both targets", () => {
    const source = 'export const A = (p) => <textarea name="x">{p.v()}</textarea>;';
    const server = ssr(source);
    expect(server).toContain("_$ssrTextArea(p.v()");
    expect(server).not.toContain("<!--");
    const client = dom(source);
    expect(client).not.toContain("_$insert(");
    expect(client).toContain("p.v()");
    // Text around the expression becomes one string value.
    const mixed = dom("export const A = (p) => <textarea>Hi {p.n()}!</textarea>;");
    expect(mixed).not.toContain("_$insert(");
    expect(mixed).toContain('"Hi "');
  });

  it("[DEF-14] a textarea with static text or its own value keeps its meaning", () => {
    expect(dom("export const A = () => <textarea>plain</textarea>;")).not.toContain("_$insert(");
    const both = dom("export const A = (p) => <textarea value={p.a()}>{p.b()}</textarea>;");
    expect(both).toContain("p.a()");
  });
});
