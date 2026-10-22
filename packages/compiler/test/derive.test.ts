import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const out = (source: string): string => compile(source, { filename: "a.tsx" }).code;

describe("auto-reactive constants (transform)", () => {
  it("[DRV-01] a derived const used in JSX is wrapped and read through .value", () => {
    const code = out(`
      function Counter() {
        const [count] = useSignal(0);
        const double = count() * 2;
        return <p>{double}</p>;
      }`);
    expect(code).toContain("const double = _$derived(() => (count() * 2));");
    expect(code).toContain("double.value");
    expect(code).toContain('import { derived as _$derived } from "@shadow-js/web"');
  });

  it("[DRV-02] a call on the derived const keeps working: double() stays a call", () => {
    const code = out(`
      function C() {
        const [count] = useSignal(0);
        const double = count() * 2;
        return <p>{double()}</p>;
      }`);
    // `double()` is a zero-argument call of an identifier, which binds the accessor directly.
    expect(code).toContain("_$insert(_el$, double)");
    expect(code).not.toContain("double.value");
  });

  it("[DRV-03] hooks, functions, literals and JSX are never wrapped", () => {
    const code = out(`
      function C(props) {
        const [a] = useSignal(1);
        const memo = useMemo(() => a());
        const fn = () => a();
        const lit = 5;
        const el = <i />;
        const made = new Map();
        return <p>{memo()}{fn()}{lit}{el}{made.size}</p>;
      }`);
    expect(code).not.toContain("_$derived");
  });

  it("[DRV-04] a const only used in plain statements is not wrapped", () => {
    const code = out(`
      function C(props) {
        const x = props.a;
        console.log(x);
        return <p />;
      }`);
    expect(code).not.toContain("_$derived");
  });

  it("[DRV-05] destructuring props becomes live getters, with defaults and renames", () => {
    const code = out(`
      function Card(props) {
        const { title, size = 3, label: text } = props;
        return <h1 title={title}>{size}{text}</h1>;
      }`);
    expect(code).toContain('title = _$derived(() => props["title"])');
    expect(code).toContain(
      'size = _$derived(() => { const _$v = props["size"]; return _$v === undefined ? (3) : _$v; })',
    );
    expect(code).toContain('text = _$derived(() => props["label"])');
  });

  it("[DRV-06] destructured parameters are supported", () => {
    const code = out(`
      const Row = ({ id, name }: { id: number; name: string }) => <li data-id={id}>{name}</li>;`);
    expect(code).toContain("_$props: { id: number; name: string }");
    expect(code).toContain('id = _$derived(() => _$props["id"])');
  });

  it("[DRV-07] dependent constants chain: a const reading a derived one is derived too", () => {
    const code = out(`
      function C() {
        const [n] = useSignal(1);
        const a = n() + 1;
        const b = a * 2;
        return <p>{b}</p>;
      }`);
    expect(code).toContain("const a = _$derived(");
    expect(code).toContain("b = _$derived(() => (a.value * 2))");
  });

  it("[DRV-08] shadowed names are left alone", () => {
    const code = out(`
      function C() {
        const [n] = useSignal(1);
        const total = n() + 1;
        const list = [1, 2].map((total) => total * 2);
        return <p>{total}{list}</p>;
      }`);
    expect(code).not.toContain("const total = _$derived");
    expect(code).toContain("const list = _$derived(");
  });

  it("[DRV-09] shorthand properties and closures are rewritten", () => {
    const code = out(`
      function C() {
        const [n] = useSignal(1);
        const label = "x" + n();
        const pick = () => ({ label });
        return <button onClick={() => console.log(label)}>{pick().label}</button>;
      }`);
    expect(code).toContain("{ label: label.value }");
    expect(code).toContain("console.log(label.value)");
  });

  it("[DRV-10] can be switched off", () => {
    const code = compile(
      "function C(){ const [c]=useSignal(0); const d = c()*2; return <p>{d}</p>; }",
      { filename: "a.tsx", autoReactive: false },
    ).code;
    expect(code).not.toContain("_$derived");
  });

  it("[DRV-11] non-components are untouched", () => {
    const code = out(`
      function helper() {
        const x = f();
        return <p>{x}</p>;
      }`);
    expect(code).not.toContain("_$derived");
  });

  it("[DRV-12] server target imports the server helper", () => {
    const code = compile(
      "function C(){ const [c]=useSignal(0); const d = c()*2; return <p>{d}</p>; }",
      {
        filename: "a.tsx",
        generate: "ssr",
      },
    ).code;
    expect(code).toContain('from "@shadow-js/web/server"');
    expect(code).toContain("_$derived");
  });
});
