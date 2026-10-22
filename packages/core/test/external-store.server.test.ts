import { describe, expect, it } from "vitest";
import { createRoot, useExternalStore } from "../src/index";

describe("useExternalStore on the server", () => {
  it("[EXT-04] renders getServerSnapshot() and never subscribes", () => {
    let subscribed = 0;
    createRoot(() => {
      const value = useExternalStore(
        () => {
          subscribed += 1;
          return () => undefined;
        },
        () => 7,
        { getServerSnapshot: () => 99 },
      );
      expect(value()).toBe(99);
    });
    expect(subscribed).toBe(0);
  });

  it("[EXT-09] without getServerSnapshot the server reads getSnapshot once", () => {
    let reads = 0;
    createRoot(() => {
      const value = useExternalStore(
        () => () => undefined,
        () => {
          reads += 1;
          return 3;
        },
      );
      expect(value()).toBe(3);
      expect(value()).toBe(3);
    });
    expect(reads).toBe(1);
  });
});
