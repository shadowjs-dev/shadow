import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Base, Link, Meta, Style, Title } from "../../src/head/components";
import { useHead } from "../../src/head/use-head";
import { insert } from "../../src/insert";
import { resetWebWarningDedupe } from "../../src/internal/diagnostics";
import { mount } from "../support/dom";

let disposers: Array<() => void> = [];

beforeEach(() => {
  resetWebWarningDedupe();
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  flushSync();
  document.head.innerHTML = "";
});

/** Messages printed through console.warn since the last call; clears them. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => args.map(String).join(" "));
  spy.mockClear();
  return messages;
}

/** Runs `build` inside a root, flushes, and remembers the disposer for cleanup. */
function mounted(build: () => void): () => void {
  const stop = createRoot((dispose) => {
    build();
    return dispose;
  });
  flushSync();
  disposers.push(stop);
  return stop;
}

describe("head components", () => {
  it("[HDC-01] Title sets document.title from its children", () => {
    mounted(() => {
      Title({ children: "Hello" });
    });
    expect(document.title).toBe("Hello");
  });

  it("[HDC-02] reactive Title children update the same title element", () => {
    const [text, setText] = useSignal("one");
    mounted(() => {
      Title({
        get children() {
          return text();
        },
      });
    });
    const element = document.head.querySelector("title");
    setText("two");
    flushSync();
    expect(document.head.querySelector("title")).toBe(element);
    expect(document.title).toBe("two");
  });

  it("[HDC-03] Meta renders a description with its content", () => {
    mounted(() => {
      Meta({ name: "description", content: "About us" });
    });
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "About us",
    );
  });

  it("[HDC-04] reactive Meta content rewrites only the content attribute of the same element", () => {
    const [content, setContent] = useSignal("a");
    mounted(() => {
      Meta({
        name: "description",
        get content() {
          return content();
        },
      });
    });
    const element = document.head.querySelector('meta[name="description"]');
    setContent("b");
    flushSync();
    expect(document.head.querySelector('meta[name="description"]')).toBe(element);
    expect(element?.getAttribute("content")).toBe("b");
  });

  it("[HDC-05] two identical resource Links produce one link element", () => {
    mounted(() => {
      Link({ rel: "dns-prefetch", href: "//example.test" });
      Link({ rel: "dns-prefetch", href: "//example.test" });
    });
    expect(document.head.querySelectorAll('link[href="//example.test"]').length).toBe(1);
  });

  it("[HDC-06] Style renders its children as text", () => {
    mounted(() => {
      Style({ children: "p { color: red; }" });
    });
    expect(document.head.querySelector("style")?.textContent).toBe("p { color: red; }");
  });

  it("[HDC-07] Style with the same key replaces the earlier style", () => {
    mounted(() => {
      Style({ key: "theme", children: "a{}" });
      Style({ key: "theme", children: "b{}" });
    });
    const styles = document.head.querySelectorAll("style");
    expect(styles.length).toBe(1);
    expect(styles[0]?.textContent).toBe("b{}");
  });

  it("[HDC-08] Base renders a safe href", () => {
    mounted(() => {
      Base({ href: "/app/" });
    });
    expect(document.head.querySelector("base")?.getAttribute("href")).toBe("/app/");
  });

  it("[HDC-09] Base with a javascript: href writes no href and warns", () => {
    mounted(() => {
      Base({ href: "javascript:alert(1)" });
    });
    expect(document.head.querySelector("base")?.hasAttribute("href")).toBe(false);
    const messages = takeWarnings();
    expect(messages.some((message) => message.includes("UNSAFE_URL_BLOCKED"))).toBe(true);
  });

  it("[HDC-10] head components render nothing at their call site", () => {
    const host = mount();
    mounted(() => {
      insert(host, Title({ children: "x" }));
      insert(host, Meta({ name: "d", content: "x" }));
    });
    expect(host.childNodes.length).toBe(0);
  });

  it("[HDC-11] useHead accepts a getter that returns an array of tags and follows it", () => {
    const [count, setCount] = useSignal(1);
    mounted(() => {
      useHead(() =>
        Array.from({ length: count() }, (_, index) => ({
          tag: "meta" as const,
          props: { name: `m${index}`, content: "x" },
        })),
      );
    });
    expect(document.head.querySelectorAll("meta").length).toBe(1);
    setCount(3);
    flushSync();
    expect(document.head.querySelectorAll("meta").length).toBe(3);
    setCount(0);
    flushSync();
    expect(document.head.querySelectorAll("meta").length).toBe(0);
  });

  it("[HDC-12] useHead outside an owner warns and registers nothing", () => {
    useHead({ tag: "title", children: "orphan" });
    flushSync();
    const messages = takeWarnings();
    expect(messages.some((message) => message.includes("useHead"))).toBe(true);
    expect(document.title).toBe("");
  });

  it("[HDC-13] a boolean Meta prop is written as a present or absent attribute", () => {
    mounted(() => {
      Meta({ name: "robots", content: "noindex", nofollow: true, noarchive: false });
    });
    const element = document.head.querySelector('meta[name="robots"]');
    expect(element?.getAttribute("nofollow")).toBe("");
    expect(element?.hasAttribute("noarchive")).toBe(false);
  });

  it("[HDC-14] children passed to Meta are ignored and write no text", () => {
    mounted(() => {
      Meta({ name: "x", content: "y", children: "ignored" });
    });
    expect(document.head.querySelector('meta[name="x"]')?.textContent).toBe("");
  });

  it("[HDC-15] Title children that are an object throw a TypeError", () => {
    expect(() =>
      mounted(() => {
        Title({ children: { text: "no" } });
      }),
    ).toThrow(TypeError);
  });

  it("[HDC-16] Title children may be an accessor", () => {
    mounted(() => {
      Title({ children: () => "from accessor" });
    });
    expect(document.title).toBe("from accessor");
  });

  it("[HDC-17] Title children that are an array of text are joined", () => {
    mounted(() => {
      Title({ children: ["Site", " - ", 2] });
    });
    expect(document.title).toBe("Site - 2");
  });

  it("[HDC-18] Title children that nest an array throw a TypeError", () => {
    expect(() =>
      mounted(() => {
        Title({ children: [["nested"]] });
      }),
    ).toThrow(TypeError);
  });

  it("[HDC-19] unmounting the only Title removes it", () => {
    const stop = mounted(() => {
      Title({ children: "Gone" });
    });
    expect(document.title).toBe("Gone");
    stop();
    flushSync();
    expect(document.head.querySelectorAll("title").length).toBe(0);
  });

  it("[HDC-20] of two Title components the later wins, and disposing it restores the earlier", () => {
    mounted(() => {
      Title({ children: "Layout" });
    });
    const stopPage = mounted(() => {
      Title({ children: "Page" });
    });
    expect(document.title).toBe("Page");
    stopPage();
    flushSync();
    expect(document.title).toBe("Layout");
  });

  it("[HDC-21] changing a Link's rel replaces the element it produced", () => {
    const [rel, setRel] = useSignal("dns-prefetch");
    mounted(() => {
      Link({
        get rel() {
          return rel();
        },
        href: "/x.css",
      });
    });
    const before = document.head.querySelector("link");
    setRel("preconnect");
    flushSync();
    expect(before?.isConnected).toBe(false);
    expect(document.head.querySelector("link")?.getAttribute("rel")).toBe("preconnect");
  });

  it("[HDC-22] a burst of registrations in one flush creates each element once", () => {
    const spy = vi.spyOn(document, "createElement");
    mounted(() => {
      Meta({ name: "a", content: "1" });
      Meta({ name: "b", content: "2" });
      Meta({ name: "c", content: "3" });
      Title({ children: "burst" });
    });
    expect(spy).toHaveBeenCalledTimes(4);
    expect(document.head.querySelectorAll("meta").length).toBe(3);
  });

  it("[HDC-23] a hostile Meta attribute name throws a TypeError", () => {
    expect(() =>
      mounted(() => {
        Meta({ "na me": "x", content: "y" });
      }),
    ).toThrow(TypeError);
  });
});
