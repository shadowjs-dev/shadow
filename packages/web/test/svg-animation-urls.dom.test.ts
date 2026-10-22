import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAttribute } from "../src/index";
import { resetWebWarningDedupe } from "../src/internal/diagnostics";
import { cleanupDom } from "./support/dom";

/**
 * Residual risk R-11 of the Dusk audit, browser side: `values`, `from`, `to` and `by` of an SVG `animate` or `set`
 * can write an `href`, so `setAttribute` applies the script-URL rule to them as it does to `href`.
 */
beforeEach(() => {
  resetWebWarningDedupe();
});

afterEach(cleanupDom);

const SVG_NS = "http://www.w3.org/2000/svg";

describe("setAttribute(): SVG animation values", () => {
  it("SEC-R11-10 a script URL in values, from, to or by of animate and set is not written, and warns", () => {
    for (const tag of ["animate", "set"]) {
      for (const name of ["values", "from", "to", "by"]) {
        resetWebWarningDedupe();
        const node = document.createElementNS(SVG_NS, tag);
        setAttribute(node, name, "  JaVaScRiPt:alert(1)");
        expect(node.hasAttribute(name), `${tag} ${name}`).toBe(false);
        const warnings = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
        expect(warnings.length, `${tag} ${name}`).toBe(1);
        expect(warnings[0]).toContain("UNSAFE_URL_BLOCKED");
        vi.mocked(console.warn).mockClear();
      }
    }
  });

  it("SEC-R11-11 one script entry in a ';' values list blocks the whole attribute; ordinary lists are written", () => {
    const node = document.createElementNS(SVG_NS, "animate");
    setAttribute(node, "values", "#a;java\nscript:alert(1)");
    expect(node.hasAttribute("values")).toBe(false);
    vi.mocked(console.warn).mockClear();
    setAttribute(node, "values", "0;1;0");
    expect(node.getAttribute("values")).toBe("0;1;0");
    setAttribute(node, "to", "https://example.com/a");
    expect(node.getAttribute("to")).toBe("https://example.com/a");
  });
});
