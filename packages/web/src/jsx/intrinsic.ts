/**
 * The complete `JSX.IntrinsicElements` map: every HTML, SVG and MathML element, plus custom elements.
 *
 * Four tag names exist in more than one namespace: `a`, `script`, `style` and `title`. The compiler
 * picks the namespace from context (inside `<svg>` or `<math>`), and TypeScript cannot see that, so
 * these four accept the union of the attributes and their `ref` receives the union of the elements.
 *
 * @since 1.0.0
 */

import type { Aliases, ElementProps, GlobalAttributes, TextElementProps } from "./global";
import type {
  AnchorAttributes,
  HTMLIntrinsicElements,
  ScriptAttributes,
  StyleElementAttributes,
} from "./html";
import type { MathMLGlobalAttributes, MathMLIntrinsicElements } from "./mathml";
import type {
  SVGAnchorAttributes,
  SVGCoreAttributes,
  SVGHrefAttributes,
  SVGIntrinsicElements,
  SVGPresentationAttributes,
  SVGReactPresentationAttributes,
} from "./svg";
import type { JsxChild, MathMLTagElement, Maybe } from "./types";

/** The DOM element a shared `a` may be. @internal */
type AnchorElement = HTMLElementTagNameMap["a"] | SVGElementTagNameMap["a"] | MathMLTagElement<"a">;
/** The DOM element a shared `script` may be. @internal */
type ScriptElement = HTMLElementTagNameMap["script"] | SVGElementTagNameMap["script"];
/** The DOM element a shared `style` may be. @internal */
type StyleElement = HTMLElementTagNameMap["style"] | SVGElementTagNameMap["style"];
/** The DOM element a shared `title` may be. @internal */
type TitleElement = HTMLElementTagNameMap["title"] | SVGElementTagNameMap["title"];

/**
 * Props of a custom element (a tag name with a hyphen). The attribute set is open: any name is
 * accepted and written as a property (`el[name] = value`), since the element defines its own API.
 *
 * @since 1.0.0
 */
export type CustomElementProps = GlobalAttributes<HTMLElement> & {
  children?: JsxChild;
  [name: string]: unknown;
};

/**
 * Shared-name props, merged: the union of the HTML, SVG and MathML attributes.
 *
 * @since 1.0.0
 */
export interface SharedIntrinsicElements {
  a: ElementProps<
    AnchorElement,
    AnchorAttributes &
      SVGAnchorAttributes &
      SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      MathMLGlobalAttributes &
      Aliases<AnchorAttributes, { hrefLang: "hreflang"; referrerPolicy: "referrerpolicy" }>
  >;
  script: TextElementProps<
    ScriptElement,
    ScriptAttributes &
      SVGCoreAttributes &
      SVGHrefAttributes &
      Aliases<
        ScriptAttributes,
        {
          crossOrigin: "crossorigin";
          fetchPriority: "fetchpriority";
          noModule: "nomodule";
          referrerPolicy: "referrerpolicy";
        }
      >
  >;
  style: TextElementProps<
    StyleElement,
    StyleElementAttributes & SVGCoreAttributes & { title?: Maybe<string> }
  >;
  title: TextElementProps<
    TitleElement,
    SVGCoreAttributes & SVGPresentationAttributes & SVGReactPresentationAttributes
  >;
}

/** Every intrinsic element except the four shared names. @internal */
type UniqueIntrinsicElements = Omit<
  HTMLIntrinsicElements & SVGIntrinsicElements & MathMLIntrinsicElements,
  keyof SharedIntrinsicElements
>;

/**
 * The map behind `JSX.IntrinsicElements`: every element by tag name, plus custom elements matched by
 * the `${string}-${string}` pattern.
 *
 * @since 1.0.0
 */
export type IntrinsicElementMap = UniqueIntrinsicElements &
  SharedIntrinsicElements & {
    [name: `${string}-${string}`]: CustomElementProps;
  };
