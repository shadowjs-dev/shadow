import { describe, expect, it, vi } from "vitest";
import { renderToStream, renderToStringAsync, ssrElement } from "../../src/server/index";

/** The delays every `setTimeout` call asked for while `run` ran. */
async function delaysOf(run: () => Promise<unknown>): Promise<unknown[]> {
  const spy = vi.spyOn(globalThis, "setTimeout");
  try {
    await run();
    return spy.mock.calls.map((call) => call[1]);
  } finally {
    spy.mockRestore();
  }
}

describe("review round: web server renderer", () => {
  it("[WEB-REV-5] hidden=until-found is written as the keyword, as the client writes it", () => {
    expect(ssrElement("div", { hidden: "until-found" }).t).toBe('<div hidden="until-found"></div>');
    expect(ssrElement("div", { hidden: true }).t).toBe("<div hidden></div>");
    expect(ssrElement("div", { hidden: false }).t).toBe("<div></div>");
    expect(ssrElement("div", { "bool:hidden": "until-found" }).t).toBe("<div hidden></div>");
  });

  it("[WEB-REV-6] a time budget beyond the timer range is clamped, not fired after one millisecond", async () => {
    const limit = 2_147_483_647;
    const async = await delaysOf(() =>
      renderToStringAsync(() => "x", { timeoutMs: Number.MAX_SAFE_INTEGER }),
    );
    expect(async).toEqual([limit]);
    const streamed = await delaysOf(async () => {
      const reader = renderToStream(() => "x", { timeoutMs: Number.MAX_SAFE_INTEGER }).getReader();
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read());
    });
    expect(streamed).toEqual([limit]);
  });
});

describe("review round: textarea children", () => {
  it("[WEB-REV-10] a textarea given its text as children keeps a leading line break, as its value does", () => {
    expect(ssrElement("textarea", { children: "\nabc" }).t).toBe("<textarea>\n\nabc</textarea>");
    expect(ssrElement("textarea", { value: "\nabc" }).t).toBe("<textarea>\n\nabc</textarea>");
    expect(ssrElement("textarea", { children: "abc" }).t).toBe("<textarea>abc</textarea>");
  });
});
