import { type Accessor, flushSync, untrack, useEffect, useId } from "@shadow-js/core";

/** The subset of `Document` the View Transitions API adds (not yet in every TypeScript lib). */
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: (() => void) | { update: () => void; types?: string[] }) => {
    finished: Promise<unknown>;
  };
};

/**
 * Options of {@link startViewTransition}.
 * @since 1.0.0
 */
export interface ViewTransitionOptions {
  /**
   * Transition types for this update. CSS selects phases with `:active-view-transition-type(name)`,
   * so one update can animate differently from another (for example forward and back navigation).
   * Ignored where the browser has no View Transitions API.
   * @default undefined (no types: the update runs as a plain transition)
   */
  readonly types?: readonly string[];
}

/**
 * Runs `update` inside a browser view transition, so the change animates from the old screen to the
 * new one, and resolves when the animation has finished. Without the API (older browsers, or a
 * server) the update runs at once and the promise resolves. Motion preferences are handled by the
 * browser and by the CSS of the page (`prefers-reduced-motion`).
 *
 * The update runs synchronously inside the transition's callback, flushed with {@link flushSync},
 * so the new DOM is what the browser captures. An error thrown by the update rejects the promise.
 *
 * @param update Changes the state the page shows. Called once, synchronously inside the transition
 * (or at once without the API).
 * @param options `types` for CSS phase selectors; see {@link ViewTransitionOptions}. Undefined
 * starts a transition without types.
 * @returns A promise that resolves when the transition has finished (or at once without the API).
 * It rejects with the error `update` threw.
 * @throws Nothing synchronously. An error thrown by `update` rejects the returned promise.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { startViewTransition } from "@shadow-js/web";
 *
 * const [, setPage] = useSignal("home");
 * async function openSettings() {
 *   await startViewTransition(() => setPage("settings"), { types: ["forward"] });
 * }
 * @see ViewTransition
 * @since 1.0.0
 */
export function startViewTransition(
  update: () => void,
  options?: ViewTransitionOptions,
): Promise<void> {
  const doc = typeof document === "undefined" ? undefined : (document as ViewTransitionDocument);
  if (doc === undefined || typeof doc.startViewTransition !== "function") {
    try {
      flushSync(update);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }
  let failure: { readonly error: unknown } | undefined;
  const callback = (): void => {
    try {
      flushSync(update);
    } catch (error) {
      failure = { error };
    }
  };
  const types = options?.types;
  const transition = doc.startViewTransition(
    types === undefined || types.length === 0 ? callback : { update: callback, types: [...types] },
  );
  return transition.finished.then(() => {
    if (failure !== undefined) throw failure.error;
  });
}

/**
 * Props of {@link ViewTransition}.
 * @since 1.0.0
 */
export interface ViewTransitionProps {
  /**
   * The transition name (`view-transition-name`). Elements with the same name in the old and the new
   * screen are animated as one (`share`); an element that appears or disappears with a name animates
   * in (`enter`) or out (`exit`). `true` makes a unique name.
   * @default undefined (no inline `view-transition-name` is set on the element)
   */
  readonly name?: string | true;
  /**
   * The transition class (`view-transition-class`), to style a group of named elements at once.
   * @default undefined (no inline `view-transition-class` is set)
   */
  readonly class?: string;
  /**
   * The content. Its first element receives the name and class.
   * @default undefined (renders nothing)
   */
  readonly children?: unknown;
}

/**
 * Gives the first element of its children a view transition name and class, so the browser animates
 * that element between the old and the new screen: it enters (an element that appears with the name),
 * exits (one that disappears), updates (the same name with new content) and shares (the same name on
 * both screens, moved or resized). The phases are the browser's own; select them in CSS with
 * `::view-transition-old(name)`, `::view-transition-new(name)` and `:active-view-transition-type()`.
 * `exit="none"` is not offered: the browser decides an exit before the update runs.
 *
 * No wrapper element is added. Without the browser API the name and class are only styles, so the
 * component renders correctly everywhere.
 *
 * @param props See {@link ViewTransitionProps}.
 * @returns An accessor of the content (two anchors and the children).
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { ViewTransition } from "@shadow-js/web";
 *
 * function Hero() {
 *   const [src] = useSignal("/hero.png");
 *   return (
 *     <ViewTransition name="hero">
 *       <img src={src()} />
 *     </ViewTransition>
 *   );
 * }
 * @see startViewTransition
 * @since 1.0.0
 */
export function ViewTransition(props: ViewTransitionProps): Accessor<unknown> {
  if (__SERVER__) return () => props.children;
  // Built once, when the parent first renders it (as Activity does): the server builds it at the same point.
  let built: unknown;
  let ready = false;
  const contentValue = (): unknown => {
    if (!ready) {
      ready = true;
      built = untrack(() => props.children);
    }
    return built;
  };
  const start = document.createTextNode("");
  const end = document.createTextNode("");
  const generated = props.name === true ? `vt-${useId()}` : undefined;
  // Runs after the DOM is committed, so the element it styles exists.
  useEffect(() => {
    const element = firstElementBetween(start, end);
    if (element === null) return;
    const name = generated ?? (typeof props.name === "string" ? props.name : undefined);
    setOrClear(element, "view-transition-name", name);
    setOrClear(element, "view-transition-class", props.class);
  });
  return () => [start, contentValue(), end];
}

/** The first element between two anchors, or null. */
function firstElementBetween(start: Node, end: Node): HTMLElement | null {
  for (let node = start.nextSibling; node !== null && node !== end; node = node.nextSibling) {
    if (node.nodeType === 1) return node as HTMLElement;
  }
  return null;
}

function setOrClear(element: HTMLElement, property: string, value: string | undefined): void {
  if (value === undefined || value === "") element.style.removeProperty(property);
  else element.style.setProperty(property, value);
}
