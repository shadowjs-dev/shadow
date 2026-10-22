import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const dom = (source: string): string =>
  compile(source, { filename: "a.tsx", generate: "dom" }).code;

describe("ref attributes (DOM output)", () => {
  it("[REF-01] a ref to a const callback never assigns the const (a bundler rejects that in dead code)", () => {
    const code = dom(
      "const setBox = (el) => { window.box = el; };\nexport const A = () => <div ref={setBox} />;",
    );
    expect(code).not.toMatch(/setBox = _el/);
    expect(code).toContain("refTo(setBox, ");
  });

  it("[REF-02] a ref to a let binding still assigns it when the value is not a function", () => {
    const code = dom("let box;\nexport const A = () => <div ref={box} />;");
    expect(code).toMatch(/\(box = _el\$\d*\)/);
  });

  it("[REF-03] a component's ref prop to a const callback never assigns the const", () => {
    const code = dom(
      "const setBox = (el) => {};\nconst Inner = (props) => <p />;\nexport const A = () => <Inner ref={setBox} />;",
    );
    expect(code).not.toMatch(/setBox = r\$/);
  });
});
