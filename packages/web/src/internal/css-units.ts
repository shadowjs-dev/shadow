/**
 * React's unitless style properties. A number given to any other property is in pixels (`0` stays
 * `0`); these properties take the bare number. Vendor prefixes do not change the answer.
 *
 * The compiler never needs this table for static values, and `class-style.ts` and the server
 * stylesheet writer are the only importers, so it is linked only where a style is written.
 * @internal
 */
const UNITLESS: ReadonlySet<string> = new Set(
  (
    "animation-iteration-count aspect-ratio border-image-outset border-image-slice " +
    "border-image-width box-flex box-flex-group box-ordinal-group column-count columns flex " +
    "flex-grow flex-positive flex-shrink flex-negative flex-order grid-area grid-row grid-row-end " +
    "grid-row-span grid-row-start grid-column grid-column-end grid-column-span grid-column-start " +
    "font-weight line-clamp line-height opacity order orphans scale tab-size widows z-index zoom " +
    "fill-opacity flood-opacity stop-opacity stroke-dasharray stroke-dashoffset stroke-miterlimit " +
    "stroke-opacity stroke-width"
  ).split(" "),
);

/**
 * The CSS text of one style value. A finite or non-finite number gets `px` unless it is zero, a
 * custom property (`--x`) or unitless; every other value is `String(value)`.
 * @param property The CSS property in kebab-case (`toCssProperty` output).
 * @param value The style value.
 * @internal
 */
export function cssValueText(property: string, value: unknown): string {
  if (typeof value !== "number" || value === 0 || property.startsWith("--")) return String(value);
  const bare = property.replace(/^-(?:webkit|moz|ms|o)-/, "");
  return UNITLESS.has(bare) ? String(value) : `${value}px`;
}
