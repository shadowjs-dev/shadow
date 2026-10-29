import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
import { escape, ssrAttribute } from "../../src/server/index";

describe("ssrAttribute", () => {
  it("[SSR-18] string values are escaped inside double quotes", () => {
    expect(ssrAttribute("title", `a"b<c`)).toBe(' title="a&quot;b&lt;c"');
  });

  it("[SSR-19] null, undefined and false remove the attribute", () => {
    expect(ssrAttribute("title", null)).toBe("");
    expect(ssrAttribute("title", undefined)).toBe("");
    expect(ssrAttribute("title", false)).toBe("");
  });

  it("[SSR-20] true writes an empty value in non-boolean mode", () => {
    expect(ssrAttribute("title", true)).toBe(' title=""');
  });

  it("[SSR-21] boolean mode writes a bare name when the value is truthy", () => {
    expect(ssrAttribute("disabled", true, true)).toBe(" disabled");
    expect(ssrAttribute("disabled", "false", true)).toBe(" disabled");
    expect(ssrAttribute("disabled", false, true)).toBe("");
    expect(ssrAttribute("disabled", 0, true)).toBe("");
    expect(ssrAttribute("disabled", "", true)).toBe("");
    expect(ssrAttribute("disabled", null, true)).toBe("");
  });

  it("[SSR-22] aria-, data- and enumerated attributes write false and true as strings", () => {
    expect(ssrAttribute("aria-hidden", false)).toBe(' aria-hidden="false"');
    expect(ssrAttribute("aria-hidden", true)).toBe(' aria-hidden="true"');
    expect(ssrAttribute("data-x", false)).toBe(' data-x="false"');
    expect(ssrAttribute("data-x", true)).toBe(' data-x="true"');
    expect(ssrAttribute("draggable", false)).toBe(' draggable="false"');
    expect(ssrAttribute("spellcheck", true)).toBe(' spellcheck="true"');
    expect(ssrAttribute("contenteditable", null)).toBe("");
  });

  it("[SSR-23] numbers and other values use their String form, escaped", () => {
    expect(ssrAttribute("tabindex", 0)).toBe(' tabindex="0"');
    expect(ssrAttribute("max", 1.5)).toBe(' max="1.5"');
    expect(ssrAttribute("data-s", { toString: () => "<o>" })).toBe(' data-s="&lt;o&gt;"');
  });

  it("[SSR-24] invalid attribute names throw a TypeError", () => {
    for (const name of [
      "a b",
      'x"onload',
      "1abc",
      "",
      "a=b",
      '"><script',
      "a>b",
      "a'b",
      "a\tb",
      "a\nb",
    ]) {
      expect(() => ssrAttribute(name, "v"), name).toThrow(TypeError);
    }
  });

  it("[SSR-25] valid attribute names are accepted, including namespaced and dotted ones", () => {
    expect(ssrAttribute("data-x", "1")).toBe(' data-x="1"');
    expect(ssrAttribute("xlink:title", "1")).toBe(' xlink:title="1"');
    expect(ssrAttribute("_x", "1")).toBe(' _x="1"');
    expect(ssrAttribute(":x", "1")).toBe(' :x="1"');
    expect(ssrAttribute("a.b-c", "1")).toBe(' a.b-c="1"');
  });

  it("[SSR-26] on* attribute names are dropped, whatever their case", () => {
    expect(ssrAttribute("onclick", "alert(1)")).toBe("");
    expect(ssrAttribute("ONCLICK", "alert(1)")).toBe("");
    expect(ssrAttribute("onLoad", true)).toBe("");
  });

  it("[SSR-27] javascript: URLs are blocked in every URL attribute, in any case", () => {
    for (const name of [
      "href",
      "src",
      "action",
      "formaction",
      "xlink:href",
      "poster",
      "data",
      "HREF",
    ]) {
      expect(ssrAttribute(name, "javascript:alert(1)"), name).toBe("");
      expect(ssrAttribute(name, "JaVaScRiPt:alert(1)"), name).toBe("");
    }
  });

  it("[SSR-28] obfuscated schemes are blocked: spaces, tabs, newlines, controls, NUL", () => {
    expect(ssrAttribute("href", "  javascript:alert(1)")).toBe("");
    expect(ssrAttribute("href", "java\tscript:alert(1)")).toBe("");
    expect(ssrAttribute("href", "java\nscript:alert(1)")).toBe("");
    expect(ssrAttribute("href", "java\r\nscript:alert(1)")).toBe("");
    expect(ssrAttribute("href", "\u0000javascript:alert(1)")).toBe("");
    expect(ssrAttribute("href", "java\u0001script:alert(1)")).toBe("");
    expect(ssrAttribute("href", "java\u007fscript:alert(1)")).toBe("");
    expect(ssrAttribute("href", "\t\n javascript:alert(1)")).toBe("");
  });

  it("[SSR-29] vbscript: and data:text/html are blocked; data:image is allowed", () => {
    expect(ssrAttribute("src", "vbscript:msgbox(1)")).toBe("");
    expect(ssrAttribute("src", "data:text/html,<script>alert(1)</script>")).toBe("");
    expect(ssrAttribute("src", "DATA:TEXT/HTML;base64,PHNjcmlwdD4=")).toBe("");
    expect(ssrAttribute("src", "data:image/png;base64,AAAA")).toBe(
      ' src="data:image/png;base64,AAAA"',
    );
  });

  it("[SSR-30] entity-looking scheme text is escaped, never decoded into a scheme", () => {
    expect(ssrAttribute("href", "&#106;avascript:alert(1)")).toBe(
      ' href="&amp;#106;avascript:alert(1)"',
    );
    expect(ssrAttribute("href", "&colon;")).toBe(' href="&amp;colon;"');
  });

  it("[SSR-31] unsafe-looking text is written to ordinary attributes", () => {
    expect(ssrAttribute("title", "javascript:alert(1)")).toBe(' title="javascript:alert(1)"');
    expect(ssrAttribute("href", "java script:alert(1)")).toBe(' href="java script:alert(1)"');
    expect(ssrAttribute("href", "/relative?x=1&y=2")).toBe(' href="/relative?x=1&amp;y=2"');
  });

  it("[SSR-32] an accessor value is called and its result used", () => {
    expect(ssrAttribute("title", () => "<x>")).toBe(' title="&lt;x&gt;"');
    expect(ssrAttribute("href", () => "javascript:alert(1)")).toBe("");
  });

  it("[SSR-33] symbol values throw a TypeError", () => {
    expect(() => ssrAttribute("title", Symbol("s"))).toThrow(TypeError);
  });

  it("[SSR-34] property: an attribute value never leaves its quotes", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const out = ssrAttribute("title", value);
        expect(out).toMatch(/^ title="[^"<>']*"$/);
        expect(out).toBe(` title="${escape(value)}"`);
      }),
      { seed: 11, numRuns: 300 },
    );
  });

  it("[SSR-35] property: no control-character disguise of javascript: gets through href", () => {
    const controls = fc.constantFrom(
      "\t",
      "\n",
      "\r",
      "\u0000",
      "\u0001",
      "\u001f",
      "\u007f",
      "\u0085",
      "\u009f",
    );
    const leading = fc.constantFrom(" ", "\t", "\n", "\u0000", "\u0001");
    const caseLetter = (letter: string) =>
      fc.constantFrom(letter.toLowerCase(), letter.toUpperCase());
    const scheme = fc
      .tuple(...["j", "a", "v", "a", "s", "c", "r", "i", "p", "t"].map(caseLetter))
      .map((letters) => letters.join(""));
    fc.assert(
      fc.property(
        fc.array(leading, { maxLength: 6 }),
        fc.array(controls, { maxLength: 6 }),
        scheme,
        (before, between, word) => {
          // Insert junk between the letters; the browser ignores tab, newline and controls there.
          const value = `${before.join("")}${word.split("").join(between.join(""))}:alert(1)`;
          expect(ssrAttribute("href", value)).toBe("");
        },
      ),
      { seed: 11, numRuns: 300 },
    );
  });
});

describe("ssrAttribute names and escaping", () => {
  it("[SSR-36] a name is validated even when the value is removed", () => {
    expect(() => ssrAttribute("a b", null)).toThrow(TypeError);
    expect(() => ssrAttribute("a b", false, true)).toThrow(TypeError);
  });
});
