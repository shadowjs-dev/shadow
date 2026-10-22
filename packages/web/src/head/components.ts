import { useHead } from "./use-head";
import type { HeadAttributeValue, HeadTag, HeadTagName } from "./validate";

/**
 * Props of {@link Title}.
 * @since 1.0.0
 */
export interface TitleProps {
  /**
   * The title text: a string, a number, an array of those, or an accessor returning them. `null`,
   * `undefined` and `false` count as empty text; anything else throws a TypeError.
   * @default undefined (the title is the empty string)
   */
  readonly children?: unknown;
}

/**
 * Props of {@link Meta}, {@link Link} and {@link Base}: every prop is an attribute, and a function
 * value is read reactively.
 * @since 1.0.0
 */
export interface HeadAttributeProps {
  /**
   * One attribute of the tag. A string or number is written as text, `true` as an empty attribute,
   * and `false`, `null` or `undefined` omit it. Any other value throws a TypeError.
   */
  readonly [attribute: string]: unknown;
}

/**
 * Props of {@link Style}: the CSS text and an optional key that replaces an earlier style with the
 * same key.
 * @since 1.0.0
 */
export interface StyleProps {
  /**
   * The CSS text: a string, a number, an array of those, or an accessor returning them.
   * @default undefined (the style has no text)
   */
  readonly children?: unknown;
  /**
   * Identity of the style: a later style with the same key replaces an earlier one. Must be a
   * non-empty string.
   * @default undefined (the style has no identity and always stays)
   */
  readonly key?: unknown;
  /** One attribute of the `<style>` element, such as `media`, with the same rules as {@link HeadAttributeProps}. */
  readonly [attribute: string]: unknown;
}

/** Text of a value that may be an accessor. Anything but text or an array of text throws. */
function partText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value === undefined || value === null || value === false) return "";
  throw new TypeError(
    __DEV__ ? "ShadowJS head: Title children must be text." : "SHADOW_HEAD_TITLE_TEXT",
  );
}

/** The text a Title shows. An accessor is called once, so its reads are tracked by the caller. */
function textOf(value: unknown): string {
  const resolved = typeof value === "function" ? (value as () => unknown)() : value;
  if (Array.isArray(resolved)) return (resolved as unknown[]).map(partText).join("");
  return partText(resolved);
}

/** The style key of a prop: absent stays absent, a non-empty string is kept, anything else throws. */
function keyOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value !== "") return value;
  throw new TypeError(
    __DEV__ ? "ShadowJS head: a key must be a non-empty string." : "SHADOW_HEAD_KEY",
  );
}

/** One attribute value from a prop: strings, numbers and booleans are kept, the rest is an error. */
function attributeValue(value: unknown): HeadAttributeValue {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true) return true;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  throw new TypeError(
    __DEV__
      ? "ShadowJS head: attribute values must be strings, numbers or booleans."
      : "SHADOW_HEAD_ATTRIBUTE_VALUE",
  );
}

/**
 * The attributes of a component's props, reading each prop (so a getter is tracked by the
 * caller). `skip` lists props that are not attributes.
 */
function attributesOf(props: object, skip: readonly string[]): Record<string, HeadAttributeValue> {
  const entries: Array<[string, HeadAttributeValue]> = [];
  for (const key of Object.keys(props)) {
    if (skip.includes(key)) continue;
    entries.push([key, attributeValue(Reflect.get(props, key))]);
  }
  return Object.fromEntries(entries);
}

/** A tag with attributes and no text, of the given name. */
function attributeTag(tag: HeadTagName, props: object, skip: readonly string[]): HeadTag {
  return { tag, props: attributesOf(props, skip) };
}

/**
 * Sets the document title. The last registered Title wins; removing it restores the one below, or
 * the original title when none is left.
 *
 * @param props The title text.
 * @returns Always null: nothing is rendered in place.
 * @throws TypeError (production message `SHADOW_HEAD_TITLE_TEXT`) when the children are not text.
 * @example
 * import { Title } from "@shadow-js/web";
 *
 * function Home() {
 *   return <Title>Home | Blog</Title>;
 * }
 * @see useHead
 * @since 1.0.0
 */
export function Title(props: TitleProps): null {
  useHead((): HeadTag => ({ tag: "title", children: textOf(props.children) }));
  return null;
}

/**
 * Registers a `<meta>`. Identity follows name, property, http-equiv or charset, so the last
 * description wins. Children are ignored: a meta carries no text.
 *
 * @param props Attributes, such as `name` and `content`.
 * @returns Always null: nothing is rendered in place.
 * @throws TypeError (production message `SHADOW_HEAD_ATTRIBUTE_VALUE`) for an attribute value that
 * is not a string, number or boolean, and for an invalid attribute name or an event attribute
 * (see {@link normalizeTags}).
 * @example
 * import { Meta } from "@shadow-js/web";
 *
 * function About() {
 *   return <Meta name="description" content="About us" />;
 * }
 * @see useHead
 * @since 1.0.0
 */
export function Meta(props: HeadAttributeProps): null {
  useHead(() => attributeTag("meta", props, ["children"]));
  return null;
}

/**
 * Registers a `<link>`. Icons are keyed by rel, sizes and type; preloads and stylesheets by rel,
 * href and as; other links are append-only.
 *
 * @param props Attributes, such as `rel` and `href`.
 * @returns Always null: nothing is rendered in place.
 * @throws TypeError (production message `SHADOW_HEAD_ATTRIBUTE_VALUE`) for an attribute value that
 * is not a string, number or boolean, and for an invalid attribute name or an event attribute
 * (see {@link normalizeTags}).
 * @example
 * import { Link } from "@shadow-js/web";
 *
 * function Page() {
 *   return <Link rel="stylesheet" href="/site.css" />;
 * }
 * @see useHead
 * @since 1.0.0
 */
export function Link(props: HeadAttributeProps): null {
  useHead(() => attributeTag("link", props, ["children"]));
  return null;
}

/**
 * Registers a `<style>` with the given CSS text. A `key` makes it replace an earlier style with the
 * same key; without one, every style stays.
 *
 * @param props The CSS as `children`, an optional `key`, and attributes such as `media`.
 * @returns Always null: nothing is rendered in place.
 * @throws TypeError (production message `SHADOW_HEAD_KEY`) when `key` is not a non-empty string.
 * @example
 * import { Style } from "@shadow-js/web";
 *
 * function Theme() {
 *   return <Style key="theme">{"body { margin: 0 }"}</Style>;
 * }
 * @see useHead
 * @since 1.0.0
 */
export function Style(props: StyleProps): null {
  useHead((): HeadTag => {
    const attributes = attributesOf(props, ["children", "key"]);
    const text = props.children === undefined ? undefined : textOf(props.children);
    const key = keyOf(props.key);
    return {
      tag: "style",
      props: attributes,
      ...(text === undefined ? {} : { children: text }),
      ...(key === undefined ? {} : { key }),
    };
  });
  return null;
}

/**
 * Registers the document `<base>`. There is one; the last registration wins. Base is placed first
 * in the head, as browsers expect.
 *
 * @param props Attributes, such as `href`.
 * @returns Always null: nothing is rendered in place.
 * @throws TypeError (production message `SHADOW_HEAD_ATTRIBUTE_VALUE`) for an attribute value that
 * is not a string, number or boolean.
 * @example
 * import { Base } from "@shadow-js/web";
 *
 * function Shell() {
 *   return <Base href="/app/" />;
 * }
 * @see useHead
 * @since 1.0.0
 */
export function Base(props: HeadAttributeProps): null {
  useHead(() => attributeTag("base", props, ["children"]));
  return null;
}
