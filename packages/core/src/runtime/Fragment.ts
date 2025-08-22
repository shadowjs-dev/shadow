/**
 * ShadowJS Fragment Component
 *
 * Fragment is a special component that renders its children without creating
 * an additional DOM wrapper element. It's useful for grouping elements together
 * without affecting the DOM structure.
 *
 * Unlike other frameworks where fragments are just logical groupings, ShadowJS
 * Fragment provides reactive section management, allowing individual children
 * to be reactive without requiring wrapper elements.
 *
 * Key Features:
 * - No DOM wrapper element
 * - Individual reactive sections for each child
 * - Automatic cleanup of reactive sections
 * - Support for mixed static and reactive content
 *
 * @example
 * ```tsx
 * function ListComponent({ items }) {
 *   return (
 *     <Fragment>
 *       <h2>My Items</h2>
 *       <ul>
 *         <For each={items()}>
 *           {(item) => <li>{item.name}</li>}
 *         </For>
 *       </ul>
 *       <p>Total: {items.length}</p>
 *     </Fragment>
 *   );
 * }
 *
 * // Renders without any wrapper div:
 * // <h2>My Items</h2>
 * // <ul>...</ul>
 * // <p>Total: 5</p>
 * ```
 */

import { useEffect, untrack } from "../reactivity/hooks/useEffect";
import {
  disposeBetween,
  markComponentBoundary,
  pushComponentScope,
  popComponentScope,
} from "./lifecycle";
import { isComponentThunk } from "./shared/isComponentThunk";

declare const document: Document;

/**
 * Creates a reactive section within a fragment for a single child.
 *
 * Each child in a Fragment gets its own reactive section, allowing individual
 * children to update independently without affecting siblings. This provides
 * fine-grained reactivity while maintaining the fragment's no-wrapper behavior.
 *
 * @param parent - The document fragment to add the reactive section to
 * @param valueOrFunction - The child value or reactive function to render
 * @internal
 */
function createReactiveSection(
  parent: DocumentFragment,
  valueOrFunction: unknown
) {
  const startComment = document.createComment("f-r-s");
  const endComment = document.createComment("f-r-e");
  parent.appendChild(startComment);
  parent.appendChild(endComment);

  const scope = pushComponentScope();
  markComponentBoundary(startComment, endComment, scope);

  const insertBeforeEnd = (end: Comment, content: unknown) => {
    const parentNode = startComment.parentNode as ParentNode | null;
    if (!parentNode) return;
    const insert = (v: unknown) => {
      if (v === null || v === undefined || typeof v === "boolean") return;
      if (typeof v === "function") {
        try {
          if (isComponentThunk(v)) {
            parentNode.insertBefore((v as () => Node)(), end);
          } else {
            insert((v as () => unknown)());
          }
        } catch {
          // Silently handle component render errors in fragments
        }
        return;
      }
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

    const newContent = untrack(() => {
      let v =
        typeof valueOrFunction === "function"
          ? (valueOrFunction as () => unknown)()
          : valueOrFunction;
      try {
        if (typeof v === "function") v = v();
      } catch {
        // Silently handle function evaluation errors in fragments
      }
      return v;
    });

    disposeBetween(startComment, endComment);
    insertBeforeEnd(endComment, newContent);
  };

  update();
  useEffect(update);
  popComponentScope();
}

function addToParent(parent: DocumentFragment, child: unknown) {
  if (child === null || child === undefined) return;

  if (typeof child === "object" && child !== null && "nodeType" in child) {
    parent.appendChild(child as Node);
    return;
  }

  if (typeof child === "function") {
    createReactiveSection(parent, child);
    return;
  }

  if (typeof child === "string" || typeof child === "number") {
    parent.appendChild(document.createTextNode(String(child)));
    return;
  }

  if (typeof child === "boolean") return;

  const textNode = document.createTextNode(String(child));
  parent.appendChild(textNode);
}

function appendChild(parent: DocumentFragment, child: unknown) {
  if (Array.isArray(child)) {
    child.forEach((nested) => appendChild(parent, nested));
  } else {
    addToParent(parent, child);
  }
}

/**
 * Fragment component - renders children without a wrapper element.
 *
 * Fragment allows you to group multiple elements together without creating
 * an additional DOM node. Each child gets its own reactive section, enabling
 * fine-grained updates while maintaining clean DOM output.
 *
 * This is particularly useful when:
 * - You need to return multiple elements from a component
 * - You want to avoid unnecessary wrapper divs
 * - You need conditional rendering with multiple elements
 * - You want to mix static and reactive content
 *
 * @param props.children - Child elements to render. Can be any valid JSX content,
 *                        including other components, primitives, and reactive functions.
 * @returns DocumentFragment containing the rendered children without a wrapper element
 *
 * @example
 * ```tsx
 * function Navigation({ user }) {
 *   return (
 *     <Fragment>
 *       <nav>
 *         <a href="/">Home</a>
 *         <a href="/about">About</a>
 *       </nav>
 *       {() => user() ? <div>Welcome, {() => user().name}!</div> : null}
 *     </Fragment>
 *   );
 * }
 *
 * // Renders as:
 * // <nav>...</nav>
 * // <div>Welcome, John!</div>
 * ```
 *
 * @example
 * ```tsx
 * // Using Fragment to avoid wrapper divs in lists
 * function TodoList({ todos }) {
 *   return (
 *     <Fragment>
 *       <h2>Tasks</h2>
 *       <For each={todos()}>
 *         {(todo) => (
 *           <div className={todo().completed ? "done" : ""}>
 *             {todo().text}
 *           </div>
 *         )}
 *       </For>
 *       <p>Total: {todos().length}</p>
 *     </Fragment>
 *   );
 * }
 * ```
 */
export function Fragment({ children }: { children: unknown }) {
  const fragment = document.createDocumentFragment();
  if (children !== undefined) {
    appendChild(fragment, children);
  }
  return fragment;
}
