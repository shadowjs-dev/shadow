import { describe, expect, it } from "vitest";
import { ClientOnly } from "../../src/control-flow/index";
import { createComponent, renderToString } from "../../src/server/index";

describe("ClientOnly on the server", () => {
  it("[CLO-02] renders the fallback and never the children", () => {
    let built = false;
    const html = renderToString(() =>
      createComponent(ClientOnly, {
        fallback: "fallback",
        get children() {
          built = true;
          return "secret";
        },
      }),
    );
    expect(html).toBe("fallback");
    expect(built).toBe(false);
  });
});
