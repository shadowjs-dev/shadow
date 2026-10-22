import { describe, expect, it } from "vitest";
import { cache, createRoot } from "../src/index";

describe("cache", () => {
  it("[CAC-01] within one root the same arguments call the function once", () => {
    let calls = 0;
    const load = cache((id: number) => {
      calls += 1;
      return { id };
    });
    createRoot(() => {
      const a = load(1);
      const b = load(1);
      expect(a).toBe(b);
      load(2);
    });
    expect(calls).toBe(2);
  });

  it("[CAC-02] different roots (requests) do not share results", () => {
    let calls = 0;
    const load = cache((id: number) => {
      calls += 1;
      return id;
    });
    createRoot(() => load(1));
    createRoot(() => load(1));
    expect(calls).toBe(2);
  });

  it("[CAC-03] arguments compare by identity per position", () => {
    let calls = 0;
    const key = { k: 1 };
    const load = cache((a: object, b: number) => {
      calls += 1;
      return [a, b];
    });
    createRoot(() => {
      load(key, 1);
      load(key, 1);
      load({ k: 1 }, 1);
      load(key, 2);
    });
    expect(calls).toBe(3);
  });

  it("[CAC-04] the cache is bounded: the oldest entries are evicted past the limit", () => {
    let calls = 0;
    const load = cache(
      (id: number) => {
        calls += 1;
        return id;
      },
      { limit: 2 },
    );
    createRoot(() => {
      load(1);
      load(2);
      load(3); // evicts 1
      load(2);
      expect(calls).toBe(3);
      load(1); // recomputed
    });
    expect(calls).toBe(4);
  });

  it("[CAC-05] a function that throws is not cached: the next call runs it again", () => {
    let calls = 0;
    const load = cache((id: number) => {
      calls += 1;
      if (calls === 1) throw new Error("first");
      return id;
    });
    createRoot(() => {
      expect(() => load(1)).toThrow("first");
      expect(load(1)).toBe(1);
    });
    expect(calls).toBe(2);
  });

  it("[CAC-06] outside any owner the function runs every time (nothing to scope the cache to)", () => {
    let calls = 0;
    const load = cache(() => {
      calls += 1;
      return calls;
    });
    load();
    load();
    expect(calls).toBe(2);
  });
});
