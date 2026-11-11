import { describe, expect, it } from "vitest";
import { compile, getBackend } from "../src/index";
import { CompileError, compile as compileWithJavaScript } from "../src/javascript";
import type { RawOptions } from "../src/native/backend";
import { backendOf, native, wasm } from "./native/support/backends";

const dom = (source: string): string =>
  compileWithJavaScript(source, { filename: "a.tsx", generate: "dom" }).code;

const ssr = (source: string): string =>
  compileWithJavaScript(source, { filename: "a.tsx", generate: "ssr" }).code;

function errorOf(source: string, generate: "dom" | "ssr" = "dom"): CompileError {
  try {
    compileWithJavaScript(source, { filename: "a.tsx", generate });
  } catch (error) {
    if (error instanceof CompileError) return error;
    throw error;
  }
  throw new Error("expected a CompileError");
}

describe("[CMP-AUD-01] the generated ref method does not shadow a name of the module", () => {
  const component = "export const A = () => { let r$; return <Inner ref={r$} />; };";

  it("a module that uses r$ gets another parameter name (dom)", () => {
    const code = dom(component);
    expect(code).not.toContain("ref(r$)");
    // The user's expression is still read as written, outside any parameter of that name.
    expect(code).toMatch(/ref\((\w+\$?_*)\) \{\nconst _ref\$ = r\$;/);
  });

  it("a module that uses r$ gets another parameter name (ssr)", () => {
    expect(ssr(component)).not.toContain("ref(r$)");
  });

  it("a module that does not use r$ is unchanged", () => {
    const code = dom("export const A = (p) => <Inner ref={p.el} />;");
    expect(code).toContain("ref(r$) {");
  });
});

describe("[CMP-AUD-02] a directive name must be an identifier", () => {
  it("use:foo-bar is refused instead of compiled to a subtraction", () => {
    const error = errorOf("export const A = () => <div use:foo-bar={x} />;");
    expect(error.diagnostic.code).toBe("BAD_ATTRIBUTE");
    expect(error.diagnostic.message).toContain("use:foo-bar");
  });

  it("use:class is refused instead of compiled to invalid code", () => {
    const error = errorOf("export const A = () => <div use:class={x} />;");
    expect(error.diagnostic.code).toBe("BAD_ATTRIBUTE");
  });

  it("the check applies to the server target too, and not to components", () => {
    expect(errorOf("export const A = () => <div use:foo-bar={x} />;", "ssr").diagnostic.code).toBe(
      "BAD_ATTRIBUTE",
    );
    expect(dom("export const A = () => <Comp use:foo-bar={x} />;")).toContain('"use:foo-bar"');
  });

  it("an ordinary directive still compiles", () => {
    expect(dom("export const A = () => <div use:tooltip={x} />;")).toContain("_$use(tooltip,");
  });
});

/**
 * The same inputs through the addon and the WebAssembly build: the code, or the same error, as the
 * TypeScript implementation.
 */
describe("[CMP-AUD-03] the Rust implementations answer these inputs like the TypeScript one", () => {
  const inputs = [
    "export const A = () => { let r$; return <Inner ref={r$} />; };",
    "export const A = () => { let r$; return <div ref={r$} />; };",
    "export const A = (p) => <Inner ref={p.el} />;",
    "export const A = () => <div use:foo-bar={x} />;",
    "export const A = () => <div use:class={x} />;",
    "export const A = () => <div use:this={x} />;",
    "export const A = () => <Comp use:foo-bar={x} />;",
    "export const A = () => <div use:tooltip={x} />;",
    'export const A = () => <svg><text xml:lang={x()} xml:space={y} xml:base="b" /></svg>;',
    "export const A = () => <div xml:lang={x()} />;",
    "export const A = () => <div foo:bar={x} />;",
  ];
  for (const [label, attempt] of [
    ["addon", native],
    ["WebAssembly", wasm],
  ] as const) {
    it(`${label}: code, error code and message agree`, () => {
      const backend = backendOf(attempt, label);
      for (const generate of ["dom", "ssr"] as const) {
        for (const input of inputs) {
          const raw: RawOptions = {
            filename: "a.tsx",
            generate,
            dev: false,
            autoReactive: true,
            hmr: false,
            hydratable: true,
            sourceMap: false,
          };
          const actual = backend.compileSync(input, raw);
          try {
            const expected = compileWithJavaScript(input, { filename: "a.tsx", generate });
            expect(actual.kind, input).toBe(0);
            expect(actual.code, input).toBe(expected.code);
          } catch (error) {
            if (!(error instanceof CompileError)) throw error;
            expect(actual.kind, input).toBe(1);
            expect(actual.errorCode, input).toBe(error.diagnostic.code);
            expect(actual.errorMessage, input).toBe(error.diagnostic.message);
            expect(actual.errorStart, input).toBe(error.diagnostic.start);
            expect(actual.errorEnd, input).toBe(error.diagnostic.end);
          }
        }
      }
    });
  }
});

describe("[CMP-AUD-04] options with an unpaired surrogate are answered like the TypeScript implementation", () => {
  const source = "export const A = () => <div>{x()}</div>;";

  it("a moduleName with an unpaired surrogate is written as it was given, not as U+FFFD", () => {
    // The addon would read the string as UTF-8 and replace the surrogate; the selector hands the call over instead.
    expect(["native", "wasm"]).toContain(getBackend().name);
    for (const generate of ["dom", "ssr"] as const) {
      for (const moduleName of ["a\ud800b", "\udc00"]) {
        const options = { filename: "a.tsx", generate, moduleName };
        const actual = compile(source, options).code;
        expect(actual).toBe(compileWithJavaScript(source, options).code);
        expect(actual).not.toContain("\ufffd");
      }
    }
  });

  it("a filename with an unpaired surrogate names the same file in an error and in the source map", () => {
    const options = { filename: "f\ud800.tsx" };
    const expected = compileWithJavaScript(source, options);
    const actual = compile(source, options);
    expect(JSON.stringify(actual.map)).toBe(JSON.stringify(expected.map));
    let message = "";
    try {
      compile("const a = <div>{", options);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("f\ud800.tsx");
  });
});

describe("[CMP-AUD-05] a dynamic xml: attribute is set in the XML namespace", () => {
  const XML = "http://www.w3.org/XML/1998/namespace";

  it("xml:lang={x} and xml:space={x} call setAttributeNS with the XML namespace (dom)", () => {
    const code = dom(
      'export const A = () => <svg><text xml:lang={x()} xml:space={y} xml:base="b" /></svg>;',
    );
    expect(code).toContain(`_$setAttributeNS(_el$2, "${XML}", "xml:lang", x())`);
    expect(code).toContain(`"${XML}", "xml:space"`);
    // The static form stays in the template, as before.
    expect(code).toContain('xml:base=\\"b\\"');
  });

  it("an element outside svg gets the same call, like xlink:href does", () => {
    expect(dom("export const A = () => <div xml:lang={x()} />;")).toContain(
      `"${XML}", "xml:lang", x())`,
    );
  });

  it("another namespace is still refused", () => {
    expect(errorOf("export const A = () => <div foo:bar={x} />;").diagnostic.code).toBe(
      "UNKNOWN_NAMESPACE",
    );
    expect(errorOf("export const A = () => <div xmlns:x={x} />;").diagnostic.code).toBe(
      "UNKNOWN_NAMESPACE",
    );
  });

  it("the server writes the attribute with its name", () => {
    expect(ssr("export const A = () => <svg><text xml:lang={x()} /></svg>;")).toContain(
      '_$ssrAttribute("xml:lang", x())',
    );
  });
});

/** Components the hot-update pass wraps in a proxy, by name, in the order they are written. */
function wrapped(source: string): string[] {
  const code = compileWithJavaScript(source, { filename: "a.tsx", hmr: true }).code;
  return [...code.matchAll(/_\$component\(_\$\$reg, "(\w+)"/g)].map((match) => match[1] ?? "");
}

function acceptsItself(source: string): boolean {
  const code = compileWithJavaScript(source, { filename: "a.tsx", hmr: true }).code;
  return code.includes("import.meta.hot?.accept()");
}

describe("[CMP-AUD-06] the hot-update pass wraps components, not every PascalCase function", () => {
  const page = "export const Page = () => <b>hi</b>;\n";

  it("a constructor (called with new) stays as written", () => {
    expect(wrapped(`function Point(x) { this.x = x; }\nconst p = new Point(1);\n${page}`)).toEqual([
      "Page",
    ]);
    // Without `this` in it: the call with `new` alone decides.
    expect(
      wrapped(`function Point(x) { return { x }; }\nconst p = new (Point)(1);\n${page}`),
    ).toEqual(["Page"]);
    expect(wrapped(`const Point = (x) => ({ x });\nconst p = new Point(1);\n${page}`)).toEqual([
      "Page",
    ]);
  });

  it("a function that uses this stays as written, even with JSX in it", () => {
    expect(wrapped(`function Point(x) { this.x = x; }\n${page}`)).toEqual(["Page"]);
    expect(wrapped("function Item(p) { return <b onClick={() => this.go(p)} />; }\n")).toEqual([]);
    // A nested regular function has a `this` of its own.
    expect(
      wrapped("function Item(p) { const f = function () { return this; }; return <b>{f()}</b>; }"),
    ).toEqual(["Item"]);
  });

  it("a PascalCase helper without JSX, never used as a tag, stays as written", () => {
    expect(wrapped(`const Total = (n) => n * 2;\nconst label = Total(2) + "px";\n${page}`)).toEqual(
      ["Page"],
    );
    expect(wrapped(`function Format(n) { return String(n); }\n${page}`)).toEqual(["Page"]);
  });

  it("a function with JSX is a component", () => {
    expect(
      wrapped("export function A(p) { return <i>{p.x}</i>; }\nexport const B = () => <b />;"),
    ).toEqual(["A", "B"]);
  });

  it("a function without JSX that the module uses as a tag is a component", () => {
    const source = `function Wrapper(props) { return props.children; }
function Unused(props) { return props.children; }
export const Page = () => <Wrapper><b /></Wrapper>;
`;
    expect(wrapped(source)).toEqual(["Wrapper", "Page"]);
    expect(
      wrapped("const Menu = (p) => p.items;\nexport const Page = () => <Menu.Item />;"),
    ).toEqual(["Menu", "Page"]);
  });

  it("a function that only returns the call of a component is a component, through any chain", () => {
    expect(
      wrapped(
        "const Layout = () => <main />;\nexport const Page = () => Layout({});\nconst Top = (p) => (p.a ? Page({}) : null);",
      ),
    ).toEqual(["Layout", "Page", "Top"]);
    // Written in the other order, and through a block body.
    expect(
      wrapped("const A = () => { return B({}); };\nconst B = () => C({});\nconst C = () => <i />;"),
    ).toEqual(["A", "B", "C"]);
    // A call that is not returned, or of something that is not a component, does not make one.
    expect(
      wrapped("const Layout = () => <main />;\nconst Probe = () => { Layout({}); return 1; };"),
    ).toEqual(["Layout"]);
    expect(
      wrapped(
        "const Total = (n) => n;\nconst Sum = (n) => Total(n);\nexport const P = () => <b />;",
      ),
    ).toEqual(["P"]);
  });

  it("a module accepts its own update only when every export is a wrapped component", () => {
    expect(acceptsItself("export const Page = () => <b />;")).toBe(true);
    expect(
      acceptsItself("export function Point(x) { this.x = x; }\nexport const Page = () => <b />;"),
    ).toBe(false);
    expect(
      acceptsItself("export const Total = (n) => n * 2;\nexport const Page = () => <b />;"),
    ).toBe(false);
    expect(
      acceptsItself(
        "export default function Point(x) { this.x = x; }\nexport const Page = () => <b />;",
      ),
    ).toBe(false);
    expect(
      acceptsItself(
        "function Point(x) { this.x = x; }\nexport { Point };\nexport const Page = () => <b />;",
      ),
    ).toBe(false);
    // Not exported: the module is still hot.
    expect(
      acceptsItself("function Point(x) { this.x = x; }\nexport const Page = () => <b />;"),
    ).toBe(true);
  });

  it("an overload signature is a type: it adds no export, and the implementation decides", () => {
    const overloaded = "export function Real(): unknown;\nexport function Real() { return <p />; }";
    expect(wrapped(overloaded)).toEqual(["Real"]);
    expect(acceptsItself(overloaded)).toBe(true);
    expect(
      acceptsItself(
        "export function Real(a: string): unknown;\nexport function Real(a: number): unknown;\nexport function Real(a: any) { return <p />; }",
      ),
    ).toBe(true);
    expect(
      acceptsItself(
        "export default function Real(): unknown;\nexport default function Real() { return <p />; }",
      ),
    ).toBe(true);
    // The implementation of an overloaded function that stays as written still blocks acceptance.
    expect(
      acceptsItself(
        "export function Point(x: number): unknown;\nexport function Point(x: any) { this.x = x; }\nexport const Page = () => <b />;",
      ),
    ).toBe(false);
  });

  it("without hot updates nothing changes: the output has no registry and no wrapper", () => {
    const source = `function Point(x) { this.x = x; }\nconst p = new Point(1);\n${page}`;
    const code = compileWithJavaScript(source, { filename: "a.tsx" }).code;
    expect(code).not.toContain("_$component");
  });
});

describe("[CMP-AUD-07] the Rust implementations choose the same hot-update components as the TypeScript one", () => {
  const page = "export const Page = () => <b>hi</b>;\n";
  const inputs = [
    `function Point(x) { this.x = x; }\nconst p = new Point(1);\n${page}`,
    `function Point(x) { return { x }; }\nconst p = new (Point)(1);\n${page}`,
    `const Point = (x) => ({ x });\nconst p = new Point(1);\n${page}`,
    "function Item(p) { return <b onClick={() => this.go(p)} />; }\n",
    "function Item(p) { const f = function () { return this; }; return <b>{f()}</b>; }",
    `const Total = (n) => n * 2;\nconst label = Total(2) + "px";\n${page}`,
    "function Wrapper(props) { return props.children; }\nfunction Unused(props) { return props.children; }\nexport const Page = () => <Wrapper><b /></Wrapper>;\n",
    "const Menu = (p) => p.items;\nexport const Page = () => <Menu.Item />;",
    "const Layout = () => <main />;\nexport const Page = () => Layout({});\nconst Top = (p) => (p.a ? Page({}) : null);",
    "const A = () => { return B({}); };\nconst B = () => C({});\nconst C = () => <i />;",
    "const Layout = () => <main />;\nconst Probe = () => { Layout({}); return 1; };",
    "const Total = (n) => n;\nconst Sum = (n) => Total(n);\nexport const P = () => <b />;",
    "function helper() { return <p />; }\nexport function Real() { return helper(); }\nasync function Async() { return <p />; }",
    "export function Point(x) { this.x = x; }\nexport const Page = () => <b />;",
    "export const Total = (n) => n * 2;\nexport const Page = () => <b />;",
    "export default function Point(x) { this.x = x; }\nexport const Page = () => <b />;",
    "export function Real(): unknown;\nexport function Real() { return <p />; }",
    "export function Real(a: string): unknown;\nexport function Real(a: number): unknown;\nexport function Real(a: any) { return <p />; }",
    "export default function Real(): unknown;\nexport default function Real() { return <p />; }",
    "function Real(): unknown;\nfunction Real() { return <p />; }\nexport { Real };",
    "export function Point(x: number): unknown;\nexport function Point(x: any) { this.x = x; }\nexport const Page = () => <b />;",
    "function Point(x) { this.x = x; }\nexport { Point };\nexport const Page = () => <b />;",
    "const Hidden = (p: { a: boolean }) => (p.a as boolean) ? Page({}) : (Page({}) as any);\nexport const Page = () => <b />;",
    "const Seq = () => (0, Page({}));\nconst Both = (p) => p.a && Page({});\nexport const Page = () => <b />;",
  ];
  for (const [label, attempt] of [
    ["addon", native],
    ["WebAssembly", wasm],
  ] as const) {
    it(`${label}: the code with hot updates on agrees`, () => {
      const backend = backendOf(attempt, label);
      for (const input of inputs) {
        const raw: RawOptions = {
          filename: "a.tsx",
          generate: "dom",
          dev: false,
          autoReactive: true,
          hmr: true,
          hydratable: true,
          sourceMap: false,
        };
        const actual = backend.compileSync(input, raw);
        const expected = compileWithJavaScript(input, { filename: "a.tsx", hmr: true });
        expect(actual.kind, input).toBe(0);
        expect(actual.code, input).toBe(expected.code);
      }
    });
  }
});
