import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index";
import {
  CompileError,
  type CompileOptions,
  compile as compileWithJavaScript,
} from "../src/javascript";
import { type Attempt, loadNative, type RawOptions } from "../src/native/backend";
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

/** Compiles with every implementation and requires one answer from all four. Returns the answer. */
function parity(source: string, options: CompileOptions = {}): Outcome {
  const settings: CompileOptions = { filename: "r7.tsx", ...options };
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

/** The syntax errors of generated code: generated JavaScript must always parse. */
function syntaxErrors(code: string): string[] {
  return parseSync("generated.tsx", code, { lang: "tsx", sourceType: "module" }).errors.map(
    (error) => error.message,
  );
}

/** Compiles on every implementation for both targets and requires the output to be valid JavaScript. */
function validBoth(source: string, options: CompileOptions = {}): { dom: string; ssr: string } {
  const dom = codeOf(parity(source, { ...options, generate: "dom" }));
  const ssr = codeOf(parity(source, { ...options, generate: "ssr" }));
  expect(syntaxErrors(dom)).toEqual([]);
  expect(syntaxErrors(ssr)).toEqual([]);
  return { dom, ssr };
}

const dom = (source: string, options: CompileOptions = {}): string =>
  codeOf(parity(source, { ...options, generate: "dom" }));
const ssr = (source: string, options: CompileOptions = {}): string =>
  codeOf(parity(source, { ...options, generate: "ssr" }));

describe("compiler review, round seven", () => {
  it("[CMP-R7-1] await and yield inside JSX are evaluated before the JSX and the output is valid JavaScript", () => {
    const sources = [
      "export const A = async (p) => <div>{await p.x}</div>;",
      "export const A = async (p) => <div title={await p.x} />;",
      "export const A = async (p) => <C v={await p.x}>{await p.x}</C>;",
      "export const A = async (p) => <div {...(await p.x)} />;",
      "export const A = async (p) => <C {...(await p.x)} />;",
      "export const A = async (p) => <><b>{await p.a}</b><i>{await p.b}</i></>;",
      "export const A = async (p) => <div>{p.ok && <b>{await p.x}</b>}</div>;",
      "export const A = async (p) => <div>{(await p.x) ? <b /> : <i />}</div>;",
      "export async function A(p) { return <div>{await f(await g(p))}</div>; }",
      "export function* A(p) { return <div title={yield p.x}>{yield* p.y}</div>; }",
    ];
    for (const source of sources) validBoth(source);
    // The value is read once, where the JSX is written, in source order.
    const code = dom("export const A = async (p) => <div>{await p.a}{await p.b}</div>;");
    expect(code.indexOf("await p.a")).toBeLessThan(code.indexOf("await p.b"));
    expect(code.match(/await p\.a/g)?.length).toBe(1);
  });

  it("[CMP-R7-1b] an await inside a nested function stays in that function", () => {
    const source =
      "export const A = (p) => <ul>{p.items.map(async (i) => <li>{await i.name}</li>)}</ul>;";
    const { dom: code } = validBoth(source);
    expect(code).toContain("async (i)");
  });

  it("[CMP-R7-2] an expression that starts with a brace but is not an object literal is parenthesized", () => {
    const sources = [
      'export const A = (p) => <div>{{ light: "L", dark: "D" }[p.mode]}</div>;',
      "export const A = (p) => <C v={{ a: 1 }[p.k]}>{{ a: 1 }[p.k]}</C>;",
      "export const A = (p) => <div {...{ a: 1 }[p.k]} />;",
      "export const A = (p) => <C {...{ a: 1 }[p.k]} />;",
      'export const A = (p) => <div title={{ a: "x" }[p.k]} />;',
      'export const A = (p) => <div>{{ a: "x" }[p.k] ?? "none"}</div>;',
    ];
    for (const source of sources) validBoth(source);
  });

  it("[CMP-R7-3] this, arguments inside component props reach the enclosing function; super is refused", () => {
    const self = [
      "export const o = { name: 'N', render() { return <Show title={this.name}>{this.name}</Show>; } };",
      "export const o = { render() { return <Show onClick={this.go} ref={this.r} />; } };",
      "export const o = { render() { return <Show>{<b title={this.t}>{this.t}</b>}</Show>; } };",
      "export const o = { render() { return <div {...this.a} title={this.t} />; } };",
      "export const o = { render() { return <Show title={cond && <b>{this.t}</b>} />; } };",
      "export function f() { return <Show title={arguments[0]} />; }",
    ];
    for (const source of self) {
      const { dom: d, ssr: s } = validBoth(source);
      expect(d).toMatch(/_self\$|_args\$/);
      expect(s).toMatch(/_self\$|_args\$/);
    }
    const kept = dom("export const o = { render() { return <Show title={this.name} />; } };");
    expect(kept).not.toMatch(/get title\(\) \{\s*return this\./);
    // Element children and plain values keep their own `this`.
    const plain = dom(
      "export const o = { render() { return <div title={this.t}>{this.c}</div>; } };",
    );
    expect(plain).not.toContain("_self$");
    const sup = "export class A extends B { render() { return <Show title={super.name} />; } }";
    for (const generate of ["dom", "ssr"] as const) {
      expect(errorCodeOf(parity(sup, { generate }))).toBe("UNSUPPORTED_SUPER");
    }
  });

  it("[CMP-R7-4] a derived prop used as a member tag is read through its accessor", () => {
    const destructured = dom("export function A({ ui }) { return <ui.Button label='x' />; }");
    expect(destructured).toContain("ui.value.Button");
    const constant = dom(
      "export function A(props) { const ui = props.ui; return <ui.Button>x</ui.Button>; }",
    );
    expect(constant).toMatch(/createComponent\(ui\.value\.Button/);
    const nested = dom("export function A({ ui }) { return <ui.group.Button />; }");
    expect(nested).toContain("ui.value.group.Button");
    // An intrinsic element that shares the name is not a reference.
    const intrinsic = dom("export function A({ ui }) { return <ui>{ui}</ui>; }");
    expect(intrinsic).toContain("<ui>");
  });

  it("[CMP-R7-5] directives written after a spread are directives, not spread props", () => {
    const source =
      'export const A = (r, f, g, x, c) => <button {...r} on:click={f} oncapture:keydown={g} use:dir={1} class:on={x} style:color={c} id="b" />;';
    const code = dom(source);
    expect(code).not.toMatch(/"(?:on|oncapture|use|class|style):/);
    expect(code).toMatch(/addEventListener\(_el\$, "click", f\)/);
    expect(code).toMatch(/addEventListener\(_el\$, "keydown", g, false, true\)/);
    expect(code).toMatch(/use\(dir, _el\$/);
    expect(code).toContain("classList.toggle");
    expect(code).toContain("setStyleProperty");
    // They run after the spread, so they are not undone by it.
    expect(code.indexOf("spread(")).toBeLessThan(code.indexOf("classList.toggle"));
    const server = ssr(source);
    expect(server).not.toMatch(/"(?:on|oncapture|use|class|style):/);
  });

  it("[CMP-R7-6] server class: and style: directives on an element with a spread reach the class and style", () => {
    const code = ssr(
      'export const A = (r, x, c) => <div {...r} class:on={x} style:color={c} class="a" />;',
    );
    expect(code).not.toContain('"class:on"');
    expect(code).not.toContain('"style:color"');
    expect(code).toContain("classList");
    expect(code).toContain("color");
  });

  it("[CMP-R7-7] a static style and style: directives are one style attribute on the server", () => {
    const merged = ssr('export const A = (c) => <div style="margin:0" style:color={c} />;');
    expect(merged).not.toContain('style=\\"margin:0\\"');
    expect(merged).toContain('ssrStyle(["margin:0", { "color": c }])');
    const objectStyle = ssr(
      'export const A = (c) => <div style="margin:0" style={{ color: c }} />;',
    );
    expect(objectStyle).not.toContain('style=\\"margin:0\\"');
    // A lone static style keeps its markup.
    const lone = ssr('export const A = () => <div style="margin:0" />;');
    expect(lone).toContain('style=\\"margin:0\\"');
  });

  it("[CMP-R7-8] the server passes on* and ref props to components, like the client", () => {
    const code = ssr("export const A = (f, r, p) => <Field onChange={f} ref={r} onBlur={p.b} />;");
    expect(code).toContain("onChange");
    expect(code).toContain("ref(");
    expect(code).toContain("onBlur");
    const client = dom(
      "export const A = (f, r, p) => <Field onChange={f} ref={r} onBlur={p.b} />;",
    );
    expect(client).toContain("onChange");
    // An intrinsic element on the server still writes no handler.
    const element = ssr("export const A = (f) => <input onChange={f} />;");
    expect(element).not.toContain("onChange");
  });

  it("[CMP-R7-9] a property is assigned only on elements that have it; elsewhere it is an attribute", () => {
    const code = dom("export const A = (p) => <div disabled={p.d} selected={p.s} value={p.v} />;");
    expect(code).not.toMatch(/\.disabled =|\.selected =|\.value =/);
    expect(code).toContain('setAttribute(_el$, "disabled"');
    expect(code).toContain('setAttribute(_el$, "selected"');
    expect(code).toContain('setAttribute(_el$, "value"');
    const input = dom(
      "export const A = (p) => <input disabled={p.d} value={p.v} checked={p.c} />;",
    );
    expect(input).toMatch(/\.disabled = /);
    expect(input).toMatch(/\.value = /);
    expect(input).toMatch(/\.checked = /);
    const option = dom("export const A = (p) => <option selected={p.s} value={p.v} />;");
    expect(option).toMatch(/\.selected = /);
    const item = dom("export const A = (p) => <li value={p.v} />;");
    expect(item).toContain('setAttribute(_el$, "value"');
    expect(item).not.toMatch(/\.value =/);
    const hidden = dom("export const A = (p) => <div hidden={p.h} />;");
    expect(hidden).toMatch(/\.hidden = /);
    const custom = dom("export const A = (p) => <my-el disabled={p.d} value={p.v} />;");
    expect(custom).toMatch(/\.disabled = /);
    const math = dom("export const A = (p) => <math hidden={p.h} />;");
    expect(math).toContain('setAttribute(_el$, "hidden"');
  });

  it("[CMP-R7-10] a hyphenated name on a custom element is an attribute, not a property", () => {
    const code = dom(
      "export const A = (s, l) => <my-el data-state={s()} aria-label={l()} items={s()} />;",
    );
    expect(code).toContain('setAttribute(_el$, "data-state"');
    expect(code).toContain('setAttribute(_el$, "aria-label"');
    expect(code).toContain('_el$["items"] = ');
    expect(code).not.toContain('_el$["data-state"]');
  });

  it("[CMP-R7-11] a function given as a property is passed as it is, not called", () => {
    const code = dom(
      "export const A = (cb) => <my-el prop:renderItem={cb} attr:fn={cb} cb={cb} />;",
    );
    expect(code).toContain('_el$["renderItem"] = cb;');
    expect(code).toContain('_el$["cb"] = cb;');
    expect(code).not.toMatch(/typeof cb === "function" \? cb\(\)/);
    // A plain attribute still accepts a signal accessor.
    const forgiving = dom("export const A = (count) => <div title={count} />;");
    expect(forgiving).toMatch(/typeof count === "function" \? count\(\)/);
  });

  it("[CMP-R7-12] JSX in the expressions of an svg or math element is built in that namespace", () => {
    const svg = dom(
      "export const A = (c) => <svg><text>{c ? <a href='#'><tspan /></a> : null}</text>{c && <style />}{c && <title />}</svg>;",
    );
    expect(svg).toMatch(/template\("<a href=\\"#\\"><tspan><\/tspan><\/a>", 1\)/);
    expect(svg).toMatch(/template\("<style><\/style>", 1\)/);
    expect(svg).toMatch(/template\("<title><\/title>", 1\)/);
    const math = dom("export const A = (c) => <math>{c && <mrow><mi /></mrow>}</math>;");
    expect(math).toMatch(/template\("<mrow><mi><\/mi><\/mrow>", 2\)/);
    const back = dom(
      "export const A = (c) => <svg><foreignObject>{c && <div />}</foreignObject></svg>;",
    );
    expect(back).toMatch(/template\("<div><\/div>"\)/);
    const html = dom("export const A = (c) => <div>{c && <a href='#' />}</div>;");
    expect(html).toMatch(/template\("<a href=\\"#\\"><\/a>"\)/);
    const component = dom("export const A = (c) => <svg><Icon>{c && <title />}</Icon></svg>;");
    expect(component).toMatch(/template\("<title><\/title>", 1\)/);
  });

  describe("[CMP-R7-13] invalid nesting the HTML parser repairs", () => {
    const refused = [
      "<p><span><div /></span></p>",
      "<p><a><table /></a></p>",
      "<p><li /></p>",
      "<p><b><dd /></b></p>",
      "<ul><li><b><li /></b></li></ul>",
      "<ul><li><div><li /></div></li></ul>",
      "<dl><dd><dd /></dd></dl>",
      "<dl><dt><dd /></dt></dl>",
      "<dl><dd><span><dt /></span></dd></dl>",
      "<optgroup><optgroup /></optgroup>",
      "<nobr><nobr /></nobr>",
      "<nobr><b><nobr /></b></nobr>",
      "<textarea><b /></textarea>",
      "<title><b /></title>",
      "<style><b /></style>",
      "<script><b /></script>",
    ];
    for (const jsx of refused) {
      it(`refuses ${jsx}`, () => {
        for (const generate of ["dom", "ssr"] as const) {
          const outcome = parity(`export const A = () => ${jsx};`, { generate });
          expect(errorCodeOf(outcome)).toBe("INVALID_HTML_NESTING");
        }
      });
    }
    it("names the ancestor in the message", () => {
      const outcome = parity("export const A = () => <p><span><div /></span></p>;");
      expect(outcome.kind === "error" && outcome.message).toContain("<p>");
    });
    const accepted = [
      "<ul><li><ul><li /></ul></li></ul>",
      "<ol><li><div><ul><li /></ul></div></li></ol>",
      "<p><button><div /></button></p>",
      "<p><svg><foreignObject><div /></foreignObject></svg></p>",
      "<p><Foo><div /></Foo></p>",
      "<dl><dt /><dd /><dt /><dd /></dl>",
      "<select><optgroup><option /></optgroup><optgroup><option /></optgroup></select>",
      "<nobr><span /></nobr>",
      "<li><table><tbody><tr><td><li /></td></tr></tbody></table></li>",
      "<svg><title><tspan /></title></svg>",
      "<textarea>{x}</textarea>",
      "<div><p><span /></p></div>",
    ];
    for (const jsx of accepted) {
      it(`accepts ${jsx}`, () => {
        for (const generate of ["dom", "ssr"] as const) {
          expect(parity(`export const A = () => ${jsx};`, { generate }).kind).toBe("code");
        }
      });
    }
  });

  it("[CMP-R7-14] an explicit addon path is tried on a platform without a prebuilt addon", () => {
    if (!native.ok) throw new Error(`the native addon is not built: ${native.reason}`);
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const previous = process.env["SHADOW_COMPILER_NATIVE_PATH"];
    try {
      Object.defineProperty(process, "platform", { value: "plan9", configurable: true });
      delete process.env["SHADOW_COMPILER_NATIVE_PATH"];
      const without = loadNative();
      expect(without.ok).toBe(false);
      expect(!without.ok && without.reason).toContain("no prebuilt addon");
      process.env["SHADOW_COMPILER_NATIVE_PATH"] = native.backend.source;
      const withPath = loadNative();
      expect(withPath.ok).toBe(true);
    } finally {
      if (platform !== undefined) Object.defineProperty(process, "platform", platform);
      if (previous === undefined) delete process.env["SHADOW_COMPILER_NATIVE_PATH"];
      else process.env["SHADOW_COMPILER_NATIVE_PATH"] = previous;
    }
  });

  it("[CMP-R7-15] a tag opened with whitespace or a comment after the angle bracket is still JSX", () => {
    const sources = [
      "export const A = () => < div />;",
      "export const A = () => <\n div />;",
      "export const A = () => </*c*/div />;",
      "export const A = () => < /* c */ // line\n div />;",
      "export const A = () => < ><b /></>;",
    ];
    for (const source of sources) {
      for (const generate of ["dom", "ssr"] as const) {
        const outcome = parity(source, { generate });
        expect(outcome.kind === "code" && outcome.transformed).toBe(true);
      }
    }
    // Comparisons are not JSX.
    const plain = parity("export const x = a < b;", { filename: "a.ts" });
    expect(plain.kind === "code" && plain.transformed).toBe(false);
  });

  it("[CMP-R7-16] a string given to a real event handler attribute is refused whatever its case; other on* names are not events", () => {
    for (const name of ["onclick", "ONCLICK", "onClick", "onInput", "ononline", "onpointerdown"]) {
      for (const generate of ["dom", "ssr"] as const) {
        const outcome = parity(`export const A = () => <button ${name}="go()" />;`, { generate });
        expect(errorCodeOf(outcome)).toBe("STRING_EVENT_HANDLER");
      }
    }
    for (const name of ["online", "onboarding", "one", "once"]) {
      for (const generate of ["dom", "ssr"] as const) {
        const outcome = parity(`export const A = () => <div ${name}="x" />;`, { generate });
        expect(outcome.kind).toBe("code");
      }
    }
  });
});
