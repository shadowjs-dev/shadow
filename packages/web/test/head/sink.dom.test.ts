import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeadRegistry, type HeadRegistry } from "../../src/head/registry";
import { createDomHeadSink } from "../../src/head/sink";
import { normalizeTag } from "../../src/head/validate";
import { resetWebWarningDedupe } from "../../src/internal/diagnostics";
import { hasComment } from "../support/dom";

let registry: HeadRegistry;
let sync: () => void;

beforeEach(() => {
  document.head.innerHTML = "";
  resetWebWarningDedupe();
  registry = createHeadRegistry(() => undefined);
  const apply = createDomHeadSink(document);
  sync = () => {
    apply(registry.winners());
  };
});

afterEach(() => {
  document.head.innerHTML = "";
});

/** Messages printed through console.warn since the last call; clears them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.map(String).join(" "));
  spy.mockClear();
  return messages;
}

/** The head's direct element children, as `tag` or `tag[name]` for readability. */
function headShape(): string[] {
  return Array.from(document.head.children, (el) => {
    const name = el.getAttribute("name");
    return name === null ? el.localName : `${el.localName}[${name}]`;
  });
}

/** Adds a description meta with the given content and returns its removal function. */
function description(content: string): () => void {
  return registry.add([normalizeTag({ tag: "meta", props: { name: "description", content } })]);
}

/** The element for a single meta description, failing the test when there is not exactly one. */
function onlyDescription(): Element {
  const found = document.head.querySelectorAll('meta[name="description"]');
  expect(found.length).toBe(1);
  const [first] = Array.from(found);
  if (first === undefined) throw new Error("expected one description meta");
  return first;
}

describe("head sink: title", () => {
  it("[HDS-01] a registered title sets document.title through one title element", () => {
    registry.add([normalizeTag({ tag: "title", children: "Page" })]);
    sync();
    expect(document.title).toBe("Page");
    expect(document.head.querySelectorAll("title").length).toBe(1);
  });

  it("[HDS-02] the title element the sink creates is marked with data-shadow-head", () => {
    registry.add([normalizeTag({ tag: "title", children: "Page" })]);
    sync();
    expect(document.head.querySelector("title")?.hasAttribute("data-shadow-head")).toBe(true);
  });

  it("[HDS-03] removing the last title restores the original document.title", () => {
    document.title = "Original";
    const remove = registry.add([normalizeTag({ tag: "title", children: "Page" })]);
    sync();
    expect(document.title).toBe("Page");
    remove();
    sync();
    expect(document.title).toBe("Original");
  });

  it("[HDS-04] with no title before, removing the last title removes the element again", () => {
    const remove = registry.add([normalizeTag({ tag: "title", children: "Page" })]);
    sync();
    remove();
    sync();
    expect(document.head.querySelectorAll("title").length).toBe(0);
  });

  it("[HDS-05] a server-rendered marked title is adopted, not duplicated", () => {
    document.head.innerHTML = '<title data-shadow-head="">Server</title>';
    const serverTitle = document.head.querySelector("title");
    registry.add([normalizeTag({ tag: "title", children: "Client" })]);
    sync();
    expect(document.head.querySelectorAll("title").length).toBe(1);
    expect(document.head.querySelector("title")).toBe(serverTitle);
    expect(document.title).toBe("Client");
  });

  it("[HDS-06] a server title is restored to its server text when the client title goes", () => {
    document.head.innerHTML = '<title data-shadow-head="">Server</title>';
    const remove = registry.add([normalizeTag({ tag: "title", children: "Client" })]);
    sync();
    remove();
    sync();
    expect(document.title).toBe("Server");
    expect(document.head.querySelectorAll("title").length).toBe(1);
  });

  it("[HDS-07] an unmarked page title is reused, then its original text is restored", () => {
    document.title = "Site";
    const foreign = document.head.querySelector("title");
    const remove = registry.add([normalizeTag({ tag: "title", children: "Page" })]);
    sync();
    expect(document.head.querySelector("title")).toBe(foreign);
    remove();
    sync();
    expect(document.head.querySelector("title")).toBe(foreign);
    expect(document.title).toBe("Site");
  });

  it("[HDS-08] changing the winning title's text updates the same element", () => {
    const first = registry.add([normalizeTag({ tag: "title", children: "A" })]);
    sync();
    const element = document.head.querySelector("title");
    first();
    registry.add([normalizeTag({ tag: "title", children: "B" })]);
    sync();
    expect(document.head.querySelector("title")).toBe(element);
    expect(document.title).toBe("B");
  });

  it("[HDS-09] title text with markup stays literal text", () => {
    registry.add([normalizeTag({ tag: "title", children: "<img src=x onerror=alert(1)>" })]);
    sync();
    expect(document.title).toBe("<img src=x onerror=alert(1)>");
    expect(document.head.querySelector("img")).toBeNull();
  });
});

describe("head sink: adoption and identity", () => {
  it("[HDS-10] a server-rendered marked meta is adopted by identity, keeping its node", () => {
    document.head.innerHTML = '<meta name="description" content="old" data-shadow-head="">';
    const serverMeta = onlyDescription();
    description("new");
    sync();
    expect(onlyDescription()).toBe(serverMeta);
    expect(serverMeta.getAttribute("content")).toBe("new");
  });

  it("[HDS-11] two registrations for one meta identity leave one element", () => {
    description("one");
    description("two");
    sync();
    expect(onlyDescription().getAttribute("content")).toBe("two");
  });

  it("[HDS-12] an unmarked foreign meta is neither adopted nor removed", () => {
    document.head.innerHTML = '<meta name="description" content="site">';
    const foreign = onlyDescriptionAllowingMany();
    description("app");
    sync();
    expect(foreign.getAttribute("content")).toBe("site");
    expect(foreign.isConnected).toBe(true);
    expect(document.head.querySelectorAll('meta[name="description"]').length).toBe(2);
  });

  it("[HDS-13] a marked element of another identity is not adopted by a different meta", () => {
    document.head.innerHTML = '<meta name="keywords" content="k" data-shadow-head="">';
    const keywords = document.head.querySelector("meta");
    description("d");
    sync();
    expect(document.head.querySelector('meta[name="keywords"]')).toBe(keywords);
    expect(headShape()).toEqual(["meta[keywords]", "meta[description]"]);
  });

  it("[HDS-14] a server-rendered keyed style is adopted by its data-shadow-key", () => {
    document.head.innerHTML = '<style data-shadow-head="" data-shadow-key="theme">a{}</style>';
    const style = document.head.querySelector("style");
    registry.add([normalizeTag({ tag: "style", key: "theme", children: "b{}" })]);
    sync();
    expect(document.head.querySelector("style")).toBe(style);
    expect(style?.textContent).toBe("b{}");
    expect(document.head.querySelectorAll("style").length).toBe(1);
  });

  it("[HDS-15] an adopted server element is removed when its registration goes away", () => {
    document.head.innerHTML = '<meta name="description" content="old" data-shadow-head="">';
    const serverMeta = onlyDescription();
    const remove = description("new");
    sync();
    remove();
    sync();
    expect(serverMeta.isConnected).toBe(false);
    expect(document.head.querySelectorAll('meta[name="description"]').length).toBe(0);
  });

  it("[HDS-16] an element of a marked identity that nobody registers is left alone", () => {
    document.head.innerHTML = '<meta name="keywords" content="k" data-shadow-head="">';
    const keywords = document.head.querySelector("meta");
    sync();
    expect(keywords?.isConnected).toBe(true);
  });
});

describe("head sink: updates and removal", () => {
  it("[HDS-17] a changed attribute is written on the same element", () => {
    const first = description("1");
    sync();
    const element = onlyDescription();
    first();
    description("2");
    sync();
    expect(onlyDescription()).toBe(element);
    expect(element.getAttribute("content")).toBe("2");
  });

  it("[HDS-18] an attribute that disappears from the registration is removed", () => {
    const first = registry.add([
      normalizeTag({ tag: "meta", props: { name: "description", content: "x", lang: "en" } }),
    ]);
    sync();
    const element = onlyDescription();
    first();
    registry.add([normalizeTag({ tag: "meta", props: { name: "description", content: "x" } })]);
    sync();
    expect(onlyDescription()).toBe(element);
    expect(element.hasAttribute("lang")).toBe(false);
  });

  it("[HDS-19] an unchanged registration sets no attributes on the next sync", () => {
    description("same");
    sync();
    const spy = vi.spyOn(Element.prototype, "setAttribute");
    sync();
    expect(spy).not.toHaveBeenCalled();
  });

  it("[HDS-20] removing the top of two same-identity registrations restores the other content", () => {
    description("1");
    const top = description("2");
    sync();
    top();
    sync();
    expect(onlyDescription().getAttribute("content")).toBe("1");
  });

  it("[HDS-21] removing one owner's element leaves the other owner's element intact", () => {
    const a = registry.add([normalizeTag({ tag: "meta", props: { name: "a", content: "1" } })]);
    registry.add([normalizeTag({ tag: "meta", props: { name: "b", content: "2" } })]);
    sync();
    const kept = document.head.querySelector('meta[name="b"]');
    a();
    sync();
    expect(document.head.querySelector('meta[name="b"]')).toBe(kept);
    expect(document.head.querySelector('meta[name="a"]')).toBeNull();
  });

  it("[HDS-22] changing an identity key replaces the element", () => {
    const first = registry.add([normalizeTag({ tag: "style", key: "a", children: "x{}" })]);
    sync();
    const old = document.head.querySelector("style");
    first();
    registry.add([normalizeTag({ tag: "style", key: "b", children: "x{}" })]);
    sync();
    expect(document.head.querySelector("style")).not.toBe(old);
    expect(old?.isConnected).toBe(false);
  });

  it("[HDS-23] an element removed by someone else is created again on the next sync", () => {
    description("back");
    sync();
    onlyDescription().remove();
    sync();
    expect(onlyDescription().getAttribute("content")).toBe("back");
  });

  it("[HDS-24] a sync with nothing registered removes everything the sink created", () => {
    const remove = description("gone");
    sync();
    remove();
    sync();
    expect(document.head.children.length).toBe(0);
  });
});

describe("head sink: markup and order", () => {
  it("[HDS-25] base is placed before the other head children", () => {
    registry.add([normalizeTag({ tag: "title", children: "T" })]);
    registry.add([normalizeTag({ tag: "base", props: { href: "/app/" } })]);
    sync();
    expect(document.head.firstElementChild?.localName).toBe("base");
  });

  it("[HDS-26] style text is kept as text: markup in it creates no elements", () => {
    const css = "a{}</style><img src=x onerror=alert(1)>";
    registry.add([normalizeTag({ tag: "style", children: css })]);
    sync();
    expect(document.head.querySelector("style")?.textContent).toBe(css);
    expect(document.head.querySelector("img")).toBeNull();
  });

  it("[HDS-27] attribute values with quotes and angle brackets are stored verbatim", () => {
    const content = 'a"b<c>&d';
    description(content);
    sync();
    expect(onlyDescription().getAttribute("content")).toBe(content);
    expect(document.head.children.length).toBe(1);
  });

  it("[HDS-28] boolean true is written as an empty attribute", () => {
    registry.add([normalizeTag({ tag: "meta", props: { name: "x", async: true } })]);
    sync();
    expect(document.head.querySelector('meta[name="x"]')?.getAttribute("async")).toBe("");
  });

  it("[HDS-29] created elements are appended in registration order", () => {
    registry.add([normalizeTag({ tag: "meta", props: { name: "a", content: "1" } })]);
    registry.add([normalizeTag({ tag: "meta", props: { name: "b", content: "2" } })]);
    registry.add([normalizeTag({ tag: "meta", props: { name: "c", content: "3" } })]);
    sync();
    expect(headShape()).toEqual(["meta[a]", "meta[b]", "meta[c]"]);
  });

  it("[HDS-30] each new tag creates exactly one element and a second sync creates none", () => {
    registry.add([
      normalizeTag({ tag: "meta", props: { name: "a", content: "1" } }),
      normalizeTag({ tag: "link", props: { rel: "dns-prefetch", href: "//example.test" } }),
      normalizeTag({ tag: "style", children: "p{}" }),
    ]);
    const spy = vi.spyOn(document, "createElement");
    sync();
    expect(spy).toHaveBeenCalledTimes(3);
    sync();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("[HDS-31] two keyless styles are both present", () => {
    registry.add([normalizeTag({ tag: "style", children: "a{}" })]);
    registry.add([normalizeTag({ tag: "style", children: "b{}" })]);
    sync();
    expect(document.head.querySelectorAll("style").length).toBe(2);
  });

  it("[HDS-32] a resource link is created with its rel and href", () => {
    registry.add([
      normalizeTag({ tag: "link", props: { rel: "dns-prefetch", href: "//example.test" } }),
    ]);
    sync();
    const link = document.head.querySelector("link");
    expect(link?.getAttribute("rel")).toBe("dns-prefetch");
    expect(link?.getAttribute("href")).toBe("//example.test");
  });

  it("[HDS-33] an og:title property meta is created with its property attribute", () => {
    registry.add([normalizeTag({ tag: "meta", props: { property: "og:title", content: "T" } })]);
    sync();
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      "T",
    );
  });

  it("[HDS-34] no comment nodes appear in the head after applying tags", () => {
    registry.add([normalizeTag({ tag: "title", children: "T" })]);
    description("d");
    sync();
    expect(hasComment(document.head)).toBe(false);
  });

  it("[HDS-35] a javascript: href never reaches the document even when registered by hand", () => {
    const tag = normalizeTag({ tag: "link", props: { rel: "canonical", href: "javascript:x" } });
    registry.add([tag]);
    sync();
    expect(document.head.querySelector("link")?.hasAttribute("href")).toBe(false);
    takeWarnings();
  });
});

/** Like onlyDescription, but tolerant of a second, foreign element. */
function onlyDescriptionAllowingMany(): Element {
  const first = document.head.querySelector('meta[name="description"]');
  if (first === null) throw new Error("expected a description meta");
  return first;
}
