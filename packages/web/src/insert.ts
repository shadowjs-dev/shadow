import { onCleanup, useRenderEffect } from "@shadow-js/core";
import {
  addCleanup,
  type ComputationNode,
  createComputation,
  currentOwner,
  disposeOwner,
  type Owner,
  readComputation,
} from "@shadow-js/core/extend";
import { leaves } from "./internal/accessor";
import { checkClaimedText } from "./internal/claim";
import { claims } from "./internal/hydration-hooks";
import { reconcileNodes } from "./internal/reconcile";

/** One piece of a value after flattening: a DOM node, or text to be turned into a Text node. */
type Part = Node | string;

/**
 * State of one dynamic child region. `nodes` are the DOM nodes the region owns, in order. When
 * `anchor` is set, content goes before it. Without one, an empty region is placed after `marker`
 * (the node that preceded it), so it keeps its position while it is empty. A marker can be a node
 * another region owns and later replaces, so the region created right behind another one on the same parent
 * gives that one an anchor of its own (see `linkRegion`): the marker of every region is then either static
 * content or an anchor nobody replaces.
 * @internal
 */
export interface Region {
  readonly parent: Node;
  anchor: Node | null;
  marker: Node | null;
  /** The owner of the effect that keeps a reactive region up to date; unset until then (and for a static region). */
  owner?: Owner | null;
  nodes: Node[];
  /**
   * Text nodes this region created or adopted; only these may be reused by string updates. Null for none, the node
   * itself for one (the usual region: a single dynamic text), a Set for more, so most regions allocate no Set.
   */
  texts: Text | Set<Text> | null;
  /**
   * Development only: the server nodes a hydration pass handed this region, kept until its first
   * commit compares their text with the value (`checkClaimedText`).
   */
  claimed?: readonly Node[] | undefined;
}

/** The newest reactive unanchored region of each parent: the one the next such region may have to give an anchor. */
const tails = new WeakMap<Node, Region>();

/** The document a node belongs to (a Document is its own document). */
function documentOf(node: Node): Document {
  return node instanceof Document ? node : (node.ownerDocument ?? document);
}

/** True when the region created or adopted `node`. */
function ownsText(region: Region, node: Node): boolean {
  const texts = region.texts;
  return texts === node || (texts instanceof Set && texts.has(node as Text));
}

/** Records that the region owns `text`. */
function addText(region: Region, text: Text): void {
  const texts = region.texts;
  if (texts === null) region.texts = text;
  else if (texts instanceof Set) texts.add(text);
  else if (texts !== text) region.texts = new Set([texts, text]);
}

/** Forgets the Text nodes of the region that are not in `keep`. */
function pruneTexts(region: Region, keep: readonly Node[]): void {
  const texts = region.texts;
  if (texts === null) return;
  if (texts instanceof Set) {
    const kept = new Set<Node>(keep);
    for (const text of texts) {
      if (!kept.has(text)) texts.delete(text);
    }
  } else if (!keep.includes(texts)) region.texts = null;
}

/**
 * The children a fragment held when it was first inserted. Inserting empties a fragment, and an effect
 * that runs again flattens the same fragment value once more: it must still give those nodes.
 */
const fragmentChildren = new WeakMap<DocumentFragment, Node[]>();

/**
 * Flattens a value into parts without recursion. Functions are called (and their results unwrapped)
 * through `call`, which runs inside the render effect that owns the value, so reads are tracked.
 */
function flatten(root: unknown, call?: (fn: () => unknown) => unknown): Part[] {
  const parts: Part[] = [];
  const cycle = __DEV__ ? "insert(): a value contains itself." : "SHADOW_INSERT_CYCLE";
  for (const item of leaves(root, cycle, call)) {
    if (item === null || item === undefined || typeof item === "boolean") continue;
    if (item instanceof DocumentFragment) {
      const kids = fragmentChildren.get(item) ?? [...item.childNodes];
      fragmentChildren.set(item, kids);
      for (const child of kids) parts.push(child);
    } else parts.push(item instanceof Node ? item : String(item)); // strings, numbers and anything else that is text
  }
  return parts;
}

/** Text nodes the region currently owns, keyed by their data, for reuse by equal strings. */
function reusablePool(region: Region): Map<string, Text[]> {
  const pool = new Map<string, Text[]>();
  for (const node of region.nodes) {
    if (!(node instanceof Text) || !ownsText(region, node)) continue;
    const list = pool.get(node.data);
    if (list === undefined) pool.set(node.data, [node]);
    else list.push(node);
  }
  return pool;
}

/** Turns parts into the nodes the region should hold, reusing its own Text nodes where possible. */
function materialize(region: Region, parts: readonly Part[]): Node[] {
  const only = parts.length === 1 ? parts[0] : undefined;
  if (typeof only === "string") {
    const current = region.nodes.length === 1 ? region.nodes[0] : undefined;
    if (current instanceof Text && ownsText(region, current)) {
      if (current.data !== only) current.data = only;
      return [current];
    }
  }
  // Sized to the parts: `[]` and `push` would reserve room for sixteen nodes in every dynamic child (a row has two).
  const nodes: Node[] = new Array<Node>(parts.length);
  let count = 0;
  const seen = new Set<Node>();
  let pool: Map<string, Text[]> | undefined;
  for (const part of parts) {
    if (typeof part === "string") {
      pool ??= reusablePool(region);
      const reused = pool.get(part)?.pop();
      let text = reused;
      if (text === undefined) {
        text = documentOf(region.parent).createTextNode(part);
        addText(region, text);
      }
      seen.add(text);
      nodes[count] = text;
      count += 1;
    } else if (!seen.has(part)) {
      seen.add(part);
      nodes[count] = part;
      count += 1;
    }
  }
  nodes.length = count;
  return nodes;
}

/** The node after the region: its anchor, or the node after its last attached child (`last`), or its marker. */
function endOf(region: Region, last: Node | undefined): Node | null {
  if (region.anchor !== null) return region.anchor;
  if (last !== undefined) return last.nextSibling;
  const marker = region.marker;
  if (marker === null) return region.parent.firstChild;
  if (marker.parentNode !== region.parent) return null;
  return marker.nextSibling;
}

/** Callbacks to run after a region of a parent has committed (see `watchCommits`). */
const commitWatchers = new WeakMap<Node, Set<() => void>>();

/**
 * Runs `run` after every commit to a region of `parent`, so code that depends on which nodes the
 * parent holds (a name on the first element of a content region) can follow a change of content.
 * The watch ends with the owner that is current when this is called.
 * @internal
 */
export function watchCommits(parent: Node, run: () => void): void {
  const set = commitWatchers.get(parent) ?? new Set<() => void>();
  commitWatchers.set(parent, set.add(run));
  onCleanup(() => {
    set.delete(run);
  });
}

/** Makes the DOM show `next` for this region. */
function reconcileRegion(region: Region, next: Node[]): void {
  const parent = region.parent;
  const attached = region.nodes.filter((node) => node.parentNode === parent);
  const end = endOf(region, attached.at(-1));
  const first = attached[0];
  if (next.length === 0 && first !== undefined) region.marker = first.previousSibling;
  reconcileNodes(parent, attached, next, end);
  region.nodes = next;
  pruneTexts(region, next);
  commitWatchers.get(parent)?.forEach((run) => {
    run();
  });
}

/** Applies a flattened value to a region. */
function commit(region: Region, parts: readonly Part[]): void {
  if (__DEV__ && region.claimed !== undefined) {
    // Only the first commit of a claimed region is compared; later changes are ordinary updates.
    checkClaimedText(region.claimed, parts);
    region.claimed = undefined;
  }
  reconcileRegion(region, materialize(region, parts));
}

/**
 * Applies a resolved value to a region. A string or number is the common case (a dynamic text): when the region
 * already shows its own Text node only the data is rewritten, and an empty region gets one new Text node, with none of
 * the flattening and reconciling a general value needs.
 */
function commitValue(region: Region, raw: unknown): void {
  if ((typeof raw === "string" || typeof raw === "number") && !(__DEV__ && region.claimed)) {
    const nodes = region.nodes;
    const text = typeof raw === "string" ? raw : String(raw);
    if (nodes.length === 1) {
      const current = nodes[0];
      if (
        current instanceof Text &&
        current.parentNode === region.parent &&
        ownsText(region, current)
      ) {
        if (current.data !== text) current.data = text;
        return;
      }
    } else if (nodes.length === 0) {
      const created = documentOf(region.parent).createTextNode(text);
      addText(region, created);
      region.parent.insertBefore(created, endOf(region, undefined));
      region.nodes = [created];
      return;
    }
  }
  commit(region, flatten(raw));
}

/** Nodes of `initial` (already in the parent) that the region adopts as its current content. */
function adoptInitial(parent: Node, initial: unknown): Node[] {
  const adopted: Node[] = [];
  const seen = new Set<Node>();
  for (const part of flatten(initial)) {
    if (typeof part === "string" || seen.has(part) || part.parentNode !== parent) continue;
    seen.add(part);
    adopted.push(part);
  }
  return adopted;
}

/**
 * Creates the state of a region in `parent`. `anchorNode` (null to append) and `initial` (nodes
 * already in the DOM, from hydration or splitText) are both optional.
 * @internal
 */
export function createRegion(parent: Node, anchorNode: Node | null, initial: unknown): Region {
  const nodes = initial === undefined ? [] : adoptInitial(parent, initial);
  const marker = nodes.length > 0 ? (nodes[0]?.previousSibling ?? null) : parent.lastChild;
  const region: Region = {
    parent,
    anchor: anchorNode,
    marker,
    nodes,
    texts: null,
  };
  for (const node of nodes) if (node instanceof Text) addText(region, node);
  // A region that adopts server nodes during a hydration pass is checked against its first commit.
  if (__DEV__ && initial !== undefined && claims.current.isClaiming()) region.claimed = nodes;
  return region;
}

/**
 * Called for a region that keeps changing and has no anchor. When the previous such region of the parent is alive
 * and ends exactly where this one starts, that region gets an empty Text node there as its anchor. Its content then
 * always goes before that node, and this region's marker is the node, so no region has a marker that a sibling
 * region can replace: the order of the calls holds however the regions change. A region with static content
 * between it and this one needs nothing, because its marker and its end are the static nodes.
 */
function linkRegion(region: Region): void {
  const parent = region.parent;
  const tail = tails.get(parent);
  region.owner = currentOwner();
  tails.set(parent, region);
  const start = region.nodes[0] ?? null;
  if (tail === undefined || tail.owner?.disposed || endOf(tail, tail.nodes.at(-1)) !== start)
    return;
  const text = anchor(parent, start);
  tail.anchor = region.marker = text;
  // The anchor is the tail's alone and goes with it, so a region replaced by another one over and over adds
  // nothing to the parent. The region behind it, if empty, is then placed at the end like any region whose marker
  // is gone.
  if (tail.owner) addCleanup(tail.owner, () => text.remove());
}

/**
 * True when a function appears anywhere in `root`, at any array depth. Scans without calling
 * anything; `seen` stops it from looping on cyclic arrays (flatten reports those).
 */
function containsFunction(root: unknown): boolean {
  if (typeof root === "function") return true;
  if (!Array.isArray(root)) return false;
  const stack: unknown[][] = [root];
  const seen = new Set<unknown[]>([root]);
  while (stack.length > 0) {
    const frame = stack.pop() as unknown[];
    for (const item of frame) {
      if (typeof item === "function") return true;
      if (Array.isArray(item) && !seen.has(item)) {
        seen.add(item);
        stack.push(item);
      }
    }
  }
  return false;
}

/**
 * One memo per accessor function, owned by `owner` (the effect that evaluates the region's expression,
 * so a new result drops them all; the effect that resolves the result runs many times and must not
 * own them). `prune` disposes the memos of accessors the last
 * run did not meet, which bounds the cache by what the region currently shows.
 */
function createCallCache(owner: ReturnType<typeof currentOwner>): {
  begin(): void;
  call(fn: () => unknown): unknown;
  prune(): void;
} {
  const memos = new Map<() => unknown, ComputationNode>();
  let touched = new Set<() => unknown>();
  return {
    begin(): void {
      touched = new Set();
    },
    call(fn: () => unknown): unknown {
      touched.add(fn);
      let node = memos.get(fn);
      if (node === undefined) {
        // Component setup runs inside these memos, which may write the state it owns.
        node = createComputation({ kind: "memo", fn: () => fn(), allowWrites: true, owner });
        memos.set(fn, node);
      }
      return readComputation(node);
    },
    prune(): void {
      for (const [fn, node] of memos) {
        if (touched.has(fn)) continue;
        memos.delete(fn);
        disposeOwner(node);
      }
    },
  };
}

/**
 * Keeps a region in sync with `value`. A value that is or contains a function (an accessor, or an
 * array with accessor members) runs inside a render effect, so its reads are tracked. Anything
 * else is inserted once. `ordered` is for `insert()` without an anchor: a region that keeps changing then keeps
 * its place among the other such regions of its parent (see `linkRegion`).
 * @internal
 */
export function bindRegion(region: Region, value: unknown, ordered?: boolean): unknown {
  if (!containsFunction(value)) {
    commitValue(region, value);
    return value instanceof DocumentFragment ? [...region.nodes] : value;
  }
  let latest: unknown;
  if (ordered === true) linkRegion(region);
  const accessor = typeof value === "function" ? (value as () => unknown) : () => value;
  // Every accessor met while resolving the result is evaluated by a memo of its own, kept between
  // runs. An accessor that builds components (`() => show() ? <Late /> : null`) then runs again
  // only when what it reads changes, not whenever something it returned (the component's own
  // accessor, reading its own data) does.
  // Two stages. The outer effect runs the expression and tracks only what the expression itself
  // reads. When the result holds accessors (a component returned one, or `props.children` did),
  // a nested effect resolves them, so a change inside the result re-renders the result but never
  // re-runs the expression: re-running `() => props.children` would build the child components
  // again, discarding their state.
  useRenderEffect(accessor, (raw) => {
    latest = raw;
    if (containsFunction(raw)) {
      const cache = createCallCache(currentOwner());
      useRenderEffect(
        () => {
          cache.begin();
          const parts = flatten(raw, cache.call);
          cache.prune();
          return parts;
        },
        (parts) => {
          commit(region, parts);
        },
      );
    } else {
      commitValue(region, raw);
    }
  });
  return latest;
}

/**
 * Moves a region to a new parent: its nodes still in the old parent go through `move` (which puts
 * each at the end of `parent`), and later commits reconcile there. The region keeps its effects, so
 * what it shows is not built again. Only for a region without an anchor.
 * @param region The region to move.
 * @param parent The node that receives the region's nodes.
 * @param move Puts one node at the end of `parent` (`appendChild`, or `moveBefore` where it exists).
 * @since 1.0.3
 * @internal
 */
export function moveRegion(region: Region, parent: Node, move: (node: Node) => void): void {
  const attached = region.nodes.filter((node) => node.parentNode === region.parent);
  for (const node of attached) move(node);
  // Read-only for everyone else: only a move changes where a region lives.
  (region as { parent: Node }).parent = parent;
  region.marker = attached[0]?.previousSibling ?? parent.lastChild;
}

/**
 * Removes a region's nodes from its parent. Anchors and nodes that were moved elsewhere are not
 * touched.
 * @internal
 */
export function removeRegion(region: Region): void {
  for (const node of region.nodes) {
    if (node.parentNode === region.parent) region.parent.removeChild(node);
  }
  region.nodes = [];
  region.texts = null;
}

/**
 * Creates a text anchor: an empty Text node placed before `before` (appended when null). Use it as
 * the stable insertion point between two dynamic regions; it is never removed by the runtime.
 *
 * @param parent Node that receives the anchor.
 * @param before Node the anchor goes before, or null to append.
 * @returns The new empty Text node.
 * @example
 * import { anchor, insert } from "@shadow-js/web";
 *
 * const list = document.createElement("ul");
 * const slot = anchor(list, null);
 * insert(list, "first", slot); // goes before the anchor
 * @see insert
 * @since 1.0.0
 */
export function anchor(parent: Node, before: Node | null): Text {
  const text = documentOf(parent).createTextNode("");
  parent.insertBefore(text, before);
  return text;
}

/**
 * Reactive child insertion: keeps the content of a region in sync with `value`.
 *
 * - A function is an accessor, wrapped in a render effect; it re-runs when its dependencies change.
 * - `null`, `undefined`, booleans render nothing. Strings and numbers become one Text node, reused
 *   when the region already holds one. A Node is inserted itself. A DocumentFragment inserts a
 *   snapshot of its children. Arrays are flattened, nested arrays included.
 * - Content goes before `anchorNode`, or at the end when it is null or omitted. Regions without an
 *   anchor on one parent keep the order of the calls, whatever they show and however often a sibling
 *   region replaces its nodes: when a reactive region is created right where the previous one ends, the
 *   previous one gets an empty Text node as its anchor there (removed again when that region is disposed).
 * - Arrays are reconciled in place: nodes that remain are never removed and re-added.
 * - `initial` lists nodes already in the DOM (from hydration or splitText) so nothing is recreated.
 * - During `hydrate()`, a region that adopted server text is compared with its first commit: in
 *   development, different text warns `HYDRATION_TEXT_MISMATCH` (on the console and in devtools) and
 *   the region shows the value computed by the client.
 *
 * @param parent Node that holds the region.
 * @param value The value or an accessor returning it.
 * @param anchorNode Node the content goes before; null or omitted appends.
 * @param initial Nodes already in place for this region. Undefined adopts the server's nodes while
 * hydrating and starts empty otherwise.
 * @returns The value as accepted (a fragment yields the array of its nodes).
 * @throws TypeError (production message `SHADOW_INSERT_CYCLE`) when an array contains itself, and
 * (`SHADOW_INSERT_DEPTH`) when an accessor returns accessors more than 10,000 levels deep. When the
 * value is reactive, the error is raised inside its render effect and goes to the owner's error
 * handler, like any effect error.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { anchor, insert } from "@shadow-js/web";
 *
 * const list = document.createElement("ul");
 * const end = anchor(list, null);
 * const [items] = useSignal(["a", "b"]);
 * insert(list, () => items().map((name) => document.createTextNode(name)), end);
 * @see anchor
 * @since 1.0.0
 */
export function insert(
  parent: Node,
  value: unknown,
  anchorNode?: Node | null,
  initial?: unknown,
): unknown {
  const resolvedAnchor = anchorNode ?? null;
  const adopted =
    initial === undefined ? claims.current.takeRegion(parent, resolvedAnchor) : initial;
  const region = createRegion(parent, resolvedAnchor, adopted);
  return bindRegion(region, value, resolvedAnchor === null);
}
