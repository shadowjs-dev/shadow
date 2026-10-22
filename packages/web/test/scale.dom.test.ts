import { flushSync } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { emitApp, type GenConfig, generateSpec, oracle, prng } from "./support/app-gen";

interface State {
  S: {
    setS: Array<(v: number) => unknown>;
    setL: Array<(v: number[]) => unknown>;
  };
}

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});
function comments(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let n = 0;
  while (walker.nextNode()) n += 1;
  return n;
}

async function run(
  seed: number,
  config: GenConfig,
  steps: number,
): Promise<{ files: number; nodes: number }> {
  const spec = generateSpec(seed, config);
  const dir = `${import.meta.dirname}/.generated/app-${seed}-${config.components}`;
  const emitted = emitApp(spec, dir);
  const state = (await import(/* @vite-ignore */ emitted.stateFile)) as State;
  const rootModule = (await import(/* @vite-ignore */ emitted.rootFile)) as { Root: () => unknown };
  const rnd = prng(seed ^ 0x9e3779b9);
  const int = (n: number): number => Math.floor(rnd() * n);

  const s = Array.from({ length: spec.signals }, () => 0);
  const l: number[][] = Array.from({ length: spec.lists }, () => []);
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const dispose = render(() => rootModule.Root(), host);
  const check = (label: string): void => {
    const expected = oracle(spec, { s, l });
    if (host.innerHTML !== expected) {
      // Show the first divergence precisely rather than two huge strings.
      let at = 0;
      while (at < expected.length && host.innerHTML[at] === expected[at]) at += 1;
      throw new Error(
        `seed ${seed} ${label}: DOM differs from oracle at ${at}\n  dom:    …${host.innerHTML.slice(Math.max(0, at - 60), at + 80)}\n  oracle: …${expected.slice(Math.max(0, at - 60), at + 80)}`,
      );
    }
  };
  check("initial");
  for (let step = 0; step < steps; step += 1) {
    const writes = 1 + int(4);
    for (let w = 0; w < writes; w += 1) {
      if (spec.lists > 0 && rnd() < 0.35) {
        const id = int(spec.lists);
        const next = Array.from({ length: int(7) }, () => int(4));
        l[id] = next;
        state.S.setL[id]?.(next);
      } else {
        const id = int(spec.signals);
        const next = int(6);
        s[id] = next;
        state.S.setS[id]?.(next);
      }
    }
    flushSync();
    check(`step ${step}`);
  }
  expect(comments(host)).toBe(0);
  const nodes = host.querySelectorAll("*").length;
  dispose();
  expect(host.innerHTML).toBe("");
  return { files: emitted.files, nodes };
}

describe("scale: generated multi-file apps match an independent oracle", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`[SCL-${String(seed).padStart(2, "0")}] 60 components, seed ${seed}`, async () => {
      const result = await run(
        seed,
        { components: 60, signals: 6, lists: 3, depth: 4, width: 3 },
        40,
      );
      expect(result.files).toBe(62);
    });
  }

  it("[SCL-07] 400 components across 402 files, deep component nesting", async () => {
    const result = await run(77, { components: 400, signals: 8, lists: 4, depth: 3, width: 2 }, 25);
    expect(result.files).toBe(402);
  }, 120_000);

  it("[SCL-08] wide and shallow: 150 components, width 5", async () => {
    await run(88, { components: 150, signals: 10, lists: 5, depth: 2, width: 5 }, 30);
  }, 120_000);
});
