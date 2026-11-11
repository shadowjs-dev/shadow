import { describe, expect, it } from "vitest";
import { renderToString } from "../src/server";
import { load } from "./support/compile";

const SOURCE = `
export const Static = () => <a href="javascript:alert(1)">bad</a>;
export const Spaced = () => <a href=" JaVaScRiPt:alert(1)">bad</a>;
export const Frame = () => <iframe src="data:text/html,<script>alert(1)</script>"></iframe>;
export const Safe = () => <a href="https://example.com/?next=javascript:x" title="javascript: is a language">ok</a>;
`;

interface Module {
  readonly Static: () => unknown;
  readonly Spaced: () => unknown;
  readonly Frame: () => unknown;
  readonly Safe: () => unknown;
}

describe("a literal script URL compiled for the server", () => {
  it("[URL-SSR-01] a static javascript: href is not written to the markup, in any case or spacing", async () => {
    const ssr = await load<Module>(SOURCE, "ssr");
    const plain = renderToString(() => ssr.Static());
    expect(plain).toContain("<a");
    expect(plain).toContain("bad");
    expect(plain.toLowerCase()).not.toContain("javascript:");
    expect(plain).not.toContain("href");
    const spaced = renderToString(() => ssr.Spaced());
    expect(spaced.toLowerCase()).not.toContain("javascript:");
    expect(spaced).not.toContain("href");
  });

  it("[URL-SSR-02] a static data:text/html source is not written either", async () => {
    const ssr = await load<Module>(SOURCE, "ssr");
    const html = renderToString(() => ssr.Frame());
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("src=");
  });

  it("[URL-SSR-03] a safe link and a non-URL attribute that mention the scheme are kept", async () => {
    const ssr = await load<Module>(SOURCE, "ssr");
    const html = renderToString(() => ssr.Safe());
    expect(html).toContain('href="https://example.com/?next=javascript:x"');
    expect(html).toContain('title="javascript: is a language"');
  });
});
