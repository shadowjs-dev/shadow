import { untrack, useEffect } from "../reactivity/hooks/useEffect";
import { disposeBetween } from "./lifecycle";
import { isComponentThunk } from "./shared/isComponentThunk";

type ErrorBoundaryProps = {
  fallback?: unknown | ((error: unknown) => unknown);
  children?: unknown;
  onError?: (error: unknown) => void;
};

/**
 * ErrorBoundary catches synchronous rendering errors from its children
 * and renders a fallback. It also calls the optional `onError` handler.
 *
 * Note: It catches errors thrown during render of function children.
 * For async errors within Suspense/lazy, use Suspense and fallback.
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  const { fallback, children, onError } = props || {};

  // Anchor an empty fragment
  const fragment = document.createDocumentFragment();
  const startComment = document.createComment("error-boundary-s");
  const endComment = document.createComment("error-boundary-e");
  fragment.appendChild(startComment);
  fragment.appendChild(endComment);

  let hasError = false;
  let storedError: unknown = null;

  // Insert content before the end marker
  const insertNode = (node: unknown) => {
    const parent = startComment.parentNode as ParentNode | null;
    if (!parent) return;

    const insert = (v: unknown) => {
      if (v === null || v === undefined || typeof v === "boolean") return;
      if (Array.isArray(v)) {
        v.forEach((x) => insert(x));
        return;
      }
      if (typeof v === "function") {
        try {
          if (isComponentThunk(v)) {
            parent.insertBefore((v as () => Node)(), endComment);
          } else {
            insert((v as () => unknown)());
          }
        } catch {
          // Silently handle component render errors - they'll be caught by the error boundary
        }
        return;
      }
      if (typeof v === "string" || typeof v === "number") {
        parent.insertBefore(document.createTextNode(String(v)), endComment);
        return;
      }
      if (v && typeof v === "object" && "nodeType" in v) {
        parent.insertBefore(v as Node, endComment);
        return;
      }
      parent.insertBefore(document.createTextNode(String(v)), endComment);
    };

    untrack(() => insert(node));
  };

  // Render either the children or the fallback upon errors
  const render = () => {
    disposeBetween(startComment, endComment);

    if (hasError) {
      const node =
        typeof fallback === "function"
          ? (fallback as (error: unknown) => unknown)(storedError)
          : fallback;
      insertNode(node);
      return;
    }

    try {
      const content =
        typeof children === "function"
          ? (children as () => unknown)()
          : children;
      insertNode(content);
    } catch (error: unknown) {
      hasError = true;
      storedError = error;
      try {
        onError?.(error);
      } catch {
        // Silently handle onError callback errors to prevent infinite error loops
      }
      const node =
        typeof fallback === "function"
          ? (fallback as (error: unknown) => unknown)(error)
          : fallback;
      disposeBetween(startComment, endComment);
      insertNode(node);
    }
  };

  render();

  // If children is a function, re-run on reactive updates
  if (typeof children === "function") {
    useEffect(() => {
      if (!hasError) render();
    });
  }

  return fragment;
}
