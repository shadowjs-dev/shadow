import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
} from "../../src/index";
import { quietFileLoading } from "../support/dom";

let restoreLoading: () => void = () => undefined;

beforeAll(() => {
  restoreLoading = quietFileLoading();
});

afterAll(() => {
  restoreLoading();
});

afterEach(() => {
  document.head.innerHTML = "";
});

function headLinks(selector: string): Element[] {
  return [...document.head.querySelectorAll(selector)];
}

describe("resource hints (React DOM preconnect/prefetchDNS/preload/preinit parity)", () => {
  it("[HNT-01] preconnect adds one <link rel=preconnect> per origin, however often it is called", () => {
    preconnect("https://cdn.example.com");
    preconnect("https://cdn.example.com");
    const links = headLinks('link[rel="preconnect"]');
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://cdn.example.com"]);
  });

  it("[HNT-02] preconnect with crossOrigin sets the crossorigin attribute", () => {
    preconnect("https://fonts.example.com", { crossOrigin: "anonymous" });
    const link = headLinks('link[rel="preconnect"]')[0];
    expect(link?.getAttribute("crossorigin")).toBe("anonymous");
  });

  it("[HNT-03] prefetchDNS adds <link rel=dns-prefetch>", () => {
    prefetchDNS("https://api.example.com");
    expect(headLinks('link[rel="dns-prefetch"]')).toHaveLength(1);
  });

  it("[HNT-04] preload(href, { as }) adds <link rel=preload as=...> and keeps distinct resources", () => {
    preload("/fonts/inter.woff2", { as: "font", crossOrigin: "anonymous" });
    preload("/fonts/inter.woff2", { as: "font", crossOrigin: "anonymous" });
    preload("/app.css", { as: "style" });
    const links = headLinks('link[rel="preload"]');
    expect(links.map((link) => [link.getAttribute("href"), link.getAttribute("as")])).toEqual([
      ["/fonts/inter.woff2", "font"],
      ["/app.css", "style"],
    ]);
  });

  it("[HNT-05] preloadModule adds <link rel=modulepreload>", () => {
    preloadModule("/chunks/editor.js");
    preloadModule("/chunks/editor.js");
    expect(headLinks('link[rel="modulepreload"]')).toHaveLength(1);
  });

  it("[HNT-06] preinit(href, { as: 'style' }) adds a stylesheet link once", () => {
    preinit("/theme.css", { as: "style" });
    preinit("/theme.css", { as: "style" });
    const links = headLinks('link[rel="stylesheet"]');
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/theme.css"]);
  });

  it("[HNT-07] preinitModule adds one module script", () => {
    preinitModule("/chunks/app.js");
    preinitModule("/chunks/app.js");
    const scripts = headLinks('script[type="module"]');
    expect(scripts.map((script) => script.getAttribute("src"))).toEqual(["/chunks/app.js"]);
  });

  it("[HNT-08] a non-http(s) URL throws a TypeError and nothing is added", () => {
    expect(() => preconnect("javascript:alert(1)")).toThrow(TypeError);
    expect(headLinks("link")).toHaveLength(0);
  });
});
