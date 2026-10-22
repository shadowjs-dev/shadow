import { checkClaimedTag } from "./internal/claim";
import { warnOnce } from "./internal/diagnostics";
import { claims } from "./internal/hydration-hooks";
import { nextKey } from "./internal/hydration-scope";
import { MATHML_NS, TEMPLATE_IMPORT_NODE, TEMPLATE_MATHML, TEMPLATE_SVG } from "./internal/names";

/** One start tag: its name, then its attribute text (group 1). */
const START_TAG =
  /<[a-zA-Z][^\s/>]*((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
/** One attribute inside the attribute text of a start tag: its name (group 1). */
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g;

/**
 * Development check for the markup a template is parsed from. The HTML parser keeps the first of two
 * same-named attributes and drops the rest, so `class` and `className` on one element (both compiled
 * to `class`) lose one silently. Warns `DUPLICATE_CLASS_ATTRIBUTE` once; the first attribute still wins.
 */
function warnDuplicateClass(html: string): void {
  for (const tag of html.matchAll(START_TAG)) {
    const attributes = [...(tag[1] ?? "").matchAll(ATTRIBUTE)];
    const classes = attributes.filter((match) => match[1]?.toLowerCase() === "class");
    if (classes.length < 2) continue;
    const name = /^<([^\s/>]+)/.exec(tag[0])?.[1] ?? "element";
    warnOnce(
      "DUPLICATE_CLASS_ATTRIBUTE",
      `<${name}> has two class attributes (class and className both write class). The parser drops the second; keep one.`,
    );
    return;
  }
}

/**
 * Copies an element subtree into `namespace`, iteratively. Used only when the engine parsed a
 * MathML wrapper as HTML (some DOM implementations do not parse foreign content).
 */
function inNamespace(source: Element, namespace: string): Element {
  const doc = document;
  const copyOf = (element: Element): Element => {
    const copy = doc.createElementNS(namespace, element.localName);
    for (const attribute of Array.from(element.attributes)) {
      copy.setAttribute(attribute.name, attribute.value);
    }
    return copy;
  };
  const root = copyOf(source);
  const stack: Array<[Element, Element]> = [[source, root]];
  while (stack.length > 0) {
    const pair = stack.pop();
    if (pair === undefined) break;
    const [from, to] = pair;
    for (const child of Array.from(from.childNodes)) {
      if (child instanceof Element) {
        const copy = copyOf(child);
        to.appendChild(copy);
        stack.push([child, copy]);
      } else if (child instanceof Text) {
        to.appendChild(doc.createTextNode(child.data));
      }
    }
  }
  return root;
}

/** Parses the markup once and returns its top-level nodes. SVG and MathML are parsed in a wrapper. */
function parse(html: string, flags: number): Node[] {
  if (__DEV__) warnDuplicateClass(html);
  const holder = document.createElement("template");
  const wrapper =
    (flags & TEMPLATE_SVG) !== 0 ? "svg" : (flags & TEMPLATE_MATHML) !== 0 ? "math" : null;
  if (wrapper === null) {
    holder.innerHTML = html;
    return Array.from(holder.content.childNodes);
  }
  holder.innerHTML = `<${wrapper}>${html}</${wrapper}>`;
  const root = holder.content.firstChild;
  if (!(root instanceof Element)) return [];
  if (wrapper === "math" && root.namespaceURI !== MATHML_NS) {
    return Array.from(inNamespace(root, MATHML_NS).childNodes);
  }
  return Array.from(root.childNodes);
}

/**
 * Turns a static HTML string into a factory of fresh DOM copies: the helper compiled JSX uses for the
 * static part of every element tree. The markup is parsed on the first call and cloned on every call
 * after that, so creating a template touches no DOM. Each call draws the next hydration key; during
 * `hydrate()` it returns the server's element for that key instead of a clone.
 *
 * @param html Markup of one or more sibling roots. It is trusted: it is parsed as written, never
 * escaped.
 * @param flags Bit set: `1` parses the content inside `<svg>` so it gets the SVG namespace, `2` does
 * the same for MathML, `4` clones with `document.importNode` (needed for custom elements).
 * Default: `0` (HTML, `cloneNode`).
 * @returns A function that returns a new, detached node on every call: the root itself when the
 * markup has one root, otherwise a `DocumentFragment` holding the roots.
 * @example
 * import { template } from "@shadow-js/web";
 *
 * const makeCard = template(`<div class="card"><h2></h2></div>`);
 * const card = makeCard() as HTMLDivElement;
 * (card.firstChild as HTMLElement).textContent = "Title";
 * document.body.append(card);
 * @since 1.0.0
 */
export function template(html: string, flags = 0): () => Node {
  const importNode = (flags & TEMPLATE_IMPORT_NODE) !== 0;
  let roots: Node[] | undefined;
  // Development holds the parsed roots weakly: the browser never frees an evaluated module, so a
  // hot-updated template would otherwise keep its parsed copy alive for the whole session. Only the
  // `__DEV__` branches reach this helper and `weakRoots`, so production builds carry neither.
  let weakRoots: WeakRef<Node[]> | undefined;
  const devRoots = (): Node[] => {
    const live = weakRoots?.deref();
    if (live !== undefined) return live;
    const fresh = parse(html, flags);
    weakRoots = new WeakRef(fresh);
    return fresh;
  };
  const copy = (node: Node): Node =>
    importNode ? document.importNode(node, true) : node.cloneNode(true);
  return () => {
    // While hydrating, the next template root is the server's element, not a clone.
    const claimed = claims.current.claimElement(nextKey());
    if (claimed !== null) {
      if (__DEV__) {
        // The template's only root names the tag the server element must have.
        const parsed = devRoots();
        const [only] = parsed;
        if (parsed.length === 1 && only instanceof Element)
          checkClaimedTag(claimed, only.localName);
      }
      return claimed;
    }
    // biome-ignore lint/suspicious/noAssignInExpressions: the first call parses the template once; the assignment is the cache.
    const parsed = __DEV__ ? devRoots() : (roots ??= parse(html, flags));
    if (parsed.length === 1) {
      const [only] = parsed;
      if (only !== undefined) return copy(only);
    }
    const fragment = document.createDocumentFragment();
    for (const root of parsed) fragment.appendChild(copy(root));
    return fragment;
  };
}
