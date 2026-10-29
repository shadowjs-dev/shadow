/**
 * React's unitless style properties. A number given to any other property is in pixels (`0` stays
 * `0`); these properties take the bare number. Vendor prefixes do not change the answer.
 *
 * The compiler never needs this table for static values, and `class-style.ts` and the server
 * stylesheet writer are the only importers, so it is linked only where a style is written.
 * @internal
 */
const UNITLESS =
  /^(?:animation-iteration-count|aspect-ratio|border-image-(?:outset|slice|width)|box-(?:flex(?:-group)?|ordinal-group)|column-count|columns|flex(?:-(?:grow|positive|shrink|negative|order))?|grid-(?:area|(?:row|column)(?:-(?:end|span|start))?)|font-weight|line-(?:clamp|height)|opacity|order|orphans|scale|tab-size|widows|z-index|zoom|(?:fill|flood|stop|stroke)-opacity|stroke-(?:dasharray|dashoffset|miterlimit|width))$/;

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
  return UNITLESS.test(bare) ? String(value) : `${value}px`;
}
