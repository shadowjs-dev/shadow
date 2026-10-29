import { beforeEach, describe, expect, it, vi } from "vitest";
import { element } from "../src/element";
import { setAttribute } from "../src/index";
import { resetWebWarningDedupe } from "../src/internal/diagnostics";

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

describe("review of web, round three: srcdoc is an HTML sink", () => {
  it("[WEB-R3-3] a srcdoc value is written as it is: it is a document, not a URL", () => {
    const frame = document.createElement("iframe");
    const documentText = "<p>javascript: is a word, data:text/html too</p><script>1</script>";
    setAttribute(frame, "srcdoc", documentText);
    expect(frame.getAttribute("srcdoc")).toBe(documentText);
    setAttribute(frame, "srcdoc", "javascript:alert(1)");
    expect(frame.getAttribute("srcdoc")).toBe("javascript:alert(1)");
    takeWarnings();
  });

  it("[WEB-R3-3] a dynamic srcdoc warns once with SRCDOC_DYNAMIC and points at the sandbox attribute", () => {
    const frame = document.createElement("iframe");
    setAttribute(frame, "srcdoc", "<p>a</p>");
    setAttribute(frame, "srcdoc", "<p>b</p>");
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[shadow SRCDOC_DYNAMIC]");
    expect(warnings[0]).toContain("sandbox");
    expect(warnings[0]).toContain("innerHTML");
  });

  it("[WEB-R3-3] removing srcdoc or writing another attribute does not warn", () => {
    const frame = document.createElement("iframe");
    setAttribute(frame, "srcdoc", null);
    setAttribute(frame, "title", "x");
    expect(takeWarnings()).toEqual([]);
  });

  it("[WEB-R3-3] element() and spread writes warn too, since their values are not known at compile time", () => {
    const frame = element("iframe", { srcdoc: "<p>x</p>" });
    expect(frame instanceof HTMLIFrameElement && frame.getAttribute("srcdoc")).toBe("<p>x</p>");
    expect(takeWarnings().join("\n")).toContain("SRCDOC_DYNAMIC");
  });
});
