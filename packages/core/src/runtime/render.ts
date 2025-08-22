/**
 * ShadowJS Render Function
 *
 * The render function is the entry point for mounting ShadowJS applications to the DOM.
 * It handles the initial mounting of components and manages the component lifecycle.
 *
 * Features:
 * - **Component Mounting**: Renders function components or DOM nodes
 * - **Lifecycle Management**: Properly initializes component scopes and effects
 * - **Cleanup**: Automatically disposes previous content before mounting new content
 * - **Error Handling**: Validates inputs and provides clear error messages
 * - **Component Thunk Support**: Handles lazy-loaded and async components
 */

import { disposeAllChildren } from "./lifecycle";
import { ERRORS } from "../errors";
import { jsx } from "./jsx";

/**
 * Renders a ShadowJS component or DOM node into a container element.
 *
 * This function is the primary entry point for mounting ShadowJS applications.
 * It handles both function components (which get executed via JSX runtime) and
 * direct DOM nodes, providing a unified mounting interface.
 *
 * The render process:
 * 1. **Validation**: Ensures container is provided and valid
 * 2. **Cleanup**: Disposes any existing mounted content
 * 3. **Component Processing**: Handles function components vs DOM nodes
 * 4. **Mounting**: Appends the rendered content to the container
 * 5. **Lifecycle**: Initializes component scopes and effects
 *
 * @param component - Component to render. Can be:
 *                    - A function component that returns JSX
 *                    - A DOM Node or DocumentFragment
 *                    - A component thunk (from lazy loading)
 * @param container - Target DOM element to mount the component into.
 *                     Must be a valid Element (not a DocumentFragment).
 * @returns The mounted DOM node or the result of the component rendering.
 *
 * @throws Error if container is invalid or component returns invalid content
 *
 * @example
 * ```tsx
 * // Basic component rendering
 * function App() {
 *   return <h1>Hello ShadowJS!</h1>;
 * }
 *
 * const root = document.getElementById("app");
 * render(App, root!);
 * ```
 *
 * @example
 * ```tsx
 * // Rendering with props
 * function Greeting({ name }) {
 *   return <h1>Hello, {name}!</h1>;
 * }
 *
 * const root = document.getElementById("app");
 * render(() => <Greeting name="World" />, root!);
 * ```
 *
 * @example
 * ```tsx
 * // Rendering existing DOM nodes
 * const existingElement = document.createElement("div");
 * existingElement.textContent = "Pre-rendered content";
 *
 * const root = document.getElementById("app");
 * render(existingElement, root!);
 * ```
 *
 * @example
 * ```tsx
 * // With lazy loading
 * const LazyApp = lazy(() => import("./App"));
 *
 * const root = document.getElementById("app");
 * render(LazyApp, root!);
 * ```
 */
export function render(component: unknown, container: Element) {
  if (!container) {
    throw ERRORS.RENDER_CONTAINER_REQUIRED();
  }

  disposeAllChildren(container as unknown as ParentNode);
  container.innerHTML = "";

  let element: unknown;

  if (typeof component === "function") {
    element = jsx(component, {});
    if (
      typeof element === "function" &&
      (element as { __isComponent?: boolean }).__isComponent
    ) {
      element = (element as () => Node)();
    }
  } else if (
    typeof component === "object" &&
    component !== null &&
    "nodeType" in component
  ) {
    element = component;
  } else {
    throw ERRORS.RENDER_INVALID_COMPONENT();
  }

  if (
    typeof element === "object" &&
    element !== null &&
    "nodeType" in element
  ) {
    container.appendChild(element as Node);
  } else {
    throw ERRORS.RENDER_INVALID_RETURN();
  }

  return element;
}
