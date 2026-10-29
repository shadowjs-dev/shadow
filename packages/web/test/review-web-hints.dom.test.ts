import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { preinit, preinitModule } from "../src/index";
import { quietFileLoading } from "./support/dom";

let restoreLoading: () => void = () => undefined;

beforeAll(() => {
  restoreLoading = quietFileLoading();
});

afterAll(() => {
  restoreLoading();
});

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("review round: resource hints", () => {
  it("[WEB-REV-7] preinit does not load a script the page already has, wherever it sits and however it is flagged", () => {
    document.head.innerHTML = '<script src="/head.js" defer></script>';
    document.body.innerHTML = '<script src="/body.js"></script>';
    preinit("/head.js", { as: "script" });
    preinit("/body.js", { as: "script" });
    expect(Array.from(document.querySelectorAll("script"), (s) => s.getAttribute("src"))).toEqual([
      "/head.js",
      "/body.js",
    ]);
  });

  it("[WEB-REV-7] a module script and a classic script of one URL are different loads", () => {
    document.body.innerHTML = '<script src="/same.js"></script>';
    preinitModule("/same.js");
    preinitModule("/same.js");
    expect(document.querySelectorAll('script[type="module"]')).toHaveLength(1);
    expect(document.querySelectorAll("script")).toHaveLength(2);
  });
});
