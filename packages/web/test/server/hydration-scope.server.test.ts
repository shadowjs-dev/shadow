import { describe, expect, it } from "vitest";
import {
  createRootScope,
  currentScope,
  enterComponent,
  nextKey,
  resourceKey,
  withScope,
} from "../../src/internal/hydration-scope";

describe("hydration scope", () => {
  it("[SSR-105] the root scope id is the render id followed by a dash", () => {
    expect(createRootScope("0").id).toBe("0-");
    expect(createRootScope().id).toBe("0-");
    expect(createRootScope("abc").id).toBe("abc-");
  });

  it("[SSR-106] nextKey returns undefined outside a scope and counts inside one", () => {
    expect(nextKey()).toBeUndefined();
    withScope(createRootScope("0"), () => {
      expect(nextKey()).toBe("0-0");
      expect(nextKey()).toBe("0-1");
    });
  });

  it("[SSR-107] enterComponent gives each call its own id and restores the parent", () => {
    const ids: string[] = [];
    withScope(createRootScope("0"), () => {
      enterComponent(() => {
        ids.push(currentScope()?.id ?? "none");
        nextKey();
      });
      enterComponent(() => {
        ids.push(currentScope()?.id ?? "none");
        enterComponent(() => {
          ids.push(currentScope()?.id ?? "none");
        });
      });
      expect(currentScope()?.count).toBe(2);
    });
    expect(ids).toEqual(["0-0-", "0-1-", "0-1-0-"]);
  });

  it("[SSR-108] withScope restores the previous scope even when the body throws", () => {
    const root = createRootScope("0");
    expect(() =>
      withScope(root, () => {
        throw new Error("inner");
      }),
    ).toThrow("inner");
    expect(currentScope()).toBeNull();
  });

  it("[SSR-109] resourceKey prefixes the explicit key, else the scope id, r and a counter", () => {
    expect(resourceKey("user")).toBe("k:user");
    expect(resourceKey(undefined)).toBe("r");
    withScope(createRootScope("0"), () => {
      expect(resourceKey(undefined)).toBe("0-r0");
      expect(resourceKey(undefined)).toBe("0-r1");
      enterComponent(() => {
        expect(resourceKey(undefined)).toBe("0-0-r0");
      });
    });
  });
});
