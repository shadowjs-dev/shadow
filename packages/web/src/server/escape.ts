import { untrack } from "@shadow-js/core";
import { invalid } from "./errors";
import { isSsrNode } from "./node";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_SPECIAL = /[&<>"']/g;

/** Longest chain of accessors that returns accessors; longer chains are a bug in user code. */
const MAX_ACCESSOR_LAYERS = 1000;

/**
 * Escapes the five HTML-significant characters. Escaping `&` too means entity-looking text is
 * written literally, and the result is safe in text and in quoted attribute values alike.
 * @internal
 */
export function escapeHtml(text: string): string {
  return text.replace(HTML_SPECIAL, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Calls accessors until a plain value remains. Accessors run untracked; a chain longer than
 * {@link MAX_ACCESSOR_LAYERS} throws instead of looping.
 * @internal
 */
export function resolveValue(value: unknown): unknown {
  let current = value;
  for (let layer = 0; typeof current === "function"; layer += 1) {
    if (layer >= MAX_ACCESSOR_LAYERS) {
      throw new TypeError("An accessor returns accessors more than 1000 levels deep.");
    }
    const accessor = current as () => unknown;
    current = untrack(accessor);
  }
  return current;
}

/** Writes the markup for one resolved value that is not an array; `text` encodes the text of a string. */
function appendLeaf(value: unknown, out: string[], text: (value: string) => string): void {
  if (value === null || value === undefined || typeof value === "boolean") return;
  if (typeof value === "string") {
    out.push(text(value));
    return;
  }
  // Numbers and bigints never contain markup characters.
  if (typeof value === "number" || typeof value === "bigint") {
    out.push(String(value));
    return;
  }
  if (typeof value === "symbol") {
    throw invalid("UNRECOGNIZED_INSERT_VALUE", "A symbol cannot be rendered.");
  }
  if (isSsrNode(value)) {
    out.push(value.t);
    return;
  }
  // Any other object is not trusted markup. Dev fails loudly; production renders nothing.
  if (typeof value === "object") {
    if (__DEV__) {
      throw invalid(
        "UNRECOGNIZED_INSERT_VALUE",
        "A plain object cannot be rendered. Use a string, a number, an array or an SsrNode.",
      );
    }
    return;
  }
  out.push(text(String(value)));
}

/**
 * Converts any value a JSX child may hold to escaped HTML: the helper compiled server output calls
 * for every dynamic child, and what the renderers call on the app's result.
 *
 * - Strings are escaped (`& < > " '`); numbers and bigints are written as they are; `null`,
 *   `undefined` and booleans render nothing.
 * - `SsrNode` values (from `ssr`, `ssrRaw` and the other helpers) pass through unchanged: they were
 *   escaped when they were built.
 * - Accessors are called (untracked) and their result is rendered; a chain of more than 1000
 *   accessors returning accessors throws.
 * - Arrays are flattened in order, with an explicit stack, so nesting depth is not limited by the
 *   call stack.
 * - Plain objects throw in development builds and render nothing in production builds.
 *
 * @param value The value to render.
 * @returns The escaped markup.
 * @throws TypeError when an array contains itself, for a symbol (`UNRECOGNIZED_INSERT_VALUE`), for an
 * object that is not an `SsrNode` (`UNRECOGNIZED_INSERT_VALUE`, development builds only), and for an
 * accessor chain deeper than 1000.
 * @example
 * import { escape } from "@shadow-js/web/server";
 *
 * const name = () => "<Ada>";
 * escape(["Hello, ", name, null, 3]); // "Hello, &lt;Ada&gt;3"
 * @since 1.0.0
 */
// biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
export function escape(value: unknown): string {
  return render(value, escapeHtml);
}

/**
 * {@link escape} with the encoding of strings left to the caller: the walk over accessors, arrays and
 * trusted nodes that every kind of text shares (an element's text is encoded one way, a script's another).
 * @internal
 */
export function render(value: unknown, text: (value: string) => string): string {
  const out: string[] = [];
  const frames: unknown[][] = [];
  const cursors: number[] = [];
  const open = new Set<unknown[]>();
  let item: unknown = value;
  for (;;) {
    const resolved = resolveValue(item);
    if (Array.isArray(resolved)) {
      if (open.has(resolved)) throw new TypeError("escape(): an array contains itself.");
      open.add(resolved);
      frames.push(resolved);
      cursors.push(0);
    } else {
      appendLeaf(resolved, out, text);
    }
    // Find the next item, closing every array that has no items left.
    let next: unknown;
    let found = false;
    while (!found && frames.length > 0) {
      const top = frames.length - 1;
      const frame = frames[top];
      const cursor = cursors[top] ?? 0;
      if (frame === undefined) break;
      if (cursor < frame.length) {
        cursors[top] = cursor + 1;
        next = frame[cursor];
        found = true;
      } else {
        frames.pop();
        cursors.pop();
        open.delete(frame);
      }
    }
    if (!found) return out.join("");
    item = next;
  }
}
