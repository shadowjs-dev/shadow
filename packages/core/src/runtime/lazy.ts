/**
 * ShadowJS Lazy Loading System
 *
 * The lazy component enables code splitting and dynamic imports in ShadowJS applications.
 * It provides:
 * - **Code Splitting**: Load components on-demand
 * - **Caching**: Avoid re-importing already loaded modules
 * - **Error Handling**: Retry logic with configurable attempts
 * - **Suspense Integration**: Works seamlessly with Suspense boundaries
 * - **Type Safety**: Full TypeScript support with proper inference
 *
 * The lazy system works by:
 * 1. Creating placeholder fragments during loading
 * 2. Loading the module asynchronously
 * 3. Replacing the placeholder with the actual component
 * 4. Notifying Suspense boundaries when complete
 */

import { ERRORS } from "../errors";
import { disposeBetween } from "./lifecycle";
import { jsx } from "./jsx";
import { untrack } from "../reactivity/hooks/useEffect";

function initInsertedTree(node: Node | null) {
  if (!node) return;
  if (node.nodeType === Node.ELEMENT_NODE) {
    (node as { __shadow_init?: () => void })?.__shadow_init?.();
  }
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    let c = (node as DocumentFragment).firstChild;
    while (c) {
      initInsertedTree(c);
      c = c.nextSibling;
    }
  }
}

// Internal metadata we attach to the fragment so Suspense can detect
// a pending lazy placeholder.
type LazyMeta = {
  pending: boolean;
  promise: Promise<void>;
  onResolve: Set<() => void>;
};

// Cache for loaded components to avoid re-importing
const componentCache = new WeakMap<() => Promise<unknown>, unknown>();
// Cache for in-flight loading promises
const promiseCache = new WeakMap<() => Promise<unknown>, Promise<void>>();

/**
 * Creates a lazy-loaded component that loads on first use.
 *
 * The lazy function enables code splitting by creating a placeholder component
 * that loads the actual component asynchronously. Once loaded, the component
 * is cached for future use.
 *
 * Features:
 * - **Automatic caching**: Loaded components are cached to prevent re-importing
 * - **Retry logic**: Configurable retry attempts with delays
 * - **Suspense support**: Integrates with Suspense boundaries for loading states
 * - **Type safety**: Full TypeScript support with proper type inference
 * - **Error handling**: Graceful error handling with informative messages
 *
 * @param importFn - Function that returns a Promise resolving to the component module
 * @param options - Configuration options for loading behavior
 * @param options.retries - Number of retry attempts (default: 3)
 * @param options.retryDelay - Delay between retries in milliseconds (default: 1000)
 * @returns A lazy wrapper component that loads the actual component on first render
 *
 * @example
 * ```tsx
 * // Basic usage with dynamic import
 * const LazyComponent = lazy(() => import("./MyComponent"));
 *
 * function App() {
 *   return (
 *     <div>
 *       <LazyComponent />
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With Suspense for loading states
 * const LazyComponent = lazy(() => import("./MyComponent"));
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<div>Loading...</div>}>
 *       <LazyComponent />
 *     </Suspense>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With custom retry configuration
 * const LazyComponent = lazy(
 *   () => import("./MyComponent"),
 *   { retries: 5, retryDelay: 2000 }
 * );
 * ```
 *
 * @example
 * ```tsx
 * // With TypeScript types
 * const LazyComponent = lazy<{ name: string }, JSX.Element>(
 *   () => import("./MyComponent")
 * );
 *
 * function App() {
 *   return <LazyComponent name="World" />;
 * }
 * ```
 */

/**
 * Overload (permissive first): accepts any Promise loader shape.
 * This helps TypeScript inference for manual `new Promise(...)` cases.
 */
export function lazy(
  importFn: () => Promise<unknown>,
  options?: { retries?: number; retryDelay?: number }
): (props?: Record<string, unknown>) => unknown;

/**
 * Overload (typed): strongly typed default export that is a component fn.
 */
export function lazy<TProps = Record<string, unknown>, TResult = unknown>(
  importFn: () => Promise<{ default: (props: TProps) => TResult }>,
  options?: { retries?: number; retryDelay?: number }
): (props: TProps) => TResult;

export function lazy<TProps = Record<string, unknown>, TResult = unknown>(
  importFn:
    | (() => Promise<unknown>)
    | (() => Promise<{ default: (props: TProps) => TResult }>),
  options: { retries?: number; retryDelay?: number } = {}
): (props: TProps) => TResult {
  const { retries = 3, retryDelay = 1000 } = options;

  const load = async (attemptsLeft: number): Promise<void> => {
    try {
      const module = await importFn();

      let Component: ((props: TProps) => TResult) | unknown;
      if (
        module &&
        typeof module === "object" &&
        module !== null &&
        "default" in module &&
        module.default !== undefined
      ) {
        Component = module.default;
      } else if (module && typeof module === "function") {
        Component = module;
      } else {
        throw ERRORS.LAZY_INVALID_EXPORT();
      }

      componentCache.set(importFn as () => Promise<unknown>, Component);
    } catch (err) {
      if (attemptsLeft > 0) {
        await new Promise((r) => setTimeout(r, retryDelay));
        return load(attemptsLeft - 1);
      }
      throw ERRORS.LAZY_FAILED_AFTER_ATTEMPTS(retries, err);
    }
  };

  return function LazyWrapper(props?: TProps): TResult {
    // If already cached, render inside component scope via jsx()
    if (componentCache.has(importFn as () => Promise<unknown>)) {
      const C = componentCache.get(importFn as () => Promise<unknown>);
      return (typeof C === "function" ? jsx(C, props ?? {}) : C) as TResult;
    }

    // Create a placeholder region that we will fill when loaded.
    const frag = document.createDocumentFragment();
    const start = document.createComment("lazy-s");
    const end = document.createComment("lazy-e");
    frag.appendChild(start);
    frag.appendChild(end);

    // Reuse or start loading
    let p = promiseCache.get(importFn as () => Promise<unknown>);
    if (!p) {
      p = load(retries);
      promiseCache.set(importFn as () => Promise<unknown>, p);
    }

    // Attach metadata so Suspense can detect this as pending.
    const meta: LazyMeta = {
      pending: true,
      promise: p,
      onResolve: new Set(),
    };
    (frag as unknown as { __shadow_lazy: LazyMeta }).__shadow_lazy = meta;

    // When loaded, render the resolved component into our region.
    p.then(
      () => {
        meta.pending = false;
        const C = componentCache.get(importFn as () => Promise<unknown>)!;
        const parent = start.parentNode as ParentNode | null;
        if (!parent) {
          // still notify listeners, even if not in DOM
          meta.onResolve.forEach((fn) => {
            try {
              fn();
            } catch {
              // Silently handle lazy component errors
            }
          });
          return;
        }

        // Clear previous placeholder content in the region
        disposeBetween(start, end);

        // Render within a component scope via jsx()
        let node: unknown =
          typeof C === "function" ? jsx(C, props ?? {}) : (C as TResult);

        // NEW: unwrap component thunk
        if (
          typeof node === "function" &&
          (node as { __isComponent?: boolean }).__isComponent
        ) {
          try {
            node = node();
          } catch {
            // Silently handle component errors in lazy loading
          }
        }

        // Insert untracked and init subtrees
        untrack(() => {
          if (node && typeof node === "object" && "nodeType" in node) {
            parent.insertBefore(node as Node, end);
            initInsertedTree(node as Node);
          } else if (node !== null && node !== undefined) {
            parent.insertBefore(document.createTextNode(String(node)), end);
          }
        });

        // Notify any suspense slots waiting on this lazy fragment
        meta.onResolve.forEach((fn) => {
          try {
            fn();
          } catch {
            // Silently handle component errors in lazy loading
          }
        });
        meta.onResolve.clear();
      },
      () => {
        // error surfaced by load() already
      }
    );

    return frag as TResult;
  };
}
