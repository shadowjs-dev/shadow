/**
 * Type tests: the attribute and event maps cover the DOM library. Every tag the lib types must have
 * a JSX entry, every DOM event must have a handler name, and every `ref` must receive the lib's
 * element type. These fail the build when the lib or the maps drift apart.
 *
 * @since 1.0.0
 */
import type { JSX, Ref } from "@shadow-js/web/jsx-runtime";
import type {
  ElementEventNames,
  GlobalEventNames,
  MediaEventNames,
  VideoEventNames,
  WindowEventNames,
} from "../src/jsx/events";
import type { HTMLIntrinsicElements } from "../src/jsx/html";
import type { MathMLIntrinsicElements } from "../src/jsx/mathml";
import type { SVGIntrinsicElements } from "../src/jsx/svg";
import type { Equal, Expect } from "./support";

type Intrinsic = keyof JSX.IntrinsicElements;

/** Tags that exist in more than one namespace: their props are unions, so they are not compared one by one. @internal */
type Shared = "a" | "script" | "style" | "title";

/** True when every value of `T` is `true`. @internal */
type AllTrue<T> = false extends T[keyof T] ? false : true;

// ---- Tags ----------------------------------------------------------------------------------------
// Each lib map is compared with its own family map, so a hyphenated name cannot hide behind the
// custom-element pattern of JSX.IntrinsicElements.
export type HtmlTagsCovered = Expect<
  Equal<Exclude<keyof HTMLElementTagNameMap, keyof HTMLIntrinsicElements | Shared>, never>
>;
export type DeprecatedHtmlTagsCovered = Expect<
  Equal<Exclude<keyof HTMLElementDeprecatedTagNameMap, keyof HTMLIntrinsicElements>, never>
>;
export type SvgTagsCovered = Expect<
  Equal<Exclude<keyof SVGElementTagNameMap, keyof SVGIntrinsicElements>, never>
>;
export type MathMLTagsCovered = Expect<
  Equal<Exclude<keyof MathMLElementTagNameMap, keyof MathMLIntrinsicElements>, never>
>;
export type NoExtraNamedTags = Expect<
  Equal<
    Exclude<
      Extract<Intrinsic, string>,
      | keyof HTMLElementTagNameMap
      | keyof HTMLElementDeprecatedTagNameMap
      | keyof SVGElementTagNameMap
      | keyof MathMLElementTagNameMap
      | Shared
      | `${string}-${string}`
    >,
    never
  >
>;

// ---- Element-typed refs ------------------------------------------------------------------------
/** The element type a props type accepts in `ref`. @internal */
type RefOf<Props> = Props extends { ref?: infer R } ? Extract<NonNullable<R>, Element> : never;

type HtmlRefsMatch = {
  [K in Exclude<keyof HTMLElementTagNameMap, Shared>]: Equal<
    RefOf<HTMLIntrinsicElements[K & keyof HTMLIntrinsicElements]>,
    HTMLElementTagNameMap[K]
  >;
};
type DeprecatedRefsMatch = {
  [K in keyof HTMLElementDeprecatedTagNameMap]: Equal<
    RefOf<HTMLIntrinsicElements[K & keyof HTMLIntrinsicElements]>,
    HTMLElementDeprecatedTagNameMap[K]
  >;
};
type SvgRefsMatch = {
  [K in Exclude<keyof SVGElementTagNameMap, Shared>]: Equal<
    RefOf<SVGIntrinsicElements[K & keyof SVGIntrinsicElements]>,
    SVGElementTagNameMap[K]
  >;
};
type MathMLRefsMatch = {
  [K in Exclude<keyof MathMLElementTagNameMap, Shared>]: Equal<
    RefOf<MathMLIntrinsicElements[K & keyof MathMLIntrinsicElements]>,
    MathMLElementTagNameMap[K]
  >;
};
export type HtmlRefsMatchDom = Expect<AllTrue<HtmlRefsMatch>>;
export type DeprecatedRefsMatchDom = Expect<AllTrue<DeprecatedRefsMatch>>;
export type SvgRefsMatchDom = Expect<AllTrue<SvgRefsMatch>>;
export type MathMLRefsMatchDom = Expect<AllTrue<MathMLRefsMatch>>;

/** A ref callback receives exactly the element type. @internal */
export type InputRef = Expect<
  Equal<
    Ref<HTMLInputElement>,
    | HTMLInputElement
    | ((element: HTMLInputElement) => void)
    | { current: HTMLInputElement | null | undefined }
    | undefined
  >
>;

// ---- DOM events --------------------------------------------------------------------------------
type HandledGlobal = GlobalEventNames[keyof GlobalEventNames];
type HandledElement = ElementEventNames[keyof ElementEventNames];
type HandledWindow = WindowEventNames[keyof WindowEventNames];
type HandledMedia = MediaEventNames[keyof MediaEventNames];
type HandledVideo = VideoEventNames[keyof VideoEventNames];

export type GlobalEventsCovered = Expect<
  Equal<Exclude<keyof GlobalEventHandlersEventMap, HandledGlobal>, never>
>;
export type ElementEventsCovered = Expect<
  Equal<Exclude<keyof ElementEventMap, HandledElement>, never>
>;
export type WindowEventsCovered = Expect<
  Equal<Exclude<keyof WindowEventHandlersEventMap, HandledWindow>, never>
>;
export type MediaEventsCovered = Expect<
  Equal<
    Exclude<Exclude<keyof HTMLMediaElementEventMap, keyof HTMLElementEventMap>, HandledMedia>,
    never
  >
>;
export type VideoEventsCovered = Expect<
  Equal<
    Exclude<Exclude<keyof HTMLVideoElementEventMap, keyof HTMLMediaElementEventMap>, HandledVideo>,
    never
  >
>;
/** Every handler name refers to an event the lib defines. @internal */
export type HandlersAreRealEvents = Expect<
  Equal<
    Exclude<
      HandledGlobal | HandledElement | HandledWindow | HandledMedia | HandledVideo,
      | keyof GlobalEventHandlersEventMap
      | keyof ElementEventMap
      | keyof WindowEventHandlersEventMap
      | keyof HTMLMediaElementEventMap
      | keyof HTMLVideoElementEventMap
    >,
    never
  >
>;

// ---- JSX entry points ----------------------------------------------------------------------------
export type ElementChildrenIsChildren = Expect<
  Equal<keyof JSX.ElementChildrenAttribute, "children">
>;
