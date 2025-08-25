/**
 * Shadow JSX runtime entry.
 *
 * This is what SWC/Vite import when using the "automatic" JSX runtime:
 *   - jsx/jsxs/jsxDEV: the factory functions to create elements.
 *   - Fragment: to group children without extra DOM nodes.
 *
 * It also declares the global JSX namespace so TypeScript can type-check
 * intrinsic elements and attributes when `jsxImportSource: "@shadow-js/core"`
 * is configured.
 */
export { jsx, jsxs, jsxDEV } from "./runtime/jsx";
export { Fragment } from "./runtime/Fragment";

// Provide JSX namespace here so TypeScript finds it via jsxImportSource
export {};

export type ShadowElement =
  | Node
  | globalThis.Element
  | DocumentFragment
  | Promise<Node | globalThis.Element | DocumentFragment>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    /**
     * Accept any HTML/SVG tag initially. Frameworks usually refine this.
     */
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>;
    }

    /**
     * Common JSX attributes recognized by ShadowJS.
     */
    interface IntrinsicAttributes {
      ref?: (element: import("./jsx-runtime").ShadowElement) => void | { current: import("./jsx-runtime").ShadowElement | null };
    }
  }
}
