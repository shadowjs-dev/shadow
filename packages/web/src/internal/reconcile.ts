/** A parent that can move a child in place (Element.prototype.moveBefore, where implemented). */
interface MovableParent extends Node {
  moveBefore(node: Node, child: Node | null): void;
}

/** Removes `node` only when it is still a child of `parent`, so detached nodes are ignored. */
function removeNode(parent: Node, node: Node | undefined): void {
  if (node !== undefined && node.parentNode === parent) parent.removeChild(node);
}

/**
 * Marks the members of one longest strictly increasing subsequence of `values` in `marks`, where
 * `values[k]` is the target position of the k-th surviving node and `marks[v - offset]` is set for
 * target position `v`. Patience sorting: O(n log n).
 */
function markLongestIncreasing(values: readonly number[], offset: number, marks: Uint8Array): void {
  // tails[k]: index into `values` of the smallest tail of an increasing run of length k + 1.
  const tails: number[] = [];
  const previous: number[] = values.map(() => -1);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const probe = values[tails[middle] ?? 0] ?? 0;
      if (probe < value) low = middle + 1;
      else high = middle;
    }
    // `tails[-1]` is undefined, which reads as no predecessor.
    previous[index] = tails[low - 1] ?? -1;
    tails[low] = index;
  }
  let cursor = tails.at(-1) ?? -1;
  while (cursor !== -1) {
    marks[(values[cursor] ?? 0) - offset] = 1;
    cursor = previous[cursor] ?? -1;
  }
}

/**
 * Updates one region of `parent`'s children from the nodes `prev` to the nodes `next`, keeping every
 * node that stays and moving as few as possible: the list reconciliation `insert` performs for arrays
 * (and so for `For`). Use it in a custom list renderer.
 *
 * Preconditions: `prev` are the nodes this region owns, in DOM order and all children of `parent`;
 * `next` holds no duplicates; `end` is the node after the region (null for the end of `parent`).
 *
 * Strategy, in three steps:
 * 1. Trim the common prefix and suffix: appends, prepends, and removals at either end touch
 *    only the nodes that changed (no move at all).
 * 2. Remove the nodes that left the value. A node that is still present is never removed.
 * 3. Place the rest from the end of `next` backwards. Nodes on a longest increasing subsequence of
 *    surviving positions stay where they are; every other node is moved (or inserted) directly
 *    before the node that follows it in `next`. Moves use `moveBefore` when the parent has it,
 *    which keeps focus and iframe state, and `insertBefore` otherwise. Each node moves at most once,
 *    and the number of moves is minimal for the surviving order.
 *
 * @param parent The parent of the region.
 * @param prev The nodes the region holds now, in DOM order, all children of `parent`.
 * @param next The nodes the region must hold, in order, without duplicates. A node of `prev` that is
 * not in `next` is removed; a node of `next` that is not in `prev` is inserted.
 * @param end The node right after the region; `null` when the region runs to the end of `parent`.
 * @example
 * import { reconcileNodes } from "@shadow-js/web/extend";
 *
 * const item = (text: string): HTMLLIElement =>
 *   Object.assign(document.createElement("li"), { textContent: text });
 * const list = document.createElement("ul");
 * const a = item("a");
 * const b = item("b");
 * const c = item("c");
 * list.append(a, b, c);
 * reconcileNodes(list, [a, b, c], [c, a], null); // removes b, moves c before a
 * @since 1.0.0
 */
export function reconcileNodes(
  parent: Node,
  prev: readonly Node[],
  next: readonly Node[],
  end: Node | null,
): void {
  const prevLength = prev.length;
  const nextLength = next.length;

  let head = 0;
  while (head < prevLength && head < nextLength && prev[head] === next[head]) head += 1;
  let prevTail = prevLength;
  let nextTail = nextLength;
  while (prevTail > head && nextTail > head && prev[prevTail - 1] === next[nextTail - 1]) {
    prevTail -= 1;
    nextTail -= 1;
  }
  if (prevTail === head && nextTail === head) return;

  // Everything in the common suffix is already in place, so the middle goes before its first node.
  const before = nextTail < nextLength ? (next[nextTail] ?? null) : end;

  if (nextTail === head) {
    for (let index = head; index < prevTail; index += 1) removeNode(parent, prev[index]);
    return;
  }

  const target = new Map<Node, number>();
  for (let index = head; index < nextTail; index += 1) {
    const node = next[index];
    if (node !== undefined) target.set(node, index);
  }

  const survivors: number[] = [];
  for (let index = head; index < prevTail; index += 1) {
    const node = prev[index];
    if (node === undefined) continue;
    const position = target.get(node);
    if (position === undefined) removeNode(parent, node);
    else survivors.push(position);
  }

  // Nothing survived: the new nodes go in document order. Inserting them back to front (the move loop below)
  // ends with the same tree but not the same steps, and a `<select>` picks its shown option while its options
  // arrive, so a replaced option list would show the wrong value.
  if (survivors.length === 0) {
    for (const node of next.slice(head, nextTail)) parent.insertBefore(node, before);
    return;
  }

  const stable = new Uint8Array(nextTail - head);
  markLongestIncreasing(survivors, head, stable);
  const movable = typeof (parent as Partial<MovableParent>).moveBefore === "function";

  let anchorNode = before;
  for (let index = nextTail - 1; index >= head; index -= 1) {
    const node = next[index];
    if (node === undefined) continue;
    if (stable[index - head] !== 1) {
      if (movable && node.parentNode === parent)
        (parent as MovableParent).moveBefore(node, anchorNode);
      else parent.insertBefore(node, anchorNode);
    }
    anchorNode = node;
  }
}
