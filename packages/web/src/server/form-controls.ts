import { invalid } from "./errors";
// biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
import { escape, escapeHtml, resolveValue } from "./escape";
import { SsrNode } from "./node";

/**
 * Server markup for the controls whose state is not an attribute. A browser ignores `value` on a
 * `<textarea>` and on a `<select>`: the textarea's text is its content, and the select's value is
 * the `selected` flag of its options. These helpers write that markup, so the server HTML shows the
 * same state the client sets and a form posted without JavaScript sends it.
 */

/** Text of a value for a textarea: null and undefined are empty, everything else is its string. */
function valueText(value: unknown): string {
  if (typeof value === "symbol") {
    throw invalid("UNRECOGNIZED_INSERT_VALUE", "A symbol cannot be a form control value.");
  }
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Markup of a textarea's content. The HTML parser drops one newline directly after `<textarea>`,
 * so a value that starts with a line break gets one more; its content is then exactly the value.
 * @internal
 */
export function textareaContent(value: unknown): string {
  return keepLeadingNewline(escapeHtml(valueText(resolveValue(value))));
}

/** Content markup of a textarea with the line break its parser would drop kept. @internal */
export function keepLeadingNewline(html: string): string {
  const first = html.charAt(0);
  return first === "\n" || first === "\r" ? `\n${html}` : html;
}

/**
 * Renders the content of a `<textarea>` from its value: the helper compiled server output calls for
 * `<textarea value={...}>` and `defaultValue`, since a browser ignores a `value` attribute on a
 * textarea. The text is escaped, and a value that starts with a line break gets one more, because
 * the HTML parser drops the first one.
 *
 * @param value The value, or an accessor of it. `null` and `undefined` give an empty textarea;
 * anything else is written as `String(value)`.
 * @returns The escaped content as a trusted `SsrNode`.
 * @throws TypeError `UNRECOGNIZED_INSERT_VALUE` when the value is a symbol.
 * @example
 * import { renderToString, ssr, ssrTextArea } from "@shadow-js/web/server";
 *
 * const bio = "Loves <b>tags</b>";
 * const html = renderToString(() => ssr(["<textarea>", "</textarea>"], ssrTextArea(bio)));
 * // "<textarea>Loves &lt;b&gt;tags&lt;/b&gt;</textarea>"
 * @see ssrSelectValue
 * @since 1.0.0
 */
export function ssrTextArea(value: unknown): SsrNode {
  return new SsrNode(textareaContent(value));
}

/** The values a select value stands for: an array lists them (`multiple`), anything else is one. */
function wantedValues(value: unknown): { values: Set<string>; many: boolean } {
  const resolved = resolveValue(value);
  if (!Array.isArray(resolved)) return { values: new Set([valueText(resolved)]), many: false };
  const values = new Set<string>();
  for (const item of resolved) {
    const one = resolveValue(item);
    if (one !== null && one !== undefined) values.add(valueText(one));
  }
  return { values, many: true };
}

/** Characters of the HTML spec's "ASCII whitespace". */
const WHITESPACE = /[ \t\n\f\r]+/g;
/** Entities our own escaping writes, plus numeric references and `&nbsp;` from trusted raw markup. */
const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
/** Comments and tags inside an option's text (the region markers the compiler writes). */
const TAGS = /<!--[\s\S]*?-->|<[^>]*>/g;
/**
 * The next option or optgroup tag, start or end: where an option's text ends. Sources of global
 * expressions, built per call so no `lastIndex` outlives it.
 */
const OPTION_BOUNDARY = "<\\/?(?:option|optgroup)(?=[\\s/>])";
/** One attribute of a start tag: name, then an optional quoted or bare value. */
const ATTRIBUTE = "\\s+([^\\s\"'<>/=]+)(?:\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+)))?";

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, decimal?: string, hex?: string, named?: string) => {
    if (named !== undefined) return NAMED_ENTITIES[named.toLowerCase()] ?? whole;
    const code = decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? "", 16);
    return Number.isInteger(code) &&
      code >= 0 &&
      code <= 0x10ffff &&
      !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : whole;
  });
}

/** Index of the `>` that ends the start tag whose attributes begin at `from`, or -1. Quotes are skipped. */
function tagEnd(html: string, from: number): number {
  let quote = "";
  for (let index = from; index < html.length; index += 1) {
    const char = html.charAt(index);
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

/** The text an option without a `value` attribute stands for: its text content, whitespace collapsed. */
function optionText(html: string, from: number, boundaries: RegExp): string {
  boundaries.lastIndex = from;
  const boundary = boundaries.exec(html);
  const raw = html.slice(from, boundary === null ? html.length : boundary.index);
  return decodeEntities(raw.replace(TAGS, "")).replace(WHITESPACE, " ").trim();
}

/**
 * Rewrites the option start tags of `html` so that exactly the wanted ones carry `selected`. The
 * input is markup this runtime produced (text and attribute values are escaped, so `<option` is
 * always a tag); only the `selected` attribute is added or removed, and nothing from the wanted
 * values is ever written.
 */
function markOptions(html: string, wanted: { values: Set<string>; many: boolean }): string {
  let out = "";
  let copied = 0;
  let at = 0;
  let found = false;
  const attribute = new RegExp(ATTRIBUTE, "g");
  const boundaries = new RegExp(OPTION_BOUNDARY, "gi");
  for (;;) {
    const start = html.indexOf("<option", at);
    if (start === -1) break;
    const attributesFrom = start + 7;
    at = attributesFrom;
    if (!/[\s/>]/.test(html.charAt(attributesFrom))) continue;
    const end = tagEnd(html, attributesFrom);
    if (end === -1) break;
    const source = html.slice(attributesFrom, end);
    let value: string | undefined;
    let selectedAt = -1;
    let selectedEnd = -1;
    attribute.lastIndex = 0;
    for (let match = attribute.exec(source); match !== null; match = attribute.exec(source)) {
      const name = (match[1] ?? "").toLowerCase();
      if (name === "selected") {
        selectedAt = match.index;
        selectedEnd = match.index + match[0].length;
      } else if (name === "value" && value === undefined) {
        value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
      }
    }
    // A scalar behaves like `select.value = x`: the first option with that value wins.
    const matches =
      (wanted.many || !found) && wanted.values.has(value ?? optionText(html, end + 1, boundaries));
    if (matches) found = true;
    if (matches && selectedAt === -1) {
      const slash = source.endsWith("/") ? source.length - 1 : source.length;
      out += `${html.slice(copied, attributesFrom + slash)} selected`;
      copied = attributesFrom + slash;
    } else if (!matches && selectedAt !== -1) {
      out += html.slice(copied, attributesFrom + selectedAt);
      copied = attributesFrom + selectedEnd;
    }
    at = end;
  }
  return copied === 0 ? html : out + html.slice(copied);
}

/**
 * The options of a `<select>` with the ones its value stands for marked `selected`. A browser
 * ignores a `value` attribute on `<select>`, so the server flags the options instead: the option
 * whose `value` attribute equals the value (or, with no such attribute, whose text does) is
 * selected, and every other option loses `selected`. An array selects every listed option, for
 * `<select multiple>`; a single value selects the first match, like `select.value = x`. `null`
 * and `undefined` stand for the empty string. Options inside `<optgroup>`, control flow and
 * components are found because the search runs on the serialized children. Values are compared,
 * never written, so they cannot add markup.
 *
 * @param value The select's `value`, or an accessor of it. Entries of an array are compared as
 * strings; `null` and `undefined` entries are skipped.
 * @param children The select's children (an `SsrNode`, or anything `escape` accepts).
 * @returns The children with the `selected` flags set, as a trusted `SsrNode`.
 * @throws TypeError `UNRECOGNIZED_INSERT_VALUE` when the value is a symbol, and the errors of
 * {@link escape} for the children.
 * @example
 * import { renderToString, ssr, ssrRaw, ssrSelectValue } from "@shadow-js/web/server";
 *
 * const options = ssrRaw(`<option value="red">Red</option><option value="blue">Blue</option>`);
 * const html = renderToString(() => ssr(["<select>", "</select>"], ssrSelectValue("blue", options)));
 * // '<select><option value="red">Red</option><option value="blue" selected>Blue</option></select>'
 * @see setSelectValue
 * @since 1.0.0
 */
export function ssrSelectValue(value: unknown, children: unknown): SsrNode {
  return new SsrNode(markSelectedOptions(value, escape(children)));
}

/** {@link ssrSelectValue} on markup that is already escaped. @internal */
export function markSelectedOptions(value: unknown, html: string): string {
  return markOptions(html, wantedValues(value));
}
