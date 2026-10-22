import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const dom = (source: string): string =>
  compile(source, { filename: "a.tsx", generate: "dom" }).code;

/** Number of immediately invoked arrow functions the compiler wrapped around element roots. */
const wrappers = (code: string): number => (code.match(/\}\)\(\)/g) ?? []).length;

describe("an element root in a return position is not wrapped in a function", () => {
  it("[OPT-ROOT-01] `return <el/>` becomes a block", () => {
    const code = dom("export function A(p) { return <div class={p.c}><b>{p.x}</b></div>; }");
    expect(wrappers(code)).toBe(0);
    expect(code).toMatch(/\{\nconst _el\$ = _tmpl\$\(\),/);
    expect(code).toContain("return _el$;\n}");
  });

  it("[OPT-ROOT-02] a parenthesized return and an expression-bodied arrow are flattened too", () => {
    const paren = dom("export function A(p) { return (\n  <div class={p.c}>{p.x}</div>\n); }");
    expect(wrappers(paren)).toBe(0);
    const arrow = dom("export const A = (p) => (\n  <div class={p.c}>{p.x}</div>\n);");
    expect(wrappers(arrow)).toBe(0);
    expect(arrow).toContain("export const A = (p) => {\nconst _el$ = ");
  });

  it("[OPT-ROOT-03] two returns of one function each get their own block", () => {
    const code = dom(
      "export function A(p) { if (p.a) return <i>{p.a}</i>; else return <b>{p.b}</b>; }",
    );
    expect(wrappers(code)).toBe(0);
    expect(code.match(/const _el\$ = /g)?.length).toBe(2);
  });

  it("[OPT-ROOT-04] a render callback inside JSX is flattened", () => {
    const code = dom(
      "export const A = (p) => <For each={p.items}>{(item) => <li class={item().c}>{item().n}</li>}</For>;",
    );
    expect(wrappers(code)).toBe(0);
    expect(code).toContain("children: (item) => {\nconst _el$ = ");
  });

  it("[OPT-ROOT-05] getters the compiler writes return the element without a function", () => {
    const children = dom("export const A = (p) => <Box><i>{p.x}</i></Box>;");
    expect(wrappers(children)).toBe(0);
    expect(children).toContain("get children() {\nconst _el$ = ");
    const fallback = dom("export const A = (p) => <Show when={p.a} fallback={<p>{p.b}</p>} />;");
    expect(fallback).toContain("get fallback() {\nconst _el$ = ");
    expect(wrappers(fallback)).toBe(0);
  });

  it("[OPT-ROOT-06] a root anywhere else keeps its function (a value, not a statement)", () => {
    const declared = dom("export const el = <b>{p.x}</b>;");
    expect(wrappers(declared)).toBe(1);
    const argument = dom("export const A = (p) => mount(<b>{p.x}</b>);");
    expect(wrappers(argument)).toBe(1);
    const conditional = dom("export const A = (p) => (p.a ? <b>{p.x}</b> : null);");
    expect(wrappers(conditional)).toBe(1);
  });

  it("[OPT-ROOT-07] an element without bindings is still the bare template call", () => {
    const code = dom("export const A = () => <div><b>x</b></div>;");
    expect(code).toContain("export const A = () => _tmpl$();");
  });

  it("[OPT-ROOT-08] the output is valid in every statement position", () => {
    const source = `
      export function A(p) {
        switch (p.k) {
          case 1: return <i>{p.a}</i>;
          case 2:
            for (const x of p.list) if (x) return <b>{x}</b>;
            break;
          default:
            try { return <u>{p.z}</u>; } finally { p.done(); }
        }
        label: { if (p.q) return <s>{p.q}</s> }
        return null;
      }`;
    const code = dom(source);
    expect(wrappers(code)).toBe(0);
    expect(
      () => new Function(code.replace(/^import .*$/gm, "").replace(/export /g, "")),
    ).not.toThrow();
  });
});
