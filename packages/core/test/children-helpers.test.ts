import { describe, expect, it } from "vitest";
import { children, createRoot } from "../src/index";

function resolve(value: unknown) {
  let resolved: ReturnType<typeof children> | undefined;
  createRoot(() => {
    resolved = children(() => value);
  });
  if (resolved === undefined) throw new Error("children() did not run");
  return resolved;
}

describe("children helpers (React Children utilities)", () => {
  it("[CHL-01] count() counts leaves, skipping null, undefined and booleans", () => {
    expect(resolve([1, null, undefined, false, [2, 3]]).count()).toBe(3);
    expect(resolve(undefined).count()).toBe(0);
  });

  it("[CHL-02] map() returns a fresh array of the mapped leaves", () => {
    const mapped = resolve(["a", "b"]).map((leaf, index) => `${String(leaf)}${index}`);
    expect(mapped).toEqual(["a0", "b1"]);
  });

  it("[CHL-03] forEach() visits each leaf with its index", () => {
    const seen: Array<[unknown, number]> = [];
    resolve(["x", "y"]).forEach((leaf, index) => {
      seen.push([leaf, index]);
    });
    expect(seen).toEqual([
      ["x", 0],
      ["y", 1],
    ]);
  });

  it("[CHL-04] only() returns the single leaf and throws when there is not exactly one", () => {
    expect(resolve("solo").only()).toBe("solo");
    expect(() => resolve(["a", "b"]).only()).toThrow(TypeError);
    expect(() => resolve(undefined).only()).toThrow(TypeError);
  });
});
