import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

const dom = (jsx: string): string =>
  compile(`export const A = (p) => ${jsx};`, { filename: "a.tsx", generate: "dom" }).code;
const ssr = (jsx: string): string =>
  compile(`export const A = (p) => ${jsx};`, { filename: "a.tsx", generate: "ssr" }).code;

/** The first hoisted template of a dom output, as its HTML. */
function template(code: string): string {
  const match = /_\$template\("((?:[^"\\]|\\.)*)"/.exec(code);
  return match === null ? "" : (JSON.parse(`"${match[1]}"`) as string);
}

describe("literal children are folded into the static text", () => {
  it("[OPT-FOLD-01] a number between texts is one text node with no insert and no split", () => {
    const code = dom("<p>Copyright {2026} ShadowJS</p>");
    expect(template(code)).toBe("<p>Copyright 2026 ShadowJS</p>");
    expect(code).not.toContain("_$insert");
    expect(code).not.toContain("splitText");
  });

  it('[OPT-FOLD-02] the JSX space idiom {" "} joins its neighbors', () => {
    const code = dom('<p><b>a</b>{" "}<i>b</i></p>');
    expect(template(code)).toBe("<p><b>a</b> <i>b</i></p>");
    expect(code).not.toContain("_$insert");
  });

  it("[OPT-FOLD-03] strings, templates without holes and arithmetic on literals fold", () => {
    const code = dom("<p>{'a'}{`b`}{1 + 2}{'c' + 'd'}{-1}</p>");
    expect(template(code)).toBe("<p>ab3cd-1</p>");
    expect(code).not.toContain("_$insert");
  });

  it("[OPT-FOLD-04] null, true and false render nothing, so they are dropped", () => {
    const code = dom("<p>a{null}{false}{true}b</p>");
    expect(template(code)).toBe("<p>ab</p>");
    expect(code).not.toContain("_$insert");
  });

  it("[OPT-FOLD-05] folded text is escaped for the template", () => {
    const code = dom('<p>{"a<b&c>d"}</p>');
    expect(template(code)).toBe("<p>a&lt;b&amp;c&gt;d</p>");
  });

  it("[OPT-FOLD-06] a literal next to a dynamic slot keeps the slot exact", () => {
    const code = dom('<p>x{"y"}{p.v}z</p>');
    expect(template(code)).toBe("<p>xyz</p>");
    expect(code).toMatch(/_\$insert\(_el\$\d*, \(\) => p\.v, _el\$\d*\)/);
    expect(code).toMatch(/splitText\(2\)/);
  });

  it("[OPT-FOLD-07] a fragment inside an element folds with the element's children", () => {
    const code = dom('<div><>{"a"}</>x</div>');
    expect(template(code)).toBe("<div>ax</div>");
  });

  it("[OPT-FOLD-08] component children are left exactly as written", () => {
    const code = dom('<Box>a{"b"}</Box>');
    expect(code).toContain('return ["a", "b"];');
    const single = dom('<Box>{"b"}</Box>');
    expect(single).toContain('children: "b"');
    const fragment = dom('<Box><>{"a"}x</></Box>');
    expect(fragment).toContain('"a"');
    expect(fragment).toContain('"x"');
  });

  it("[OPT-FOLD-09] a root fragment is left as written", () => {
    const code = dom('<>{"a"}{p.v}</>');
    expect(code).toContain('"a"');
  });

  it("[OPT-FOLD-10] parents where markup parsing differs from inserting keep the insert", () => {
    for (const tag of ["tr", "table", "tbody", "select", "pre", "textarea", "script", "style"]) {
      const code = dom(`<${tag}>{"x"}</${tag}>`);
      expect(code, tag).toContain("x");
      expect(template(code), tag).not.toContain(">x<");
    }
  });

  it("[OPT-FOLD-11] text the HTML parser would rewrite is not folded", () => {
    for (const text of ["a\\r\\nb", "a\\u0000b", "a\\ud800b"]) {
      const code = dom(`<p>{"${text}"}</p>`);
      expect(code, text).toContain("_$insert");
    }
  });

  it("[OPT-FOLD-12] expressions that are not plain literals stay dynamic", () => {
    expect(dom("<p>{p.a}</p>")).toContain("_$insert");
    expect(dom("<p>{1 / 0}</p>")).toContain("_$insert");
    expect(dom("<p>{undefined}</p>")).toContain("_$insert");
    expect(dom("<p>{'a' + p.b}</p>")).toContain("_$insert");
  });

  it("[OPT-FOLD-13] SSR writes the folded text with no hydration markers around it", () => {
    const code = ssr("<p>Copyright {2026} ShadowJS</p>");
    expect(code).toContain("Copyright 2026 ShadowJS");
    expect(code).not.toContain("<!--[-->");
    expect(code).not.toContain("_$escape");
  });
});

describe("constant folding of attribute values", () => {
  it("[OPT-FOLD-20] literal arithmetic and concatenation become static attributes", () => {
    const code = dom('<img alt={"a" + "b"} width={1 + 2} data-n={-1} />');
    expect(template(code)).toBe('<img alt="ab" width="3" data-n="-1">');
  });

  it("[OPT-FOLD-21] component props fold the same way", () => {
    const code = dom('<Card title={"a" + "b"} size={2 * 3} />');
    expect(code).toContain('title: "ab"');
    expect(code).toContain("size: 6");
  });

  it("[OPT-FOLD-22] a deep chain is not evaluated and does not overflow the stack", () => {
    const chain = Array.from({ length: 5000 }, () => "1").join(" + ");
    const code = dom(`<p title={${chain}}>x</p>`);
    expect(code).toContain("_$setAttribute");
  });
});
