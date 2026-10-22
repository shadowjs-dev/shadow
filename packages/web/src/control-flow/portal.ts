import { createRoot, isServer, onCleanup, useContext, useRenderEffect } from "@shadow-js/core";
import {
  bindRegion,
  childScope,
  claims,
  createRegion,
  nextKey,
  PortalContext,
  type Region,
  removeRegion,
  withScope,
} from "../extend";
import { renderServerPortal } from "../server/portals";

/**
 * Props of {@link Portal}.
 * @since 1.0.0
 */
export interface PortalProps {
  /**
   * The element that receives the content, or a function returning it (read reactively). A null
   * target, or a function that returns null or undefined, renders nothing and warns once in
   * development (`PORTAL_TARGET_MISSING`).
   * @default document.body (when the prop is omitted)
   */
  readonly mount?: Element | null | (() => Element | null | undefined);
  /**
   * Put the content in a shadow root of the mount, created once and reused. A portal with a shadow
   * root is not server-rendered; the browser creates it.
   * @default false
   */
  readonly useShadow?: boolean;
  /**
   * Reserved for namespace handling. Nodes are inserted as they were created, so the flag does not
   * change the output yet.
   * @default false
   */
  readonly isSVG?: boolean;
  /**
   * The content: a node, text, an array, or an accessor returning them.
   * @default undefined (nothing is rendered)
   */
  readonly children?: unknown;
}

/** What the portal holds while content is mounted: where it is, its region, and its effects. */
interface Mounted {
  readonly host: Node;
  readonly region: Region;
  /** Stops the content's effects. The nodes stay where they are. */
  readonly stopEffects: () => void;
}

/**
 * How the content of a mount is built. `claimed`: the server markup is adopted (the templates claim
 * it). `unclaimed`: hydrating, but the server sent nothing for this portal, so it is built fresh.
 */
type MountMode = "plain" | "claimed" | "unclaimed";

/** A node that can be moved in place (`Element.prototype.moveBefore`, where implemented). */
interface MovableNode extends Node {
  moveBefore(node: Node, child: Node | null): void;
}

/** Appends `node` to `target`, moving it in place when the target supports `moveBefore`. */
function appendMoved(target: Node, node: Node): void {
  if (typeof (target as Partial<MovableNode>).moveBefore === "function") {
    (target as MovableNode).moveBefore(node, null);
  } else {
    target.appendChild(node);
  }
}

/** The shadow root of an element, attached once when the element has none. */
function shadowRootOf(host: Element): ShadowRoot {
  return host.shadowRoot ?? host.attachShadow({ mode: "open" });
}

/** The mount target of a `mount` prop: the default body, the element, or the function's result. */
function resolveMount(mount: PortalProps["mount"]): Element | null {
  if (mount === undefined) return document.body;
  const value = typeof mount === "function" ? mount() : mount;
  return value ?? null;
}

/**
 * Renders `children` into another part of the document, without a wrapper: the content nodes are
 * inserted directly into the mount element (or its shadow root). Nothing is left at the call site.
 * Disposing the owner removes exactly the nodes the portal inserted; nodes that were already in the
 * mount stay. A reactive `mount` moves the content, and static nodes keep their identity while they
 * move.
 *
 * On the server the content is rendered into the render's `portals` collector (see
 * `createServerPortals`), and the document emits it at the end of `<body>`. When the browser hydrates
 * the portal it adopts that markup instead of creating it again, moving it into the mount if the mount
 * is not `body`. A portal with `useShadow` is not server-rendered; the browser creates it.
 *
 * Events follow the DOM tree. Delegated handlers inside the content fire when the mount is in the
 * document, because the document listener sees the event bubble past the mount. Handlers on
 * elements that wrap the call site do not fire.
 *
 * @param props See {@link PortalProps}.
 * @returns Always null: the portal renders nothing in place.
 * @example
 * import { Portal } from "@shadow-js/web";
 *
 * function Modal() {
 *   return <div role="dialog">Hello</div>;
 * }
 *
 * function App() {
 *   return (
 *     <Portal mount={document.getElementById("modal-root")}>
 *       <Modal />
 *     </Portal>
 *   );
 * }
 * @see Dynamic
 * @since 1.0.0
 */
export function Portal(props: PortalProps): null {
  // The key of this portal's server block, taken at the call site on the server and in the browser
  // alike. The content renders in a scope of its own (`childScope`), so the keys of the siblings do
  // not depend on whether the content rendered.
  const key = nextKey();
  // A server render provides the portal collector (`renderToString` and friends), so it is recognized
  // by the collector as well as by the build's `isServer` flag: the same server code runs in both.
  const sink = useContext(PortalContext);
  if (isServer || sink !== null) {
    if (props.useShadow !== true) renderServerPortal(key, () => props.children, sink);
    return null;
  }
  let mounted: Mounted | undefined;
  let warned = false;
  // The server block of this portal, taken out of the markers while hydrating; used by the first mount.
  let adopted: Node[] | undefined = claims.current.claimPortal(key);

  /** Stops the content's effects, then removes its nodes. Safe to call when nothing is mounted. */
  const unmount = (): void => {
    const current = mounted;
    if (current === undefined) return;
    mounted = undefined;
    current.stopEffects();
    removeRegion(current.region);
  };

  /** Creates the content region in `host`, adopting the nodes that are already there. */
  const mountInto = (host: Node, initial: Node[], mode: MountMode): Mounted => {
    const region = createRegion(host, null, initial);
    const stopEffects = createRoot((dispose) => {
      const bind = (): void => {
        bindRegion(region, () => props.children);
      };
      if (mode === "plain") bind();
      else if (mode === "claimed") withScope(childScope(key), bind);
      else claims.current.withoutClaiming(() => withScope(childScope(key), bind));
      return dispose;
    });
    return { host, region, stopEffects };
  };

  /** Moves the content to `target`. The nodes move first, then the children are bound again. */
  const moveTo = (target: Node): void => {
    const previous = mounted;
    if (previous === undefined) {
      const initial = adopted ?? [];
      let mode: MountMode = "plain";
      if (adopted !== undefined) mode = "claimed";
      else if (key !== undefined && claims.current.isClaiming()) mode = "unclaimed";
      adopted = undefined;
      for (const node of initial) {
        if (node.parentNode !== target) appendMoved(target, node);
      }
      mounted = mountInto(target, initial, mode);
      return;
    }
    const nodes = previous.region.nodes.filter((node) => node.parentNode === previous.host);
    previous.stopEffects();
    for (const node of nodes) appendMoved(target, node);
    mounted = mountInto(target, nodes, "plain");
  };

  useRenderEffect(
    () => {
      const host = resolveMount(props.mount);
      const shadow = props.useShadow === true;
      return { host, shadow };
    },
    ({ host, shadow }) => {
      if (host === null) {
        unmount();
        if (__DEV__ && !warned) {
          warned = true;
          console.warn(
            "[shadow PORTAL_TARGET_MISSING] Portal has no mount element; nothing is rendered.",
          );
        }
        return;
      }
      const target: Node = shadow ? shadowRootOf(host) : host;
      if (mounted !== undefined && mounted.host === target) return;
      moveTo(target);
    },
  );
  onCleanup(unmount);
  return null;
}
