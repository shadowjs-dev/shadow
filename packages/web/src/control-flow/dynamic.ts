import { mergeProps, splitProps, untrack, useMemo } from "@shadow-js/core";
import { createComponent } from "../component";
import { bindRegion, claims, createRegion, MATHML_NS, nextKey, SVG_NS, warnOnce } from "../extend";
import { ssrElement, ssrRaw } from "../server/element";
import { isTextOnlyElement } from "../server/raw-text";
import { spreadProps } from "../spread";

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

/**
 * The SVG element names (lowercase) HTML does not define: the names a tag takes the SVG namespace for. A pattern
 * rather than a question to the platform because it answers the same in every DOM (browsers, happy-dom, jsdom,
 * which has no interface per SVG element) and never parses HTML, so a page that enforces Trusted Types is never
 * asked for a sink. `fe[bcdfgimopst]...` is every filter primitive (`feBlend` to `feTurbulence`).
 */
const SVG_PATTERN =
  /^(svg|g|path|circle|ellipse|line|poly(gon|line)|rect|text(path)?|tspan|defs|desc|discard|metadata|use|symbol|marker|switch|view|set|mpath|image|stop|mask|pattern|clippath|filter|foreignobject|animate(motion|transform)?|(linear|radial)gradient|fe[bcdfgimopst][a-z]{3,})$/;

/** The MathML element names (the HTML spec's list), matched in lowercase. None of them is an HTML element. */
const MATHML_TAGS =
  /^(m(ath|[ion]|s(ub(sup)?|up|qrt|pace|tyle)?|t(ext|able|[rd])|row|frac|root|error|padded|phantom|enclose|under(over)?|over|(multi|pre)scripts|labeledtr|action)|none|semantics|annotation(-xml)?)$/;

/**
 * Shape of a tag name: a letter, then letters, digits or dashes. Anything else is refused, and so is `script` in
 * any letter case: it would bypass CSP nonces and Trusted Types.
 */
const TAG_PATTERN = /^(?!script$)[a-z][a-z0-9-]*$/i;

/**
 * Warns (development only) about an SVG element name written in a case SVG does not spell it in: the namespace
 * is case-sensitive, so a `clippath` element is not the `clipPath` that `clip-path="url(#...)"`, CSS and
 * `querySelector` mean. Warns once per name. The table of canonical names exists only behind `__DEV__`.
 */
function warnSvgCase(tag: string, lower: string): void {
  const canonical =
    "animateMotion animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject linearGradient radialGradient textPath"
      .split(" ")
      .find((name) => name.toLowerCase() === lower);
  if (canonical === undefined || canonical === tag) return;
  warnOnce(
    "DYNAMIC_SVG_CASE",
    `Dynamic created the SVG element "${tag}" with the name as written, but SVG spells it "${canonical}": the name is case-sensitive, so "${tag}" is not the element SVG defines. Write "${canonical}".`,
    lower,
  );
}

/**
 * Creates the element of a validated tag name in its namespace. MathML names are exact (none of them is an
 * HTML element). For the rest the platform answers first: a name HTML knows (`div`, `a`, `style`, `title`, a
 * custom element) is an HTML element, which is all the common tags cost; only a name HTML does not know is
 * matched against the SVG names, and it keeps the spelling the caller wrote.
 */
function createTagged(tag: string): Element {
  const lower = tag.toLowerCase();
  if (MATHML_TAGS.test(lower)) return document.createElementNS(MATHML_NS, lower);
  const el = document.createElement(tag);
  // Firefox makes `image` a plain HTMLElement, where Chromium and WebKit call it unknown: it is no HTML element
  // (the parser turns it into `img`), and SVG defines it, so it takes the SVG route in every engine.
  if ((el.constructor !== HTMLUnknownElement && lower !== "image") || !SVG_PATTERN.test(lower)) {
    return el;
  }
  if (__DEV__) warnSvgCase(tag, lower);
  return document.createElementNS(SVG_NS, tag);
}

/**
 * Creates an element for a validated tag name and applies the props to it, children included.
 * The namespace comes from the tag: SVG-only names get the SVG namespace (named as written), MathML names the
 * MathML namespace, the rest are HTML.
 * On the server it renders the element as markup (with the hydration key and the children region
 * the client adopts); while hydrating it claims that element instead of creating one.
 */
function buildElement(tag: string, props: object): unknown {
  if (!TAG_PATTERN.test(tag)) {
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
        // The content of a style or a title is text the parser reads whole: no markers can go in it.
        if (children === undefined || isTextOnlyElement(tag)) return children;
        return [ssrRaw("<!--[-->"), children, ssrRaw("<!--]-->")];
      },
      true,
    );
  }
  const el = claims.current.claimElement(nextKey()) ?? createTagged(tag);
  // Attributes through spread; children through insert, which adopts the server's children region.
  spreadProps(el, props, el.namespaceURI === SVG_NS);
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
 * data-driven tags cannot inject markup. The browser decides the namespace: a name HTML knows (`div`,
 * `a`, `style`, `title`, a custom element) is an HTML element, in any letter case. A name HTML does not
 * know and that SVG defines (`circle`, `path`, `svg`, `image`, `foreignObject`, `clipPath`, the `fe*` filter
 * primitives, the gradients and animation elements, ...) is created in the SVG namespace, matched against a
 * name pattern (no HTML is parsed, so Trusted Types is never involved); any other name stays an HTML element.
 * The element keeps the name exactly as written: `Dynamic` does not derive the canonical case, which SVG
 * needs (`clipPath`, `linearGradient`, `feGaussianBlur`, `foreignObject`, ...), so write those names as SVG
 * spells them. Development builds warn once per name with `DYNAMIC_SVG_CASE` when they are not.
 * MathML names (`math`, `mi`, `mfrac`, `semantics`, `annotation-xml`, ...) are created in the MathML
 * namespace, in lowercase. `title`, `style` and `a` stay HTML elements: `Dynamic` does not know the parent
 * the element will be inserted into.
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
