import { type MockInstance, vi } from "vitest";

/** Namespaces used by the assertions. */
export const SVG_NS = "http://www.w3.org/2000/svg";
export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
export const XLINK_NS = "http://www.w3.org/1999/xlink";

// Captured before any spy is installed, so stubs can delegate to the native implementation
// without being counted by spies on Node.prototype.
const nativeInsertBefore = Node.prototype.insertBefore;

/** Creates an element in the document body. {@link cleanupDom} removes everything again. */
export function mount(tag = "div"): HTMLElement {
  const element = document.createElement(tag);
  document.body.appendChild(element);
  return element;
}

/** Empties the document body between tests. */
export function cleanupDom(): void {
  document.body.innerHTML = "";
}

/** Compact description of the direct children: `#t:data` for text, the local name for elements. */
export function shape(parent: Node): string[] {
  return Array.from(parent.childNodes, (node) => {
    if (node instanceof Text) return `#t:${node.data}`;
    if (node instanceof Element) return node.localName;
    return `#${node.nodeType}`;
  });
}

/** Shape of the expected content of a text-only region, e.g. `["a", "b"]` becomes `["#t:a", "#t:b"]`. */
export function texts(...values: string[]): string[] {
  return values.map((value) => `#t:${value}`);
}

/** True when the subtree contains at least one comment node. */
export function hasComment(root: Node): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  return walker.nextNode() !== null;
}

/** Sets a compiler-style expando (`el.$$click`) without a type assertion at call sites. */
export function setExpando(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

/** Reads a compiler-style expando. */
export function getExpando(target: object, key: string): unknown {
  return Reflect.get(target, key);
}

/**
 * Installs a `moveBefore` on Element.prototype (happy-dom has none). It moves with the native
 * insertBefore and records each moved node in `record` when one is given.
 */
export function installMoveBefore(record?: Node[]): () => void {
  Object.defineProperty(Element.prototype, "moveBefore", {
    configurable: true,
    writable: true,
    value(this: Element, node: Node, child: Node | null): void {
      record?.push(node);
      nativeInsertBefore.call(this, node, child);
    },
  });
  return () => {
    Reflect.deleteProperty(Element.prototype, "moveBefore");
  };
}

/** Spies on the two DOM mutations the runtime is allowed to use, without changing behavior. */
export function spyMutations(): {
  insertBefore: MockInstance<Node["insertBefore"]>;
  removeChild: MockInstance<Node["removeChild"]>;
} {
  return {
    insertBefore: vi.spyOn(Node.prototype, "insertBefore"),
    removeChild: vi.spyOn(Node.prototype, "removeChild"),
  };
}

/** Builds `count` fresh list items with stable identities. */
export function items(count: number, prefix = "item"): HTMLElement[] {
  return Array.from({ length: count }, (_, index) => {
    const element = document.createElement("li");
    element.setAttribute("data-id", `${prefix}${index}`);
    return element;
  });
}

/** Returns the `data-id` values of element children, in order. */
export function ids(parent: Node): string[] {
  return Array.from(parent.childNodes, (node) =>
    node instanceof Element ? (node.getAttribute("data-id") ?? "") : `#${node.nodeType}`,
  );
}

interface LoadingSettings {
  disableCSSFileLoading: boolean;
  disableJavaScriptFileLoading: boolean;
  enableIframePageLoading: boolean;
  handleDisabledFileLoadingAsSuccess: boolean;
}

/**
 * Stops happy-dom from fetching what a test only writes into the document (a stylesheet link, a module script, an iframe) and from
 * reporting that the fetch is disabled. Those tests check the tags the runtime builds, not what a browser would then load.
 * @returns The function that puts the settings back; call it in `finally` or `afterAll`.
 */
export function quietFileLoading(): () => void {
  const { settings } = (window as unknown as { happyDOM: { settings: LoadingSettings } }).happyDOM;
  const saved = { ...settings };
  settings.disableCSSFileLoading = true;
  settings.disableJavaScriptFileLoading = true;
  // An iframe has no "handled as success" path: it reports an error unless its page may load. Without a `src` that page is `about:blank`.
  settings.enableIframePageLoading = true;
  settings.handleDisabledFileLoadingAsSuccess = true;
  return () => {
    Object.assign(settings, saved);
  };
}
