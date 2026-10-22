import {
  type Accessor,
  runWithOwner,
  untrack,
  useEffect,
  useRenderEffect,
  useSignal,
} from "@shadow-js/core";
import { createOwner, pauseOwner, resumeOwner } from "@shadow-js/core/extend";

/**
 * `visible` shows the children; `hidden` keeps them alive (state, DOM and focus) but out of sight.
 * @since 1.0.0
 */
export type ActivityMode = "visible" | "hidden";

/**
 * Props of {@link Activity}.
 * @since 1.0.0
 */
export interface ActivityProps {
  /**
   * `"visible"` shows the children; `"hidden"` keeps them alive but out of sight. Changing it
   * does not rebuild the children and may be reactive.
   * @default "visible"
   */
  readonly mode?: ActivityMode;
  /**
   * The content. Built once, when the parent first renders the Activity.
   * @default undefined (the Activity renders nothing)
   */
  readonly children?: unknown;
}

/** What a hidden Activity changed in the DOM, so showing it restores exactly that. */
interface Stash {
  readonly elements: Array<readonly [HTMLElement, string]>;
  readonly texts: Array<{ readonly text: Text; readonly parent: Node; readonly next: Node | null }>;
  readonly scrolls: Array<readonly [Element, number, number]>;
  readonly focus: Element | null;
}

/**
 * Hides the nodes between two anchors without removing them. Top-level elements get
 * `display: none` (their own state, subtree and listeners are untouched). Top-level text nodes are
 * detached (a text node cannot be hidden) and put back in order when shown. Scroll offsets and the
 * focused element are remembered, because `display: none` loses both.
 */
function stashBetween(start: Node, end: Node): Stash | undefined {
  const parent = start.parentNode;
  if (parent === null) return undefined;
  const elements: Array<readonly [HTMLElement, string]> = [];
  const texts: Stash["texts"][number][] = [];
  const scrolls: Array<readonly [Element, number, number]> = [];
  const active = document.activeElement;
  let focus: Element | null = null;
  let node: Node | null = start.nextSibling;
  while (node !== null && node !== end) {
    const next: Node | null = node.nextSibling;
    if (node.nodeType === 1) {
      const element = node as HTMLElement;
      elements.push([element, element.style.display]);
      element.style.display = "none";
      for (const scrollable of [element, ...Array.from(element.querySelectorAll("*"))]) {
        if (scrollable.scrollTop !== 0 || scrollable.scrollLeft !== 0) {
          scrolls.push([scrollable, scrollable.scrollTop, scrollable.scrollLeft]);
        }
      }
      if (active !== null && element.contains(active)) focus = active;
    } else if (node.nodeType === 3) {
      texts.push({ text: node as Text, parent, next });
      parent.removeChild(node);
    }
    node = next;
  }
  return { elements, texts, scrolls, focus };
}

/** Puts back what {@link stashBetween} changed. Texts are restored last-to-first, so each finds its next. */
function restore(stash: Stash, end: Node): void {
  for (let i = stash.texts.length - 1; i >= 0; i -= 1) {
    const entry = stash.texts[i];
    if (entry === undefined || entry.text.parentNode !== null) continue;
    const before = entry.next !== null && entry.next.parentNode === entry.parent ? entry.next : end;
    entry.parent.insertBefore(entry.text, before);
  }
  for (const [element, display] of stash.elements) element.style.display = display;
  for (const [element, top, left] of stash.scrolls) {
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  const focus = stash.focus;
  if (focus instanceof HTMLElement && focus.isConnected) focus.focus({ preventScroll: true });
}

/**
 * Keeps its children alive while hidden: `mode="hidden"` removes them from sight but keeps their state,
 * their DOM nodes and their focus and scroll position. Hidden content is paused: its effects run their
 * cleanups and wait, its memos keep their last value, and its DOM does not update. Updates that arrive
 * while hidden are applied once, when the content is shown again.
 *
 * Use it for tabs, wizards and routes you want back instantly. A hidden Activity mounted hidden renders
 * its DOM once (so it is ready to show) and runs no effects until it is shown. The server renders the
 * children without hiding them; the client hides them once it hydrates.
 *
 * @param props See {@link ActivityProps}.
 * @returns An accessor of the content (two anchors and the children).
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { Activity } from "@shadow-js/web";
 *
 * function Chat() {
 *   return <p>Chat</p>;
 * }
 *
 * function Tabs() {
 *   const [tab] = useSignal("chat");
 *   return (
 *     <Activity mode={tab() === "chat" ? "visible" : "hidden"}>
 *       <Chat />
 *     </Activity>
 *   );
 * }
 * @see Show
 * @since 1.0.0
 */
export function Activity(props: ActivityProps): Accessor<unknown> {
  if (__SERVER__) return () => props.children;
  // The content lives under its own owner, so pausing it reaches every effect and memo it created.
  const content = createOwner();
  // Built when the parent first reads it, not here: the server builds children at the same point of the
  // render, which keeps hydration keys equal on both sides.
  let built: unknown;
  let ready = false;
  const contentValue = (): unknown => {
    if (!ready) {
      ready = true;
      built = runWithOwner(content, () => untrack(() => props.children));
    }
    return built;
  };
  // Empty text anchors bound the content: the DOM range the visibility code hides and shows.
  const start = document.createTextNode("");
  const end = document.createTextNode("");
  const [hidden, setHidden] = useSignal(false);
  let paused = false;
  // Pausing happens in the render phase, before the content's own effects can run.
  useRenderEffect(
    () => props.mode === "hidden",
    (isHidden) => {
      if (isHidden === paused) return;
      paused = isHidden;
      if (isHidden) pauseOwner(content);
      else resumeOwner(content);
      setHidden(isHidden);
    },
  );
  // Runs after the DOM is committed (a user effect), so the nodes it hides exist.
  let stash: Stash | undefined;
  useEffect(() => {
    if (hidden()) {
      if (stash === undefined) stash = stashBetween(start, end);
    } else if (stash !== undefined) {
      const previous = stash;
      stash = undefined;
      restore(previous, end);
    }
  });
  return () => [start, contentValue(), end];
}
