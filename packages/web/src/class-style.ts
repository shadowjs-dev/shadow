import { cssValueText } from "./internal/css-units";
import { HTML_NS } from "./internal/names";

/** Appends the truthy class names of `value` (strings, numbers, nested arrays, objects) to `parts`. */
function collectClasses(root: unknown, parts: string[]): void {
  // Explicit frames instead of recursion: array nesting depth is controlled by the user.
  const frames: unknown[][] = [[root]];
  const cursors: number[] = [0];
  const active = new Set<unknown[]>();
  while (frames.length > 0) {
    const top = frames.length - 1;
    const frame = frames[top];
    const cursor = cursors[top] ?? 0;
    if (frame === undefined || cursor >= frame.length) {
      const done = frames.pop();
      if (done !== undefined) active.delete(done);
      cursors.pop();
      continue;
    }
    cursors[top] = cursor + 1;
    const item = frame[cursor];
    if (Array.isArray(item)) {
      if (active.has(item))
        throw new TypeError(
          __DEV__ ? "className(): a class array contains itself." : "SHADOW_CLASS_CYCLE",
        );
      active.add(item);
      frames.push(item);
      cursors.push(0);
    } else if (typeof item === "string") {
      if (item !== "") parts.push(item);
    } else if (typeof item === "number") {
      if (item !== 0 && !Number.isNaN(item)) parts.push(String(item));
    } else if (item !== null && typeof item === "object") {
      const record = item as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (record[key] && key !== "") parts.push(key);
      }
    }
  }
}

/** Class text for `value`, or null when the class attribute must be removed. */
function classText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined || value === false) return null;
  const parts: string[] = [];
  collectClasses(value, parts);
  return parts.join(" ");
}

/**
 * Writes a class value. `svg` selects the attribute path, which SVG and MathML need because their
 * `className` is not a plain string.
 * @internal
 */
export function applyClass(el: Element, value: unknown, svg: boolean): void {
  const text = classText(value);
  if (text === null) {
    el.removeAttribute("class");
    return;
  }
  if (svg) {
    if (el.getAttribute("class") !== text) el.setAttribute("class", text);
  } else if (el.className !== text) {
    el.className = text;
  }
}

/**
 * Replaces the whole `class` of an element: the helper compiled templates call for `class` and
 * `className`. HTML elements are written through `className`; SVG and MathML elements (whose
 * `className` is not a plain string) through the `class` attribute. The DOM is touched only when
 * the text changes.
 *
 * @param el Target element.
 * @param value A string is used as is. Arrays and objects are clsx-style: non-empty strings,
 * numbers other than `0` and `NaN`, nested arrays, and the keys of objects whose value is truthy,
 * joined with spaces. `null`, `undefined` and `false` remove the attribute.
 * @throws TypeError `SHADOW_CLASS_CYCLE` when an array contains itself (directly or through a nested
 * array).
 * @example
 * import { className } from "@shadow-js/web";
 *
 * const card = document.createElement("div");
 * className(card, ["card", { "card--active": true, "card--muted": false }]);
 * card.className; // "card card--active"
 * @see classList
 * @since 1.0.0
 */
export function className(el: Element, value: unknown): void {
  applyClass(el, value, el.namespaceURI !== HTML_NS);
}

/** Narrows an object value to a record of keys; arrays and primitives are not class maps. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Toggles individual classes from an object: the helper compiled templates call for `classList`.
 * Unlike {@link className}, it leaves classes it did not set alone: only keys whose truthiness
 * changed relative to `prev` are touched. A key may hold several space-separated names. Keys that
 * disappeared from `value` are switched off.
 *
 * @param el Target element.
 * @param value Map from class names to truthiness. `undefined` switches off every class `prev` had on.
 * @param prev The map returned by the previous call. Undefined (the first call) means no class was
 * on yet.
 * @returns The map now in effect (`value`, or `{}` for undefined), to pass back as `prev` next time.
 * @example
 * import { classList } from "@shadow-js/web";
 *
 * const el = document.createElement("li");
 * let prev = classList(el, { active: true, "is-new pulse": true });
 * prev = classList(el, { active: false }, prev); // removes active, is-new and pulse
 * @see className
 * @since 1.0.0
 */
export function classList(
  el: Element,
  value: Record<string, unknown> | undefined,
  prev?: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = value ?? {};
  const before: Record<string, unknown> = prev ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(next)]);
  for (const key of keys) {
    const now = Boolean(next[key]);
    const was = Boolean(before[key]);
    if (now === was) continue;
    for (const token of key.split(/\s+/)) {
      if (token !== "") el.classList.toggle(token, now);
    }
  }
  return next;
}

/**
 * Converts a camelCase style name to a CSS property name. Custom properties are kept as they are,
 * and vendor prefixes map to `-webkit-` and `-ms-`.
 * @internal
 */
export function toCssProperty(name: string): string {
  if (name.startsWith("--")) return name;
  const kebab = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return kebab.startsWith("ms-") ? `-${kebab}` : kebab;
}

/**
 * Sets or removes one inline style property: the helper compiled templates call for the `style:`
 * prefix. Other inline properties are left alone.
 *
 * @param el HTML or SVG element.
 * @param name CSS property in camelCase (`backgroundColor`, `msTransform` gives `-ms-transform`) or
 * kebab-case, or a custom property (`--accent`, kept as is).
 * @param value `null`, `undefined` and `false` remove the property. A number is in pixels, as in
 * React, unless it is `0`, the property is unitless (`opacity`, `zIndex`, `flexGrow`, `lineHeight`,
 * ...) or a custom property. Any other value is written as `String(value)`.
 * @example
 * import { setStyleProperty } from "@shadow-js/web";
 *
 * const el = document.createElement("div");
 * setStyleProperty(el, "marginTop", 8); // margin-top: 8px
 * setStyleProperty(el, "--accent", "rebeccapurple");
 * setStyleProperty(el, "opacity", 0.5); // unitless
 * @see style
 * @since 1.0.0
 */
export function setStyleProperty(el: HTMLElement | SVGElement, name: string, value: unknown): void {
  const property = toCssProperty(name);
  if (value === null || value === undefined || value === false) {
    el.style.removeProperty(property);
  } else {
    el.style.setProperty(property, cssValueText(property, value));
  }
}

/**
 * Sets the inline style of an element: the helper compiled templates call for a `style` attribute.
 * An object is diffed against `prev` so that only changed properties are written, each with the
 * rules of {@link setStyleProperty}; properties that disappeared are removed.
 *
 * @param el HTML or SVG element.
 * @param value An object of properties (camelCase, kebab-case or custom names). A string replaces
 * `cssText`. `null`, `undefined` and `false` remove the `style` attribute.
 * @param prev The value returned by the previous call. Undefined (the first call) diffs against an
 * empty style. When it is a string, `cssText` is cleared before the object is written.
 * @returns What to pass back as `prev` next time: a shallow copy of an object value, otherwise
 * `value` itself.
 * @example
 * import { style } from "@shadow-js/web";
 *
 * const el = document.createElement("div");
 * let prev = style(el, { color: "red", width: 120 }); // width: 120px
 * prev = style(el, { color: "blue" }, prev); // writes color, removes width
 * @see setStyleProperty
 * @since 1.0.0
 */
export function style(el: HTMLElement | SVGElement, value: unknown, prev?: unknown): unknown {
  if (value === null || value === undefined || value === false) {
    el.removeAttribute("style");
    return value;
  }
  if (typeof value !== "object") {
    el.style.cssText = String(value);
    return value;
  }
  const next = { ...(value as Record<string, unknown>) };
  const before = asRecord(prev) ?? {};
  if (typeof prev === "string") el.style.cssText = "";
  const keys = new Set([...Object.keys(before), ...Object.keys(next)]);
  for (const key of keys) {
    if (Object.is(before[key], next[key])) continue;
    setStyleProperty(el, key, next[key]);
  }
  return next;
}
