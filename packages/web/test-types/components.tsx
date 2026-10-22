// biome-ignore-all lint/a11y: fixtures check typing of attribute values; accessibility rules do not apply
/**
 * Type tests: component helpers (`Component`, `ParentComponent`, `VoidComponent`, `FlowComponent`),
 * the prop helpers, `ComponentProps`, `ValidComponent`, and the `JSX` namespace.
 *
 * @since 1.0.0
 */
import type {
  BoundEventHandler,
  ClassValue,
  Component,
  ComponentProps,
  CSSProperties,
  EventHandler,
  FlowComponent,
  JSX,
  MaybeAccessor,
  ParentComponent,
  ParentProps,
  Ref,
  ValidComponent,
  VoidComponent,
  VoidProps,
} from "@shadow-js/web/jsx-runtime";
import type { Equal, Expect } from "./support";
import { sink } from "./support";

declare function count(): number;

// Class components are not supported: the runtime calls components as functions.
class LegacyClass {
  render(): string {
    return "legacy";
  }
}

const Greeting: Component<{ name: string }> = (props) => <p>{props.name}</p>;
const Card: ParentComponent<{ title: string }> = (props) => <section>{props.children}</section>;
const Badge: VoidComponent<{ label: string }> = (props) => <span>{props.label}</span>;
const Panel: FlowComponent<{ title: string }, () => JSX.Element> = (props) => (
  <div>{props.children()}</div>
);
const Empty: Component = () => null;
const Accessor: Component<{ value: MaybeAccessor<number> }> = (props) => (
  <i>{typeof props.value === "function" ? props.value() : props.value}</i>
);

// ---- Calling components --------------------------------------------------------------------------
sink(<Greeting name="Ada" />);
sink(<Greeting name={`Lovelace ${count()}`} />);
sink(
  <Card title="Outer">
    <Badge label="inner" />
  </Card>,
);
sink(<Card title="Empty" />);
sink(<Badge label="leaf" />);
sink(<Panel title="x">{() => <b>content</b>}</Panel>);
sink(<Empty />);
sink(<Accessor value={1} />);
sink(<Accessor value={() => 2} />);
sink(<Greeting name="a" />);

// ---- Negatives: class components
// @ts-expect-error class components are not supported
sink(<LegacyClass />);

// ---- Negatives: props and children --------------------------------------------------------------
// @ts-expect-error name is required
sink(<Greeting />);
// @ts-expect-error name must be a string
sink(<Greeting name={1} />);
// @ts-expect-error unknown prop
sink(<Greeting name="a" extra={true} />);
// key is React's list identity: a component accepts it (it reads props.key), without declaring it
sink(<Greeting name="a" key="k" />);
// @ts-expect-error a component without a children prop cannot take children
sink(<Greeting name="a">child</Greeting>);
// @ts-expect-error a void component cannot take children
sink(<Badge label="x">child</Badge>);
// @ts-expect-error a flow component requires children
sink(<Panel title="x" />);
// @ts-expect-error a flow component's children are a function here
sink(<Panel title="x">{"text"}</Panel>);

// ---- Prop helpers as types ------------------------------------------------------------------------
type CardProps = ParentProps<{ title: string }>;
type LeafProps = VoidProps<{ label: string }>;
export type ChildrenOfCard = Expect<Equal<CardProps["children"], JSX.Element | undefined>>;
export type NoChildrenOnLeaf = Expect<Equal<LeafProps["children"], undefined>>;
export type FlowChildren = Expect<
  Equal<Parameters<typeof Panel>[0]["children"], () => JSX.Element>
>;

// ---- ComponentProps -------------------------------------------------------------------------------
export type GreetingProps = Expect<Equal<ComponentProps<typeof Greeting>, { name: string }>>;
export type InputProps = Expect<Equal<ComponentProps<"input">, JSX.IntrinsicElements["input"]>>;
export type DivProps = Expect<Equal<ComponentProps<"div">, JSX.IntrinsicElements["div"]>>;
const inputProps: ComponentProps<"input"> = { type: "email", value: "a@b.c" };
sink(<input {...inputProps} />);
// @ts-expect-error the input type is a closed set
const badInputProps: ComponentProps<"input"> = { type: "nope" };
sink(badInputProps);

// ---- ValidComponent -------------------------------------------------------------------------------
const tagName: ValidComponent = "div";
const componentValue: ValidComponent = Greeting;
const customTag: ValidComponent = "my-element";
sink(tagName, componentValue, customTag);
// @ts-expect-error not an intrinsic tag and not a component
const unknownTag: ValidComponent = "nope";
sink(unknownTag);

// ---- Component type shape -------------------------------------------------------------------------
export type ComponentReturns = Expect<Equal<ReturnType<typeof Greeting>, JSX.Element>>;
// @ts-expect-error a component returns a JSX element, not an object
const notAComponent: Component = () => ({ a: 1 });
sink(notAComponent);

// ---- JSX namespace --------------------------------------------------------------------------------
const nodes: JSX.Element[] = [
  null,
  undefined,
  true,
  false,
  "text",
  3,
  document.createElement("p"),
  () => "lazy",
  [["nested"]],
];
sink(nodes);
// @ts-expect-error a plain object is not a JSX element
const notElement: JSX.Element = { a: 1 };
sink(notElement);
export type ElementChildrenKey = Expect<Equal<keyof JSX.ElementChildrenAttribute, "children">>;
export type IntrinsicAttributesHasOnlyKey = Expect<Equal<keyof JSX.IntrinsicAttributes, "key">>;

// ---- Shared value helpers -------------------------------------------------------------------------
const cls: ClassValue = ["a", { b: true }];
const css: CSSProperties = { color: "red", "--token": "x" };
const onClick: EventHandler<HTMLButtonElement, MouseEvent> = (e) => e.currentTarget.disabled;
const bound: BoundEventHandler<HTMLButtonElement, MouseEvent, number> = [(n, e) => n + e.button, 1];
const ref: Ref<HTMLDivElement> = undefined;
sink(cls, css, onClick, bound, ref);
// @ts-expect-error a string is not a ClassValue function
const badClass: ClassValue = () => "x";
sink(badClass);
