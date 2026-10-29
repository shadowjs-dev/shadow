import { invalid } from "./errors";
import { render, resolveValue } from "./escape";
import { isSsrNode, SsrNode } from "./node";

/**
 * Elements whose content the HTML parser reads as text and nothing else: `script` and `style` (raw text, no
 * entities) and `title` and `textarea` (entities only). Neither kind can hold a comment, so the region markers
 * that delimit a dynamic child elsewhere would show up as literal text inside them.
 */
const TEXT_ONLY_ELEMENTS: ReadonlySet<string> = new Set(["script", "style", "title", "textarea"]);

/**
 * True for an HTML element whose content is text only, so its children are written without region markers
 * and the client adopts the text as it is. Pass the tag in any letter case; SVG elements of the same names
 * are ordinary elements and are not text only.
 * @internal
 */
export function isTextOnlyElement(tag: string): boolean {
  return TEXT_ONLY_ELEMENTS.has(tag.toLowerCase());
}

/** The elements whose text the parser reads raw. */
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set(["script", "style"]);

/** The closing tag of a script or style in any case, and the `<!--` that opens a script's double-escaped state. */
const CLOSING_TAG = {
  script: /<\/(script)|<!--/gi,
  style: /<\/(style)/gi,
} as const;

/**
 * Keeps raw text from ending its element or the script data state. `</script` and `</style` get a backslash that
 * CSS, JavaScript and JSON all read as the character itself (`<\/style` is `</style` in a string, a comment or a
 * selector escape), and `<!--` in a script becomes `<\u0021--`: `\!` is no JSON escape, and a script that holds
 * JSON data (`application/json`, `ld+json`) must still parse. The text means what it meant and the parser does
 * not see a tag. Entities would instead change the text: raw text has none.
 */
function neutralize(tag: "script" | "style", text: string): string {
  return text.replace(CLOSING_TAG[tag], (match: string) =>
    match === "<!--" ? "<\\u0021--" : `<\\/${match.slice(2)}`,
  );
}

/** The text of a child value for a `script` or `style`: strings unescaped, the whole checked by {@link neutralize}. @internal */
export function rawTextContent(tag: string, value: unknown): string {
  return neutralize(
    tag.toLowerCase() === "script" ? "script" : "style",
    render(value, (text) => text),
  );
}

/**
 * The content of a `script` or `style` element made by `ssrElement`. A node the compiler built (`ssr`, `ssrRaw`)
 * is the application's own markup and is left as it is; any other value is raw text and is checked.
 * @internal
 */
export function rawElementContent(tag: string, value: unknown): string {
  const resolved = resolveValue(value);
  return isSsrNode(resolved) ? resolved.t : rawTextContent(tag, resolved);
}

/**
 * Writes the children of a `<script>` or `<style>` element: the helper compiled server output calls for a
 * dynamic child of one. The browser reads these elements' content as raw text, so the value is written
 * as it is (`a > b` stays `a > b`; HTML entities would corrupt the stylesheet or the code) with no region
 * markers around it, and the client adopts the text when it hydrates. Only one thing is changed: a closing tag of
 * the element, in any letter case (`</style`, `</SCRIPT`), and `<!--` in a script, would end the element
 * early or hide its end, so each is rewritten (`<\/style`, `<\u0021--`) to text that CSS, JavaScript and JSON read as the same characters.
 *
 * Accessors are called untracked, arrays are flattened, `null`, `undefined` and booleans write nothing, and
 * a symbol throws, as in {@link escape}.
 *
 * @param tag The element, `"script"` or `"style"` (any letter case).
 * @param value The child value: a string, a number, an array, an accessor or `null`.
 * @returns The text as a trusted `SsrNode`.
 * @throws TypeError `INVALID_RAW_TEXT_TAG` when `tag` is not `script` or `style`, and the errors of
 * {@link escape} for the value.
 * @example
 * import { renderToString, ssr, ssrRawText } from "@shadow-js/web/server";
 *
 * const css = "a > b { color: red } </style><script>alert(1)</script>";
 * const html = renderToString(() => ssr(["<style>", "</style>"], ssrRawText("style", css)));
 * // "<style>a > b { color: red } <\/style><script>alert(1)</script></style>"
 * @see escape
 * @since 1.0.2
 */
export function ssrRawText(tag: "script" | "style", value: unknown): SsrNode {
  if (typeof tag !== "string" || !RAW_TEXT_ELEMENTS.has(tag.toLowerCase())) {
    throw invalid("INVALID_RAW_TEXT_TAG", "ssrRawText(): the tag must be script or style.");
  }
  return new SsrNode(rawTextContent(tag, value));
}
