/**
 * Shared value types for ShadowJS JSX. Everything here is a type: this module emits no code.
 *
 * Attribute values follow the DOM runtime contract: `null` and
 * `undefined` remove an attribute, so every attribute type accepts them.
 *
 * @since 1.0.0
 */

/**
 * A value that may be absent at runtime. `null` and `undefined` remove the attribute or property.
 *
 * @example
 * import type { Maybe } from "@shadow-js/web";
 *
 * function linkTarget(external: boolean): Maybe<string> {
 *   return external ? "_blank" : undefined; // undefined: no target attribute
 * }
 * const link = <a href="/docs" target={linkTarget(true)}>Docs</a>;
 * @since 1.0.0
 */
export type Maybe<T> = T | null | undefined;

/**
 * Booleans written either as `true`/`false` or as the strings the DOM enumerates: the value type of
 * enumerated attributes such as `draggable`, `spellcheck` and the `aria-*` flags.
 *
 * @example
 * import type { Booleanish } from "@shadow-js/web";
 *
 * const expanded: Booleanish = "false";
 * const toggle = <button aria-expanded={expanded}>Menu</button>;
 * @since 1.0.0
 */
export type Booleanish = boolean | "true" | "false";

/**
 * A literal union that still accepts any other string. Keeps editor completions for the known
 * values without rejecting future ones.
 *
 * @since 1.0.0
 * @internal
 */
export type LooseString<T extends string> = T | (string & Record<never, never>);

/**
 * Everything a JSX expression can produce or a child can be: DOM nodes, text, numbers, booleans,
 * nothing, accessors (`() => child`, re-run when their dependencies change) and nested arrays.
 * `JSX.Element` is this type.
 *
 * @example
 * import type { JsxChild } from "@shadow-js/web";
 *
 * function list(items: readonly string[]): JsxChild {
 *   return items.length === 0 ? "Nothing yet" : items.map((item) => <li>{item}</li>);
 * }
 * @since 1.0.0
 */
export type JsxChild =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => JsxChild)
  | readonly JsxChild[];

/**
 * Children of elements whose content is text only: `textarea`, `option`, `script`, `style`.
 * Accessors are allowed because the runtime inserts text nodes reactively.
 *
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import type { TextChild } from "@shadow-js/web";
 *
 * const [draft] = useSignal("Hello");
 * const content: TextChild = draft;
 * const editor = <textarea>{content}</textarea>;
 * @since 1.0.0
 */
export type TextChild =
  | string
  | number
  | null
  | undefined
  | (() => string | number | null | undefined);

/**
 * A class value in the clsx style the runtime understands: strings, numbers (0 is dropped), booleans,
 * nested arrays and objects whose truthy keys become class names. `null`, `undefined` and `false`
 * remove the `class` attribute.
 *
 * @example
 * import type { ClassValue } from "@shadow-js/web";
 *
 * const active = true;
 * const classes: ClassValue = ["card", { "card--active": active }, undefined];
 * const card = <div class={classes} />;
 * @since 1.0.0
 */
export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ClassArray
  | ClassDictionary;

/** A nested class list. @since 1.0.0 */
export type ClassArray = readonly ClassValue[];

/** A class map: each truthy key contributes its class names. @since 1.0.0 */
export type ClassDictionary = Readonly<Record<string, unknown>>;

/**
 * A value for one CSS property: a string, a number (in pixels, as in React, unless the property is
 * unitless such as `opacity`, and `0` is `0`), or `null` or `undefined` (removes the property).
 *
 * @since 1.0.0
 */
export type CSSPropertyValue = string | number | null | undefined;

/** `backgroundColor` to `background-color`; `WebkitX` to `-webkit-x`. @internal */
type KebabCase<S extends string> = S extends `${infer Head}${infer Tail}`
  ? Head extends Lowercase<Head>
    ? `${Head}${KebabCase<Tail>}`
    : `-${Lowercase<Head>}${KebabCase<Tail>}`
  : S;

/**
 * The string-valued properties of the DOM's `CSSStyleDeclaration`. Written against that interface
 * alone, so it resolves the same on every TypeScript that ships the DOM library, 5.4 through 7.x.
 * (`CSSStyleProperties` and `CSSStyleDeclarationBase` exist only in some of those versions.)
 * @internal
 */
type StyleStringKey = Extract<
  {
    [K in keyof CSSStyleDeclaration]-?: CSSStyleDeclaration[K] extends string ? K : never;
  }[keyof CSSStyleDeclaration],
  string
>;

/** The React spelling of a vendor property: `webkitTransition` is also `WebkitTransition`. @internal */
type VendorSpelling<K extends string> = K extends `webkit${infer Rest}`
  ? `Webkit${Capitalize<Rest>}`
  : never;

/** The standard CSS property names of the platform, in camelCase, plus React's `Webkit` spellings. @internal */
type CSSPropertyName = Exclude<StyleStringKey, "cssText"> | VendorSpelling<StyleStringKey>;

/**
 * Inline style declarations for `style={...}`: every standard CSS property in camelCase or in
 * kebab-case (derived from the DOM library's `CSSStyleProperties`, so it tracks the platform), plus
 * CSS custom properties (`--name`). Values are strings or numbers; no per-property value unions.
 *
 * @example
 * import type { CSSProperties } from "@shadow-js/web";
 *
 * const accent = "rebeccapurple";
 * const style: CSSProperties = { backgroundColor: "red", "margin-top": 4, "--accent": accent };
 * const box = <div style={style} />;
 * @since 1.0.0
 */
export type CSSProperties = {
  /**
   * A standard CSS property in camelCase (`backgroundColor`, `WebkitTransition`).
   * @default undefined (the property is not set)
   */
  [K in CSSPropertyName]?: CSSPropertyValue;
} & {
  /**
   * The same property in kebab-case (`background-color`).
   * @default undefined (the property is not set)
   */
  [K in CSSPropertyName as KebabCase<K>]?: CSSPropertyValue;
} & {
  /** A CSS custom property (`--accent`), written as is; a number is not given a unit. */
  [name: `--${string}`]: CSSPropertyValue;
};

/**
 * A ref: a variable that receives the element (`ref={el}` assigns it), a callback that runs once with
 * the element, or a `{ current }` object that receives it (React's `useRef` shape; `current` is cleared
 * when the element's owner is disposed).
 *
 * @example
 * import type { Ref } from "@shadow-js/web";
 *
 * let input: HTMLInputElement | undefined;
 * const plain = <input ref={input} />; // the compiler assigns the element to `input`
 * const focused = <input ref={(el) => el.focus()} />;
 * const box: Ref<HTMLDivElement> = { current: null };
 * const panel = <div ref={box} />;
 * @since 1.0.0
 */
export type Ref<T> = T | ((element: T) => void) | { current: T | null | undefined } | undefined;

/**
 * A value or an accessor returning it. Use it for function parameters that should accept a plain
 * value or a signal-like getter; the accessor is read where it is needed.
 *
 * @example
 * import type { MaybeAccessor } from "@shadow-js/web";
 *
 * function label(text: MaybeAccessor<string>): string {
 *   return typeof text === "function" ? text() : text;
 * }
 * @since 1.0.0
 */
export type MaybeAccessor<T> = T | (() => T);

/**
 * The MathML element for a tag. Some TypeScript versions' DOM library omits a few MathML tags from
 * `MathMLElementTagNameMap` (`a`, for one); those fall back to the generic `MathMLElement`.
 *
 * @typeParam K A MathML tag name.
 * @internal
 */
export type MathMLTagElement<K extends string> = K extends keyof MathMLElementTagNameMap
  ? MathMLElementTagNameMap[K]
  : MathMLElement;

/**
 * The element type a props object accepts in `ref`, e.g. `HTMLInputElement` for an `input`.
 *
 * @typeParam Props An element props type.
 * @since 1.0.0
 */
export type RefOf<Props> = Props extends { ref?: infer R }
  ? Extract<NonNullable<R>, Element>
  : never;
