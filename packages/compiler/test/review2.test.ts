import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index";
import {
  CompileError,
  type CompileOptions,
  compile as compileWithJavaScript,
} from "../src/javascript";
import type { Attempt, RawOptions } from "../src/native/backend";
import { backendOf, native, wasm } from "./native/support/backends";

/** What one implementation answered: the code, or the error it threw. */
type Outcome =
  | { kind: "code"; code: string; transformed: boolean; mappings: string | null }
  | {
      kind: "error";
      code: string;
      message: string;
      start: number;
      end: number;
      line: number;
      column: number;
      frame: string;
    }
  | { kind: "handed-over"; reason: string };

function rawOptions(options: CompileOptions): RawOptions {
  return {
    generate: options.generate === "ssr" ? "ssr" : "dom",
    dev: options.dev === true,
    autoReactive: options.autoReactive !== false,
    hmr: options.hmr === true,
    hydratable: options.hydratable !== false,
    sourceMap: options.sourceMap !== false,
    ...(options.filename === undefined ? {} : { filename: options.filename }),
  };
}

function errorOutcome(error: CompileError): Outcome {
  const { diagnostic } = error;
  return {
    kind: "error",
    code: diagnostic.code,
    message: diagnostic.message,
    start: diagnostic.start,
    end: diagnostic.end,
    line: diagnostic.line,
    column: diagnostic.column,
    frame: error.frame,
  };
}

/** The TypeScript implementation's answer: the oracle. */
function reference(source: string, options: CompileOptions): Outcome {
  try {
    const result = compileWithJavaScript(source, options);
    return {
      kind: "code",
      code: result.code,
      transformed: result.transformed,
      mappings: result.map === null ? null : result.map.mappings,
    };
  } catch (error) {
    if (error instanceof CompileError) return errorOutcome(error);
    throw error;
  }
}

/** The Rust core's own answer, with no routing to the TypeScript implementation in front of it. */
function viaBackend(attempt: Attempt, label: string, source: string, options: CompileOptions) {
  const output = backendOf(attempt, label).compileSync(source, rawOptions(options));
  if (output.kind === 0) {
    return {
      kind: "code",
      code: output.code,
      transformed: output.transformed,
      mappings: output.mapMappings ?? null,
    } satisfies Outcome;
  }
  if (output.kind === 1) {
    return {
      kind: "error",
      code: output.errorCode ?? "",
      message: output.errorMessage ?? "",
      start: output.errorStart ?? 0,
      end: output.errorEnd ?? 0,
      line: output.errorLine ?? 1,
      column: output.errorColumn ?? 0,
      frame: output.errorFrame ?? "",
    } satisfies Outcome;
  }
  return { kind: "handed-over", reason: output.errorMessage ?? "" } satisfies Outcome;
}

/**
 * Compiles with the oracle, the native addon, the WebAssembly build and the entry that chooses, and requires one answer from all
 * four. Returns the answer.
 */
function parity(source: string, options: CompileOptions = {}): Outcome {
  const settings: CompileOptions = { filename: "r2.tsx", ...options };
  const expected = reference(source, settings);
  expect(viaBackend(native, "the native addon", source, settings)).toEqual(expected);
  expect(viaBackend(wasm, "the WebAssembly build", source, settings)).toEqual(expected);
  let chosen: Outcome;
  try {
    const result = compile(source, settings);
    chosen = {
      kind: "code",
      code: result.code,
      transformed: result.transformed,
      mappings: result.map === null ? null : result.map.mappings,
    };
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    chosen = errorOutcome(error);
  }
  expect(chosen).toEqual(expected);
  return expected;
}

function codeOf(outcome: Outcome): string {
  if (outcome.kind !== "code") throw new Error(`expected code, got ${JSON.stringify(outcome)}`);
  return outcome.code;
}

function errorCodeOf(outcome: Outcome): string {
  if (outcome.kind !== "error") throw new Error(`expected an error, got ${outcome.kind}`);
  return outcome.code;
}

const both = ["dom", "ssr"] as const;

describe("compiler review, round two: the Rust core catches up", () => {
  it("[CMP-R2-1] conditionals nested deep compile in linear time on the Rust core, same output as the reference", () => {
    // Each level used to generate its inner JSX twice in Rust: depth 26 took minutes.
    const depth = 26;
    const ternary = `export const A = (p) => ${"<b>{p.a ? ".repeat(depth)}1${" : <i />}</b>".repeat(depth)};`;
    const logical = `export const A = (p) => ${"<b>{p.a && ".repeat(depth)}1${"}</b>".repeat(depth)};`;
    const chained = `export const A = (p) => ${"<b>{p.a ? <i /> : ".repeat(depth)}1${"}</b>".repeat(depth)};`;
    for (const source of [ternary, logical, chained]) {
      for (const generate of both) {
        expect(parity(source, { generate }).kind).toBe("code");
      }
    }
  }, 30_000);

  it("[CMP-R2-2] a module's own _el$, _c$ and _ref$ are never shadowed, on every implementation", () => {
    const source = [
      "const _el$ = 1;",
      "const _c$ = 2;",
      "const _ref$ = 3;",
      "export const A = (p) => <div id={_el$} title={p.t}>{p.a ? <i>{_c$}</i> : null}</div>;",
      "export const B = (p) => <input ref={_ref$} value={p.v} />;",
      "export const C = (p) => <Comp ref={p.r} id={_ref$} />;",
      "export const D = (p) => <div ref={p.r}>{p.a && <b>{_c$}</b>}</div>;",
    ].join("\n");
    for (const generate of both) {
      const code = codeOf(parity(source, { generate }));
      expect(code).not.toMatch(/_el\$ = _tmpl/);
      expect(code).not.toMatch(/const _c\$ = _\$memo/);
      expect(code).not.toMatch(/const _ref\$ = p\.r/);
    }
  });

  it("[CMP-R2-3] a tag that starts with a non-ASCII letter is JSX on every implementation", () => {
    for (const source of [
      "export const A = () => <Übersicht n={1} />;",
      "export const A = () => <ñ-el>x</ñ-el>;",
      "export const A = () => <ℵ />;",
    ]) {
      for (const generate of both) {
        const outcome = parity(source, { generate });
        expect(outcome.kind).toBe("code");
        expect(outcome.kind === "code" && outcome.transformed).toBe(true);
      }
    }
    // A less-than sign before a non-letter is not JSX.
    const plain = parity("export const x = a <ñ;", { filename: "a.ts" });
    expect(plain.kind === "code" && plain.transformed).toBe(false);
    const digit = parity("export const x = a <1;", { filename: "a.ts" });
    expect(digit.kind === "code" && digit.transformed).toBe(false);
  });

  it("[CMP-R2-4] an exported enum or namespace is a value export: the module does not accept its own update, on every implementation", () => {
    const hot = (declaration: string): string =>
      codeOf(
        parity(`${declaration}\nexport function A() { return <b />; }`, {
          filename: "a.tsx",
          hmr: true,
        }),
      );
    expect(hot("export enum Color { Red }")).not.toContain("_$accept(");
    expect(hot("export const enum Flag { On }")).not.toContain("_$accept(");
    expect(hot("export namespace N { export const x = 1; }")).not.toContain("_$accept(");
    expect(hot("export module M { export const x = 1; }")).not.toContain("_$accept(");
    expect(hot("export declare enum Color { Red }")).toContain("_$accept(");
    expect(hot("export declare namespace N { const x: number }")).toContain("_$accept(");
    expect(hot("export interface Props { n: number }")).toContain("_$accept(");
    expect(hot("export type Id = string")).toContain("_$accept(");
    // `enum` and `namespace` as plain words in a hot module change nothing.
    expect(hot("// an enum in a namespace of a module")).toContain("_$accept(");
  });

  it("[CMP-R2-5] JSX nested through expressions is refused with JSX_TOO_DEEP past 400 levels, identically", () => {
    const attribute = (depth: number): string =>
      `export const A = () => ${"<b x={".repeat(depth)}1${"}/>".repeat(depth)};`;
    const child = (depth: number): string =>
      `export const A = (p) => ${"<b>{p.a && ".repeat(depth)}1${"}</b>".repeat(depth)};`;
    for (const generate of both) {
      for (const make of [attribute, child]) {
        expect(parity(make(100), { generate }).kind).toBe("code");
        // The WebAssembly build follows the same 400 levels as the addon, not fewer.
        expect(parity(make(400), { generate }).kind).toBe("code");
        expect(errorCodeOf(parity(make(401), { generate }))).toBe("JSX_TOO_DEEP");
        expect(errorCodeOf(parity(make(1500), { generate }))).toBe("JSX_TOO_DEEP");
      }
      // Each level adds a conditional and parentheses around its JSX.
      const grouped = (depth: number): string =>
        `export const A = (p) => ${"<b>{(p.a ? ".repeat(depth)}1${" : <i />)}</b>".repeat(depth)};`;
      expect(parity(grouped(120), { generate }).kind).toBe("code");
      expect(parity(grouped(300), { generate }).kind).toBe("code");
      expect(errorCodeOf(parity(grouped(500), { generate }))).toBe("JSX_TOO_DEEP");
    }
  }, 60_000);

  it("[CMP-R2-6] a capitalized tag with a dash is a BAD_TAG error, and a lowercase custom element stays intrinsic", () => {
    for (const generate of both) {
      for (const name of ["Foo-Bar", "_foo-bar", "$x-y", "Ünï-code"]) {
        const direct = parity(`export const A = () => <${name} x={1} />;`, { generate });
        expect(errorCodeOf(direct)).toBe("BAD_TAG");
        expect(direct.kind === "error" && direct.message).toContain(name);
        const nested = parity(`export const A = () => <div><${name}>x</${name}></div>;`, {
          generate,
        });
        expect(errorCodeOf(nested)).toBe("BAD_TAG");
      }
      const custom = codeOf(parity("export const A = () => <my-el x={1} />;", { generate }));
      expect(custom).not.toContain("createComponent");
      // Dashes elsewhere in a component's path are not tag names with a dash.
      expect(parity("export const A = () => <Foo.Bar />;", { generate }).kind).toBe("code");
    }
  });

  it("[CMP-R2-7] text children of style, script and title are written without region markers, raw or escaped as the element parses them", () => {
    const style = codeOf(
      parity("export const A = (p) => <style>{p.css}</style>;", { generate: "ssr" }),
    );
    expect(style).toContain('_$ssrRawText("style", p.css)');
    expect(style).not.toContain("<!--[-->");
    expect(style).not.toContain("_$escape");
    const script = codeOf(
      parity('export const A = (p) => <script>{"if (a < b && c) x"}</script>;', {
        generate: "ssr",
      }),
    );
    expect(script).toContain('_$ssrRawText("script", "if (a < b && c) x")');
    expect(script).not.toContain("<!--[-->");
    const mixed = codeOf(
      parity("export const A = (p) => <style>a{'{'} {p.x} {p.y}</style>;", { generate: "ssr" }),
    );
    expect(mixed).toContain("_$ssrRawText(");
    expect(mixed).not.toContain("<!--[-->");
    const title = codeOf(
      parity("export const A = (p) => <title>{p.t}</title>;", { generate: "ssr" }),
    );
    expect(title).toContain("_$escape(p.t)");
    expect(title).not.toContain("<!--[-->");
    // SVG parses its style and title as ordinary elements: escaped text between markers, as before.
    const svg = codeOf(
      parity("export const A = (p) => <svg><style>{p.css}</style></svg>;", { generate: "ssr" }),
    );
    expect(svg).toContain("<!--[-->");
    expect(svg).toContain("_$escape(p.css)");
    // Other elements keep their markers.
    const div = codeOf(parity("export const A = (p) => <div>{p.x}</div>;", { generate: "ssr" }));
    expect(div).toContain("<!--[-->");
    // The browser output is one insert, so the server text is one region to adopt.
    const dom = codeOf(
      parity("export const A = (p) => <style>a{'{'} {p.x} {p.y}</style>;", { generate: "dom" }),
    );
    expect(dom.match(/_\$insert\(/g)?.length).toBe(1);
  });

  it("[REVIEW-FINAL-2] the joined text of a title, style or script writes no `false` for a boolean child, in all four compilers", () => {
    for (const generate of both) {
      const code = codeOf(
        parity('export const A = (p) => <title>{p.on && "Loading "}My App</title>;', { generate }),
      );
      expect(code).toContain('typeof part !== "boolean"');
      expect(code).not.toContain('?? ""');
    }
  });

  it("[CMP-R2-8] value and defaultValue on one element: the explicit value wins and is written once", () => {
    for (const generate of both) {
      const dynamic = codeOf(
        parity("export const A = (p) => <input value={p.a} defaultValue={p.b} />;", { generate }),
      );
      expect(dynamic).toContain("p.a");
      expect(dynamic).not.toContain("p.b");
      const reversed = codeOf(
        parity("export const A = (p) => <input defaultValue={p.b} value={p.a} />;", { generate }),
      );
      expect(reversed).toContain("p.a");
      expect(reversed).not.toContain("p.b");
      const mixed = codeOf(
        parity('export const A = (p) => <input value="x" defaultValue={p.b} />;', { generate }),
      );
      expect(mixed).not.toContain("p.b");
      const checked = codeOf(
        parity("export const A = (p) => <input type='checkbox' checked={p.a} defaultChecked />;", {
          generate,
        }),
      );
      expect(
        checked.match(generate === "ssr" ? /ssrAttribute\("checked"/g : /\.checked =/g)?.length,
      ).toBe(1);
      expect(checked).not.toContain("defaultChecked");
      // Alone, a default stays what it was.
      const alone = codeOf(
        parity("export const A = (p) => <input defaultValue={p.b} />;", { generate }),
      );
      expect(alone).toContain("p.b");
      const area = codeOf(
        parity("export const A = (p) => <textarea value={p.a} defaultValue={p.b} />;", {
          generate,
        }),
      );
      expect(area).not.toContain("p.b");
    }
    const ssr = codeOf(
      parity("export const A = (p) => <input value={p.a} defaultValue={p.b} />;", {
        generate: "ssr",
      }),
    );
    expect(ssr.match(/_\$ssrAttribute\("value"/g)?.length).toBe(1);
    const dom = codeOf(
      parity("export const A = (p) => <input value={p.a} defaultValue={p.b} />;", {
        generate: "dom",
      }),
    );
    expect(dom.match(/\.(?:value|defaultValue) =/g)?.length).toBe(1);
  });

  it("[CMP-R2-9] a static attribute value the template parser would change is written at run time, not in the template", () => {
    for (const generate of both) {
      for (const value of ["a\r\nb", "a\u0000b", "a\u0001b", "a\ufffdb"]) {
        const source = `export const A = () => <div data-x={${JSON.stringify(value)}} title="${"t"}" />;`;
        const code = codeOf(parity(source, { generate }));
        // The value is a string at run time, never inside the markup text.
        expect(code).not.toMatch(/data-x=\\"/);
        expect(code).toContain('title=\\"t\\"');
      }
      // A literal carriage return in a string-literal attribute, and one written as a character reference.
      const literal = codeOf(
        parity('export const A = () => <div data-x="a&#13;b" data-y="plain" />;', { generate }),
      );
      expect(literal).not.toMatch(/data-x=\\"/);
      expect(literal).toContain('data-y=\\"plain\\"');
    }
  });

  it("[CMP-R2-10] a script URL in a static xlinkHref of SVG is refused at build time, as xlink:href is", () => {
    for (const generate of both) {
      for (const name of ["xlinkHref", "xlink:href", "href"]) {
        const code = codeOf(
          parity(`export const A = () => <svg><a ${name}="javascript:alert(1)" /></svg>;`, {
            generate,
          }),
        );
        // Not in the markup: the checked attribute writer gets it, and drops it.
        expect(code).not.toMatch(/(?:xlink:href|href)=\\"javascript/);
      }
      const safe = codeOf(
        parity('export const A = () => <svg><a xlinkHref="#top" /></svg>;', { generate }),
      );
      expect(safe).toContain('xlink:href=\\"#top\\"');
    }
  });

  it("[CMP-R2-11] a chain of thousands of ternaries compiles on every implementation", () => {
    const chainOf = (length: number): string => {
      const links = Array.from({ length }, (_, index) => `p.a${index} ? <i>{${index}}</i> : `);
      return `export const A = (p) => <b>{${links.join("")}null}</b>;`;
    };
    for (const generate of both) {
      expect(parity(chainOf(1500), { generate }).kind).toBe("code");
      expect(parity(chainOf(9000), { generate }).kind).toBe("code");
    }
  }, 60_000);

  describe("the WebAssembly build follows what the addon follows", () => {
    /** The addon's answer and the WebAssembly build's, which must be one answer (the oracle may not survive input this deep). */
    function twin(source: string, options: CompileOptions = {}): Outcome {
      const settings: CompileOptions = { filename: "r3.tsx", ...options };
      const fromNative = viaBackend(native, "the native addon", source, settings);
      expect(viaBackend(wasm, "the WebAssembly build", source, settings)).toEqual(fromNative);
      return fromNative;
    }

    const inJsx = (expression: string): string => `export const A = (p) => <b>{${expression}}</b>;`;

    it("[CMP-R3-1] a chain of 20,000 ternaries, with JSX in each link, is the same code in both targets", () => {
      const chain = inJsx(
        `${Array.from({ length: 20_000 }, (_, index) => `p.a${index} ? <i>{${index}}</i> : `).join("")}null`,
      );
      for (const generate of both) expect(twin(chain, { generate }).kind).toBe("code");
    }, 60_000);

    it("[CMP-R3-2] nested braces and parentheses are followed as deep as the addon follows, and refused at the same depth", () => {
      for (const generate of both) {
        expect(twin(inJsx(`${"{a:".repeat(5000)}1${"}".repeat(5000)}`), { generate }).kind).toBe(
          "code",
        );
        expect(
          twin(inJsx(`${"(".repeat(100_000)}1${")".repeat(100_000)}`), { generate }).kind,
        ).toBe("code");
        const refused = twin(inJsx(`${"(".repeat(151_000)}1${")".repeat(151_000)}`), { generate });
        expect(errorCodeOf(refused)).toBe("PARSE_ERROR");
      }
    }, 60_000);

    it("[CMP-R3-3] long chains of operators, members and calls are the same code in both implementations", () => {
      const shapes = [
        inJsx(Array<string>(50_000).fill("p.a").join(" + ")),
        inJsx(`p${".a".repeat(50_000)}`),
        inJsx(`p${"()".repeat(50_000)}`),
      ];
      for (const generate of both) {
        for (const shape of shapes) expect(twin(shape, { generate }).kind).toBe("code");
      }
    }, 60_000);

    it("[CMP-R3-4] JSX nested 400 levels deep, and the 401st level, are the same answer without the reference", () => {
      const child = (depth: number): string =>
        `export const A = (p) => ${"<b>{p.a && ".repeat(depth)}1${"}</b>".repeat(depth)};`;
      for (const generate of both) {
        expect(twin(child(400), { generate }).kind).toBe("code");
        expect(errorCodeOf(twin(child(401), { generate }))).toBe("JSX_TOO_DEEP");
      }
    });

    it("[CMP-R3-5] the build keeps answering small modules after deep ones, deep ones twice, and several sizes in a row", () => {
      const backend = backendOf(wasm, "the WebAssembly build");
      const options = rawOptions({ filename: "r3.tsx" });
      const small = "export const A = () => <b>hi</b>;";
      const deep = inJsx(`${"(".repeat(30_000)}1${")".repeat(30_000)}`);
      const first = backend.compileSync(small, options);
      for (let round = 0; round < 3; round += 1) {
        expect(backend.compileSync(deep, options).kind).toBe(0);
        expect(backend.compileSync(small, options)).toEqual(first);
      }
    }, 60_000);

    it("[CMP-R3-6] a process that compiled deep input with the WebAssembly build exits by itself", () => {
      const bundle = buildSync({
        stdin: {
          contents: `
            import { loadWasm } from "./native/backend";
            const attempt = loadWasm();
            if (!attempt.ok) throw new Error(attempt.reason);
            const deep = "export const A = () => <b>{" + "(".repeat(30000) + "1" + ")".repeat(30000) + "}</b>;";
            const out = attempt.backend.compileSync(deep, { generate: "dom", dev: false, autoReactive: true, hmr: false, hydratable: true, sourceMap: false });
            process.stdout.write(String(out.kind));
          `,
          resolveDir: join(import.meta.dirname, "../src"),
          loader: "ts",
        },
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
        logLevel: "silent",
      }).outputFiles[0]?.text;
      if (bundle === undefined) throw new Error("esbuild produced no output");
      const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", bundle], {
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          SHADOW_COMPILER_WASM_PATH: join(import.meta.dirname, "../wasm/shadow-compiler.wasm"),
        },
      });
      expect(stdout).toBe("0");
    }, 60_000);
  });
});
