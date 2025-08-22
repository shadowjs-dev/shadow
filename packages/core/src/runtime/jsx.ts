/**
 * ShadowJS JSX Runtime
 *
 * This module implements the core JSX runtime for ShadowJS, providing:
 * - **Intrinsic element creation**: HTML and SVG element rendering
 * - **Function component execution**: Component lifecycle and scoping
 * - **Reactive child sections**: Fine-grained reactivity for child content
 * - **Props handling**: Attribute, style, and event management
 * - **Async support**: Promise/thenable handling without uncaught rejections
 *
 * The runtime uses a sophisticated two-phase dependency tracking system:
 * 1. **Collection Phase**: Gather dependencies without executing components
 * 2. **Execution Phase**: Render content with proper reactive scoping
 *
 * This prevents cross-tracking issues between parent and child components
 * while maintaining fine-grained reactivity throughout the component tree.
 */

import { Match } from "./Switch";
import { useEffect, untrack } from "../reactivity/hooks/useEffect";
import { onCleanup } from "../reactivity/hooks/onCleanup";
import {
  disposeBetween,
  markComponentBoundary,
  popComponentScope,
  pushComponentScope,
  runInScope,
} from "./lifecycle";
import { ERRORS } from "../errors";
import { warn } from "./shared/warn";
import { isComponentThunk } from "./shared/isComponentThunk";

export type MatchMarker = {
  __isMatch: true;
  type: typeof Match;
  props: Record<string, unknown>;
  $$typeof?: symbol;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const SVG_ONLY_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "marker",
  "defs",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "pattern",
  "stop",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "symbol",
  "use",
  "view",
  "image",
  "animate",
  "animateTransform",
  "animateMotion",
  "mpath",
]);

const BOOLEAN_ATTRS = new Set([
  "checked",
  "disabled",
  "selected",
  "readonly",
  "required",
  "hidden",
  "multiple",
  "autofocus",
  "autoplay",
  "controls",
  "loop",
  "muted",
  "open",
  "playsinline",
  "inert",
]);

type ComponentThunk = (() => Node) & { __isComponent: true };

// update appendContent to support component thunks
function appendContent(
  parent: ParentNode,
  before: ChildNode | null,
  value: unknown
) {
  const insert = (val: unknown) => {
    if (val === null || val === undefined || typeof val === "boolean") return;

    // Component thunk
    if (typeof val === "function" && isComponentThunk(val)) {
      try {
        const node = val();
        parent.insertBefore(node, before);
      } catch {
        // Silently handle component thunk errors in JSX
      }
      return;
    }

    // Plain function: unwrap it and insert the result
    if (typeof val === "function") {
      try {
        insert(val());
      } catch {
        // Silently handle function evaluation errors in JSX
      }
      return;
    }

    if (typeof val === "object" && val !== null && "nodeType" in val) {
      parent.insertBefore(val as Node, before);
      return;
    }
    if (Array.isArray(val)) {
      val.forEach((x) => insert(x));
      return;
    }
    parent.insertBefore(document.createTextNode(String(val)), before);
  };

  insert(value);
}

// create a lazy component thunk
function createComponentThunk(
  tag: (props: Record<string, unknown>) => unknown,
  props: Record<string, unknown>,
  children: unknown
): ComponentThunk {
  const thunk = (() => {
    return () => {
      const scope = pushComponentScope();

      const frag = document.createDocumentFragment();
      const start = document.createComment("comp-s");
      const end = document.createComment("comp-e");
      frag.appendChild(start);
      frag.appendChild(end);
      markComponentBoundary(start, end, scope);

      let result: unknown;
      let threwThenable: Promise<unknown> | null = null;

      try {
        result = (tag as (props: Record<string, unknown>) => unknown)({
          ...props,
          children,
        });
      } catch (err: unknown) {
        if (err && typeof (err as { then?: unknown }).then === "function") {
          threwThenable = err as Promise<unknown>;
        } else {
          popComponentScope();
          throw err;
        }
      }

      const parentAppendResolved = (resolved: unknown) => {
        const parent = start.parentNode as ParentNode | null;
        if (!parent) return;

        let nodeOrValue = resolved;

        if (typeof resolved === "function" && !isComponentThunk(resolved)) {
          nodeOrValue = runInScope(scope, () =>
            (resolved as (props: Record<string, unknown>) => unknown)({
              ...props,
              children,
            })
          );
        }

        appendContent(parent, end, nodeOrValue);
      };

      if (result && typeof (result as { then?: unknown }).then === "function") {
        (result as Promise<unknown>).then(
          (r) => parentAppendResolved(r),
          () => {}
        );
        popComponentScope();
        return frag;
      }

      if (threwThenable) {
        (threwThenable as Promise<unknown>).then(
          (r) => parentAppendResolved(r),
          () => {}
        );
        popComponentScope();
        return frag;
      }

      const parent = frag as unknown as ParentNode;
      appendContent(parent, end, result);
      popComponentScope();
      return frag;
    };
  })() as unknown as ComponentThunk;

  (thunk as { __isComponent: true }).__isComponent = true;
  return thunk;
}

// Two-phase dependency collection guard:
// When true, function components should not execute.
let __collectingDeps = false;

function createReactiveSection(parent: Element, valueOrFunction: unknown) {
  const start = document.createComment("r-s");
  const end = document.createComment("r-e");
  parent.appendChild(start);
  parent.appendChild(end);

  // Give this region its own scope so cleanups fire when removed
  const regionScope = pushComponentScope();
  markComponentBoundary(start, end, regionScope);

  const update = () => {
    const p = start.parentNode as ParentNode | null;
    if (!p) return;

    // Phase 1: tracked pass — collect only guard deps (e.g., show/hide)
    if (typeof valueOrFunction === "function") {
      try {
        __collectingDeps = true;
        // We ignore this value; we're only collecting deps here.
        (valueOrFunction as () => unknown)();
      } catch (err: unknown) {
        if (!err || typeof (err as { then?: unknown }).then !== "function") {
          // non-thenable errors ignored during collection
        }
      } finally {
        __collectingDeps = false;
      }
    }

    // Phase 2: untracked render — compute and mount nodes
    const next: unknown = untrack(() => {
      let v =
        typeof valueOrFunction === "function"
          ? (valueOrFunction as () => unknown)()
          : valueOrFunction;
      try {
        if (typeof v === "function") v = v();
      } catch {
        // Silently handle function evaluation errors in reactive sections
      }
      return v;
    });

    disposeBetween(start, end);

    // IMPORTANT: mount untracked to avoid parent effect subscribing to child stores
    untrack(() => appendContent(p, end, next));
  };

  update();
  useEffect(update);

  // Pop after registering effects so they bind to regionScope
  popComponentScope();
}

function applyProp(
  el: Element,
  rawName: string,
  value: unknown,
  isSvg: boolean
): void {
  if (rawName === "ref") return;
  if (rawName.startsWith("on")) return;

  const name =
    rawName === "className" ? "class" : rawName === "htmlFor" ? "for" : rawName;

  if (
    typeof value === "function" &&
    !(value as { __isStore?: boolean }).__isStore
  ) {
    useEffect(() => {
      setProp(el, name, value(), isSvg);
    });
  } else if (
    typeof value === "function" &&
    (value as { __isStore?: boolean }).__isStore
  ) {
    useEffect(() => {
      setProp(el, name, (value as () => unknown)(), isSvg);
    });
  } else {
    setProp(el, name, value, isSvg);
  }
}

function setProp(
  el: Element,
  name: string,
  value: unknown,
  isSvg: boolean
): void {
  if (name === "dangerouslySetInnerHTML") {
    const html =
      value && typeof value === "object" && value !== null
        ? String((value as { __html?: unknown }).__html ?? "")
        : "";
    (el as HTMLElement).innerHTML = html;
    return;
  }

  if (name === "class") {
    if (value == null || value === false) {
      if (isSvg) el.removeAttribute("class");
      else (el as HTMLElement).className = "";
    } else {
      const next =
        Array.isArray(value) || value instanceof Set
          ? Array.from(value).join(" ")
          : String(value);
      if (isSvg) el.setAttribute("class", next);
      else (el as HTMLElement).className = next;
    }
    return;
  }

  if (name === "style") {
    const style = (el as HTMLElement).style as CSSStyleDeclaration;
    if (value == null || value === false) {
      (el as HTMLElement).removeAttribute("style");
      return;
    }
    if (typeof value === "string") {
      style.cssText = value;
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        (style as unknown as Record<string, string | number>)[k] = String(v);
      }
      return;
    }
    (el as HTMLElement).setAttribute("style", String(value));
    return;
  }

  if (name === "value" && "value" in el) {
    if (
      (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)
        .value !== (value ?? "")
    ) {
      (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value =
        String(value ?? "");
    }
    return;
  }
  if (name === "checked" && "checked" in el) {
    (el as HTMLInputElement).checked = !!value;
    return;
  }
  if (name === "selected" && "selected" in el) {
    (el as HTMLOptionElement).selected = !!value;
    return;
  }
  if (name === "muted" && "muted" in el) {
    (el as HTMLMediaElement).muted = !!value;
    return;
  }

  if (BOOLEAN_ATTRS.has(name)) {
    if (value) {
      el.setAttribute(name, "");
    } else {
      el.removeAttribute(name);
    }
    return;
  }

  if (name.startsWith("data-") || name.startsWith("aria-")) {
    if (value == null || value === false) el.removeAttribute(name);
    else el.setAttribute(name, String(value));
    return;
  }

  if (name.startsWith("xlink:")) {
    const local = name.slice(6);
    if (value == null || value === false)
      (el as SVGElement).removeAttributeNS(XLINK_NS, local);
    else (el as SVGElement).setAttributeNS(XLINK_NS, name, String(value));
    return;
  }

  if (value == null || value === false) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, String(value));
  }
}

function createDomElement(tag: string): Element {
  let t = tag;
  let forceSvg = false;
  if (t.startsWith("svg:")) {
    forceSvg = true;
    t = t.slice(4);
  }
  const isSvgTag = t === "svg" || SVG_ONLY_TAGS.has(t);
  if (forceSvg || isSvgTag) {
    return document.createElementNS(SVG_NS, t);
  }
  return document.createElement(t);
}

type EventBinding = {
  listener: EventListener;
  handler: EventListener | null;
};

const __eventMap = new WeakMap<Element, Map<string, EventBinding>>();

function getEventMap(el: Element): Map<string, EventBinding> {
  let m = __eventMap.get(el);
  if (!m) {
    m = new Map();
    __eventMap.set(el, m);
  }
  return m;
}

function bindEvent(el: Element, rawName: string, value: unknown) {
  const eventName = rawName.toLowerCase().slice(2);
  const map = getEventMap(el);

  let binding = map.get(eventName);
  if (!binding) {
    const state: EventBinding = {
      listener: (e: Event) => {
        if (state.handler) {
          try {
            state.handler(e);
          } catch {
            // Silently handle promise resolution errors
          }
        }
      },
      handler: null,
    };
    el.addEventListener(eventName, state.listener);
    map.set(eventName, state);
    binding = state;

    onCleanup(() => {
      try {
        el.removeEventListener(eventName, state.listener);
      } catch {
        // Silently handle event listener removal errors
      }
      map.delete(eventName);
    });
  }

  if (
    typeof value === "function" &&
    (value as { __isStore?: boolean }).__isStore
  ) {
    useEffect(() => {
      const next = (value as () => unknown)();
      const rec = map.get(eventName)!;
      rec.handler = typeof next === "function" ? (next as EventListener) : null;
    });
  } else {
    binding.handler =
      typeof value === "function" ? (value as EventListener) : null;
  }
}

/**
 * Core JSX function for ShadowJS.
 *
 * This function handles the creation of JSX elements, both intrinsic HTML/SVG elements
 * and custom function components. It implements ShadowJS's unique approach to reactive
 * JSX with component thunking and fine-grained reactivity.
 *
 * Processing Logic:
 * 1. **Match Components**: Handle `<Match>` sentinels for Switch statements
 * 2. **Function Components**: Create lazy component thunks for function tags
 * 3. **Intrinsic Elements**: Create DOM elements for string tags
 * 4. **Props Processing**: Handle attributes, events, refs, and styles
 * 5. **Children Rendering**: Set up reactive sections for child content
 *
 * @param tag - Component tag (function component or string element name)
 * @param props - Component props including children
 * @returns JSX result (Element, Fragment, or ComponentThunk)
 *
 * @example
 * ```tsx
 * // Intrinsic element
 * jsx("div", { className: "container", children: "Hello" })
 * // → <div class="container">Hello</div>
 *
 * // Function component
 * jsx(MyComponent, { name: "World" })
 * // → ComponentThunk that renders MyComponent
 * ```
 */
export const jsx = (
  tag: unknown,
  props: Record<string, unknown> = {}
): unknown => {
  const { children, ...otherProps } = props || {};

  // Handle <Match> sentinel first (before narrowing tag)
  if (tag === Match) {
    return {
      __isMatch: true,
      type: Match,
      props: { ...otherProps, children },
    } as MatchMarker;
  }

  // Function component => return lazy component thunk (do not execute now)
  if (typeof tag === "function") {
    // During dependency collection, don't execute components; return a noop thunk.
    if (__collectingDeps) {
      const noop = (() =>
        document.createComment("collect")) as unknown as ComponentThunk;
      (noop as { __isComponent: true }).__isComponent = true;
      return noop;
    }
    return createComponentThunk(
      tag as (props: Record<string, unknown>) => unknown,
      otherProps,
      children
    );
  }

  // Must be an intrinsic tag string
  if (typeof tag !== "string") {
    throw ERRORS.JSX_INVALID_TAG(tag);
  }

  const element = createDomElement(tag);
  const isSvg = (element as Element).namespaceURI === SVG_NS;

  Object.entries(otherProps).forEach(
    ([rawName, rawValue]: [string, unknown]) => {
      if (rawName === "ref") {
        if (typeof rawValue === "function") {
          try {
            rawValue(element);
          } catch {
            // Silently handle ref callback errors in JSX
          }
        } else if (
          rawValue &&
          typeof rawValue === "object" &&
          "current" in rawValue
        ) {
          try {
            (rawValue as { current: Element | null }).current = element;
          } catch {
            // Silently handle ref assignment errors in JSX
          }
        }
        return;
      }

      if (rawName.startsWith("on")) {
        bindEvent(element, rawName, rawValue);
        return;
      }

      applyProp(element, rawName, rawValue, isSvg);
    }
  );

  if ("dangerouslySetInnerHTML" in otherProps && children !== undefined) {
    warn(
      false,
      "Both children and dangerouslySetInnerHTML were provided. " +
        "dangerouslySetInnerHTML will be used and children are ignored."
    );
    return element;
  }

  if (children !== undefined) {
    if (typeof children === "function") {
      // keep reactive function children as-is
      createReactiveSection(element, children);
    } else if (Array.isArray(children)) {
      children.forEach((c) => {
        if (typeof c === "function") {
          // component thunk vs reactive function
          if (isComponentThunk(c)) {
            try {
              const node = c();
              element.appendChild(node);
            } catch {
              // Silently handle promise resolution errors
            }
          } else {
            createReactiveSection(element, c);
          }
        } else if (c?.nodeType) {
          element.appendChild(c);
        } else if (c != null) {
          element.appendChild(document.createTextNode(String(c)));
        }
      });
    } else if (
      typeof children === "object" &&
      children !== null &&
      "nodeType" in children
    ) {
      element.appendChild(children as Node);
    } else if (children != null) {
      element.appendChild(document.createTextNode(String(children)));
    }
  }

  return element;
};

export const jsxs = jsx;
export const jsxDEV = jsx;
