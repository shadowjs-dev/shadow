import { useEffect } from "../reactivity/hooks/useEffect";
import { disposeBetween } from "./lifecycle";
import { ERRORS } from "../errors";
import { warn } from "./shared/warn";
import { untrack } from "../reactivity/hooks/useEffect";
import { isComponentThunk } from "./shared/isComponentThunk";

type ShowProps = {
  when: boolean | (() => boolean);
  fallback?: unknown;
  children: unknown;
  /**
   * If true, unmount subtree when condition changes.
   * If false (default), detach and cache nodes for faster re-show.
   */
  unmount?: boolean;
};

/**
 * Conditional rendering:
 * - when is true: render children
 * - when is false: render fallback (if provided)
 * - if unmount=false, caches DOM nodes to avoid re-creating them
 */
export function Show(props: ShowProps) {
  if (typeof props.when !== "boolean" && typeof props.when !== "function") {
    throw ERRORS.SHOW_INVALID_WHEN();
  }

  warn(
    props.children !== undefined || props.fallback !== undefined,
    "<Show> has no children or fallback; renders empty content."
  );

  const fragment = document.createDocumentFragment();
  const start = document.createComment("show-s");
  const end = document.createComment("show-e");
  fragment.appendChild(start);
  fragment.appendChild(end);

  const getParent = () => start.parentNode as ParentNode | null;

  const toNode = (value: unknown): Node => {
    if (typeof value === "function") {
      try {
        if (isComponentThunk(value)) {
          return (value as () => Node)();
        }
        return toNode((value as () => unknown)());
      } catch {
        return document.createComment("error");
      }
    }
    if (value === null || value === undefined || typeof value === "boolean") {
      return document.createComment("");
    }
    if (typeof value === "object" && value !== null && "nodeType" in value)
      return value as Node;
    if (Array.isArray(value)) {
      const df = document.createDocumentFragment();
      value.forEach((v) => df.appendChild(toNode(v)));
      return df;
    }
    return document.createTextNode(String(value));
  };

  const detachBetween = (): Node[] => {
    const parent = getParent();
    if (!parent) return [];
    const nodes: Node[] = [];
    let cur = start.nextSibling;
    while (cur && cur !== end) {
      const next = cur.nextSibling;
      nodes.push(cur);
      parent.removeChild(cur);
      cur = next;
    }
    return nodes;
  };

  const insertNodes = (nodes: Node[]) => {
    const parent = getParent();
    if (!parent) return;
    nodes.forEach((n) => parent.insertBefore(n, end));
  };

  const materialize = (content: unknown): Node[] => {
    const n = toNode(content);
    if (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      const arr: Node[] = [];
      let c = (n as DocumentFragment).firstChild;
      while (c) {
        const next = c.nextSibling;
        arr.push(c);
        c = next;
      }
      return arr;
    }
    return [n];
  };

  let lastCond: boolean | null = null;
  let cachedTrueContent: Node[] | null = null;
  let cachedFalseContent: Node[] | null = null;

  const computeCond = (): boolean => {
    try {
      return typeof props.when === "function" ? props.when() : props.when;
    } catch {
      return false;
    }
  };

  const shouldUnmount = props.unmount === undefined ? false : !!props.unmount;

  const update = () => {
    const parent = getParent();
    if (!parent) return;

    const cond = computeCond();

    const mat = (c: unknown) => untrack(() => materialize(c));

    // First render
    if (lastCond === null) {
      lastCond = cond;
      if (cond) {
        insertNodes(mat(props.children));
      } else if (props.fallback !== undefined) {
        insertNodes(mat(props.fallback));
      }
      return;
    }

    if (cond === lastCond) return;

    if (shouldUnmount) {
      disposeBetween(start, end);
      if (cond) {
        insertNodes(mat(props.children));
      } else if (props.fallback !== undefined) {
        insertNodes(mat(props.fallback));
      }
    } else {
      // Dispose effects before detaching to prevent them from running while cached
      disposeBetween(start, end);
      const detachedNodes = detachBetween();
      // Cache the content for re-materialization
      if (lastCond) {
        cachedTrueContent = detachedNodes;
      } else if (props.fallback !== undefined) {
        cachedFalseContent = detachedNodes;
      }

      let toInsert: Node[] = [];
      if (cond) {
        // Re-materialize cached content to re-initialize effects
        toInsert = mat(cachedTrueContent || props.children);
        cachedTrueContent = null;
      } else if (props.fallback !== undefined) {
        // Re-materialize cached content to re-initialize effects
        toInsert = mat(cachedFalseContent || props.fallback);
        cachedFalseContent = null;
      }
      if (toInsert.length) insertNodes(toInsert);
    }

    lastCond = cond;
  };

  update();
  useEffect(update);

  return fragment;
}
