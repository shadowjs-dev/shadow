import { describe, expect, it } from "vitest";
import { compile } from "../src/index";
import { CompileError, compile as compileWithJavaScript } from "../src/javascript";

/** The first error a compile throws, or `undefined` when it compiles. */
function failure(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("compiler review round", () => {
  it("[CMP-REV-1] JSX nested through expressions is refused with JSX_TOO_DEEP, never a stack overflow", () => {
    const depth = 1500;
    const inAttribute = `export const A = () => ${"<b x={".repeat(depth)}1${"}/>".repeat(depth)};`;
    const inChild = `export const A = (p) => ${"<b>{p.a && ".repeat(depth)}1${"}</b>".repeat(depth)};`;
    for (const source of [inAttribute, inChild]) {
      for (const run of [compileWithJavaScript, compile]) {
        const error = failure(() => run(source, { filename: "deep.tsx" }));
        expect(error).toBeInstanceOf(CompileError);
        expect((error as CompileError).diagnostic.code).toBe("JSX_TOO_DEEP");
      }
    }
  });

  it("[CMP-REV-2] JSX nested through expressions up to the limit (400) still compiles, on both targets", () => {
    const attribute = `export const A = () => ${"<b x={".repeat(400)}1${"}/>".repeat(400)};`;
    const child = `export const A = (p) => ${"<b>{p.a && ".repeat(400)}1${"}</b>".repeat(400)};`;
    for (const source of [attribute, child]) {
      for (const generate of ["dom", "ssr"] as const) {
        const options = { filename: "ok.tsx", generate } as const;
        expect(compileWithJavaScript(source, options).transformed).toBe(true);
        expect(compile(source, options).code).toBe(compileWithJavaScript(source, options).code);
      }
    }
    const over = `export const A = () => ${"<b x={".repeat(401)}1${"}/>".repeat(401)};`;
    expect(failure(() => compileWithJavaScript(over, { filename: "over.tsx" }))).toBeInstanceOf(
      CompileError,
    );
  });

  it("[CMP-REV-3] a module's own _el$, _c$ and _ref$ are never shadowed by generated locals", () => {
    const source = [
      "const _el$ = 1;",
      "const _c$ = 2;",
      "const _ref$ = 3;",
      "export const A = (p) => <div id={_el$} title={p.t}>{p.a ? <i>{_c$}</i> : null}</div>;",
      "export const B = (p) => <input ref={_ref$} value={p.v} />;",
      "export const C = (p) => <Comp ref={p.r} id={_ref$} />;",
    ].join("\n");
    for (const run of [compileWithJavaScript, compile]) {
      const { code } = run(source, { filename: "a.tsx" });
      // Each generated declaration must use a name the module does not already bind.
      expect(code).not.toMatch(/_el\$ = _tmpl/);
      expect(code).not.toMatch(/const _c\$ = _\$memo/);
      expect(code).not.toMatch(/const _ref\$ = p\.r/);
    }
    expect(compile(source, { filename: "a.tsx" }).code).toBe(
      compileWithJavaScript(source, { filename: "a.tsx" }).code,
    );
  });

  it("[CMP-REV-4] an exported enum or namespace is a value export: the module does not accept its own update", () => {
    const hot = (declaration: string): string =>
      compile(`${declaration}\nexport function A() { return <b />; }`, {
        filename: "a.tsx",
        hmr: true,
      }).code;
    expect(hot("export enum Color { Red }")).not.toContain("_$accept(");
    expect(hot("export namespace N { export const x = 1; }")).not.toContain("_$accept(");
    // A declaration with no runtime form stays out of the way.
    expect(hot("export declare enum Color { Red }")).toContain("_$accept(");
    expect(hot("export interface Props { n: number }")).toContain("_$accept(");
  });

  it("[CMP-REV-5] conditionals nested deep compile in linear time, not 2^depth", () => {
    // Each level used to generate its inner JSX twice, so depth 40 never finished.
    const depth = 40;
    const ternary = `export const A = (p) => ${"<b>{p.a ? ".repeat(depth)}1${" : <i />}</b>".repeat(depth)};`;
    const logical = `export const A = (p) => ${"<b>{p.a && ".repeat(depth)}1${"}</b>".repeat(depth)};`;
    for (const source of [ternary, logical]) {
      for (const generate of ["dom", "ssr"] as const) {
        expect(compileWithJavaScript(source, { filename: "n.tsx", generate }).transformed).toBe(
          true,
        );
      }
    }
  });

  it("[CMP-REV-6] a component whose name starts with a non-ASCII letter is compiled", () => {
    const source = "export const A = () => <Übersicht n={1} />;";
    for (const run of [compileWithJavaScript, compile]) {
      const result = run(source, { filename: "a.tsx" });
      expect(result.transformed).toBe(true);
      expect(result.code).toContain("_$createComponent(Übersicht");
    }
    // A less-than sign before a non-letter is still not JSX.
    expect(compile("export const x = a <ñ;", { filename: "a.ts" }).transformed).toBe(false);
  });
});
