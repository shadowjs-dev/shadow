import type { Accessor } from "@shadow-js/core";
import { claims, nextKey, withScope } from "../extend";
import { ssrRaw } from "../server/element";

/** The nodes between `<!--nh:KEY-->` and its `<!--/nh-->` in the lifted regions, or undefined when the server sent none. */
function findStatic(
  key: string | undefined,
  regions: readonly (readonly Node[])[] | undefined,
): Node[] | undefined {
  if (key === undefined || regions === undefined) return undefined;
  for (const region of regions) {
    const open = region.findIndex(
      (node) => node.nodeType === 8 && (node as Comment).data === `nh:${key}`,
    );
    if (open === -1) continue;
    const nodes: Node[] = [];
    let depth = 1;
    for (let i = open + 1; i < region.length; i += 1) {
      const node = region[i] as Node;
      if (node.nodeType === 8) {
        const data = (node as Comment).data;
        if (data.startsWith("nh:")) depth += 1;
        else if (data === "/nh" && --depth === 0) break;
      }
      nodes.push(node);
    }
    return nodes;
  }
  return undefined;
}

/**
 * Props of {@link NoHydration}.
 * @since 1.0.0
 */
export interface NoHydrationProps {
  /**
   * The static content. Rendered by the server without hydration keys and left untouched by the
   * browser's hydration pass.
   * @default undefined (renders nothing)
   */
  readonly children?: unknown;
}

/**
 * Content the browser never hydrates: the server renders it without hydration keys, and while the
 * page hydrates the browser leaves that markup exactly as it is (no code runs for it, no event
 * handlers or reactivity are attached). Use it for static, heavy markup such as rendered
 * documentation or a long article. Rendered by the browser alone (a client-side navigation), its
 * children render normally.
 *
 * @param props See {@link NoHydrationProps}.
 * @returns An accessor of the content: the children, or the server's own nodes while the browser hydrates.
 * @example
 * import { NoHydration } from "@shadow-js/web";
 *
 * function Docs(props: { html: string }) {
 *   return (
 *     <NoHydration>
 *       <article innerHTML={props.html} />
 *     </NoHydration>
 *   );
 * }
 * @see ClientOnly
 * @since 1.0.0
 */
export function NoHydration(props: NoHydrationProps): Accessor<unknown> {
  // The component has its own scope, so this key does not move the keys of its siblings.
  const key = nextKey();
  if (__SERVER__) {
    // No scope for the content: the keys of what is rendered inside are not handed out.
    const built = withScope(null, () => props.children);
    return () => [ssrRaw(`<!--nh:${key ?? ""}-->`), built, ssrRaw("<!--/nh-->")];
  }
  if (claims.current.isClaiming()) {
    // Hydrating: the server's nodes between the markers are handed to the region as they are.
    const kept = findStatic(key, claims.current.liftedRegions());
    if (kept !== undefined) return () => kept;
    // No markers from the server (the root of the container): render on the client, claiming nothing.
    return () => claims.current.withoutClaiming(() => props.children);
  }
  return () => props.children;
}
