import { DEVTOOLS_EVENT, devtoolsReport } from "@shadow-js/core/extend";

/** What a hydration pass in progress knows. Exists only while `hydrate()` runs its synchronous pass. */
interface HydrationState {
  /** Server elements by `data-hk` key; entries are consumed when claimed. */
  readonly registry: Map<string, Element>;
  /** Told about each mismatch the pass repaired (the `onRecoverableError` option). */
  readonly recoverable: ((error: unknown) => void) | undefined;
  /** Region contents taken out of each claimed parent, in document order. */
  readonly pending: WeakMap<Node, Node[][]>;
  /** The content of every region lifted out of a claimed element, in document order (read by `NoHydration`). */
  readonly lifted: Node[][];
}

let state: HydrationState | null = null;

/** Starts a claiming pass over the given server elements. @internal */
export function beginClaiming(
  registry: Map<string, Element>,
  recoverable?: (error: unknown) => void,
): void {
  state = { registry, recoverable, pending: new WeakMap(), lifted: [] };
}

/** Ends the claiming pass. @internal */
export function endClaiming(): void {
  state = null;
}

/**
 * Reports whether a `hydrate()` pass is claiming server DOM right now: a custom renderer reads it to
 * decide between adopting server nodes and building fresh ones. The pass is synchronous, so this is
 * `false` again once `hydrate()` returns, and in every later update.
 *
 * @returns `true` during the synchronous pass of `hydrate()` (outside {@link withoutClaiming}),
 * `false` otherwise.
 * @example
 * import { isClaiming } from "@shadow-js/web/extend";
 *
 * function describe(): string {
 *   return isClaiming() ? "adopting server markup" : "building fresh DOM";
 * }
 * @see claims
 * @since 1.0.0
 */
export function isClaiming(): boolean {
  return state !== null;
}

function isMarker(node: Node, data: string): boolean {
  if (node.nodeType !== 8) return false;
  const text = (node as Comment).data;
  // `[b:ID` opens a Suspense boundary region (streaming); it hydrates like a plain region.
  return text === data || (data === "[" && text.startsWith("[b:"));
}

/**
 * Turns server markup for one template into the shape a freshly cloned template has: region
 * contents are lifted out (to be re-inserted by `insert`), marker comments are removed and text
 * nodes are merged again. Iterative; static elements below the root are walked, regions are not
 * (their contents belong to other templates, claimed later through the registry).
 */
function prepare(root: Element, pending: WeakMap<Node, Node[][]>, lifted: Node[][]): void {
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const parent = stack.pop();
    if (parent === undefined) break;
    let child: ChildNode | null = parent.firstChild;
    while (child !== null) {
      const following: ChildNode | null = child.nextSibling;
      if (isMarker(child, "[")) {
        const content: Node[] = [];
        let depth = 1;
        let cursor: ChildNode | null = child.nextSibling;
        while (cursor !== null) {
          if (isMarker(cursor, "[")) depth += 1;
          else if (isMarker(cursor, "]")) {
            depth -= 1;
            if (depth === 0) break;
          }
          content.push(cursor);
          cursor = cursor.nextSibling;
        }
        const after: ChildNode | null = cursor === null ? null : cursor.nextSibling;
        lifted.push(content);
        for (const node of content) parent.removeChild(node);
        parent.removeChild(child);
        if (cursor !== null) parent.removeChild(cursor);
        const queue = pending.get(parent);
        if (queue === undefined) pending.set(parent, [content]);
        else queue.push(content);
        child = after;
        continue;
      }
      if (child.nodeType === 1) stack.push(child as Element);
      child = following;
    }
  }
  root.normalize();
}

/**
 * Adopts the server's element for a hydration key while `hydrate()` runs: the step that lets a custom
 * template reuse server markup instead of creating new nodes. The element loses its `data-hk`
 * attribute, and the content of its regions is lifted out, to be adopted by {@link takeRegion} when
 * the regions bind. Prefer `claims.current.claimElement`, which links this code only into apps that
 * call `hydrate()`.
 *
 * @param key The key from `nextKey()`, drawn where the server drew it. Undefined claims nothing.
 * @returns The server element; `null` when no hydration pass is running, when `key` is undefined, or
 * when the server sent no element for the key (the caller then creates the node itself). A missing
 * key is a recoverable mismatch: development builds warn `HYDRATION_KEY_MISS`, and the pass's
 * `onRecoverableError` receives an `Error`.
 * @example
 * import { claimElement, nextKey } from "@shadow-js/web/extend";
 *
 * function createPanel(): Element {
 *   // During hydrate(): the server's <section>. Otherwise: a new one.
 *   return claimElement(nextKey()) ?? document.createElement("section");
 * }
 * @see claims
 * @since 1.0.0
 */
export function claimElement(key: string | undefined): Element | null {
  const current = state;
  if (current === null || key === undefined) return null;
  const element = current.registry.get(key);
  if (element === undefined) {
    // Production keeps only the code (the same split as core's messages): the text stays out of the bundle.
    if (__DEV__) {
      const message = `No server element for key "${key}".`;
      console.warn(`[shadow HYDRATION_KEY_MISS] ${message}`);
      devtoolsReport(DEVTOOLS_EVENT.HYDRATION_MISMATCH, message, key, undefined);
    }
    current.recoverable?.(
      new Error(__DEV__ ? `No server element for key "${key}".` : "SHADOW_HYDRATION_KEY_MISS"),
    );
    return null;
  }
  current.registry.delete(key);
  element.removeAttribute("data-hk");
  prepare(element, current.pending, current.lifted);
  return element;
}

/** Characters that stay readable as escapes in a diagnostic snippet: markup, quotes and ampersands. */
const SNIPPET_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["<", "\\u003c"],
  [">", "\\u003e"],
  ["&", "\\u0026"],
  ['"', "\\u0022"],
  ["'", "\\u0027"],
]);

/**
 * Escapes text for a diagnostic snippet and cuts it to `limit` output characters, with `...` when cut.
 * Escapes are never split, so the output is at most `limit + 3` characters.
 * @internal
 */
function snippet(text: string, limit: number): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const controlled = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    const escaped =
      SNIPPET_ESCAPES.get(char) ?? (controlled ? `\\u${code.toString(16).padStart(4, "0")}` : char);
    if (out.length + escaped.length > limit) return `${out}...`;
    out += escaped;
  }
  return out;
}

/** The opening tag of a server element as the server wrote it (attribute values as they are). */
function openingMarkup(element: Element): string {
  let markup = `<${element.localName}`;
  for (const attr of Array.from(element.attributes)) markup += ` ${attr.name}="${attr.value}"`;
  return `${markup}>`;
}

/**
 * Development check of a claimed element against the tag its template or `element()` call expects.
 * A different tag warns `HYDRATION_MISMATCH` on the console and in devtools, with an escaped snippet of
 * the server element (its opening tag and the start of its text, bounded). Recovery is unchanged: the
 * element is still adopted, nothing is thrown or replaced, and the caller gets the same value.
 *
 * Call it under `if (__DEV__)`. Text is not compared here: the expected text is inserted later, by
 * `insert`, and {@link checkClaimedText} compares it with the server text at that point.
 *
 * @param element The server element `claimElement` returned.
 * @param expectedTag The tag the client expects (any case).
 * @internal
 */
export function checkClaimedTag(element: Element, expectedTag: string): void {
  if (!__DEV__) return;
  const expected = expectedTag.toLowerCase();
  const actual = element.localName.toLowerCase();
  if (actual === expected) return;
  const text = element.textContent ?? "";
  let detail = `expected <${expected}> but the server sent <${snippet(actual, 80)}>; server markup: "${snippet(openingMarkup(element), 80)}"`;
  if (text !== "") detail += `; text: "${snippet(text, 40)}"`;
  console.warn(`[shadow HYDRATION_MISMATCH] ${detail}`);
  devtoolsReport(DEVTOOLS_EVENT.HYDRATION_MISMATCH, detail, undefined, undefined);
}

/**
 * Development check of the first commit of a region that claimed server text. The server text is the
 * DOM text of the claimed nodes (already decoded, so an escaped `&lt;` compares as `<`); the expected
 * text is the strings of the first commit, joined (a number is already its string, `null` and booleans
 * render nothing, so they expect `""`). Equal text is silent. Different text warns
 * `HYDRATION_TEXT_MISMATCH` on the console and in devtools, with both texts escaped and bounded to 40
 * characters. Recovery is unchanged: the region shows the value the client computed.
 *
 * Not compared, so silent: a region that claimed no nodes (an empty server region has no server text),
 * a region whose server nodes are not all text (an element, or the markers of a nested region), and a
 * commit that holds a node (an element is shown in place of the server's content, as before).
 *
 * Call it under `if (__DEV__)`, once per claimed region, at its first commit.
 *
 * @param claimed The server nodes the region adopted, in document order.
 * @param parts What the first commit shows: strings, or nodes.
 * @internal
 * @since 1.0.0
 */
export function checkClaimedText(
  claimed: readonly Node[],
  parts: readonly (Node | string)[],
): void {
  if (!__DEV__) return;
  if (claimed.length === 0) return;
  let server = "";
  for (const node of claimed) {
    if (node.nodeType !== 3) return;
    server += node.textContent ?? "";
  }
  let expected = "";
  for (const part of parts) {
    if (typeof part !== "string") return;
    expected += part;
  }
  if (expected === server) return;
  const detail = `expected text "${snippet(expected, 40)}" but the server sent text "${snippet(server, 40)}"`;
  console.warn(`[shadow HYDRATION_TEXT_MISMATCH] ${detail}`);
  devtoolsReport(DEVTOOLS_EVENT.HYDRATION_MISMATCH, detail, undefined, undefined);
}

/** HTML elements whose content is text and nothing else: no comment can mark a region inside them. */
const TEXT_ONLY = new Set(["script", "style", "title", "textarea"]);

/**
 * True for a `script`, `style`, `title` or `textarea`, in whichever namespace the parser put it: `Dynamic` knows no
 * parent, so the server writes the children of such a tag without region markers even where the page parses it as
 * an SVG `title` or `style`. Its whole content is then the one region.
 */
function isTextOnly(node: Node): boolean {
  return node.nodeType === 1 && TEXT_ONLY.has((node as Element).localName);
}

/**
 * Adopts the server content of the next region of a claimed parent while `hydrate()` runs: the nodes
 * that sat between the region's markers are put back before `anchorNode` and returned, so a custom
 * region can bind to them instead of inserting new nodes. Regions are taken in document order.
 *
 * @param parent An element returned by {@link claimElement} (or one of its descendants).
 * @param anchorNode The node the content goes before; `null` appends it at the end of `parent`.
 * @returns The adopted nodes; undefined when no hydration pass is running or `parent` has no region
 * left to adopt (the caller then inserts fresh nodes). A `script`, `style`, `title` or `textarea` has no
 * markers (the server writes its text as the parser reads it): its current children are the region.
 * @example
 * import { takeRegion } from "@shadow-js/web/extend";
 *
 * function fillRegion(parent: Element): Node[] {
 *   const adopted = takeRegion(parent, null);
 *   if (adopted !== undefined) return adopted;
 *   const text = document.createTextNode("fresh");
 *   parent.append(text);
 *   return [text];
 * }
 * @see claimElement
 * @since 1.0.0
 */
export function takeRegion(parent: Node, anchorNode: Node | null): Node[] | undefined {
  const current = state;
  if (current === null) return undefined;
  const content = current.pending.get(parent)?.shift();
  if (content === undefined) return isTextOnly(parent) ? Array.from(parent.childNodes) : undefined;
  for (const node of content) parent.insertBefore(node, anchorNode);
  return content;
}

/**
 * The content of every region the pass lifted out of the server elements it claimed, in document order. `NoHydration` finds
 * its own markers in them. Undefined outside a hydration pass.
 * @internal
 */
export function liftedRegions(): readonly (readonly Node[])[] | undefined {
  return state?.lifted;
}

/**
 * Runs `fn` with claiming switched off, so the templates it builds are created fresh instead of
 * claimed from the server markup. Use it for content the server did not render (a portal the server
 * sent nothing for), so its keys are not reported as missing. The previous state is restored when
 * `fn` returns or throws.
 *
 * @param fn The code to run. It runs synchronously, once.
 * @returns What `fn` returns. An error `fn` throws propagates.
 * @example
 * import { template } from "@shadow-js/web";
 * import { withoutClaiming } from "@shadow-js/web/extend";
 *
 * const makeTip = template(`<div class="tip"></div>`);
 * const tip = withoutClaiming(() => makeTip()); // a fresh clone, even during hydrate()
 * @see claims
 * @since 1.0.0
 */
export function withoutClaiming<T>(fn: () => T): T {
  const saved = state;
  state = null;
  try {
    return fn();
  } finally {
    state = saved;
  }
}

/** Comment that opens the server block of a portal (`<!--portal:KEY-->`). */
const PORTAL_OPEN = "portal:";
/** Comment that closes it (`<!--/portal:KEY-->`). */
const PORTAL_CLOSE = "/portal:";

/**
 * Adopts the server block of a portal while `hydrate()` runs. The server writes each portal's markup
 * at the end of `<body>` between `<!--portal:KEY-->` and `<!--/portal:KEY-->` comments (see
 * `createServerPortals`); this removes the comments, leaves the content in place, and registers its
 * keyed elements so the portal's templates claim them.
 *
 * @param key The portal's key from `nextKey()`. Undefined claims nothing.
 * @returns The nodes of the block, in place in the body; undefined when no hydration pass is running,
 * `key` is undefined, there is no document body, or the server sent no complete block for the key.
 * @example
 * import { claimPortal, nextKey } from "@shadow-js/web/extend";
 *
 * function mountOverlay(build: () => Node): Node[] {
 *   const adopted = claimPortal(nextKey());
 *   if (adopted !== undefined) return adopted;
 *   const node = build();
 *   document.body.append(node);
 *   return [node];
 * }
 * @since 1.0.0
 */
export function claimPortal(key: string | undefined): Node[] | undefined {
  const current = state;
  if (current === null || key === undefined || typeof document === "undefined") return undefined;
  const body = document.body;
  if (body === null) return undefined;
  const nodes = Array.from(body.childNodes);
  const open = nodes.findIndex((node) => isComment(node, PORTAL_OPEN + key));
  if (open === -1) return undefined;
  const close = nodes.findIndex(
    (node, index) => index > open && isComment(node, PORTAL_CLOSE + key),
  );
  if (close === -1) return undefined;
  // The content stays where the server put it (the region adopts it in place); only the markers go.
  const content: Node[] = [];
  for (const node of nodes.slice(open + 1, close)) {
    if (node.nodeType === 8 && isRegionMarker(node as Comment)) body.removeChild(node);
    else content.push(node);
  }
  for (const node of [nodes[open], nodes[close]]) {
    if (node !== undefined) body.removeChild(node);
  }
  for (const node of content) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const own = element.getAttribute("data-hk");
    if (own !== null) current.registry.set(own, element);
    for (const keyed of Array.from(element.querySelectorAll("[data-hk]"))) {
      const hk = keyed.getAttribute("data-hk");
      if (hk !== null) current.registry.set(hk, keyed);
    }
  }
  return content;
}

/**
 * Removes the server blocks of portals that were not claimed during the pass: the client did not render
 * those portals, so their markup must not stay in the page. Each block goes with its comments. A block
 * without its closing comment loses only its opening one.
 * @internal
 */
export function releaseUnclaimedPortals(body: Node): void {
  const nodes = Array.from(body.childNodes);
  for (let open = 0; open < nodes.length; open += 1) {
    const opening = nodes[open];
    if (opening === undefined || opening.nodeType !== 8) continue;
    const data = (opening as Comment).data;
    if (!data.startsWith(PORTAL_OPEN)) continue;
    const close = nodes.findIndex(
      (node, index) =>
        index > open && isComment(node, PORTAL_CLOSE + data.slice(PORTAL_OPEN.length)),
    );
    const last = close === -1 ? open : close;
    for (const node of nodes.slice(open, last + 1)) {
      if (node.parentNode === body) body.removeChild(node);
    }
    open = last;
  }
}

function isComment(node: Node, data: string): boolean {
  return node.nodeType === 8 && (node as Comment).data === data;
}

function isRegionMarker(comment: Comment): boolean {
  return comment.data === "[" || comment.data === "]";
}
