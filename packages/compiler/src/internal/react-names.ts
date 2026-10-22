/**
 * React spellings of attributes and events, resolved at build time so the runtime pays nothing.
 *
 * The runtime twin of this table lives in `packages/web/src/internal/react-names.ts`; a test keeps
 * the two presentation lists equal. Keep both in step.
 */

/**
 * SVG presentation attributes and the hyphenated SVG names that React spells in camelCase. A camelCase
 * name whose hyphenated form is in this list is written with that form; every other name keeps its
 * case, because SVG has attributes such as `viewBox` and `gradientUnits` that are camelCase on purpose.
 */
export const SVG_HYPHENATED: ReadonlySet<string> = new Set(
  (
    "alignment-baseline baseline-shift clip clip-path clip-rule color color-interpolation " +
    "color-interpolation-filters color-profile color-rendering cursor direction display " +
    "dominant-baseline enable-background fill fill-opacity fill-rule filter flood-color " +
    "flood-opacity font-family font-size font-size-adjust font-stretch font-style " +
    "font-variant font-weight glyph-orientation-horizontal glyph-orientation-vertical " +
    "image-rendering isolation kerning letter-spacing lighting-color marker-end " +
    "marker-mid marker-start mask mask-type mix-blend-mode opacity overflow paint-order " +
    "pointer-events shape-rendering stop-color stop-opacity stroke stroke-dasharray " +
    "stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity " +
    "stroke-width text-anchor text-decoration text-overflow text-rendering transform " +
    "transform-origin unicode-bidi vector-effect visibility white-space word-spacing " +
    "writing-mode"
  ).split(" "),
);

/** React spellings with a fixed HTML name that is not the lower-case of the React name. */
// A Map, not an object literal: an object would answer for `constructor` or `toString` (Object.prototype
// keys), and a JSX attribute with one of those names would compile to a function.
const HTML_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["className", "class"],
  ["htmlFor", "for"],
  ["httpEquiv", "http-equiv"],
  ["acceptCharset", "accept-charset"],
]);

/**
 * The attribute name written for a React-style JSX attribute on an element.
 *
 * - HTML elements: lower-case, the name the HTML parser and `setAttribute` use anyway, so markup and
 *   the live DOM agree (`colSpan` gives `colspan`).
 * - SVG elements: `xlinkHref` gives `xlink:href`, `xmlLang` gives `xml:lang`, and a presentation name
 *   gives its hyphenated form (`strokeWidth` gives `stroke-width`). Other names keep their SVG case.
 *
 * Names that already contain a colon (`xlink:href`, `aria-*`, `data-*`) are returned unchanged for SVG
 * and lower-cased for HTML.
 */
export function attributeName(name: string, svg: boolean): string {
  const exception = HTML_EXCEPTIONS.get(name);
  if (exception !== undefined) return exception;
  if (!svg) return name.toLowerCase();
  if (name.includes(":")) return name;
  const xlink = /^xlink([A-Z].*)$/.exec(name);
  if (xlink !== null) return `xlink:${lowerFirst(xlink[1] ?? "")}`;
  const xml = /^xml([A-Z].*)$/.exec(name);
  if (xml !== null) return `xml:${lowerFirst(xml[1] ?? "")}`;
  const hyphenated = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return SVG_HYPHENATED.has(hyphenated) ? hyphenated : name;
}

function lowerFirst(text: string): string {
  return text.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

/**
 * Attributes React accepts that have no DOM form in ShadowJS. `key` is list identity (only `For`
 * reads it), and the two suppress flags only silence React's hydration warnings.
 */
export const IGNORED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "suppressHydrationWarning",
  "suppressContentEditableWarning",
]);

/** The React-spelled DOM event name, the element it applies to, and how it is bound. */
export interface EventPlan {
  /** The DOM event type, lower case. */
  readonly type: string;
  /** Bound in the capture phase (`onXCapture`). */
  readonly capture: boolean;
  /** Bound with `{ passive: true }` (React binds `onWheel` passive). */
  readonly passive: boolean;
}

/** The control types whose React `onChange` is the native `change` event (not per keystroke). */
const CHANGE_ON_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio", "file"]);

/**
 * Plans the DOM event for an event attribute.
 *
 * React spellings (`onClick`, `onChange`) follow React's semantics where they differ from the DOM:
 * `onChange` on a text input or a textarea is the `input` event; on a select, checkbox, radio or file
 * input it is `change`. `onFocus` and `onBlur` are `focusin` and `focusout`. `onDoubleClick` is
 * `dblclick`. `onWheel` is passive. A `...Capture` suffix binds the capture phase. The lower-case
 * spelling of an HTML event (`onchange`, `onfocus`) always means the native event.
 *
 * @param attribute The attribute name as written (`onChange`).
 * @param tag The element tag, lower case.
 * @param type The static `type` of an input, or `null` when it is absent or dynamic.
 */
export function eventPlan(attribute: string, tag: string, type: string | null): EventPlan {
  const reactSpelling = /^on[A-Z]/.test(attribute);
  const capture = reactSpelling && attribute.endsWith("Capture");
  const base = attribute.slice(2, capture ? -"Capture".length : undefined);
  if (!reactSpelling) return { type: base.toLowerCase(), capture: false, passive: false };
  const lower = base.toLowerCase();
  if (lower === "change") {
    // Text-like inputs and textareas report every edit; other controls report the committed change.
    // Anything else (a wrapper element) keeps the native bubbling `change`.
    const perEdit =
      tag === "textarea" || (tag === "input" && (type === null || !CHANGE_ON_TYPES.has(type)));
    return { type: perEdit ? "input" : "change", capture, passive: false };
  }
  if (lower === "focus") return { type: "focusin", capture, passive: false };
  if (lower === "blur") return { type: "focusout", capture, passive: false };
  if (lower === "doubleclick") return { type: "dblclick", capture, passive: false };
  if (lower === "wheel") return { type: "wheel", capture, passive: !capture };
  return { type: lower, capture, passive: false };
}
