import { createRoot, useEffect, useId, useMemo } from "@shadow-js/core";
import { createComponent } from "@shadow-js/web";
import { describe, expect, it } from "vitest";
import { createRootScope, withScope } from "../src/internal/hydration-scope";

/** A component that asks for two ids and records them; `noisy` adds owners the other side lacks. */
function app(ids: string[], noisy: boolean): () => unknown {
  const Leaf = (props: { name: string }): unknown => {
    if (noisy) {
      // The browser creates effects and memos the server does not.
      useEffect(() => undefined);
      useMemo(() => 1);
    }
    ids.push(`${props.name}:${useId()}`, `${props.name}:${useId()}`);
    return null;
  };
  const Parent = (): unknown => {
    if (noisy) useEffect(() => undefined);
    ids.push(`parent:${useId()}`);
    return [createComponent(Leaf, { name: "a" }), createComponent(Leaf, { name: "b" })];
  };
  return () => createComponent(Parent, {});
}

function run(noisy: boolean): string[] {
  const ids: string[] = [];
  createRoot((dispose) => {
    withScope(createRootScope("0"), () => app(ids, noisy)());
    dispose();
  });
  return ids;
}

describe("useId in components", () => {
  it("[UID-01] ids agree whether or not extra owners (effects, memos) exist around the components", () => {
    const server = run(false);
    const browser = run(true);
    expect(browser).toEqual(server);
    expect(new Set(server).size).toBe(server.length - 0);
  });

  it("[UID-02] ids are unique per call and valid CSS identifiers", () => {
    const ids = run(true).map((entry) => entry.split(":")[1] as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^s[\w-]+$/);
  });

  it("[UID-03] without a hydration scope components still get unique ids", () => {
    const ids: string[] = [];
    createRoot((dispose) => {
      app(ids, true)();
      dispose();
    });
    expect(new Set(ids.map((entry) => entry.split(":")[1])).size).toBe(ids.length);
  });
});
