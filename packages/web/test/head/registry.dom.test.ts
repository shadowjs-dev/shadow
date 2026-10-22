import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHeadRegistry, type HeadRegistry } from "../../src/head/registry";
import { type NormalizedTag, normalizeTag } from "../../src/head/validate";
import { resetWebWarningDedupe } from "../../src/internal/diagnostics";

let registry: HeadRegistry;
let changes: number;

beforeEach(() => {
  changes = 0;
  registry = createHeadRegistry(() => {
    changes += 1;
  });
  resetWebWarningDedupe();
});

/** Messages printed through console.warn since the last call; clears them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.map(String).join(" "));
  spy.mockClear();
  return messages;
}

/** Winners as short strings: `tag|text|name=value,...`, in order. */
function summary(): string[] {
  return registry.winners().map(({ tag }) => `${tag.tag}|${tag.text ?? ""}|${attributesOf(tag)}`);
}

function attributesOf(tag: NormalizedTag): string {
  return tag.attributes.map(([name, value]) => `${name}=${value}`).join(",");
}

function title(text: string): NormalizedTag {
  return normalizeTag({ tag: "title", children: text });
}

function meta(props: Record<string, unknown>): NormalizedTag {
  return normalizeTag({ tag: "meta", props });
}

function link(props: Record<string, unknown>): NormalizedTag {
  return normalizeTag({ tag: "link", props });
}

describe("head registry: identity and precedence", () => {
  it("[HDR-01] an empty registry has no winners", () => {
    expect(registry.winners()).toEqual([]);
  });

  it("[HDR-02] a single title is the winner", () => {
    registry.add([title("Home")]);
    expect(summary()).toEqual(["title|Home|"]);
  });

  it("[HDR-03] the last registered title wins over an earlier one", () => {
    registry.add([title("Layout")]);
    registry.add([title("Page")]);
    expect(summary()).toEqual(["title|Page|"]);
  });

  it("[HDR-04] removing the winning title restores the previous one", () => {
    registry.add([title("Layout")]);
    const remove = registry.add([title("Page")]);
    remove();
    expect(summary()).toEqual(["title|Layout|"]);
  });

  it("[HDR-05] removing a middle registration keeps the current winner", () => {
    registry.add([title("A")]);
    const middle = registry.add([title("B")]);
    registry.add([title("C")]);
    middle();
    expect(summary()).toEqual(["title|C|"]);
  });

  it("[HDR-06] removing the same registration twice changes nothing the second time", () => {
    registry.add([title("A")]);
    const remove = registry.add([title("B")]);
    remove();
    const after = changes;
    remove();
    expect(changes).toBe(after);
    expect(summary()).toEqual(["title|A|"]);
  });

  it("[HDR-07] removing every registration leaves no winners", () => {
    const first = registry.add([title("A")]);
    const second = registry.add([title("B")]);
    first();
    second();
    expect(registry.winners()).toEqual([]);
  });

  it("[HDR-08] two description metas share one identity and the later one wins", () => {
    registry.add([meta({ name: "description", content: "old" })]);
    registry.add([meta({ name: "description", content: "new" })]);
    expect(summary()).toEqual(["meta||name=description,content=new"]);
  });

  it("[HDR-09] keywords and description metas are independent identities", () => {
    registry.add([meta({ name: "description", content: "d" })]);
    registry.add([meta({ name: "keywords", content: "k" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-10] a property meta and a name meta with the same value do not collide", () => {
    registry.add([meta({ name: "title", content: "n" })]);
    registry.add([meta({ property: "title", content: "p" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-11] metas with the same name but different media are both kept", () => {
    registry.add([
      meta({ name: "theme-color", content: "a", media: "(prefers-color-scheme: dark)" }),
    ]);
    registry.add([
      meta({ name: "theme-color", content: "b", media: "(prefers-color-scheme: light)" }),
    ]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-12] http-equiv metas are a separate identity from a name with the same value", () => {
    registry.add([meta({ "http-equiv": "content-language", content: "en" })]);
    registry.add([meta({ name: "content-language", content: "fr" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-13] charset is a singleton: a later charset wins", () => {
    registry.add([meta({ charset: "utf-8" })]);
    registry.add([meta({ charset: "latin1" })]);
    expect(summary()).toEqual(["meta||charset=latin1"]);
  });

  it("[HDR-14] a meta without an identity field is append-only and both stay", () => {
    registry.add([meta({ content: "one" })]);
    registry.add([meta({ content: "two" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-15] icons with the same rel, sizes and type replace each other", () => {
    registry.add([link({ rel: "icon", href: "/a.png", sizes: "32x32", type: "image/png" })]);
    registry.add([link({ rel: "icon", href: "/b.png", sizes: "32x32", type: "image/png" })]);
    expect(summary()).toEqual(["link||rel=icon,href=/b.png,sizes=32x32,type=image/png"]);
  });

  it("[HDR-16] icons with different sizes are both kept", () => {
    registry.add([link({ rel: "icon", href: "/a.png", sizes: "16x16" })]);
    registry.add([link({ rel: "icon", href: "/b.png", sizes: "32x32" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-17] apple-touch-icon counts as an icon for identity", () => {
    registry.add([link({ rel: "apple-touch-icon", href: "/a.png" })]);
    registry.add([link({ rel: "apple-touch-icon", href: "/b.png" })]);
    expect(registry.winners()).toHaveLength(1);
  });

  it("[HDR-18] two preloads with the same href and as share one identity", () => {
    registry.add([link({ rel: "preload", href: "/f.woff2", as: "font" })]);
    registry.add([link({ rel: "preload", href: "/f.woff2", as: "font", crossorigin: "" })]);
    expect(registry.winners()).toHaveLength(1);
  });

  it("[HDR-19] a preload with the same href but another as is a different identity", () => {
    registry.add([link({ rel: "preload", href: "/x", as: "script" })]);
    registry.add([link({ rel: "preload", href: "/x", as: "style" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-20] two stylesheet links to one href leave one winner", () => {
    registry.add([link({ rel: "stylesheet", href: "/site.css" })]);
    registry.add([link({ rel: "stylesheet", href: "/site.css" })]);
    expect(registry.winners()).toHaveLength(1);
  });

  it("[HDR-21] a canonical link is a singleton: a second canonical replaces the first (HTML allows one)", () => {
    registry.add([link({ rel: "canonical", href: "https://a.example/" })]);
    registry.add([link({ rel: "canonical", href: "https://b.example/" })]);
    expect(registry.winners()).toHaveLength(1);
    expect(summary()).toEqual(["link||rel=canonical,href=https://b.example/"]);
  });

  it("[HDR-22] rel is compared ignoring case and extra white space", () => {
    registry.add([link({ rel: "  ICON ", href: "/a.png" })]);
    registry.add([link({ rel: "icon", href: "/b.png" })]);
    expect(registry.winners()).toHaveLength(1);
  });

  it("[HDR-23] styles without a key are append-only", () => {
    registry.add([normalizeTag({ tag: "style", children: "a{}" })]);
    registry.add([normalizeTag({ tag: "style", children: "b{}" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-24] styles with one key replace each other, different keys stay", () => {
    registry.add([normalizeTag({ tag: "style", key: "theme", children: "a{}" })]);
    registry.add([normalizeTag({ tag: "style", key: "theme", children: "b{}" })]);
    registry.add([normalizeTag({ tag: "style", key: "other", children: "c{}" })]);
    expect(summary()).toEqual(["style|b{}|", "style|c{}|"]);
  });

  it("[HDR-25] base is a singleton: the later base wins", () => {
    registry.add([normalizeTag({ tag: "base", props: { href: "/one/" } })]);
    registry.add([normalizeTag({ tag: "base", props: { href: "/two/" } })]);
    expect(summary()).toEqual(["base||href=/two/"]);
  });

  it("[HDR-26] winners keep the order in which their identities first appeared", () => {
    registry.add([title("T")]);
    registry.add([meta({ name: "description", content: "d" })]);
    registry.add([title("T2")]);
    expect(registry.winners().map(({ tag }) => tag.tag)).toEqual(["title", "meta"]);
  });

  it("[HDR-27] a registration made after a removal takes precedence again", () => {
    const first = registry.add([title("A")]);
    first();
    registry.add([title("B")]);
    expect(summary()).toEqual(["title|B|"]);
  });

  it("[HDR-28] a deep stack of 500 same-identity registrations unwinds in reverse order", () => {
    const removers: Array<() => void> = [];
    for (let index = 0; index < 500; index += 1) {
      removers.push(registry.add([title(`t${index}`)]));
    }
    for (let index = 499; index >= 1; index -= 1) {
      removers[index]?.();
      expect(summary()).toEqual([`title|t${index - 1}|`]);
    }
  });

  it("[HDR-29] removing the middle of a deep stack leaves the top in place", () => {
    const removers: Array<() => void> = [];
    for (let index = 0; index < 200; index += 1) {
      removers.push(registry.add([title(`t${index}`)]));
    }
    removers[100]?.();
    expect(summary()).toEqual(["title|t199|"]);
  });

  it("[HDR-30] onChange fires once per registration and once per effective removal", () => {
    const remove = registry.add([title("A")]);
    expect(changes).toBe(1);
    remove();
    expect(changes).toBe(2);
  });

  it("[HDR-31] an empty group registers nothing and does not notify", () => {
    const remove = registry.add([]);
    remove();
    expect(changes).toBe(0);
    expect(registry.winners()).toEqual([]);
  });

  it("[HDR-32] within one group the later of two titles wins", () => {
    registry.add([title("first"), title("second")]);
    expect(summary()).toEqual(["title|second|"]);
  });

  it("[HDR-33] duplicate identical registrations: removing the top restores the other", () => {
    registry.add([title("same")]);
    const top = registry.add([title("same")]);
    top();
    expect(summary()).toEqual(["title|same|"]);
    expect(changes).toBe(3);
  });

  it("[HDR-34] identities built from separator-like text do not collide", () => {
    registry.add([meta({ name: "a|b", content: "1" })]);
    registry.add([meta({ name: "a", media: "b", content: "2" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-35] a meta name containing the framing digits does not collide with another name", () => {
    registry.add([meta({ name: "3:abc", content: "1" })]);
    registry.add([meta({ name: "abc", content: "2" })]);
    expect(registry.winners()).toHaveLength(2);
  });

  it("[HDR-36] attribute names are compared in lower case", () => {
    registry.add([meta({ NAME: "description", content: "old" })]);
    registry.add([meta({ name: "description", content: "new" })]);
    expect(registry.winners()).toHaveLength(1);
  });

  it("[HDR-37] the registry never writes to document.head", () => {
    const spy = vi.spyOn(document.head, "appendChild");
    registry.add([title("A"), meta({ name: "d", content: "x" })]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("head registry: hostile input", () => {
  it("[HDR-38] an attribute name with a space is refused", () => {
    expect(() => meta({ "data x": "1" })).toThrow(TypeError);
  });

  it("[HDR-39] an attribute name with a quote is refused", () => {
    expect(() => meta({ 'na"me': "1" })).toThrow(TypeError);
  });

  it("[HDR-40] an attribute name that starts with a digit or colon is refused", () => {
    expect(() => meta({ "1x": "a" })).toThrow(TypeError);
    expect(() => meta({ ":x": "a" })).toThrow(TypeError);
  });

  it("[HDR-41] event-handler attributes such as onload are refused", () => {
    expect(() => meta({ onload: "alert(1)" })).toThrow(TypeError);
    expect(() => meta({ OnError: "x" })).toThrow(TypeError);
  });

  it("[HDR-42] the reserved marker attributes cannot be supplied by the caller", () => {
    expect(() => meta({ "data-shadow-head": "" })).toThrow(TypeError);
    expect(() => meta({ "data-shadow-key": "k" })).toThrow(TypeError);
  });

  it("[HDR-43] script is refused as a head tag", () => {
    expect(() => normalizeTag({ tag: "script", children: "alert(1)" })).toThrow(TypeError);
  });

  it("[HDR-44] noscript and iframe are refused as head tags", () => {
    expect(() => normalizeTag({ tag: "noscript" })).toThrow(TypeError);
    expect(() => normalizeTag({ tag: "iframe" })).toThrow(TypeError);
  });

  it("[HDR-45] children on a void tag such as meta are refused", () => {
    expect(() => normalizeTag({ tag: "meta", props: { name: "d" }, children: "x" })).toThrow(
      TypeError,
    );
  });

  it("[HDR-46] a key on a tag other than style is refused", () => {
    expect(() => normalizeTag({ tag: "meta", key: "k", props: { name: "d" } })).toThrow(TypeError);
  });

  it("[HDR-47] a non-object tag description is refused", () => {
    expect(() => normalizeTag("title")).toThrow(TypeError);
    expect(() => normalizeTag(null)).toThrow(TypeError);
  });

  it("[HDR-48] a javascript: href is dropped and a warning is printed", () => {
    const tag = normalizeTag({
      tag: "link",
      props: { rel: "canonical", href: "javascript:alert(1)" },
    });
    expect(attributesOf(tag)).toBe("rel=canonical");
    const messages = takeWarnings();
    expect(messages.some((message) => message.includes("UNSAFE_URL_BLOCKED"))).toBe(true);
  });

  it("[HDR-49] a data:text/html base href is dropped with a warning", () => {
    const tag = normalizeTag({ tag: "base", props: { href: "data:text/html,<b>x" } });
    expect(attributesOf(tag)).toBe("");
    takeWarnings();
  });

  it("[HDR-50] a control-character disguised javascript: href is dropped", () => {
    const tag = normalizeTag({
      tag: "link",
      props: { rel: "canonical", href: "\u0001 JaVaScRiPt:x" },
    });
    expect(tag.attributes.some(([name]) => name === "href")).toBe(false);
    takeWarnings();
  });

  it("[HDR-51] an https href is kept", () => {
    const tag = normalizeTag({
      tag: "link",
      props: { rel: "canonical", href: "https://a.example/" },
    });
    expect(attributesOf(tag)).toBe("rel=canonical,href=https://a.example/");
  });

  it("[HDR-52] true is an empty attribute, false and undefined are omitted, numbers are text", () => {
    const tag = normalizeTag({
      tag: "meta",
      props: { async: true, defer: false, media: undefined, content: 5, name: "n" },
    });
    expect(attributesOf(tag)).toBe("async=,content=5,name=n");
  });

  it("[HDR-53] an object as an attribute value is refused", () => {
    expect(() => meta({ content: { toString: () => "x" } })).toThrow(TypeError);
  });

  it("[HDR-54] title text containing markup is kept as literal text", () => {
    const tag = title("<img src=x onerror=alert(1)>");
    expect(tag.text).toBe("<img src=x onerror=alert(1)>");
  });
});
