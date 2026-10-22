import { describe, expect, it } from "vitest";
import { ssrAttribute } from "../../src/server/index";

/**
 * Residual risk R-11 of the Dusk audit: an SVG animation element (`animate`, `set`) can write an `href` by
 * animation, so the `values`, `from`, `to` and `by` attributes carry URLs and get the same script-URL check as `href`.
 * The same rule runs in the browser (`svg-animation-urls.dom.test.ts`).
 */
describe("ssrAttribute: SVG animation values", () => {
  it("SEC-R11-06 javascript:, vbscript: and data:text/html are dropped from values, from, to and by, in any case", () => {
    for (const name of ["values", "from", "to", "by", "VALUES", "To"]) {
      expect(ssrAttribute(name, "javascript:alert(1)"), name).toBe("");
      expect(ssrAttribute(name, "  JaVaScRiPt:alert(1)"), name).toBe("");
      expect(ssrAttribute(name, "java\tscript:alert(1)"), name).toBe("");
      expect(ssrAttribute(name, "vbscript:msgbox(1)"), name).toBe("");
      expect(ssrAttribute(name, "data:text/html,<script>alert(1)</script>"), name).toBe("");
    }
  });

  it("SEC-R11-07 values is a ';' list: one script entry anywhere drops the whole attribute", () => {
    expect(ssrAttribute("values", "#a;javascript:alert(1)")).toBe("");
    expect(ssrAttribute("values", "#a; \tjava\nscript:alert(1) ;#b")).toBe("");
    expect(ssrAttribute("values", "javascript:alert(1);#a")).toBe("");
  });

  it("SEC-R11-08 ordinary animation values are written unchanged", () => {
    expect(ssrAttribute("values", "0;1;0")).toBe(' values="0;1;0"');
    expect(ssrAttribute("values", "#a;#b")).toBe(' values="#a;#b"');
    expect(ssrAttribute("to", "https://example.com/a")).toBe(' to="https://example.com/a"');
    expect(ssrAttribute("from", 0)).toBe(' from="0"');
    expect(ssrAttribute("by", "10")).toBe(' by="10"');
    expect(ssrAttribute("values", "see javascript: docs")).toBe(' values="see javascript: docs"');
  });

  it("SEC-R11-09 the check sees accessor values too", () => {
    expect(ssrAttribute("to", () => "javascript:alert(1)")).toBe("");
  });
});
