/**
 * Attributes every element accepts, and the helpers that build each element's props from them.
 *
 * Names follow the compiler (`packages/compiler/src/internal/dom.ts`): the canonical lower-case HTML
 * name, plus the React-style camelCase aliases the compiler supports (`className`, `htmlFor`,
 * `tabIndex`, `readOnly`, ...). The compiler lower-cases attribute names for HTML elements, so an
 * alias and its canonical name write the same attribute.
 *
 * @since 1.0.0
 */

import type { AriaAttributes } from "./aria";
import type {
  EventAttributes,
  MediaEventAttributes,
  VideoEventAttributes,
  WindowEventAttributes,
} from "./events";
import type {
  Booleanish,
  ClassValue,
  CSSProperties,
  CSSPropertyValue,
  JsxChild,
  Maybe,
  Ref,
  TextChild,
} from "./types";

/**
 * Values accepted by `data-*` attributes. `true` and `false` are written as the strings "true" and
 * "false", so they are not presence flags.
 *
 * @since 1.0.0
 */
export type DataValue = string | number | boolean | null | undefined;

/**
 * Values accepted by `attr:name`: written with `String(value)`, removed for `null`/`undefined`.
 *
 * @since 1.0.0
 */
export type AttributeValue = string | number | boolean | null | undefined;

/**
 * Non-event global attributes: identity, language, behavior and the React-style aliases.
 *
 * @since 1.0.0
 */
export interface CoreAttributes {
  accesskey?: Maybe<string>;
  accessKey?: Maybe<string>;
  autocapitalize?: Maybe<"off" | "none" | "on" | "sentences" | "words" | "characters">;
  autoCapitalize?: Maybe<"off" | "none" | "on" | "sentences" | "words" | "characters">;
  autofocus?: Maybe<boolean>;
  autoFocus?: Maybe<boolean>;
  contenteditable?: Maybe<Booleanish | "plaintext-only">;
  contentEditable?: Maybe<Booleanish | "plaintext-only">;
  dir?: Maybe<"ltr" | "rtl" | "auto">;
  draggable?: Maybe<Booleanish>;
  enterkeyhint?: Maybe<"enter" | "done" | "go" | "next" | "previous" | "search" | "send">;
  enterKeyHint?: Maybe<"enter" | "done" | "go" | "next" | "previous" | "search" | "send">;
  exportparts?: Maybe<string>;
  hidden?: Maybe<boolean | "until-found">;
  id?: Maybe<string>;
  inert?: Maybe<boolean>;
  inputmode?: Maybe<"none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url">;
  inputMode?: Maybe<"none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url">;
  is?: Maybe<string>;
  itemid?: Maybe<string>;
  /** React spelling of `itemid`. Accepted for React compatibility. */
  itemID?: Maybe<string>;
  itemprop?: Maybe<string>;
  /** React spelling of `itemprop`. Accepted for React compatibility. */
  itemProp?: Maybe<string>;
  itemref?: Maybe<string>;
  /** React spelling of `itemref`. Accepted for React compatibility. */
  itemRef?: Maybe<string>;
  itemscope?: Maybe<boolean>;
  /** React spelling of `itemscope`. Accepted for React compatibility. */
  itemScope?: Maybe<boolean>;
  itemtype?: Maybe<string>;
  /** React spelling of `itemtype`. Accepted for React compatibility. */
  itemType?: Maybe<string>;
  lang?: Maybe<string>;
  nonce?: Maybe<string>;
  part?: Maybe<string>;
  popover?: Maybe<boolean | "auto" | "manual" | "hint">;
  slot?: Maybe<string>;
  spellcheck?: Maybe<Booleanish>;
  spellCheck?: Maybe<Booleanish>;
  tabindex?: Maybe<number | string>;
  tabIndex?: Maybe<number | string>;
  title?: Maybe<string>;
  translate?: Maybe<boolean | "yes" | "no">;
  writingsuggestions?: Maybe<Booleanish>;
  /**
   * React's `{ __html }` form of `innerHTML`: the markup is written as a property, so it is trusted HTML
   * only. Accepted for React compatibility; prefer `innerHTML`.
   */
  dangerouslySetInnerHTML?: Maybe<{ readonly __html: string | null | undefined }>;
  /** React's hydration warning flag. Accepted and ignored: ShadowJS writes no hydration warnings. */
  suppressHydrationWarning?: Maybe<boolean>;
  /** React's content-editable warning flag. Accepted and ignored. */
  suppressContentEditableWarning?: Maybe<boolean>;
  /**
   * React's list key. Accepted and ignored on elements (list identity belongs to `For`); a component
   * receives it as its `key` prop.
   */
  key?: unknown;
  /** Property, not attribute: assigned when the expression is dynamic. */
  innerHTML?: Maybe<string>;
  /** Property, not attribute: assigned when the expression is dynamic. */
  innerText?: Maybe<string | number>;
  /** Property, not attribute: assigned when the expression is dynamic. */
  textContent?: Maybe<string | number>;
}

/**
 * Namespaced attributes that apply to every element. Each namespace is typed by what it writes:
 * - `data-*`: `DataValue` (any `data-` name);
 * - `attr:name`: `AttributeValue`, written with `setAttribute`;
 * - `bool:name`: boolean attribute, present or absent;
 * - `class:name`: toggles one class name;
 * - `style:name`: one style property (kebab or camelCase, or `--custom`);
 * - `prop:name`: assigns a DOM property; the compiler does not check it, so the type is `unknown`;
 * - `use:name`: a directive, typed by the `Directives` interface of `@shadow-js/web/jsx-runtime`.
 *
 * @since 1.0.0
 */
export interface NamespaceAttributes {
  [name: `data-${string}`]: DataValue;
  [name: `attr:${string}`]: AttributeValue;
  [name: `bool:${string}`]: Maybe<boolean>;
  [name: `class:${string}`]: Maybe<boolean>;
  [name: `style:${string}`]: CSSPropertyValue;
  [name: `prop:${string}`]: unknown;
}

/**
 * Directive props for `use:name={argument}`. `D` is the entry's `Directives` interface: names declared
 * there are typed by their argument, other names accept any value. Passed in by the entry, so this module
 * needs no import from it.
 *
 * @typeParam D The directive-argument map (the entry's `Directives`).
 * @since 1.0.0
 */
export type DirectiveProps<D> = {
  [K in keyof D as `use:${K & string}`]?: D[K];
} & {
  [name: `use:${string}`]: unknown;
};

/**
 * Props every element shares that are not events or attributes: `ref`, the class and style family,
 * and the children-free base of `ElementProps`.
 *
 * @typeParam T The element type the `ref` receives.
 * @since 1.0.0
 */
export interface DomProps<T> {
  ref?: Ref<T>;
  class?: Maybe<ClassValue>;
  className?: Maybe<ClassValue>;
  /** Toggles class names by truthiness; only keys that changed are touched. */
  classList?: Maybe<Record<string, boolean | undefined>>;
  /** A CSS text string, or a declaration object. */
  style?: Maybe<string | CSSProperties>;
}

/**
 * Every attribute an element of type `T` accepts, without children and without element-specific
 * attributes.
 *
 * @typeParam T The element type.
 * @since 1.0.0
 */
export type GlobalAttributes<T extends Element> = CoreAttributes &
  AriaAttributes &
  EventAttributes<T> &
  NamespaceAttributes &
  DomProps<T>;

/**
 * Rename attributes: `{ hrefLang: "hreflang" }` makes `hrefLang` accept the type of `hreflang`.
 *
 * @typeParam A The attribute map to alias.
 * @typeParam M Alias name to canonical attribute name.
 * @since 1.0.0
 */
export type Aliases<A, M extends Record<string, keyof A>> = {
  [K in keyof M]?: Maybe<A[M[K]]>;
};

/**
 * Props for an element that accepts JSX children.
 *
 * @typeParam T The element type.
 * @typeParam A Element-specific attributes.
 * @since 1.0.0
 */
export type ElementProps<T extends Element, A = unknown> = GlobalAttributes<T> &
  A & { children?: JsxChild };

/**
 * Props for a void element (`img`, `input`, `br`, ...): children are a type error.
 *
 * @typeParam T The element type.
 * @typeParam A Element-specific attributes.
 * @since 1.0.0
 */
export type VoidElementProps<T extends Element, A = unknown> = GlobalAttributes<T> &
  A & { children?: never };

/**
 * Props for an element whose content is text only (`textarea`, `option`, `script`, `style`).
 *
 * @typeParam T The element type.
 * @typeParam A Element-specific attributes.
 * @since 1.0.0
 */
export type TextElementProps<T extends Element, A = unknown> = GlobalAttributes<T> &
  A & { children?: TextChild };

/**
 * Props for `audio` and `video`: the media events are added to the element props.
 *
 * @typeParam T The element type.
 * @typeParam A Element-specific attributes.
 * @since 1.0.0
 */
export type MediaElementProps<T extends Element, A = unknown> = ElementProps<T, A> &
  MediaEventAttributes<T>;

/**
 * Props for `video`: media events plus picture-in-picture events.
 *
 * @typeParam T The element type.
 * @typeParam A Element-specific attributes.
 * @since 1.0.0
 */
export type VideoElementProps<T extends Element, A = unknown> = MediaElementProps<T, A> &
  VideoEventAttributes<T>;

/**
 * Props for an element that also receives `Window` events (`body`, `frameset`, root `svg`).
 *
 * @typeParam T The element type.
 * @typeParam A Element-specific attributes.
 * @since 1.0.0
 */
export type WindowElementProps<T extends Element, A = unknown> = ElementProps<T, A> &
  WindowEventAttributes<T>;
