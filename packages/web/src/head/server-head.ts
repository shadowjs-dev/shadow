import { type Context, createContext } from "@shadow-js/core";
import { escapeHtml } from "../server/escape";
import { createHeadRegistry, type HeadRegistry } from "./registry";
import { HEAD_KEY, HEAD_MARKER, type NormalizedTag } from "./validate";

/** Elements that never have content or a closing tag. */
const VOID_TAGS: ReadonlySet<string> = new Set(["meta", "link", "base"]);

/**
 * The head of one server render: what `useHead`, `<Title>`, `<Meta>`, `<Link>`, `<Style>` and
 * `<Base>` registered while the app rendered. Pass it to a render function through its `head`
 * option, then write {@link ServerHead.html} into the document's `<head>`.
 *
 * Tags follow the same rules as in the browser: the last registration of an identity wins
 * (`title`, `meta` by name, ...), append-only tags all stay. Every tag carries the marker the
 * browser's head sink looks for, so the client adopts the server's elements instead of adding
 * duplicates.
 * @since 1.0.0
 */
export interface ServerHead {
  /** Registers tags. Used by `useHead`; the returned function removes them again. */
  add(tags: readonly NormalizedTag[]): () => void;
  /** Forgets every registration. Multi-pass renders call this before each pass. */
  clear(): void;
  /**
   * The markup of the winning tags, in registration order. With a `nonce`, every `<style>` carries
   * it, so the page's Content-Security-Policy (`style-src 'nonce-...'`) accepts the styles. Throws a
   * TypeError when the text of a style contains a closing style tag.
   *
   * @param options `nonce` is added to every `<style>`. Default: no options, so no nonce.
   */
  html(options?: { readonly nonce?: string }): string;
  /** The winning tags, for hosts that build the head themselves. */
  tags(): readonly NormalizedTag[];
}

/** The collector `useHead` writes to while a render is running; null outside a render with `head`. @internal */
export const ServerHeadContext: Context<ServerHead | null> =
  /* @__PURE__ */ createContext<ServerHead | null>(null, { name: "ServerHead" });

/** Markup of one tag. Text and attribute values are escaped; `</style` cannot appear in a style. */
function tagHtml(tag: NormalizedTag, nonce: string | undefined): string {
  let attributes = ` ${HEAD_MARKER}`;
  if (tag.key !== undefined) attributes += ` ${HEAD_KEY}="${escapeHtml(tag.key)}"`;
  for (const [name, value] of tag.attributes) {
    attributes += value === "" ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
  }
  if (VOID_TAGS.has(tag.tag)) return `<${tag.tag}${attributes}>`;
  const text = tag.text ?? "";
  if (tag.tag === "style") {
    if (/<\/style/i.test(text)) {
      throw new TypeError("ShadowJS head: style text may not contain a closing style tag.");
    }
    const withNonce =
      nonce === undefined ? attributes : `${attributes} nonce="${escapeHtml(nonce)}"`;
    return `<style${withNonce}>${text}</style>`;
  }
  return `<${tag.tag}${attributes}>${escapeHtml(text)}</${tag.tag}>`;
}

/**
 * Creates an empty server head collector.
 *
 * @returns A collector to pass as the `head` option of `renderToString`, `renderToStringAsync` or
 *   `renderToStream`.
 * @example
 * import { createComponent, Title } from "@shadow-js/web";
 * import { createServerHead, renderToString } from "@shadow-js/web/server";
 *
 * function App() {
 *   return Title({ children: "Home" });
 * }
 *
 * const head = createServerHead();
 * const html = renderToString(() => createComponent(App, {}), { head });
 * const page = `<!doctype html><head>${head.html()}</head><body>${html}</body>`;
 * @see useHead
 * @since 1.0.0
 */
export function createServerHead(): ServerHead {
  let registry: HeadRegistry = createHeadRegistry(() => undefined);
  return {
    add: (tags) => registry.add(tags),
    clear() {
      registry = createHeadRegistry(() => undefined);
    },
    html: (options) =>
      registry
        .winners()
        .map((winner) => tagHtml(winner.tag, options?.nonce))
        .join(""),
    tags: () => registry.winners().map((winner) => winner.tag),
  };
}

/**
 * Runs `fn` with `head` as the collector `useHead` writes to. Server renderers call it around the
 * app; with no collector `fn` runs as is. @internal
 */
export function runWithServerHead<T>(head: ServerHead | undefined, fn: () => T): T {
  if (head === undefined) return fn();
  const holder: { value?: T } = {};
  ServerHeadContext({
    value: head,
    get children() {
      holder.value = fn();
      return null;
    },
  });
  return holder.value as T;
}
