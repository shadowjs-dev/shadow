import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { insert } from "../src/index";
import { cleanupDom, ids, installMoveBefore, items, mount, spyMutations } from "./support/dom";

afterEach(cleanupDom);

/** Renders `initial` as a reactive list and returns the setter plus the list's parent. */
function list(initial: readonly Node[]): {
  parent: HTMLElement;
  set: (next: readonly Node[]) => void;
} {
  const parent = mount("ul");
  const [value, setValue] = useSignal<readonly Node[]>(initial);
  createRoot(() => insert(parent, () => [...value()]));
  return {
    parent,
    set: (next) => {
      setValue(next);
      flushSync();
    },
  };
}

/** Four fresh items with a typed tuple, so destructuring needs no undefined checks. */
function four(): [HTMLElement, HTMLElement, HTMLElement, HTMLElement] {
  const nodes = items(4);
  return [
    nodes[0] as HTMLElement,
    nodes[1] as HTMLElement,
    nodes[2] as HTMLElement,
    nodes[3] as HTMLElement,
  ];
}

function same(parent: Node, expected: readonly Node[]): boolean {
  return (
    parent.childNodes.length === expected.length &&
    expected.every((node, index) => parent.childNodes[index] === node)
  );
}

describe("reconcile: fast paths", () => {
  it("[REC-01] append inserts only the new nodes and removes nothing", () => {
    const [a, b, c, d] = four();
    const { parent, set } = list([a, b, c]);
    const spies = spyMutations();
    set([a, b, c, d]);
    expect(spies.insertBefore).toHaveBeenCalledTimes(1);
    expect(spies.removeChild).not.toHaveBeenCalled();
    expect(ids(parent)).toEqual(["item0", "item1", "item2", "item3"]);
  });

  it("[REC-02] prepend inserts only the new nodes and removes nothing", () => {
    const [a, b, c, d] = four();
    const { parent, set } = list([b, c, d]);
    const spies = spyMutations();
    set([a, b, c, d]);
    expect(spies.insertBefore).toHaveBeenCalledTimes(1);
    expect(spies.removeChild).not.toHaveBeenCalled();
    expect(same(parent, [a, b, c, d])).toBe(true);
  });

  it("[REC-03] removing a middle node removes exactly that node", () => {
    const [a, b, c, d] = four();
    const { parent, set } = list([a, b, c, d]);
    const spies = spyMutations();
    set([a, c, d]);
    expect(spies.removeChild).toHaveBeenCalledTimes(1);
    expect(spies.removeChild.mock.calls[0]?.[0]).toBe(b);
    expect(spies.insertBefore).not.toHaveBeenCalled();
    expect(same(parent, [a, c, d])).toBe(true);
  });

  it("[REC-04] clearing removes every node and inserts none", () => {
    const nodes = items(3);
    const { parent, set } = list(nodes);
    const spies = spyMutations();
    set([]);
    expect(spies.removeChild).toHaveBeenCalledTimes(3);
    expect(spies.insertBefore).not.toHaveBeenCalled();
    expect(parent.childNodes.length).toBe(0);
  });

  it("[REC-05] replace-all removes the old nodes and inserts new ones", () => {
    const old = items(2, "old");
    const fresh = items(2, "new");
    const { parent, set } = list(old);
    const spies = spyMutations();
    set(fresh);
    expect(spies.removeChild).toHaveBeenCalledTimes(2);
    expect(spies.insertBefore).toHaveBeenCalledTimes(2);
    expect(same(parent, fresh)).toBe(true);
  });

  it("[REC-06] swapping two adjacent nodes costs exactly one move and no removal", () => {
    const [a, b, c, d] = four();
    const { parent, set } = list([a, b, c, d]);
    const spies = spyMutations();
    set([a, c, b, d]);
    expect(spies.insertBefore).toHaveBeenCalledTimes(1);
    expect(spies.removeChild).not.toHaveBeenCalled();
    expect(same(parent, [a, c, b, d])).toBe(true);
  });

  it("[REC-07] reversing 200 nodes keeps every node and moves at most n-1 of them", () => {
    const nodes = items(200);
    const { parent, set } = list(nodes);
    const spies = spyMutations();
    set([...nodes].reverse());
    expect(spies.removeChild).not.toHaveBeenCalled();
    expect(spies.insertBefore.mock.calls.length).toBeLessThanOrEqual(199);
    expect(same(parent, [...nodes].reverse())).toBe(true);
  });

  it("[REC-08] moving the first node to the end costs one move", () => {
    const nodes = items(5);
    const { parent, set } = list(nodes);
    const spies = spyMutations();
    set([...nodes.slice(1), nodes[0] as HTMLElement]);
    expect(spies.insertBefore).toHaveBeenCalledTimes(1);
    expect(same(parent, [...nodes.slice(1), nodes[0] as HTMLElement])).toBe(true);
  });

  it("[REC-09] moving the last node up to index 1 costs one move", () => {
    const nodes = items(5);
    const { parent, set } = list(nodes);
    const spies = spyMutations();
    const next = [nodes[0], nodes[4], nodes[1], nodes[2], nodes[3]] as HTMLElement[];
    set(next);
    expect(spies.insertBefore).toHaveBeenCalledTimes(1);
    expect(spies.removeChild).not.toHaveBeenCalled();
    expect(same(parent, next)).toBe(true);
  });

  it("[REC-10] a 5000-node reversal finishes without recursion", () => {
    const nodes = items(5000);
    const { parent, set } = list(nodes);
    set([...nodes].reverse());
    expect(parent.childNodes[0]).toBe(nodes[4999]);
    expect(parent.childNodes[4999]).toBe(nodes[0]);
  });
});

describe("reconcile: moves", () => {
  it("[REC-11] moved nodes are the same objects (identity stable)", () => {
    const nodes = items(6);
    const { parent, set } = list(nodes);
    const next = [nodes[3], nodes[0], nodes[5], nodes[1], nodes[4], nodes[2]] as HTMLElement[];
    set(next);
    for (const [index, node] of next.entries()) expect(parent.childNodes[index]).toBe(node);
  });

  it("[REC-12] with moveBefore available, survivors move through it and new nodes use insertBefore", () => {
    const moved: Node[] = [];
    const restore = installMoveBefore(moved);
    try {
      const nodes = items(4);
      const { parent, set } = list(nodes);
      const spies = spyMutations();
      const fresh = document.createElement("li");
      const next = [nodes[3], nodes[0], fresh, nodes[1], nodes[2]] as HTMLElement[];
      set(next);
      expect(moved.length).toBeGreaterThan(0);
      expect(moved).not.toContain(fresh);
      expect(spies.insertBefore.mock.calls.map((call) => call[0])).toEqual([fresh]);
      expect(same(parent, next)).toBe(true);
    } finally {
      restore();
    }
  });

  it("[REC-13] a node that is not yet in the parent is never passed to moveBefore", () => {
    const moved: Node[] = [];
    const restore = installMoveBefore(moved);
    try {
      const nodes = items(2);
      const { parent, set } = list(nodes);
      const fresh = document.createElement("li");
      set([fresh, nodes[1] as HTMLElement]);
      expect(moved).not.toContain(fresh);
      expect(parent.childNodes[0]).toBe(fresh);
      expect(same(parent, [fresh, nodes[1] as HTMLElement])).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("reconcile: properties (fast-check, seed 7)", () => {
  it("[REC-14] a random shuffle of 200 nodes yields the expected order, with no node recreated or removed", () => {
    const nodes = items(200);
    const { parent, set } = list(nodes);
    const spies = spyMutations();
    fc.assert(
      fc.property(fc.shuffledSubarray(nodes, { minLength: 200, maxLength: 200 }), (permutation) => {
        spies.insertBefore.mockClear();
        spies.removeChild.mockClear();
        set(permutation);
        expect(spies.removeChild).not.toHaveBeenCalled();
        expect(spies.insertBefore.mock.calls.length).toBeLessThanOrEqual(200);
        expect(same(parent, permutation)).toBe(true);
      }),
      { seed: 7, numRuns: 100 },
    );
  });

  it("[REC-15] random updates over a pool keep the DOM equal to the deduplicated value and remove only absent nodes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 0, max: 39 }), { maxLength: 60 }), { maxLength: 12 }),
        (steps) => {
          const pool = items(40);
          const { parent, set } = list([]);
          const spies = spyMutations();
          for (const step of steps) {
            const expected: HTMLElement[] = [];
            const seen = new Set<HTMLElement>();
            for (const index of step) {
              const node = pool[index];
              if (node !== undefined && !seen.has(node)) {
                seen.add(node);
                expected.push(node);
              }
            }
            spies.removeChild.mockClear();
            set(expected);
            expect(same(parent, expected)).toBe(true);
            for (const call of spies.removeChild.mock.calls) {
              expect(seen.has(call[0] as HTMLElement)).toBe(false);
            }
          }
          spies.insertBefore.mockRestore();
          spies.removeChild.mockRestore();
        },
      ),
      { seed: 7, numRuns: 100 },
    );
  });
});
