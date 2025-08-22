import { untrack, useEffect } from "../reactivity/hooks/useEffect";
import { disposeBetween } from "./lifecycle";
import { isComponentThunk } from "./shared/isComponentThunk";

/**
 * Narrow check for a thenable object (Promise-like).
 */
function isThenable(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

/**
 * Convert arbitrary values to a Node (DocumentFragment if array).
 */

function toNode(value: unknown): Node | null {
  if (value === null || value === undefined) return null;
  if (isComponentThunk(value)) {
    try {
      return value();
    } catch {
      return document.createComment("error");
    }
  }
  if (typeof value === "object" && value !== null && "nodeType" in value)
    return value as Node;
  if (Array.isArray(value)) {
    const df = document.createDocumentFragment();
    value.forEach((v) => {
      const n = toNode(v);
      if (n) df.appendChild(n);
    });
    return df;
  }
  if (typeof value === "function") {
    try {
      return toNode((value as () => unknown)());
    } catch {
      return document.createComment("error");
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    return document.createTextNode(String(value));
  }
  return document.createTextNode(String(value));
}

/**
 * Detect whether a DocumentFragment contains a nested Suspense marker.
 */
function isSuspenseFragmentNode(node: unknown): boolean {
  if (
    !node ||
    typeof node !== "object" ||
    !(node as Node).nodeType ||
    (node as Node).nodeType !== Node.DOCUMENT_FRAGMENT_NODE
  )
    return false;
  const df = node as DocumentFragment;
  for (let i = 0; i < df.childNodes.length; i++) {
    const n = df.childNodes[i];
    if (
      n.nodeType === Node.COMMENT_NODE &&
      (n as Comment).textContent === "suspense-s"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Detect whether a node is a lazy placeholder fragment produced by lazy().
 * If so, returns its metadata (including the pending promise).
 */
function getLazyMeta(node: unknown): {
  pending: boolean;
  promise: Promise<void>;
  onResolve: Set<() => void>;
} | null {
  if (
    node &&
    typeof node === "object" &&
    (node as Node).nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
    (node as { __shadow_lazy?: unknown }).__shadow_lazy &&
    typeof (node as { __shadow_lazy?: unknown }).__shadow_lazy === "object"
  ) {
    return (
      node as {
        __shadow_lazy: {
          pending: boolean;
          promise: Promise<void>;
          onResolve: Set<() => void>;
        };
      }
    ).__shadow_lazy;
  }
  return null;
}

/**
 * Suspense component - coordinates asynchronous operations with fallback UI.
 *
 * Suspense provides a way to show fallback content while waiting for async
 * operations to complete. It works with:
 * - Promises (thenables) thrown or returned by components
 * - Lazy-loaded components (via lazy() function)
 * - Nested Suspense components
 *
 * Behavior:
 * 1. Shows fallback content if any top-level child is pending
 * 2. Waits for all top-level async operations to resolve
 * 3. Reveals actual content once all top-level operations complete
 * 4. Keeps nested Suspense boundaries functional for fine-grained loading states
 * 5. Updates reactively when children change
 *
 * @param props.fallback - Content to show while waiting for async operations
 * @param props.children - Child components that may be async
 * @returns DocumentFragment containing the Suspense boundary
 *
 * @example
 * ```tsx
 * const [data, setData] = useStore(null);
 * const [loading, setLoading] = useStore(false);
 *
 * const fetchData = async () => {
 *   setLoading(true);
 *   const result = await fetch("/api/data").then(r => r.json());
 *   setData(result);
 *   setLoading(false);
 * };
 *
 * function DataComponent() {
 *   if (loading()) {
 *     // This promise will be caught by Suspense
 *     throw new Promise(resolve => {
 *       if (!loading()) resolve();
 *     });
 *   }
 *   return <div>{JSON.stringify(data())}</div>;
 * }
 *
 * return (
 *   <Suspense fallback={<div>Loading...</div>}>
 *     <DataComponent />
 *   </Suspense>
 * );
 * ```
 *
 * @example Lazy loading
 * ```tsx
 * const LazyComponent = lazy(() => import("./MyComponent"));
 *
 * return (
 *   <Suspense fallback={<div>Loading component...</div>}>
 *     <LazyComponent />
 *   </Suspense>
 * );
 * ```
 */
export function Suspense(props: { fallback?: unknown; children?: unknown }) {
  const { fallback, children } = props || {};

  // Anchor region
  const fragment = document.createDocumentFragment();
  const startComment = document.createComment("suspense-s");
  const endComment = document.createComment("suspense-e");
  fragment.appendChild(startComment);
  fragment.appendChild(endComment);

  // Normalize children to array
  const childrenArray = (): unknown[] =>
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children];

  const clearBetween = () => {
    disposeBetween(startComment, endComment);
  };

  // Each "slot" represents one child position and its async state
  type Slot = {
    isNested: boolean; // nested Suspense fragment?
    resolved: boolean; // resolved (top-level)
    node: Node | null; // resolved node (or placeholder)
    promise: Promise<unknown> | null; // in-flight promise
    reactive: (() => unknown) | null; // original reactive thunk if any
  };
  let slots: Slot[] = [];
  let anchors: { start: Comment; end: Comment }[] | null = null;
  let fallbackVisible = false;
  let stageOneCompleted = false;

  // Replace all content with fallback (if provided)
  const showFallback = () => {
    const parent = startComment.parentNode as ParentNode | null;
    if (!parent) return;
    clearBetween();
    if (fallback !== undefined) {
      const node = toNode(
        typeof fallback === "function"
          ? (fallback as () => unknown)()
          : fallback
      );
      if (node) parent.insertBefore(node, endComment);
    }
    fallbackVisible = true;
  };

  // Prepare slot anchors to place each child in its position
  const ensureAnchors = () => {
    if (anchors) return;
    const parent = startComment.parentNode as ParentNode | null;
    if (!parent) return;
    const arr = childrenArray();
    anchors = arr.map((_, i) => ({
      start: document.createComment(`suspense-slot-s:${i}`),
      end: document.createComment(`suspense-slot-e:${i}`),
    }));
    anchors.forEach((a) => {
      parent.insertBefore(a.start, endComment);
      parent.insertBefore(a.end, endComment);
    });
  };

  // Set content for one slot
  const setSlotContent = (index: number, node: Node | null) => {
    if (!anchors) return;
    const parent = startComment.parentNode as ParentNode | null;
    if (!parent) return;
    const a = anchors[index];
    if (!a) return;

    disposeBetween(a.start, a.end);
    if (node) parent.insertBefore(node, a.end);
  };

  // Reveal content (clear fallback and mount slots) only when all top-level
  // non-nested slots have resolved.
  const maybeReveal = () => {
    if (stageOneCompleted) return;
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].isNested && !slots[i].resolved) return;
    }
    // All top-level resolved
    stageOneCompleted = true;
    const parent = startComment.parentNode as ParentNode | null;
    if (!parent) return;
    if (fallbackVisible) {
      clearBetween();
      fallbackVisible = false;
    }
    ensureAnchors();
    // Set all non-nested slot contents now
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].isNested) {
        setSlotContent(i, slots[i].node);
      }
    }
    // Now reveal nested fragments (already resolved)
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].isNested) {
        setSlotContent(i, slots[i].node);
      }
    }
  };

  // Resolve a child value (sync, async, or lazy placeholder)
  const inspectChild = (index: number, value: unknown) => {
    const finish = (resolvedValue: unknown) => {
      const node = toNode(resolvedValue);
      slots[index].resolved = true;
      slots[index].node = node;
      maybeReveal();
    };

    // Thenable
    if (isThenable(value)) {
      slots[index].promise = value;
      (value as Promise<unknown>).then(
        (v) => finish(v),
        () => finish(null) // treat rejection as resolved-null to avoid deadlock
      );
      return;
    }

    // Lazy placeholder detection: treat as pending until its promise resolves
    const meta = getLazyMeta(value);
    if (meta && meta.pending) {
      slots[index].promise = meta.promise;
      // Register a one-shot listener to mark resolution
      const onRes = () => finish(value);
      meta.onResolve.add(onRes);
      meta.promise.finally(() => {
        meta.onResolve.delete(onRes);
      });
      return;
    }

    // Already materialized value
    finish(value);
  };

  // Initial pass: inspect children and show fallback if anything is pending
  const process = () => {
    const arr = childrenArray();

    slots = arr.map((child) => {
      let value: unknown = child;
      let isNested = false;

      if (typeof child === "function") {
        try {
          value = (child as () => unknown)();
        } catch (err: unknown) {
          if (isThenable(err)) value = err;
          else throw err;
        }
      }

      if (
        typeof value === "object" &&
        value !== null &&
        "nodeType" in value &&
        isSuspenseFragmentNode(value)
      ) {
        isNested = true;
      }

      return {
        isNested,
        resolved: isNested ? true : false,
        node: isNested ? (value as Node) : null,
        promise: null,
        reactive: typeof child === "function" ? (child as () => unknown) : null,
      } as Slot;
    });

    // Determine if any top-level child is pending (thenable or lazy)
    let hasPending = false;
    arr.forEach((child, index) => {
      let value: unknown = child;
      if (typeof child === "function") {
        try {
          value = (child as () => unknown)();
        } catch (err: unknown) {
          if (isThenable(err)) value = err;
          else throw err;
        }
      }
      const meta = getLazyMeta(value);
      if (
        (!slots[index].isNested && isThenable(value)) ||
        (!slots[index].isNested && meta && meta.pending)
      ) {
        hasPending = true;
      }
    });

    if (hasPending) {
      showFallback();
    }

    // Inspect children to wire promises and compute resolution
    arr.forEach((child, index) => {
      if (slots[index].isNested) return;
      let value: unknown = child;
      if (typeof child === "function") {
        try {
          value = (child as () => unknown)();
        } catch (err: unknown) {
          if (isThenable(err)) value = err;
          else throw err;
        }
      }
      inspectChild(index, value);
    });

    // In case there was nothing pending, reveal immediately
    maybeReveal();

    // Reactive updates for function children
    slots.forEach((slot, index) => {
      if (!slot.reactive) return;
      useEffect(() => {
        let v: unknown;
        try {
          v = slot.reactive!();
        } catch (err: unknown) {
          if (isThenable(err)) {
            (err as Promise<unknown>).then(() => {
              try {
                const next = slot.reactive!();
                if (isThenable(next)) {
                  (next as Promise<unknown>).then((r) =>
                    setSlotContent(
                      index,
                      untrack(() => toNode(r))
                    )
                  );
                } else {
                  setSlotContent(
                    index,
                    untrack(() => toNode(next))
                  );
                }
              } catch {
                // Silently handle Suspense cleanup errors
              }
            });
            return;
          } else {
            throw err;
          }
        }
        if (isThenable(v)) {
          (v as Promise<unknown>).then((r) =>
            setSlotContent(
              index,
              untrack(() => toNode(r))
            )
          );
        } else {
          setSlotContent(
            index,
            untrack(() => toNode(v))
          );
        }
      });
    });
  };

  // Wait until inserted before processing (so anchors have a parent)
  const checkConnected = () => {
    if (startComment.isConnected) process();
    else setTimeout(checkConnected, 0);
  };
  checkConnected();

  // If children is a reactive function, reprocess on change
  if (typeof children === "function") {
    useEffect(() => {
      if (startComment.isConnected) {
        anchors = null;
        fallbackVisible = false;
        stageOneCompleted = false;
        slots = [];
        clearBetween();
        process();
      }
    });
  }

  return fragment;
}
