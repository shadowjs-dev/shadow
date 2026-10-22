import { describe, expect, it } from "vitest";
import { CompileError, compile } from "../src/javascript";

const code = (jsx: string): string => `export const a = ${jsx};`;
const fails = (jsx: string): string => {
  try {
    compile(code(jsx), { filename: "a.tsx" });
  } catch (error) {
    if (error instanceof CompileError) return error.diagnostic.code;
    throw error;
  }
  return "ok";
};

describe("html nesting validation", () => {
  const invalid: Array<[string, string]> = [
    ["<p><div>x</div></p>", "p>div"],
    ["<p><ul><li /></ul></p>", "p>ul"],
    ["<table><tr><td /></tr></table>", "table>tr (parser inserts tbody)"],
    ["<table><div /></table>", "table>div"],
    ["<table><tbody><td /></tbody></table>", "tbody>td"],
    ["<table><tbody><tr><div /></tr></tbody></table>", "tr>div"],
    ["<tr><td /></tr>", "tr at root is fine, but text below is not"],
    ["<a href='x'><a href='y'>z</a></a>", "a>a"],
    ["<button><button /></button>", "button>button"],
    ["<form><form /></form>", "form>form"],
    ["<select><div /></select>", "select>div"],
    ["<h1><h2>x</h2></h1>", "h1>h2"],
    ["<table>text</table>", "text in table"],
    ["<div><a><span><a /></span></a></div>", "deep a>a"],
  ];
  for (const [jsx, label] of invalid) {
    if (label.startsWith("tr at root")) continue;
    it(`[NST] rejects ${label}`, () => {
      expect(fails(jsx)).toBe("INVALID_HTML_NESTING");
    });
  }
  const valid = [
    "<div><p>x</p></div>",
    "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
    "<table><caption>c</caption><colgroup><col /></colgroup><tbody>{rows()}</tbody></table>",
    "<ul><li>a</li><li>b</li></ul>",
    "<select><option>a</option><optgroup><option>b</option></optgroup></select>",
    "<p><span><a href='x'>y</a></span></p>",
    "<svg><a><circle /></a></svg>",
    "<form><label>l</label><button>b</button></form>",
  ];
  for (const jsx of valid) {
    it(`[NST] accepts ${jsx.slice(0, 50)}`, () => {
      expect(fails(jsx)).toBe("ok");
    });
  }
  it("[NST] reports the position of the offending element", () => {
    try {
      compile(code("<p><div /></p>"), { filename: "a.tsx" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CompileError);
      expect((error as CompileError).diagnostic.line).toBe(1);
    }
  });
});
