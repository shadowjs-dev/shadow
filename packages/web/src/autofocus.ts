import { onMount } from "@shadow-js/core";
import { isHydrating } from "@shadow-js/core/extend";

/**
 * Focuses an element written with `autoFocus` (React parity) once it is inserted into the document
 * by a client render or update. The compiler calls this for an `autoFocus` attribute and for
 * `autoFocus` keys of a spread, so an app that never uses `autoFocus` never reaches this code. Call it
 * yourself only for elements you create by hand, inside an owner (a component or a root): the focus
 * is requested with `onMount`, so development builds warn with `NO_OWNER_EFFECT` without one.
 *
 * The rules, which match React's for `autoFocus`:
 * - Once per element: the focus is requested when the element is created, after the owner has been
 *   flushed. Moving the element later (a keyed reorder) does not focus it again.
 * - An element that is not connected when its owner flushes (a detached root) is not focused.
 * - During hydration the server markup already carries `autofocus`, so the element focuses only when
 *   nothing else has the focus (the document's active element is the body or null). A user's focus
 *   is never taken away by hydration.
 *
 * @param el The element. Only `HTMLElement` and `SVGElement` are focused; for any other element, and
 * for one that cannot take focus, the call does nothing.
 * @param enabled The `autoFocus` value: falsy values (`false`, `undefined`, `""`, `0`) do nothing.
 * @example
 * import { autoFocus, render } from "@shadow-js/web";
 *
 * render(() => {
 *   const input = document.createElement("input");
 *   autoFocus(input, true); // focused once the root has mounted it
 *   return input;
 * }, document.body);
 * @since 1.0.0
 */
export function autoFocus(el: Element, enabled: unknown): void {
  if (!enabled) return;
  const hydrating = isHydrating();
  onMount(() => {
    const doc = el.ownerDocument;
    const active = doc.activeElement;
    // Hydration focuses only when nothing has the focus: the body or no element.
    const free = !hydrating || active === null || active === doc.body;
    if (el.isConnected && free && (el instanceof HTMLElement || el instanceof SVGElement)) {
      el.focus();
    }
  });
}
