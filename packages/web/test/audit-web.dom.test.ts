import { flushSync, onCleanup, useEffect, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it } from "vitest";
import { hydrate, render, style } from "../src/index";
import { ssrStyle } from "../src/server";
import { cleanupDom, mount } from "./support/dom";

afterEach(cleanupDom);

describe("style(): an array of style objects", () => {
  it("[WEB-F01] a null or false value in a later object does not erase an earlier declaration (server parity)", () => {
    const sources = [
      { color: "red", width: 1 },
      { color: null, width: false, height: 4 },
    ];
    const el = mount();
    style(el, sources);
    // The server skips a null value ("later declarations win" only for declarations that exist).
    expect(ssrStyle(sources)).toBe(' style="color:red;width:1px;height:4px"');
    expect(el.style.color).toBe("red");
    expect(el.style.width).toBe("1px");
    expect(el.style.height).toBe("4px");
  });
});

describe("render(): an effect throws while the tree is built", () => {
  it("[WEB-F02] the root is torn down and nothing stays mounted when render() throws", () => {
    const el = mount();
    const [n, setN] = useSignal(0);
    let runs = 0;
    let cleanups = 0;
    expect(() =>
      render(() => {
        useEffect(() => {
          n();
          runs += 1;
          onCleanup(() => {
            cleanups += 1;
          });
        });
        useEffect(() => {
          throw new Error("boom");
        });
        return document.createElement("p");
      }, el),
    ).toThrow("boom");
    // The caller never got a dispose function, so render() must not leave a live app behind.
    expect(el.innerHTML).toBe("");
    expect(cleanups).toBe(1);
    setN(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[WEB-F02] a throwing component body leaves nothing behind either", () => {
    const el = mount();
    expect(() =>
      render(() => {
        throw new Error("setup failed");
      }, el),
    ).toThrow("setup failed");
    expect(el.innerHTML).toBe("");
  });
});

describe("hydrate(): an effect throws during the first flush", () => {
  it("[WEB-F02] the root is disposed and the server markup stays when hydrate() throws", () => {
    const el = mount();
    el.innerHTML = "<p>server</p>";
    const server = el.firstElementChild;
    const [n, setN] = useSignal(0);
    let runs = 0;
    let cleanups = 0;
    expect(() =>
      hydrate(() => {
        useEffect(() => {
          n();
          runs += 1;
          onCleanup(() => {
            cleanups += 1;
          });
        });
        useEffect(() => {
          throw new Error("boom");
        });
        return server;
      }, el),
    ).toThrow("boom");
    expect(el.innerHTML).toBe("<p>server</p>");
    expect(cleanups).toBe(1);
    setN(1);
    flushSync();
    expect(runs).toBe(1);
  });
});
