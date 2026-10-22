/**
 * Entry for `"jsxImportSource": "@shadow-js/web"` with `"jsx": "preserve"` (or `"react-jsx"`).
 * Types only: this module exports nothing at runtime.
 *
 * This module owns the augmentable interfaces, `CustomEvents` and `Directives`, and the `JSX`
 * namespace that applies them to every intrinsic element. Augment them from your app with
 * `declare module "@shadow-js/web/jsx-runtime"`. `jsx-dev-runtime` re-exports this module, so the
 * augmentation applies to both. The other modules under `./jsx/` do not import this one: that keeps
 * the declarations local to this file, where module augmentation can merge with them.
 *
 * @since 1.0.0
 */
import type { Component } from "./jsx/component";
import type { CustomEventProps } from "./jsx/events";
import type { DirectiveProps } from "./jsx/global";
import type { IntrinsicElementMap } from "./jsx/intrinsic";
import type { JsxChild, RefOf } from "./jsx/types";

/**
 * The app's custom events, by name, for the `on:` and `oncapture:` prefixes: declaration-merge it so
 * `on:toast={...}` receives a typed event. Empty by default; a name without an entry is not accepted
 * after `on:`.
 *
 * @example
 * import type { JSX } from "@shadow-js/web/jsx-runtime";
 *
 * declare module "@shadow-js/web/jsx-runtime" {
 *   interface CustomEvents {
 *     toast: CustomEvent<{ message: string }>;
 *   }
 * }
 * const banner: JSX.Element = <div on:toast={(event) => console.log(event.detail.message)} />;
 * @since 1.0.0
 */
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the augmentation point; a type alias cannot be merged
export interface CustomEvents {}

/**
 * The app's directives, by name, typed by their argument: declaration-merge it so
 * `use:name={argument}` checks the argument. Empty by default; a name without an entry accepts any
 * argument.
 *
 * @example
 * import type { JSX } from "@shadow-js/web/jsx-runtime";
 *
 * declare module "@shadow-js/web/jsx-runtime" {
 *   interface Directives {
 *     tooltip: string;
 *   }
 * }
 * const save: JSX.Element = <button use:tooltip={"Save the draft"}>Save</button>;
 * @since 1.0.0
 */
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the augmentation point; a type alias cannot be merged
export interface Directives {}

/** What every intrinsic element gains from the app: its custom events and directives. @internal */
type AppProps<P> = CustomEventProps<RefOf<P>, CustomEvents> & DirectiveProps<Directives>;

/**
 * The JSX namespace TypeScript reads through `jsxImportSource`. It is exported from this module only,
 * so it never leaks into the global scope.
 *
 * @since 1.0.0
 */
export namespace JSX {
  /**
   * What a JSX expression evaluates to and what a child may be: DOM nodes, text, numbers, booleans,
   * `null`/`undefined`, accessors (`() => child`) and nested arrays.
   *
   * @example
   * import { useSignal } from "@shadow-js/core";
   * import type { JSX } from "@shadow-js/web";
   *
   * const [name] = useSignal("Ada");
   * const greeting: JSX.Element = () => <span>Hello, {name()}</span>;
   * @since 1.0.0
   */
  export type Element = JsxChild;

  /**
   * The property that receives JSX children. The type is unused; TypeScript only reads the name.
   *
   * @since 1.0.0
   */
  export interface ElementChildrenAttribute {
    children: unknown;
  }

  /**
   * Attributes every component accepts without declaring them. `key` is React's list identity: it is
   * passed to the component as its `key` prop (`For` and the head components read it). `ref` belongs to
   * elements, not components.
   *
   * @since 1.0.0
   */
  export interface IntrinsicAttributes {
    /**
     * React's list identity; a component reads it as `props.key`.
     * @default undefined (the component receives no `key` prop)
     */
    key?: unknown;
  }

  /**
   * Class components are not supported: the runtime calls components as functions. `never` means no
   * class instance is a valid JSX element, so `<Legacy />` for a class is a type error.
   *
   * @since 1.0.0
   */
  export type ElementClass = never;

  /**
   * What a JSX tag may be: an intrinsic element name or any function. A component's return value is
   * not constrained, so `Show`, `For` and `Provider` (which return accessors) are valid tags.
   *
   * @since 1.0.0
   */
  export type ElementType = keyof IntrinsicElements | ((props: never) => unknown);

  /**
   * Attribute maps for every intrinsic element: HTML, SVG and MathML by tag name, plus custom elements
   * (any tag with a hyphen). Each element also accepts the app's `CustomEvents` and `Directives`.
   *
   * @since 1.0.0
   */
  export type IntrinsicElements = {
    [K in keyof IntrinsicElementMap]: IntrinsicElementMap[K] & AppProps<IntrinsicElementMap[K]>;
  };
}

/**
 * Anything that can be used as a JSX tag: an intrinsic element name or a component function. Use it
 * to type a prop that takes either.
 *
 * @since 1.0.0
 */
export type ValidComponent = keyof JSX.IntrinsicElements | Component<never>;

/**
 * The props type of a component, or of an intrinsic element tag name: use it to wrap or forward the
 * props of an element or another component.
 *
 * @typeParam T A tag name (`"div"`) or a component type.
 * @example
 * import type { ComponentProps, JSX } from "@shadow-js/web";
 *
 * function Card(props: { title: string }): JSX.Element {
 *   return <h2>{props.title}</h2>;
 * }
 * type InputProps = ComponentProps<"input">; // the attributes of <input>
 * type CardProps = ComponentProps<typeof Card>; // { title: string }
 * @since 1.0.0
 */
export type ComponentProps<T extends ValidComponent> = T extends keyof JSX.IntrinsicElements
  ? JSX.IntrinsicElements[T]
  : T extends (props: infer P) => unknown
    ? P
    : never;

export type * from "./jsx/index";
