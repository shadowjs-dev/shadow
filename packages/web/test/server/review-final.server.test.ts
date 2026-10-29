import { describe, expect, it } from "vitest";
import { ssrRawText } from "../../src/server/index";

describe("review final: server raw text", () => {
  it("[REVIEW-FINAL-1] a JSON script keeps parsing when its data holds `<!--` or `</script`", () => {
    const data = { bio: "<!-- hi", close: "</script><b>", ok: "a < b" };
    const text = ssrRawText("script", JSON.stringify(data)).t;
    expect(text).not.toContain("<!--");
    expect(text.toLowerCase()).not.toContain("</script");
    // The page parses the text of the element: it must still be the same JSON.
    expect(JSON.parse(text)).toEqual(data);
  });
});
