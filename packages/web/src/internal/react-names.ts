/**
 * React spellings at run time: the attribute and event names that a props object (a spread) passes
 * through. The compiler resolves the same names at build time (`packages/compiler/src/internal/
 * react-names.ts`); a test keeps the two presentation lists equal, so keep them in step.
 *
 * @internal
 */

/**
 * SVG presentation attributes are CSS properties, and React spells them in camelCase (`strokeWidth` is
 * `stroke-width`). A camelCase name whose first word is one of these families is hyphenated. The
 * families are the first words of the CSS properties SVG takes as attributes, so one rule covers the
 * presentation list. The compiler's table (`packages/compiler/src/internal/react-names.ts`) lists the
 * same names, and a test checks each one. The exceptions are SVG attributes that start with a family but are
 * not CSS properties (`clipPathUnits`, `markerWidth`): they are camelCase in SVG, so they keep their case.
 */
const SVG_PROPERTY_FAMILY =
  /^(?!clipPathUnits|glyphRef|marker(?:Height|Units|Width)|mask(?:Content)?Units|textLength)(?:alignment|baseline|clip|color|dominant|enable|fill|flood|font|glyph|image|letter|lighting|marker|mask|mix|paint|pointer|shape|stop|stroke|text|transform|unicode|vector|white|word|writing)(?=[A-Z])/;

/** React names whose attribute differs from the lower-cased key, in HTML and SVG alike. */
const RENAMED: ReadonlyMap<string, string> = new Map([
  ["className", "class"],
  ["htmlFor", "for"],
  ["httpEquiv", "http-equiv"],
  ["acceptCharset", "accept-charset"],
]);

/**
 * The attribute name for a props key on an element: HTML names are lower case (what the parser and
 * `setAttribute` write anyway, and what server markup needs); SVG presentation names are hyphenated,
 * `xlinkHref` and `xmlLang` take their prefix, and other SVG names keep their case (`viewBox`).
 * @internal
 */
export function attributeName(name: string, svg: boolean): string {
  const renamed = RENAMED.get(name);
  if (renamed !== undefined) return renamed;
  if (!svg) return name.toLowerCase();
  if (name.includes(":")) return name;
  const prefixed = /^(xlink|xml)([A-Z])(.*)$/.exec(name);
  if (prefixed !== null) return `${prefixed[1]}:${prefixed[2]?.toLowerCase()}${prefixed[3]}`;
  if (!SVG_PROPERTY_FAMILY.test(name)) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Props that have no DOM form: a spread ignores them (React's `key` and hydration flags). @internal */
export const IGNORED_KEYS: RegExp = /^(?:key|suppress(?:Hydration|ContentEditable)Warning)$/;

/** The DOM event for a React-spelled prop (see the compiler's `eventPlan`). @internal */
export interface EventPlan {
  readonly type: string;
  readonly capture: boolean;
  readonly passive: boolean;
}

/** React events that bubble under another name. */
const REACT_EVENTS: ReadonlyMap<string, string> = new Map([
  ["focus", "focusin"],
  ["blur", "focusout"],
  ["doubleclick", "dblclick"],
]);

const CHANGE_ON_TYPES = /^(?:checkbox|radio|file)$/;

/**
 * Plans the DOM event for an `on*` prop. React's spellings follow React: `onChange` is the per-edit
 * `input` event on text inputs and textareas and the `change` event on other controls; `onFocus` and
 * `onBlur` bubble as `focusin` and `focusout`; a `...Capture` suffix binds the capture phase; `onWheel`
 * is passive. A lower-case `on` spelling is the native event.
 * @internal
 */
export function eventPlan(attribute: string, tag: string, type: string | null): EventPlan {
  const reactSpelling = /^on[A-Z]/.test(attribute);
  const capture = reactSpelling && attribute.endsWith("Capture");
  const lower = attribute.slice(2, capture ? -"Capture".length : undefined).toLowerCase();
  let planned = lower;
  if (reactSpelling) {
    planned =
      lower === "change"
        ? tag === "textarea" || (tag === "input" && (type === null || !CHANGE_ON_TYPES.test(type)))
          ? "input"
          : "change"
        : (REACT_EVENTS.get(lower) ?? lower);
  }
  return { type: planned, capture, passive: reactSpelling && lower === "wheel" && !capture };
}

/**
 * Boolean attributes that a props object writes as presence flags (`disabled: true` gives a bare
 * `disabled`). Lower-case names only. The server and the client share this test, so a value that
 * renders a flag on one side renders it on the other. One space-separated string, not a set of
 * strings, because every bundle that spreads props carries it. A name with a space in it can match
 * two neighbors, but such a name is not a valid attribute name and both renderers refuse it before
 * they write anything.
 */
const BOOLEAN_ATTRIBUTES =
  " async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert " +
  "ismap loop multiple muted nomodule novalidate open playsinline readonly required reversed selected ";

/**
 * True when a prop written under attribute name `name` is a presence flag for `value`: one of the
 * boolean attributes, except `hidden="until-found"`, a keyword that only collapses the element
 * (a bare `hidden` would hide it). The client writes the flag with truthiness, as the server does.
 * @internal
 */
export function isFlagAttribute(name: string, value: unknown): boolean {
  return (
    BOOLEAN_ATTRIBUTES.includes(` ${name} `) && !(name === "hidden" && value === "until-found")
  );
}
