import { isUnsafeUrlAttribute, warnOnce } from "../extend";

/**
 * Head elements the registry manages. `script` and `noscript` are refused: a head-registered
 * script would bypass CSP nonces and Trusted Types, so scripts come only from the asset pipeline.
 * @since 1.0.0
 */
export type HeadTagName = "title" | "meta" | "link" | "style" | "base";

/**
 * One attribute value: a string is written as is, `true` as an empty attribute, `false` and
 * `undefined` omit it, and a number is written as text.
 * @since 1.0.0
 */
export type HeadAttributeValue = string | number | boolean | undefined;

/**
 * Describes one head element. `key` identifies a `style` for replacement; other tags use their
 * own identity (see {@link useHead}).
 *
 * @example
 * import type { HeadTag } from "@shadow-js/web";
 *
 * const description: HeadTag = { tag: "meta", props: { name: "description", content: "Docs" } };
 * @since 1.0.0
 */
export interface HeadTag {
  /** The element to register: `title`, `meta`, `link`, `style` or `base`. Any other name throws. */
  readonly tag: HeadTagName;
  /**
   * The attributes of the element. Names are case-insensitive, must be valid attribute names, and
   * may not start with `on`.
   * @default undefined (the element has no attributes)
   */
  readonly props?: Readonly<Record<string, HeadAttributeValue>>;
  /**
   * The text of a `title` or `style`. Other tags take no text and throw when it is given.
   * @default undefined (no text)
   */
  readonly children?: string;
  /**
   * Identity of a `style`: a later style with the same key replaces an earlier one. Only `style`
   * takes a key.
   * @default undefined (the style has no identity and always stays)
   */
  readonly key?: string;
}

/**
 * What {@link useHead} accepts: one tag, several tags, or nothing (which registers nothing).
 * @since 1.0.0
 */
export type HeadInput = HeadTag | readonly HeadTag[] | null | undefined | false;

/**
 * A validated tag: lower-case attribute names, the text it carries, and its identity. Produced
 * only by {@link normalizeTag}, so the registry and the DOM sink never see unchecked input.
 * @internal
 */
export interface NormalizedTag {
  readonly tag: HeadTagName;
  readonly attributes: ReadonlyArray<readonly [string, string]>;
  readonly text: string | undefined;
  readonly key: string | undefined;
  /** Identity that replaces earlier registrations; undefined for append-only tags. */
  readonly identity: string | undefined;
}

/** Marks every element the sink created or adopted. Callers may not supply it. @internal */
export const HEAD_MARKER = "data-shadow-head";
/** Carries a style's key so a server-rendered style can be adopted. @internal */
export const HEAD_KEY = "data-shadow-key";

const TAG_NAMES: ReadonlySet<string> = new Set(["title", "meta", "link", "style", "base"]);
const ATTRIBUTE_NAME = /^[a-zA-Z_][a-zA-Z0-9_:.-]*$/;
const RESERVED_ATTRIBUTES: ReadonlySet<string> = new Set([HEAD_MARKER, HEAD_KEY]);
/** Names skipped silently, as spread does: they would reach a prototype if written as keys. */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const META_IDENTITY_FIELDS = ["name", "property", "http-equiv", "charset"] as const;
/**
 * Properties that repeat by design (one tag per image, per tag, per locale). Their identity includes the content,
 * so every value stays; the others are last-wins. Sub-properties of an image (`og:image:width`) are single.
 * @since 1.0.0
 */
const MULTI_VALUED_META: ReadonlySet<string> = new Set([
  "og:image",
  "og:video",
  "og:audio",
  "og:locale:alternate",
  "og:email",
  "og:phone_number",
  "og:fax_number",
  "article:tag",
  "article:author",
  "book:author",
  "book:tag",
  "music:album",
  "music:song",
  "music:musician",
  "music:creator",
  "video:actor",
  "video:director",
  "video:writer",
  "video:tag",
  "fb:admins",
  "twitter:image",
]);
/** Links that repeat (alternates per language, authors, archives): their identity is every attribute. */
const MULTI_LINK_RELS: ReadonlySet<string> = new Set([
  "alternate",
  "author",
  "archives",
  "assets",
  "bookmarks",
  "me",
  "apple-touch-startup-image",
]);
const RESOURCE_RELS: ReadonlySet<string> = new Set([
  "preload",
  "modulepreload",
  "prefetch",
  "preconnect",
  "dns-prefetch",
  "stylesheet",
]);

/** True for the tag names the registry manages. @internal */
export function isHeadTagName(value: string): value is HeadTagName {
  return TAG_NAMES.has(value);
}

/**
 * Length-prefixed identity: `["a|b"]` and `["a", "b"]` can never collide because every part
 * carries its own length.
 */
function frame(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("");
}

/** Text of an attribute value, or undefined when the attribute is omitted. */
function attributeText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (value === true) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  throw new TypeError(
    __DEV__
      ? "ShadowJS head: attribute values must be strings, numbers or booleans."
      : "SHADOW_HEAD_ATTRIBUTE_VALUE",
  );
}

/**
 * Validates the props of one tag and returns its lower-case, de-duplicated attributes, in order. The
 * map is the lookup that the identity is built from, so it is built once per tag.
 */
function attributesFrom(tag: HeadTagName, props: unknown): ReadonlyMap<string, string> {
  if (props === undefined || props === null) return new Map();
  if (typeof props !== "object" || Array.isArray(props)) {
    throw new TypeError(__DEV__ ? "ShadowJS head: props must be an object." : "SHADOW_HEAD_PROPS");
  }
  const values = new Map<string, string>();
  for (const key of Object.keys(props)) {
    if (!ATTRIBUTE_NAME.test(key)) {
      throw new TypeError(
        __DEV__
          ? `ShadowJS head: "${key}" is not a valid attribute name.`
          : "SHADOW_HEAD_ATTRIBUTE_NAME",
      );
    }
    const name = key.toLowerCase();
    if (name.startsWith("on")) {
      throw new TypeError(
        __DEV__
          ? `ShadowJS head: event attribute "${key}" is not allowed.`
          : "SHADOW_HEAD_EVENT_ATTRIBUTE",
      );
    }
    if (RESERVED_ATTRIBUTES.has(name)) {
      throw new TypeError(
        __DEV__ ? `ShadowJS head: "${key}" is reserved for the runtime.` : "SHADOW_HEAD_RESERVED",
      );
    }
    if (FORBIDDEN_NAMES.has(name)) continue;
    const text = attributeText(Reflect.get(props, key));
    if (text === undefined) continue;
    if (isUnsafeUrlAttribute(name, text)) {
      warnOnce("UNSAFE_URL_BLOCKED", `Dropped the unsafe "${name}" value of a <${tag}> head tag.`);
      continue;
    }
    values.set(name, text);
  }
  return values;
}

/** Children text: title and style only, and only as a string. */
function textFrom(tag: HeadTagName, children: unknown): string | undefined {
  if (children === undefined || children === null) return undefined;
  if (tag !== "title" && tag !== "style") {
    throw new TypeError(
      __DEV__ ? `ShadowJS head: <${tag}> takes no children.` : "SHADOW_HEAD_NO_CHILDREN",
    );
  }
  if (typeof children !== "string")
    throw new TypeError(__DEV__ ? "ShadowJS head: children must be text." : "SHADOW_HEAD_TEXT");
  return children;
}

/** The key of a style. Only style takes one. */
function keyFrom(tag: HeadTagName, key: unknown): string | undefined {
  if (key === undefined || key === null) return undefined;
  if (tag !== "style")
    throw new TypeError(
      __DEV__ ? "ShadowJS head: only <style> takes a key." : "SHADOW_HEAD_STYLE_KEY",
    );
  if (typeof key !== "string" || key === "") {
    throw new TypeError(
      __DEV__ ? "ShadowJS head: a key must be a non-empty string." : "SHADOW_HEAD_KEY",
    );
  }
  return key;
}

/** Rel tokens, lower-cased and sorted, so `"ICON  apple"` and `"apple icon"` compare equal. */
function normalizeRel(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== "");
  if (tokens.length === 0) return undefined;
  return tokens.sort().join(" ");
}

/** Identity of a meta: its first identifying field and the media query. */
function metaIdentity(lookup: ReadonlyMap<string, string>): string | undefined {
  const media = lookup.get("media") ?? "";
  for (const field of META_IDENTITY_FIELDS) {
    const value = lookup.get(field);
    if (value === undefined) continue;
    // A document has one charset, whatever its value: that meta is a singleton.
    if (field === "charset") return frame(["meta", field]);
    if (MULTI_VALUED_META.has(value))
      return frame(["meta", field, value, media, lookup.get("content") ?? ""]);
    return frame(["meta", field, value, media]);
  }
  return undefined;
}

/** Identity of a link: icons by rel, sizes and type; preloads and stylesheets by rel, href and as. */
function linkIdentity(lookup: ReadonlyMap<string, string>): string | undefined {
  const rel = normalizeRel(lookup.get("rel"));
  if (rel === undefined) return undefined;
  const isIcon = rel.split(" ").some((token) => token === "icon" || token.endsWith("-icon"));
  if (isIcon) {
    return frame(["link", "icon", rel, lookup.get("sizes") ?? "", lookup.get("type") ?? ""]);
  }
  // A document has one canonical URL: a singleton, so a new value replaces the old element (and a server's
  // copy is adopted) instead of a second `<link rel="canonical">` being appended.
  if (rel === "canonical") return frame(["link", "canonical"]);
  if (RESOURCE_RELS.has(rel)) {
    return frame(["link", "resource", rel, lookup.get("href") ?? "", lookup.get("as") ?? ""]);
  }
  if (MULTI_LINK_RELS.has(rel)) {
    return frame([
      "link",
      "multi",
      rel,
      lookup.get("href") ?? "",
      lookup.get("hreflang") ?? "",
      lookup.get("media") ?? "",
      lookup.get("type") ?? "",
    ]);
  }
  return undefined;
}

/** Identity of a validated tag, or undefined when the tag is append-only. @internal */
export function identityOf(
  tag: HeadTagName,
  lookup: ReadonlyMap<string, string>,
  key: string | undefined,
): string | undefined {
  if (tag === "title") return frame(["title"]);
  if (tag === "base") return frame(["base"]);
  if (tag === "style") return key === undefined ? undefined : frame(["style", key]);
  return tag === "meta" ? metaIdentity(lookup) : linkIdentity(lookup);
}

/**
 * Validates one head tag description and computes its identity. Hostile input throws a
 * TypeError: an unknown tag (including `script`), a bad attribute name, an event attribute, a
 * reserved marker, children on a void tag, or a key on anything but a style. An unsafe URL
 * attribute is dropped with a dev warning, the same way `setAttribute` treats it.
 *
 * @param input The description, usually a {@link HeadTag}; any value is checked.
 * @returns The normalized tag.
 * @throws TypeError for every invalid input listed above.
 * @internal
 * @since 1.0.0
 */
export function normalizeTag(input: unknown): NormalizedTag {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(
      __DEV__ ? "ShadowJS head: a head tag must be an object." : "SHADOW_HEAD_TAG",
    );
  }
  const name = Reflect.get(input, "tag");
  if (typeof name !== "string" || !isHeadTagName(name)) {
    const shown = typeof name === "string" ? name : typeof name;
    throw new TypeError(
      __DEV__ ? `ShadowJS head: unsupported tag "${shown}".` : "SHADOW_HEAD_TAG_NAME",
    );
  }
  const lookup = attributesFrom(name, Reflect.get(input, "props"));
  const text = textFrom(name, Reflect.get(input, "children"));
  const key = keyFrom(name, Reflect.get(input, "key"));
  return {
    tag: name,
    attributes: [...lookup],
    text,
    key,
    identity: identityOf(name, lookup, key),
  };
}

/**
 * Normalizes what {@link useHead} receives: one description, a list, or nothing.
 *
 * @param input A description, a list of them, or null, undefined or false for none.
 * @returns The normalized tags, in order.
 * @throws TypeError when any description is invalid: an unknown tag (including `script`), an
 * attribute name that is not valid or starts with `on`, a reserved marker attribute, an attribute
 * value that is not a string, number or boolean, children on a tag other than `title` and `style`,
 * or a key on anything but a `style`. The production messages start with `SHADOW_HEAD_`.
 * @example
 * import { normalizeTags } from "@shadow-js/web/server";
 *
 * const tags = normalizeTags([
 *   { tag: "title", children: "A" },
 *   { tag: "base", props: { href: "/" } },
 * ]);
 * console.log(tags.length); // 2
 * @see useHead
 * @since 1.0.0
 */
export function normalizeTags(input: unknown): NormalizedTag[] {
  if (input === null || input === undefined || input === false) return [];
  if (Array.isArray(input)) return input.map((item: unknown) => normalizeTag(item));
  return [normalizeTag(input)];
}

/**
 * The identity of an element already in the document, computed the same way as for a
 * registration, so the sink can adopt a server-rendered element. Undefined for elements that are
 * not head tags or that are append-only.
 * @internal
 */
export function identityOfElement(element: Element): string | undefined {
  const name = element.localName;
  if (!isHeadTagName(name)) return undefined;
  const lookup = new Map<string, string>();
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === HEAD_MARKER || attribute.name === HEAD_KEY) continue;
    lookup.set(attribute.name.toLowerCase(), attribute.value);
  }
  const key = element.getAttribute(HEAD_KEY) ?? undefined;
  return identityOf(name, lookup, key);
}
