import { untrack, useEffect } from "../reactivity/hooks/useEffect";
import { onCleanup } from "../reactivity/hooks/onCleanup";
import { disposeBetween } from "./lifecycle";
import { ERRORS } from "../errors";

/**
 * Create a reactive section between two anchors already inserted
 * under a parent element.
 */
function createReactiveSectionBetweenAnchors(
  anchorEnd: Comment,
  valueOrFunction: unknown
): void {
  const anchorParent = anchorEnd.parentNode as ParentNode | null;
  if (!anchorParent) return;

  const startComment = document.createComment("p-r-s");
  const endComment = document.createComment("p-r-e");

  anchorParent.insertBefore(startComment, anchorEnd);
  anchorParent.insertBefore(endComment, anchorEnd);

  const insertBeforeEnd = (end: Comment, content: unknown) => {
    const parentNode = startComment.parentNode as ParentNode | null;
    if (!parentNode) return;
    const insert = (v: unknown) => {
      if (v === null || v === undefined || typeof v === "boolean") return;
      if (typeof v === "string" || typeof v === "number") {
        parentNode.insertBefore(document.createTextNode(String(v)), end);
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((x) => insert(x));
        return;
      }
      if (typeof v === "object" && v !== null && "nodeType" in v) {
        parentNode.insertBefore(v as Node, end);
        return;
      }
      parentNode.insertBefore(document.createTextNode(String(v)), end);
    };
    insert(content);
  };

  const update = () => {
    const parentNode = startComment.parentNode as ParentNode | null;
    if (!parentNode) return;

    const newContent = untrack(() =>
      typeof valueOrFunction === "function"
        ? valueOrFunction()
        : valueOrFunction
    );

    disposeBetween(startComment, endComment);
    untrack(() => insertBeforeEnd(endComment, newContent));
  };

  update();
  useEffect(update);
}

/**
 * Portal renders its children into a different DOM container (mount).
 *
 * @param props.mount Target element to render into (required).
 * @param props.children Content to render (supports reactive functions).
 * @param props.ref Optional ref to the mount element.
 */
export function Portal(props: {
  mount?: Element | null;
  children?: unknown;
  ref?: (element: Element) => void | { current: Element | null };
}) {
  const { mount, children, ref } = props || {};
  if (!mount) {
    throw ERRORS.PORTAL_MOUNT_REQUIRED();
  }

  // Forward ref to the mount element (not the content)
  if (ref) {
    if (typeof ref === "function") {
      try {
        ref(mount);
      } catch {
        // Silently handle ref callback errors in portals
      }
    } else if (ref && typeof ref === "object" && "current" in ref) {
      try {
        (ref as { current: Element | null }).current = mount;
      } catch {
        // Silently handle ref assignment errors in portals
      }
    }
  }

  // Anchors delimiting the portal content inside the mount
  const startAnchor = document.createComment("p-s");
  const endAnchor = document.createComment("p-e");
  mount.appendChild(startAnchor);
  mount.appendChild(endAnchor);

  if (children !== undefined) {
    createReactiveSectionBetweenAnchors(endAnchor, children);
  }

  // Cleanup on unmount
  onCleanup(() => {
    const parent = startAnchor.parentNode as ParentNode | null;
    if (!parent) return;
    disposeBetween(startAnchor, endAnchor);
    parent.removeChild(startAnchor);
    parent.removeChild(endAnchor);
  });

  // Portals return an empty fragment where they are declared
  return document.createDocumentFragment();
}
