import { mergeProps, splitProps, untrack, useMemo } from "@shadow-js/core";
import { createComponent } from "../component";
import { bindRegion, claims, createRegion, nextKey, SVG_NS } from "../extend";
import { ssrElement, ssrRaw } from "../server/element";
import { spread } from "../spread";

/**
 * A component function or a tag name, as {@link Dynamic} accepts it. The props of a function are
 * checked by the caller.
 * @since 1.0.0
 */
export type DynamicComponent = string | ((props: never) => unknown);

/**
 * Everything `component` may be: a component, a tag name, or `undefined`, `null` or `false`, which
 * render nothing.
 * @since 1.0.0
 */
export type DynamicTarget = DynamicComponent | undefined | null | false;

/**
 * Props of {@link Dynamic}: `component` plus the props of whatever it renders. Every other prop
 * passes through, reactive getters included.
 * @since 1.0.0
 */
export interface DynamicProps<C extends DynamicTarget = DynamicTarget> {
  /** The component to render, a tag name, or a falsy value for nothing. */
  readonly component: C;
  /** Any other prop is passed to the rendered component or set on the element, still reactive. */
  readonly [prop: string]: unknown;
}

/** Tag names that take the SVG namespace. Anything else is HTML. */
const SVG_TAGS: ReadonlySet<string> = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "rect",
  "text",
  "tspan",
  "textpath",
  "defs",
  "use",
  "symbol",
  "marker",
  "clippath",
  "mask",
  "pattern",
  "lineargradient",
  "radialgradient",
  "stop",
  "filter",
]);

/** Shape of a tag name: a letter, then letters, digits or dashes. Anything else is refused. */
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/i;

/** Tags refused in any letter case: a script would bypass CSP nonces and Trusted Types. */
const DENIED_TAGS: ReadonlySet<string> = new Set(["script"]);

/**
 * Creates an element for a validated tag name and applies the props to it, children included.
 * The namespace comes from the tag: SVG-only names get the SVG namespace, the rest are HTML.
 * On the server it renders the element as markup (with the hydration key and the children region
 * the client adopts); while hydrating it claims that element instead of creating one.
 */
function buildElement(tag: string, props: object): unknown {
  const lower = tag.toLowerCase();
  if (!TAG_PATTERN.test(tag) || DENIED_TAGS.has(lower)) {
    throw new TypeError(__DEV__ ? "ShadowJS Dynamic: invalid tag" : "SHADOW_DYNAMIC_TAG");
  }
  if (__SERVER__) {
    // The children are read lazily, after `ssrElement` took the element's hydration key: the client
    // claims the element first and builds its children second, so the keys must be drawn in that
    // order here too, or a component inside the element and every sibling after it would miss.
    return ssrElement(
      tag,
      props,
      () => {
        const { children } = props as { children?: unknown };
        return children === undefined
          ? undefined
          : [ssrRaw("<!--[-->"), children, ssrRaw("<!--]-->")];
      },
      true,
    );
  }
  const svg = SVG_TAGS.has(lower);
  const claimed = claims.current.claimElement(nextKey());
  const el = claimed ?? (svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag));
  // Attributes through spread; children through insert, which adopts the server's children region.
  spread(el, props, svg, true);
  const region = createRegion(el, null, claims.current.takeRegion(el, null));
  bindRegion(region, () => (props as { children?: unknown }).children);
  return el;
}

/**
 * Renders one value of `component`: nothing for a falsy value, an element for a tag name, the
 * component's result for a function. Anything else is a TypeError.
 */
function buildTarget(target: unknown, props: object): unknown {
  if (!target) return null;
  if (typeof target === "string") return buildElement(target, props);
  if (typeof target === "function") {
    return createComponent(target as (props: object) => unknown, props);
  }
  throw new TypeError(
    __DEV__
      ? "ShadowJS Dynamic: component must be a string, a function, or a falsy value."
      : "SHADOW_DYNAMIC_COMPONENT",
  );
}

/**
 * Renders a component function or an element chosen by a tag name, and re-renders when
 * `component` changes. Only `component` is tracked: the rest of the props are passed through
 * reactive, so changing them updates the rendered output without rebuilding it. Swapping
 * `component` disposes the old subtree, cleanups included, and builds the new one once. A falsy
 * `component` renders nothing.
 *
 * Tag names are checked against `^[a-z][a-z0-9-]*$` (case-insensitive) and `script` is refused, so
 * data-driven tags cannot inject markup. SVG-only names (`circle`, `path`, `svg`, ...) are created
 * in the SVG namespace.
 *
 * @param props `component` and the props of what it renders.
 * @returns An accessor of the rendered output, to be inserted by the caller.
 * @throws TypeError for an invalid tag name or a component that is neither a string nor a function
 *   (at read time, which is when the caller inserts it).
 * @example
 * import { createRoot, useSignal } from "@shadow-js/core";
 * import { Dynamic, insert } from "@shadow-js/web";
 *
 * const parent = document.createElement("div");
 * createRoot(() => {
 *   const [level] = useSignal(1);
 *   insert(
 *     parent,
 *     Dynamic({
 *       get component() {
 *         return level() === 1 ? "h1" : "h2";
 *       },
 *       children: "Title",
 *     }),
 *   );
 * });
 * @see createDynamic
 * @since 1.0.0
 */
export function Dynamic<C extends DynamicTarget>(props: DynamicProps<C>): () => unknown {
  const [, rest] = splitProps(props, ["component"]);
  // The component is built inside this memo, so its setup (or a ref, or a directive) may write signals.
  return useMemo(
    (): unknown => {
      const target: unknown = props.component;
      return untrack(() => buildTarget(target, rest));
    },
    { allowWrites: true },
  );
}

/**
 * Function form of {@link Dynamic}, for code that is not JSX: renders what `component()` returns (a
 * component, a tag name or a falsy value) with `props`, and follows it when it changes.
 *
 * @param component Accessor of the target.
 * @param props The props of what it renders (reactive getters stay reactive).
 * @returns An accessor of the rendered output.
 * @example
 * import { createRoot, useSignal } from "@shadow-js/core";
 * import { createDynamic, insert } from "@shadow-js/web";
 *
 * const parent = document.createElement("div");
 * createRoot(() => {
 *   const [level] = useSignal(1);
 *   insert(parent, createDynamic(() => (level() === 1 ? "h1" : "h2"), { children: "Title" }));
 * });
 * @see Dynamic
 * @since 1.0.0
 */
export function createDynamic<C extends DynamicTarget>(
  component: () => C,
  props: object = {},
): () => unknown {
  return Dynamic(
    mergeProps(
      {
        get component(): C {
          return component();
        },
      },
      props,
    ) as DynamicProps<C>,
  );
}
