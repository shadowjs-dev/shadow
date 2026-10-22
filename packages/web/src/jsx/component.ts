/**
 * Component helper types. A component is a plain function from props to a `JsxChild`; there are
 * no class components.
 *
 * @since 1.0.0
 */
import type { JsxChild } from "./types";

/**
 * A component: a function from props to a JSX element. Components run once; props are read through
 * their getters, so they stay reactive.
 *
 * @typeParam P The props type.
 * @example
 * import type { Component } from "@shadow-js/web";
 *
 * const Greeting: Component<{ name: string }> = (props) => <p>Hello {props.name}</p>;
 * @since 1.0.0
 */
export type Component<P = Record<never, never>> = (props: P) => JsxChild;

/**
 * Props of a component that takes no children: passing `children` is a type error.
 *
 * @typeParam P The component's own props.
 * @example
 * import type { VoidProps } from "@shadow-js/web";
 *
 * function Avatar(props: VoidProps<{ src: string }>) {
 *   return <img src={props.src} alt="" />;
 * }
 * @since 1.0.0
 */
export type VoidProps<P = Record<never, never>> = P & { children?: never };

/**
 * A component that takes no children. Use it for leaf components such as an `Icon` or an `Input`.
 *
 * @typeParam P The component's own props.
 * @example
 * import type { VoidComponent } from "@shadow-js/web";
 *
 * const Icon: VoidComponent<{ name: string }> = (props) => <i class={`icon-${props.name}`} />;
 * @since 1.0.0
 */
export type VoidComponent<P = Record<never, never>> = Component<VoidProps<P>>;

/**
 * Props of a component that takes optional children: adds `children?: JsxChild` to `P`.
 *
 * @typeParam P The component's own props.
 * @example
 * import type { ParentProps } from "@shadow-js/web";
 *
 * function Card(props: ParentProps<{ title: string }>) {
 *   return (
 *     <section>
 *       <h2>{props.title}</h2>
 *       {props.children}
 *     </section>
 *   );
 * }
 * @since 1.0.0
 */
export type ParentProps<P = Record<never, never>> = P & { children?: JsxChild };

/**
 * A component that takes optional children, such as a `Card` or a `Layout`.
 *
 * @typeParam P The component's own props.
 * @example
 * import type { ParentComponent } from "@shadow-js/web";
 *
 * const Layout: ParentComponent = (props) => <main class="layout">{props.children}</main>;
 * @since 1.0.0
 */
export type ParentComponent<P = Record<never, never>> = Component<ParentProps<P>>;

/**
 * A component that requires children of type `C`, such as `Show` (children are the content it
 * shows) or a `For` callback.
 *
 * @typeParam P The component's own props.
 * @typeParam C The children type. Defaults to any `JsxChild`.
 * @example
 * import type { FlowComponent, JSX } from "@shadow-js/web";
 *
 * const Repeat: FlowComponent<{ times: number }, (index: number) => JSX.Element> = (props) =>
 *   Array.from({ length: props.times }, (_, index) => props.children(index));
 * @since 1.0.0
 */
export type FlowComponent<P = Record<never, never>, C = JsxChild> = Component<P & { children: C }>;
