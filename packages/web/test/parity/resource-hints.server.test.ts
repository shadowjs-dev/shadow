import { describe, expect, it } from "vitest";
import { preconnect, preload } from "../../src/index";
import { createComponent, createServerHead, renderToString } from "../../src/server/index";

describe("resource hints on the server", () => {
  it("[HNT-S1] hints called while rendering are collected in the head with the adoption marker", () => {
    const head = createServerHead();
    const App = (): unknown => {
      preconnect("https://cdn.example.com");
      preload("/fonts/inter.woff2", { as: "font", crossOrigin: "anonymous" });
      return "page";
    };
    const html = renderToString(() => createComponent(App, {}), { head });
    expect(html).toBe("page");
    expect(head.html()).toBe(
      '<link data-shadow-head rel="preconnect" href="https://cdn.example.com">' +
        '<link data-shadow-head rel="preload" href="/fonts/inter.woff2" as="font" crossorigin="anonymous">',
    );
  });

  it("[HNT-S2] without a head collector a hint renders nothing and does not throw", () => {
    const html = renderToString(() => {
      preconnect("https://cdn.example.com");
      return "page";
    });
    expect(html).toBe("page");
  });
});
