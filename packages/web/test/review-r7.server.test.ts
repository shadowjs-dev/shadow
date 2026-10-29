import { describe, expect, it } from "vitest";
import { ssrClass, ssrStyle } from "../src/server/class-style";
import { ssrElement } from "../src/server/element";

describe("ssrElement: a leading line break in pre and listing", () => {
  it("[WEB-R7-7] pre, listing and textarea get one extra line break when the content starts with one", () => {
    expect(ssrElement("pre", { children: "\nfoo" }).t).toBe("<pre>\n\nfoo</pre>");
    expect(ssrElement("listing", { children: "\r\nfoo" }).t).toBe("<listing>\n\r\nfoo</listing>");
    expect(ssrElement("textarea", { children: "\nfoo" }).t).toBe("<textarea>\n\nfoo</textarea>");
    expect(ssrElement("pre", { id: "p" }, "\nfoo").t).toBe('<pre id="p">\n\nfoo</pre>');
  });

  it("[WEB-R7-7] content that does not start with a line break, other elements and innerHTML are unchanged", () => {
    expect(ssrElement("pre", { children: "foo\nbar" }).t).toBe("<pre>foo\nbar</pre>");
    expect(ssrElement("pre", {}).t).toBe("<pre></pre>");
    expect(ssrElement("div", { children: "\nfoo" }).t).toBe("<div>\nfoo</div>");
    expect(ssrElement("pre", { innerHTML: "\nfoo" }).t).toBe("<pre>\nfoo</pre>");
  });
});

describe("server class and style accessors (the client resolves them the same way)", () => {
  it("[WEB-R7-5] the server calls accessors in arrays, object values and style values", () => {
    expect(ssrClass(["a", () => "b"])).toBe(' class="a b"');
    expect(ssrClass({ on: () => false, off: () => true })).toBe(' class="off"');
    expect(ssrStyle({ color: () => "red" })).toBe(' style="color:red"');
  });
});

describe("ssrElement boolean attributes (the client writes the same set)", () => {
  it("[WEB-R7-1] a falsy value writes no flag, a truthy one a bare flag, hidden keeps until-found", () => {
    expect(ssrElement("button", { disabled: 0, hidden: "", required: Number.NaN, loop: 0 }).t).toBe(
      "<button></button>",
    );
    expect(ssrElement("button", { disabled: "0", readOnly: 1 }).t).toBe(
      "<button disabled readonly></button>",
    );
    expect(ssrElement("div", { hidden: "until-found" }).t).toBe('<div hidden="until-found"></div>');
  });
});
