import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const hmr = (source: string): string => compile(source, { filename: "a.tsx", hmr: true }).code;

describe("hmr transform", () => {
  it("[HMR-01] wraps arrow components and function declarations, registers acceptance", () => {
    const out = hmr(`
      export function Counter(props) { return <b>{props.n}</b>; }
      export const Label = (props) => <i>{props.t}</i>;
    `);
    expect(out).toContain('Counter = _$component(_$$reg, "Counter", Counter);');
    expect(out).toContain('const Label = _$component(_$$reg, "Label", (props) =>');
    expect(out).toContain('import.meta.hot, "a.tsx")');
    expect(out).toContain("_$accept(import.meta.hot, _$$reg);");
    expect(out).toContain('from "@shadow-js/web/hmr"');
  });

  it("[HMR-02] a module that also exports a value is not self-accepting", () => {
    const out = hmr(`export const limit = 5;\nexport function Box() { return <p />; }`);
    expect(out).toContain("_$component(");
    expect(out).not.toContain("_$accept(");
  });

  it("[HMR-03] lowercase functions, async functions and 2-parameter functions are not components", () => {
    const out = hmr(`
      function helper() { return <p />; }
      async function Async() { return <p />; }
      function Two(a, b) { return <p />; }
      export function Real() { return helper(); }
    `);
    expect(out).toContain('"Real"');
    expect(out).not.toContain('"helper"');
    expect(out).not.toContain('"Async"');
    expect(out).not.toContain('"Two"');
  });

  it("[HMR-04] type-only exports do not block self-acceptance", () => {
    const out = hmr(
      `export interface Props { n: number }\nexport type X = string;\nexport function A(props: Props) { return <p>{props.n}</p>; }`,
    );
    expect(out).toContain("_$accept(");
  });

  it("[HMR-05] output is unchanged without the option", () => {
    const plain = compile(`export function A() { return <p />; }`, { filename: "a.tsx" }).code;
    expect(plain).not.toContain("hmr");
  });

  it("[HMR-07] a self-accepting module calls import.meta.hot.accept() literally, where the bundler reads it", () => {
    // Vite decides from the source text whether a module accepts itself: a call hidden behind a
    // helper is not seen, and every edit then reloads the page.
    const out = hmr(`export function Box() { return <p />; }`);
    expect(out).toContain("import.meta.hot?.accept();");
    expect(hmr(`export const limit = 5;\nexport function Box() { return <p />; }`)).not.toContain(
      "import.meta.hot?.accept",
    );
  });

  it("[HMR-06] export default function components and export * disable correctly", () => {
    expect(hmr(`export default function Page() { return <p />; }`)).toContain("_$accept(");
    expect(hmr(`export * from "./x";\nexport function A() { return <p />; }`)).not.toContain(
      "_$accept(",
    );
  });
});
