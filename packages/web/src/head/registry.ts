import type { NormalizedTag } from "./validate";

/**
 * One rendered head element: the slot it occupies (its identity, or a unique key for an
 * append-only tag) and the tag that currently wins that slot.
 * @internal
 */
export interface HeadWinner {
  readonly slot: string;
  readonly tag: NormalizedTag;
}

/**
 * The pure head registry: no DOM, no signals. Every registration joins the stack of its identity;
 * the top of each stack is the winner. Removing a registration takes it out of its stack, so the
 * one below it wins again.
 * @internal
 */
export interface HeadRegistry {
  /**
   * Registers a group of tags. The returned function removes them again; calling it twice is a
   * no-op.
   */
  add(tags: readonly NormalizedTag[]): () => void;
  /** The winning tag of every slot, in the order each slot first appeared. */
  winners(): HeadWinner[];
}

interface Entry {
  readonly slot: string;
  readonly tag: NormalizedTag;
}

const noop = (): void => undefined;

/**
 * Creates an empty head registry. `onChange` runs after every effective add or removal, so the
 * owner of the DOM can schedule one update for a whole batch.
 *
 * @param onChange Called after the registry changes.
 * @returns A registry with no winners.
 * @internal
 * @since 1.0.0
 */
export function createHeadRegistry(onChange: () => void): HeadRegistry {
  const stacks = new Map<string, Entry[]>();
  let appendOnly = 0;
  return {
    add(tags: readonly NormalizedTag[]): () => void {
      if (tags.length === 0) return noop;
      const entries: Entry[] = [];
      for (const tag of tags) {
        let slot = tag.identity;
        if (slot === undefined) {
          slot = `#${appendOnly}`;
          appendOnly += 1;
        }
        let stack = stacks.get(slot);
        if (stack === undefined) {
          stack = [];
          stacks.set(slot, stack);
        }
        const entry: Entry = { slot, tag };
        stack.push(entry);
        entries.push(entry);
      }
      onChange();
      let removed = false;
      return (): void => {
        if (removed) return;
        removed = true;
        for (const entry of entries) {
          const stack = stacks.get(entry.slot);
          if (stack === undefined) continue;
          const index = stack.indexOf(entry);
          if (index !== -1) stack.splice(index, 1);
          if (stack.length === 0) stacks.delete(entry.slot);
        }
        onChange();
      };
    },
    winners(): HeadWinner[] {
      const winners: HeadWinner[] = [];
      for (const [slot, stack] of stacks) {
        const top = stack[stack.length - 1];
        if (top !== undefined) winners.push({ slot, tag: top.tag });
      }
      return winners;
    },
  };
}
