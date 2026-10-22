import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it } from "vitest";
import { useHead } from "../src/head/index";
import { createServerHead } from "../src/server/index";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("head adoption", () => {
  it("[HAD-01] the browser adopts the server's head elements instead of adding duplicates, then updates them", () => {
    // The server's markup, produced by the real collector.
    const server = createServerHead();
    server.add([
      { tag: "title", attributes: [], text: "Server", key: undefined, identity: "5:title" },
      {
        tag: "meta",
        attributes: [
          ["name", "description"],
          ["content", "from server"],
        ],
        text: undefined,
        key: undefined,
        identity: "4:meta11:description0:",
      },
    ]);
    document.head.innerHTML = server.html();
    const title = document.head.querySelector("title");
    const meta = document.head.querySelector("meta");
    expect(title?.hasAttribute("data-shadow-head")).toBe(true);

    const [text, setText] = useSignal("Server");
    createRoot(() => {
      useHead(() => [
        { tag: "title", children: text() },
        { tag: "meta", props: { name: "description", content: "from server" } },
      ]);
    });
    flushSync();
    expect(document.head.querySelectorAll("title")).toHaveLength(1);
    expect(document.head.querySelectorAll("meta")).toHaveLength(1);
    expect(document.head.querySelector("title")).toBe(title);
    expect(document.head.querySelector("meta")).toBe(meta);

    flushSync(() => setText("Client"));
    expect(document.title).toBe("Client");
    expect(document.head.querySelector("title")).toBe(title);
  });
});
