import { describe, expect, it } from "vitest";
import { ssrClass, ssrStyle } from "../../src/server/index";

describe("ssrClass", () => {
  it("[SSR-37] a string is used verbatim", () => {
    expect(ssrClass("a b")).toBe(' class="a b"');
  });

  it("[SSR-38] arrays and objects are clsx-style, nested and falsy entries skipped", () => {
    expect(ssrClass(["a", null, false, 0, "", "b", ["c", { d: true, e: false }]])).toBe(
      ' class="a b c d"',
    );
  });

  it("[SSR-39] numbers are classes unless zero or NaN", () => {
    expect(ssrClass([5, Number.NaN, 0])).toBe(' class="5"');
  });

  it("[SSR-40] empty values render nothing", () => {
    for (const value of [null, undefined, false, "", [], {}, [null, false]]) {
      expect(ssrClass(value)).toBe("");
    }
  });

  it("[SSR-41] class injection through quotes is escaped, not written", () => {
    expect(ssrClass('a" onclick="x')).toBe(' class="a&quot; onclick=&quot;x"');
    expect(ssrClass({ "x<y": true, "z>": true })).toBe(' class="x&lt;y z&gt;"');
  });

  it("[SSR-42] an object key holding several space-separated names yields all of them", () => {
    expect(ssrClass({ "a  b": true })).toBe(' class="a  b"');
  });

  it("[SSR-43] a class array that contains itself throws a TypeError", () => {
    const cyclic: unknown[] = ["a"];
    cyclic.push(cyclic);
    expect(() => ssrClass(cyclic)).toThrow(TypeError);
  });

  it("[SSR-44] 20,000 nested class arrays are walked iteratively", () => {
    let nested: unknown = "deep";
    for (let depth = 0; depth < 20_000; depth += 1) nested = [nested];
    expect(ssrClass(nested)).toBe(' class="deep"');
  });
});

describe("ssrStyle", () => {
  it("[SSR-45] a string is written verbatim, escaped", () => {
    expect(ssrStyle("color: red")).toBe(' style="color: red"');
    expect(ssrStyle("content: '<'")).toBe(' style="content: &#39;&lt;&#39;"');
  });

  it("[SSR-46] camelCase becomes kebab-case, custom properties and -ms- prefixes are kept", () => {
    expect(ssrStyle({ backgroundColor: "red", "--my-var": "1px", msTransform: "x" })).toBe(
      ' style="background-color:red;--my-var:1px;-ms-transform:x"',
    );
  });

  it("[SSR-47] numbers are written unitless", () => {
    expect(ssrStyle({ opacity: 0.5, zIndex: 0 })).toBe(' style="opacity:0.5;z-index:0"');
  });

  it("[SSR-48] null, undefined and false values are skipped", () => {
    expect(ssrStyle({ color: null, width: false, height: undefined })).toBe("");
  });

  it("[SSR-49] later declarations win when several sources are combined in an array", () => {
    expect(ssrStyle([{ color: "red" }, "width: 1px", { color: "blue" }])).toBe(
      ' style="color:red;width: 1px;color:blue"',
    );
  });

  it("[SSR-50] values are escaped so they cannot leave the attribute", () => {
    const out = ssrStyle({ "font-family": `"x"><script>` });
    expect(out).toMatch(/^ style="[^"<>]*"$/);
    expect(out).toBe(' style="font-family:&quot;x&quot;&gt;&lt;script&gt;"');
  });

  it("[SSR-51] a declaration cannot end itself with a top-level semicolon, brace or open quote", () => {
    expect(ssrStyle({ color: "red; background: blue" })).toBe("");
    expect(ssrStyle({ color: "red} body{display:none" })).toBe("");
    expect(ssrStyle({ color: 'red"' })).toBe("");
  });

  it("[SSR-52] semicolons inside quotes or parentheses are legitimate and kept", () => {
    expect(ssrStyle({ content: '";"' })).toBe(' style="content:&quot;;&quot;"');
    expect(ssrStyle({ background: "url(data:image/png;base64,AA)" })).toBe(
      ' style="background:url(data:image/png;base64,AA)"',
    );
  });

  it("[SSR-53] invalid property names throw a TypeError", () => {
    expect(() => ssrStyle({ "a:b": "x" })).toThrow(TypeError);
    expect(() => ssrStyle({ "color;x": "red" })).toThrow(TypeError);
    expect(() => ssrStyle({ "": "x" })).toThrow(TypeError);
    expect(() => ssrStyle({ "a b": "x" })).toThrow(TypeError);
  });

  it("[SSR-54] an empty style object or an empty array renders nothing", () => {
    expect(ssrStyle({})).toBe("");
    expect(ssrStyle([])).toBe("");
    expect(ssrStyle(null)).toBe("");
    expect(ssrStyle(false)).toBe("");
  });

  it("[SSR-55] a nested array inside a style array is rejected", () => {
    expect(() => ssrStyle([[{ color: "red" }]])).toThrow(TypeError);
  });
});
