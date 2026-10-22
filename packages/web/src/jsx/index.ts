/**
 * Public JSX types of `@shadow-js/web`: the `JSX` namespace, component helpers, event and attribute
 * value types. Type-only: this module emits no runtime code.
 *
 * `src/jsx-runtime.ts` (the `JSX` namespace, `ComponentProps`, `ValidComponent`, and the augmentable
 * `CustomEvents` and `Directives` interfaces) re-exports these with `export type * from "./jsx/index"`.
 * Nothing under `src/jsx/` imports the entry: that would create a cycle and split the declarations.
 *
 * @since 1.0.0
 */
export type { AriaAttributes, AriaRole } from "./aria";
export type {
  Component,
  FlowComponent,
  ParentComponent,
  ParentProps,
  VoidComponent,
  VoidProps,
} from "./component";
export type { BoundEventHandler, EventHandler, EventHandlerProp, ListenerObject } from "./events";
export type { HTMLIntrinsicElements } from "./html";
export type { CustomElementProps, IntrinsicElementMap } from "./intrinsic";
export type { MathMLIntrinsicElements } from "./mathml";
export type { SVGIntrinsicElements } from "./svg";
export type {
  Booleanish,
  ClassValue,
  CSSProperties,
  JsxChild,
  Maybe,
  MaybeAccessor,
  Ref,
  TextChild,
} from "./types";
