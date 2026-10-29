import { batch, untrack, useRenderEffect } from "@shadow-js/core";
import { setAttribute, setBoolAttribute } from "./attributes";
import { style } from "./class-style";
import { insert } from "./insert";
import { checkClaimedTag } from "./internal/claim";
import { claims } from "./internal/hydration-hooks";
import { nextKey } from "./internal/hydration-scope";
import { isFlagAttribute } from "./internal/react-names";
import { ssrElement, ssrRaw } from "./server/element";
import { isTextOnlyElement } from "./server/raw-text";

/**
 * The slim element primitive: one HTML element with attributes, event listeners, `ref` and children,
 * and no generic prop runtime. `Dynamic` and `spread` cover every prop shape; this covers the common
 * ones, so a library that renders one fixed element (a link, a button) pays for what it binds.
 *
 * It keeps the renderer's contracts: the hydration key is drawn when the element is created, so it
 * claims the server's element and adopts its children; on the server it writes the same markup `Dynamic`
 * writes for the tag.
 */

/** Tag shape that `Dynamic` accepts. `script` is refused for the same reason. */
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/i;

/** `onClick` to `click`, when the key is an event handler name. */
function eventNameOf(key: string): string | undefined {
  return key.length > 2 && key.startsWith("on") && /^[A-Z]/.test(key.charAt(2))
    ? key.slice(2).toLowerCase()
    : undefined;
}

/**
 * Binds one listener, read once. A function runs with the element as `this`; a `[fn, data]` tuple
 * receives `data` first. `null`, `undefined` and `false` bind nothing. Handlers run in a batch and
 * untracked, as the event binding of `Dynamic` runs them.
 */
function bindListener(el: Element, name: string, handler: unknown): void {
  let call: ((event: Event) => unknown) | undefined;
  if (typeof handler === "function") {
    call = (event: Event): unknown => handler.call(el, event);
  } else if (Array.isArray(handler)) {
    const [fn, data] = handler as [unknown, unknown];
    if (typeof fn === "function") call = (event: Event): unknown => fn.call(el, data, event);
  }
  if (call === undefined) return;
  const run = call;
  el.addEventListener(name, (event: Event): void => {
    batch(() => untrack(() => run(event)));
  });
}

/**
 * Creates one HTML element from a tag name and a props object, without the generic prop runtime of
 * `spread` and `Dynamic`: for a library that renders one fixed element (a link, a button) and wants
 * to pay only for what it binds. It draws a hydration key, so during `hydrate()` it adopts the
 * server's element and its children; on the server it returns the markup `Dynamic` writes for the tag.
 *
 * Each prop other than `children`, `ref` and `onX` is read in a render effect, so a getter prop
 * updates the element in place. `class` and the other attributes follow {@link setAttribute} (URL
 * attributes that would run script are refused); `style` follows {@link style}. Use `Dynamic` when the
 * tag is not known in advance, or for SVG, `classList`, delegated events or React prop names.
 *
 * @param tag An HTML tag name matching `[a-z][a-z0-9-]*` (any case), such as `"a"`. `script` is
 * refused.
 * @param props The element's props. `onX` keys whose third letter is uppercase are native listeners,
 * read once: the rest of the key lowercased is the event (`onClick` is `click`), and the value is a
 * function (called with the element as `this`) or a `[fn, data]` tuple (called as `fn(data, event)`);
 * handlers run batched and untracked. `ref` is called once with the element. `children` is inserted
 * (a getter keeps it reactive). `class` takes a string; `style` a string or an object.
 * @returns The element on the client; its server markup when rendering on the server.
 * @throws TypeError `SHADOW_ELEMENT_TAG` when `tag` is not an allowed tag name.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { element } from "@shadow-js/web";
 *
 * function HomeLink() {
 *   const [active] = useSignal(true);
 *   return element("a", {
 *     href: "/",
 *     get "aria-current"() { return active() ? "page" : undefined; },
 *     onClick: (event: MouseEvent) => console.log(event.type),
 *     children: "Home",
 *   });
 * }
 * @see spread
 * @since 1.0.0
 */
export function element(tag: string, props: object): unknown {
  if (!TAG_PATTERN.test(tag) || tag.toLowerCase() === "script") {
    throw new TypeError(__DEV__ ? "ShadowJS element: invalid tag" : "SHADOW_ELEMENT_TAG");
  }
  const read = props as Readonly<Record<string, unknown>>;
  if (__SERVER__) {
    // The children are read after the hydration key is drawn, in the order the client claims them.
    return ssrElement(
      tag,
      props,
      () => {
        const children = read["children"];
        // The content of a style or a title is text the parser reads whole: no markers can go in it.
        if (children === undefined || isTextOnlyElement(tag)) return children;
        return [ssrRaw("<!--[-->"), children, ssrRaw("<!--]-->")];
      },
      true,
    );
  }
  const claimed = claims.current.claimElement(nextKey());
  if (claimed !== null && __DEV__) checkClaimedTag(claimed, tag);
  const el = claimed ?? document.createElement(tag);
  for (const key of Object.keys(props)) {
    if (key === "children" || key === "ref") continue;
    const event = eventNameOf(key);
    if (event !== undefined) {
      bindListener(el, event, read[key]);
    } else if (key === "style") {
      // The last value written, so a property that leaves the style object is removed (as spread does).
      let applied: unknown;
      useRenderEffect(
        () => read[key],
        (value) => {
          applied = style(el as HTMLElement, value, applied);
        },
      );
    } else {
      useRenderEffect(
        () => read[key],
        (value) => {
          // The server writes a boolean attribute by truthiness; the client does the same. A name
          // that is a flag has no React spelling, so lower case is its attribute name.
          const name = key.toLowerCase();
          if (isFlagAttribute(name, value)) setBoolAttribute(el, name, value);
          else setAttribute(el, key, value);
        },
      );
    }
  }
  const ref = read["ref"];
  if (typeof ref === "function") untrack(() => ref(el));
  insert(el, () => read["children"]);
  return el;
}
