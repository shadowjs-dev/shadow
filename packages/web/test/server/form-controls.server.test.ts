import { describe, expect, it } from "vitest";
import {
  // biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
  escape,
  ssr,
  ssrElement,
  ssrRaw,
  ssrSelectValue,
  ssrTextArea,
} from "../../src/server/index";

/** Options as the compiler writes them: a static value attribute and static text. */
const OPTIONS = ssr([
  '<option value="a">Apple</option><option value="b">Banana</option><option value="c">Cherry</option>',
]);

describe("textarea value on the spread path", () => {
  it("[SSR-172] a textarea's value is its content, never a value attribute", () => {
    const html = ssrElement("textarea", { name: "bio", value: "hello <b> & bye" }).t;
    expect(html).toBe('<textarea name="bio">hello &lt;b&gt; &amp; bye</textarea>');
    expect(html).not.toContain("value=");
  });

  it("[SSR-173] the value wins over children, defaultValue is the fallback, null and undefined are empty", () => {
    expect(ssrElement("textarea", { value: "v", defaultValue: "d" }, "kids").t).toBe(
      "<textarea>v</textarea>",
    );
    expect(ssrElement("textarea", { defaultValue: "d" }).t).toBe("<textarea>d</textarea>");
    expect(ssrElement("textarea", { value: null }, "kids").t).toBe("<textarea></textarea>");
    expect(ssrElement("textarea", { value: undefined }, "kids").t).toBe("<textarea></textarea>");
    expect(ssrElement("textarea", {}, "kids").t).toBe("<textarea>kids</textarea>");
    expect(
      ssrElement("textarea", {
        get value() {
          return () => 3;
        },
      }).t,
    ).toBe("<textarea>3</textarea>");
  });

  it("[SSR-174] a markup-looking value cannot close the textarea", () => {
    const html = ssrElement("textarea", { value: "</textarea><script>alert(1)</script>" }).t;
    expect(html).toBe(
      "<textarea>&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;</textarea>",
    );
  });

  it("[SSR-175] a first newline is kept: the parser drops one directly after the start tag", () => {
    expect(ssrElement("textarea", { value: "\nfirst" }).t).toBe("<textarea>\n\nfirst</textarea>");
    expect(ssrElement("textarea", { value: "\r\nfirst" }).t).toBe(
      "<textarea>\n\r\nfirst</textarea>",
    );
    expect(ssrElement("textarea", { value: "a\nb" }).t).toBe("<textarea>a\nb</textarea>");
    expect(ssrTextArea("\nx").t).toBe("\n\nx");
    expect(ssrTextArea(() => "y").t).toBe("y");
    expect(ssrTextArea(null).t).toBe("");
    expect(ssrTextArea(0).t).toBe("0");
    expect(ssrTextArea(false).t).toBe("false");
  });

  it("[SSR-176] a symbol value is refused like any attribute value", () => {
    expect(() => ssrElement("textarea", { value: Symbol("x") })).toThrow(TypeError);
  });
});

describe("select value marks the matching option", () => {
  it("[SSR-177] spread: value marks the option with that value attribute and writes no select attribute", () => {
    const html = ssrElement("select", { name: "f", value: "b" }, OPTIONS).t;
    expect(html).toBe(
      '<select name="f"><option value="a">Apple</option><option value="b" selected>Banana</option><option value="c">Cherry</option></select>',
    );
  });

  it("[SSR-178] compiled shape: ssrSelectValue marks the options of the children", () => {
    expect(ssrSelectValue("c", OPTIONS).t).toBe(
      '<option value="a">Apple</option><option value="b">Banana</option><option value="c" selected>Cherry</option>',
    );
    expect(ssrSelectValue(() => "a", OPTIONS).t).toContain('<option value="a" selected>');
  });

  it("[SSR-179] an option without a value attribute matches by its text, whitespace collapsed", () => {
    const options = ssr([
      "<option>\n  Plain   text\n</option><option><!--[-->Tom &amp; Jerry<!--]--></option>",
    ]);
    expect(ssrSelectValue("Plain text", options).t).toBe(
      "<option selected>\n  Plain   text\n</option><option><!--[-->Tom &amp; Jerry<!--]--></option>",
    );
    expect(ssrSelectValue("Tom & Jerry", options).t).toBe(
      "<option>\n  Plain   text\n</option><option selected><!--[-->Tom &amp; Jerry<!--]--></option>",
    );
  });

  it("[SSR-180] an empty value attribute is a value; it does not fall back to the text", () => {
    const options = ssr(['<option value="">none</option><option value="x">none</option>']);
    expect(ssrSelectValue("", options).t).toBe(
      '<option value="" selected>none</option><option value="x">none</option>',
    );
    expect(ssrSelectValue("none", options).t).toBe(
      '<option value="">none</option><option value="x">none</option>',
    );
  });

  it("[SSR-181] multiple: an array marks every option it lists, in optgroups too", () => {
    const options = ssr([
      '<optgroup label="Fruit"><option value="a">A</option><option value="b">B</option></optgroup><optgroup label="Veg"><option value="c">C</option><option value="d">D</option></optgroup>',
    ]);
    const html = ssrElement("select", { multiple: true, value: ["b", "c"] }, options).t;
    expect(html).toBe(
      '<select multiple><optgroup label="Fruit"><option value="a">A</option><option value="b" selected>B</option></optgroup><optgroup label="Veg"><option value="c" selected>C</option><option value="d">D</option></optgroup></select>',
    );
    expect(ssrSelectValue([], options).t).not.toContain("selected");
  });

  it("[SSR-182] values are compared as strings: numbers match, null and undefined items are skipped", () => {
    const options = ssr(['<option value="1">1</option><option value="2">2</option>']);
    expect(ssrSelectValue(2, options).t).toBe(
      '<option value="1">1</option><option value="2" selected>2</option>',
    );
    expect(ssrSelectValue([1, null, undefined, 2], options).t).toBe(
      '<option value="1" selected>1</option><option value="2" selected>2</option>',
    );
  });

  it("[SSR-183] a scalar marks only the first matching option, like setting select.value", () => {
    const options = ssr(['<option value="a">1</option><option value="a">2</option>']);
    expect(ssrSelectValue("a", options).t).toBe(
      '<option value="a" selected>1</option><option value="a">2</option>',
    );
    expect(ssrSelectValue(["a"], options).t).toBe(
      '<option value="a" selected>1</option><option value="a" selected>2</option>',
    );
  });

  it("[SSR-184] a controlled select drops other options' selected; no match marks nothing", () => {
    const options = ssr([
      '<option value="a" selected>A</option><option value="b" selected="">B</option><option value="c">C</option>',
    ]);
    expect(ssrSelectValue("c", options).t).toBe(
      '<option value="a">A</option><option value="b">B</option><option value="c" selected>C</option>',
    );
    expect(ssrSelectValue("zzz", options).t).toBe(
      '<option value="a">A</option><option value="b">B</option><option value="c">C</option>',
    );
    // An option that already carries the attribute and matches is left untouched.
    expect(ssrSelectValue("a", options).t).toBe(
      '<option value="a" selected>A</option><option value="b">B</option><option value="c">C</option>',
    );
  });

  it("[SSR-185] null and undefined select the option whose value is empty", () => {
    const options = ssr(['<option value="">none</option><option value="x">X</option>']);
    expect(ssrSelectValue(undefined, options).t).toContain('<option value="" selected>');
    expect(ssrSelectValue(null, options).t).toContain('<option value="" selected>');
  });

  it("[SSR-186] options written by spread elements and components are found", () => {
    const rows = ["x", "y & z"].map((value) =>
      ssrElement("option", { value, disabled: false, children: `label ${value}` }),
    );
    const html = ssrElement("select", { value: "y & z" }, rows).t;
    expect(html).toBe(
      '<select><option value="x">label x</option><option value="y &amp; z" selected>label y &amp; z</option></select>',
    );
  });

  it("[SSR-187] hostile values stay escaped: attributes and text never gain markup", () => {
    const hostile = `"><img src=x onerror=alert(1)> & ' <script>`;
    const attribute = hostile.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const options = ssr([`<option value="a">A</option><option value="${attribute}">B</option>`]);
    const html = ssrSelectValue(hostile, options).t;
    expect(html).toBe(
      `<option value="a">A</option><option value="${attribute}" selected>B</option>`,
    );
    // The wanted value itself is only compared, never written.
    const never = ssrSelectValue(hostile, ssr(['<option value="a">A</option>'])).t;
    expect(never).toBe('<option value="a">A</option>');
    expect(never).not.toContain("<img");
  });

  it("[SSR-188] a static attribute value with > or a quote inside does not end the tag early", () => {
    const options = ssr([
      '<option title="a>b" value="v\'x">T</option><option value="w">W</option>',
    ]);
    expect(ssrSelectValue("v'x", options).t).toBe(
      '<option title="a>b" value="v\'x" selected>T</option><option value="w">W</option>',
    );
  });

  it("[SSR-189] text and attributes that look like options are not options", () => {
    const options = ssr([
      '<optgroup label="&lt;option value=&quot;z&quot;&gt;"><option value="a">&lt;option value="z"&gt;</option></optgroup>',
    ]);
    expect(ssrSelectValue("z", options).t).not.toContain("selected");
    expect(ssrSelectValue("a", options).t).toContain('<option value="a" selected>');
  });

  it("[SSR-190] control-flow output (markers, nested nodes, strings) is searched too", () => {
    const children = [
      ssrRaw("<!--[-->"),
      ssr(['<option value="a">A</option>']),
      ssrRaw("<!--]-->"),
      ssr(['<option value="b">B</option>']),
    ];
    const html = ssrElement("select", { value: "b" }, children).t;
    expect(html).toBe(
      '<select><!--[--><option value="a">A</option><!--]--><option value="b" selected>B</option></select>',
    );
    expect(escape(ssrSelectValue("a", children))).toContain("selected");
  });

  it("[SSR-191] a select without a value prop keeps its options untouched", () => {
    const options = ssr(['<option value="a" selected>A</option><option value="b">B</option>']);
    expect(ssrElement("select", { name: "n" }, options).t).toBe(
      '<select name="n"><option value="a" selected>A</option><option value="b">B</option></select>',
    );
  });

  it("[SSR-192] defaultValue marks too, but value wins; non-select elements keep value as an attribute", () => {
    expect(ssrElement("select", { defaultValue: "b" }, OPTIONS).t).toContain(
      '<option value="b" selected>',
    );
    expect(ssrElement("select", { defaultValue: "b", value: "c" }, OPTIONS).t).toContain(
      '<option value="c" selected>',
    );
    expect(ssrElement("li", { value: "3" }, "x").t).toBe('<li value="3">x</li>');
    expect(ssrElement("option", { value: "3" }, "x").t).toBe('<option value="3">x</option>');
  });

  it("[SSR-193] a symbol value is refused", () => {
    expect(() => ssrSelectValue(Symbol("x"), OPTIONS)).toThrow(TypeError);
  });

  it("[SSR-194] a long option list is handled in one linear pass", () => {
    const html = ssr([
      Array.from({ length: 20_000 }, (_, i) => `<option value="${i}">item ${i}</option>`).join(""),
    ]);
    const out = ssrSelectValue(19_999, html).t;
    expect(out.endsWith('<option value="19999" selected>item 19999</option>')).toBe(true);
    expect(out.split(" selected").length).toBe(2);
  });
});

describe("inputs keep their value and checked as attributes", () => {
  it("[SSR-195] text, number, radio and checkbox controls", () => {
    expect(ssrElement("input", { type: "text", value: 'a"b' }).t).toBe(
      '<input type="text" value="a&quot;b">',
    );
    expect(ssrElement("input", { type: "number", value: 0 }).t).toBe(
      '<input type="number" value="0">',
    );
    expect(ssrElement("input", { type: "checkbox", checked: true }).t).toBe(
      '<input type="checkbox" checked>',
    );
    expect(ssrElement("input", { type: "checkbox", checked: false }).t).toBe(
      '<input type="checkbox">',
    );
    expect(ssrElement("input", { type: "radio", value: "a", checked: true }).t).toBe(
      '<input type="radio" value="a" checked>',
    );
  });

  it("[SSR-196] defaultValue and defaultChecked are the value and checked attributes", () => {
    expect(ssrElement("input", { defaultValue: "d" }).t).toBe('<input value="d">');
    expect(ssrElement("input", { defaultValue: "d", value: "v" }).t).toBe('<input value="v">');
    expect(ssrElement("input", { type: "checkbox", defaultChecked: true }).t).toBe(
      '<input type="checkbox" checked>',
    );
  });
});
