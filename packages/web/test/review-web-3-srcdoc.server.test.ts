import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetWebWarningDedupe } from "../src/internal/diagnostics";
import { ssrAttribute, ssrElement } from "../src/server/index";

beforeEach(() => {
  resetWebWarningDedupe();
});

/** The warnings printed since the last call, taken out of the spy so the test setup does not fail on them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.join(" "));
  spy.mockClear();
  return messages;
}

describe("review of web, round three: srcdoc on the server", () => {
  it("[WEB-R3-3] ssrAttribute writes srcdoc escaped but unfiltered, and warns once with SRCDOC_DYNAMIC", () => {
    expect(ssrAttribute("srcdoc", "<p>javascript:x</p>")).toBe(
      ' srcdoc="&lt;p&gt;javascript:x&lt;/p&gt;"',
    );
    expect(ssrAttribute("SRCDOC", "javascript:alert(1)")).toBe(' SRCDOC="javascript:alert(1)"');
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[shadow SRCDOC_DYNAMIC]");
    expect(warnings[0]).toContain("sandbox");
  });

  it("[WEB-R3-3] ssrElement writes srcdoc from props the same way", () => {
    const html = String(
      (ssrElement("iframe", { srcdoc: "<b>x</b>" }, undefined, false) as { t: string }).t,
    );
    expect(html).toContain('srcdoc="&lt;b&gt;x&lt;/b&gt;"');
    expect(takeWarnings().join("\n")).toContain("SRCDOC_DYNAMIC");
  });

  it("[WEB-R3-3] a removed srcdoc does not warn", () => {
    expect(ssrAttribute("srcdoc", null)).toBe("");
    expect(takeWarnings()).toEqual([]);
  });
});
