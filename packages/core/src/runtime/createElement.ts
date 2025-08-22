import { jsx } from "./jsx";

/**
 * Shadow's `createElement` function used by the JSX transform when
 * `jsxImportSource: "@shadow-js/core"` is set. Delegates to `jsx`.
 *
 * @param tag The tag name (e.g., "div") or a component function.
 * @param props Props object passed from JSX.
 * @param children Children passed by JSX variadic arguments.
 * @returns A DOM element or a MatchMarker (for <Match> in <Switch>).
 */
export function createElement(
  tag: unknown,
  props?: Record<string, unknown>,
  ...children: unknown[]
): unknown {
  const finalProps = { ...(props || {}) };
  if (children.length > 0) {
    finalProps.children = children.length === 1 ? children[0] : children;
  }
  return jsx(tag, finalProps);
}
