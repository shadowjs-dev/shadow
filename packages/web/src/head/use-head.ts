import {
  createRoot,
  getOwner,
  isServer,
  untrack,
  useContext,
  useEffect,
  useRenderEffect,
  useSignal,
} from "@shadow-js/core";
import { createHeadRegistry, type HeadRegistry } from "./registry";
import { ServerHeadContext } from "./server-head";
import { createDomHeadSink } from "./sink";
import { type HeadInput, normalizeTags } from "./validate";

/** One registry per document, shared by every `useHead` call on it. */
const registries = new WeakMap<Document, HeadRegistry>();

/**
 * Creates the registry for a document and the deferred effect that writes it to the head. The
 * effect is detached: it lives as long as the document, not as long as the first caller. It runs
 * in the user-effect queue, so every registration made in one flush produces one DOM pass.
 */
function createRegistryFor(doc: Document): HeadRegistry {
  return createRoot(
    (): HeadRegistry => {
      const [version, bump] = useSignal(0);
      const registry = createHeadRegistry(() => {
        bump((count) => count + 1);
      });
      const apply = createDomHeadSink(doc);
      useEffect(
        () => {
          version();
          return registry.winners();
        },
        (winners) => {
          apply(winners);
        },
      );
      return registry;
    },
    { detached: true },
  );
}

/** The registry of a document, created on first use. */
function registryFor(doc: Document): HeadRegistry {
  const known = registries.get(doc);
  if (known !== undefined) return known;
  const registry = createRegistryFor(doc);
  registries.set(doc, registry);
  return registry;
}

/**
 * Registers head tags for the lifetime of the current owner. Each registration joins the stack of
 * its identity: `title` and `base` are singletons, `meta` is keyed by its name, property,
 * http-equiv or charset (and media), icons by rel, sizes and type, resource links by rel, href and
 * as, and styles by key. The last registration of an identity wins; disposing it restores the one
 * below. Append-only tags (no identity) all stay. Passing a function re-registers when its
 * dependencies change. On the client the registrations are written to `document.head` after the
 * render phase of a flush, in one pass per flush. On the server the tags go to the render's `head`
 * collector (see `createServerHead`), read once; without one, or outside an owner, nothing is
 * registered.
 *
 * @param input One tag, several tags, or a function returning them. `null`, `undefined` and `false`
 * register nothing.
 * @throws TypeError for an invalid tag description (see {@link normalizeTags}); on the client the
 * error is raised in the registration's render effect and goes to the owner's error handler.
 * In development builds, calling it on the client with no owner does not throw: it warns
 * `HEAD_OUTSIDE_OWNER` and registers nothing.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { useHead } from "@shadow-js/web";
 *
 * function Post() {
 *   const [post] = useSignal({ title: "Hello" });
 *   useHead(() => ({ tag: "title", children: `${post().title} | Blog` }));
 *   return null;
 * }
 * @see Title
 * @see Meta
 * @since 1.0.0
 */
export function useHead(input: HeadInput | (() => HeadInput)): void {
  if (isServer) {
    const collector = getOwner() === null ? null : useContext(ServerHeadContext);
    if (collector !== null) {
      collector.add(normalizeTags(untrack(() => (typeof input === "function" ? input() : input))));
    }
    return;
  }
  if (getOwner() === null) {
    if (__DEV__) {
      console.warn("[shadow HEAD_OUTSIDE_OWNER] useHead() needs an owner; nothing was registered.");
    }
    return;
  }
  const registry = registryFor(document);
  useRenderEffect(
    () => normalizeTags(typeof input === "function" ? input() : input),
    (tags) => registry.add(tags),
  );
}
