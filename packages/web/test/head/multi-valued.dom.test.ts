import { describe, expect, it } from "vitest";
import { createHeadRegistry } from "../../src/head/registry";
import { normalizeTags } from "../../src/head/validate";

/**
 * Properties that repeat by design keep every value in the registry (one tag per image, per tag, per locale and
 * per alternate link); a single-valued property stays last-wins, and a canonical link stays append-only.
 */
function winnersOf(tags: unknown[]): string[] {
  const registry = createHeadRegistry(() => undefined);
  registry.add(normalizeTags(tags));
  return registry.winners().map((winner) => {
    const content = winner.tag.attributes.find(([name]) => name === "content")?.[1];
    const key = winner.tag.attributes.find(
      ([name]) => name === "property" || name === "name" || name === "rel",
    )?.[1];
    return `${key ?? winner.tag.tag}=${content ?? ""}`;
  });
}

describe("head registry: repeated properties", () => {
  it("[HDR-30] several og:image values all stay (their identity includes the content)", () => {
    const winners = winnersOf([
      { tag: "meta", props: { property: "og:image", content: "/a.png" } },
      { tag: "meta", props: { property: "og:image", content: "/b.png" } },
    ]);
    expect(winners).toEqual(["og:image=/a.png", "og:image=/b.png"]);
  });

  it("[HDR-31] article:tag and twitter:image repeat; the same value twice is one tag", () => {
    const winners = winnersOf([
      { tag: "meta", props: { property: "article:tag", content: "x" } },
      { tag: "meta", props: { property: "article:tag", content: "y" } },
      { tag: "meta", props: { property: "article:tag", content: "x" } },
      { tag: "meta", props: { name: "twitter:image", content: "/t.png" } },
    ]);
    expect(winners).toEqual(["article:tag=x", "article:tag=y", "twitter:image=/t.png"]);
  });

  it("[HDR-32] a single-valued property is still last-wins (og:title)", () => {
    const winners = winnersOf([
      { tag: "meta", props: { property: "og:title", content: "one" } },
      { tag: "meta", props: { property: "og:title", content: "two" } },
    ]);
    expect(winners).toEqual(["og:title=two"]);
  });

  it("[HDR-33] alternate links keep one tag per language; the same language and href is one tag", () => {
    const winners = winnersOf([
      { tag: "link", props: { rel: "alternate", hreflang: "en", href: "https://a.example/en" } },
      { tag: "link", props: { rel: "alternate", hreflang: "ar", href: "https://a.example/ar" } },
      { tag: "link", props: { rel: "alternate", hreflang: "en", href: "https://a.example/en" } },
    ]);
    expect(winners).toHaveLength(2);
  });
});
