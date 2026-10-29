import { onCleanup, untrack, useRenderEffect } from "@shadow-js/core";
import { setAttribute, setAttributeNS, setBoolAttribute } from "./attributes";
import { autoFocus } from "./autofocus";
import { applyClass, asRecord, classList, style } from "./class-style";
import { bindEvent } from "./events";
import { bindRegion, createRegion } from "./insert";
import { claims } from "./internal/hydration-hooks";
import { attributeName, eventPlan, IGNORED_KEYS } from "./internal/react-names";
import { plainText, setSelectValue } from "./select-value";

/** The namespace of `xlink:` attributes (SVG's legacy links). */
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** The HTML of a `dangerouslySetInnerHTML` value (`{ __html }`); null and undefined mean empty. */
function innerHtmlValue(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  return plainText(Reflect.get(value, "__html"));
}

/** Keys that would reach a prototype if written as properties. Ignored everywhere. */
const FORBIDDEN_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** Mutable bookkeeping for one spread: the values last applied and the event bindings. */
interface SpreadState {
  readonly values: Map<string, unknown>;
  readonly unbinders: Map<string, () => void>;
  styleValue: unknown;
  classListValue: Record<string, unknown> | undefined;
  /** Cleanup returned by the `ref` callback currently applied (React 19 ref cleanup). */
  refCleanup: (() => void) | undefined;
  /** `autoFocus` acts on the first application only, as React applies it once at commit. */
  autoFocused?: boolean;
}

/** True for `on*` keys, which bind event handlers. */
function isEventKey(key: string): boolean {
  return key.length > 2 && key.startsWith("on");
}

/** The name after a `prop:`, `attr:` or `bool:` namespace, or the whole key. */
function nameOf(key: string): string {
  const colon = key.indexOf(":");
  return colon === -1 ? key : key.slice(colon + 1);
}

/** Reads every prop except children, inside the render effect so each read is tracked. */
function readEntries(props: unknown, textarea: boolean): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  if (props === null || typeof props !== "object") return entries;
  let value: unknown;
  let hasValue = false;
  for (const key of Object.keys(props)) {
    if (FORBIDDEN_NAMES.has(nameOf(key)) || IGNORED_KEYS.has(key)) continue;
    if (key === "children") {
      // A textarea's children are its value (the server writes them as its content): a text node
      // child would not follow the data once the user has typed.
      if (textarea) {
        value = Reflect.get(props, key);
        hasValue = true;
      }
      continue;
    }
    entries.push([key, Reflect.get(props, key)]);
  }
  if (hasValue && !entries.some(([key]) => key === "value")) entries.push(["value", value]);
  return entries;
}

/** Runs and forgets the cleanup the last ref callback returned, if any. */
function runRefCleanup(state: SpreadState): void {
  const cleanup = state.refCleanup;
  if (cleanup === undefined) return;
  state.refCleanup = undefined;
  untrack(cleanup);
}

/** Applies one prop that is new or changed. */
function applyKey(
  el: Element,
  key: string,
  value: unknown,
  state: SpreadState,
  svg: boolean,
): void {
  if (key === "ref") {
    // The ref that was replaced is undone first: its cleanup runs, as for a ref attribute.
    runRefCleanup(state);
    if (typeof value === "function") {
      const callRef = value as (node: Element) => unknown;
      const cleanup = untrack(() => callRef(el));
      if (typeof cleanup === "function") state.refCleanup = cleanup as () => void;
    }
    return;
  }
  if (key === "autoFocus") {
    if (!state.autoFocused) {
      state.autoFocused = true;
      autoFocus(el, value);
    }
    return;
  }
  if (key === "class" || key === "className") {
    applyClass(el, value, svg);
    return;
  }
  if (key === "style") {
    state.styleValue = style(el as HTMLElement | SVGElement, value, state.styleValue);
    return;
  }
  if (key === "classList") {
    state.classListValue = classList(el, asRecord(value), state.classListValue);
    return;
  }
  if (isEventKey(key)) {
    state.unbinders.get(key)?.();
    state.unbinders.delete(key);
    // React's spelling: `onChange`, `onFocus`, `...Capture` and passive `onWheel` bind as React does.
    const plan = eventPlan(key, el.localName, el.getAttribute("type")?.toLowerCase() ?? null);
    const handler =
      plan.passive && typeof value === "function" ? { handleEvent: value, passive: true } : value;
    const unbind = bindEvent(el, plan.type, handler, true, plan.capture);
    if (unbind !== undefined) state.unbinders.set(key, unbind);
    return;
  }
  if (key === "innerHTML" || key === "dangerouslySetInnerHTML") {
    el.innerHTML = key === "innerHTML" ? plainText(value) : innerHtmlValue(value);
    return;
  }
  if (key === "textContent") {
    el.textContent = plainText(value);
    return;
  }
  if (!svg && (key === "value" || key === "defaultValue") && el instanceof HTMLSelectElement) {
    // A select's value may be an array (`multiple`).
    setSelectValue(el, value);
    return;
  }
  if (!svg && LIVE_PROPERTIES.has(key) && key in el) {
    // State the user changes (a typed value, a toggled box) lives in the property; the attribute is
    // only the default, and writing it stops the element following the data once it is dirty.
    liveDiffers(el, key, value, svg) &&
      Reflect.set(el, key, STRING_PROPERTIES.has(key) ? (value ?? "") : Boolean(value));
    // An input's `value` attribute is its default (what a form reset restores) and what the server
    // wrote; keep it equal to the live value like server markup, so both renders match.
    if (key === "value" && el instanceof HTMLInputElement) {
      el.defaultValue = plainText(value);
    }
    return;
  }
  writeKey(el, key, value, svg);
}

/**
 * Writes one prop by its key: a `prop:` property, an `attr:` or `bool:` attribute, or an attribute
 * under its React name. An `undefined` value removes the attribute or resets the property, which is how
 * a prop that disappeared is undone.
 */
function writeKey(el: Element, key: string, value: unknown, svg: boolean): void {
  if (key.startsWith("prop:")) {
    Reflect.set(el, key.slice(5), value);
  } else if (key.startsWith("attr:")) {
    setAttribute(el, key.slice(5), value);
  } else if (key.startsWith("bool:")) {
    setBoolAttribute(el, key.slice(5), value);
  } else {
    const wire = attributeName(key, svg);
    if (wire.startsWith("xlink:")) setAttributeNS(el, XLINK_NS, wire, value);
    else setAttribute(el, wire, value);
  }
}

/** Props written as element properties, like the compiler does for the same names in JSX. */
const LIVE_PROPERTIES: ReadonlySet<string> = new Set([
  "value",
  "checked",
  "selected",
  "muted",
  "indeterminate",
  "defaultValue",
  "defaultChecked",
]);
/** The properties of {@link LIVE_PROPERTIES} that hold text; the others are booleans. */
const STRING_PROPERTIES: ReadonlySet<string> = new Set(["value", "defaultValue"]);

/**
 * True when a live property (typed value, toggled box) no longer matches the value last applied, so
 * an unchanged prop is written again and the element follows the data.
 */
function liveDiffers(el: Element, key: string, value: unknown, svg: boolean): boolean {
  if (svg || !LIVE_PROPERTIES.has(key) || !(key in el)) return false;
  // A select is written again whenever its props run: setting the value it already shows changes nothing.
  if (key === "value" && el instanceof HTMLSelectElement) return true;
  const live = Reflect.get(el, key);
  return STRING_PROPERTIES.has(key) ? live !== plainText(value) : live !== Boolean(value);
}

/**
 * Applies the entries that changed since the last run and undoes the ones that disappeared.
 * Unchanged values are skipped by identity, so only changed keys touch the DOM.
 */
function applyEntries(
  el: Element,
  entries: Array<[string, unknown]>,
  state: SpreadState,
  svg: boolean,
): void {
  const current = new Set<string>();
  for (const [key, value] of entries) {
    current.add(key);
    if (
      state.values.has(key) &&
      Object.is(state.values.get(key), value) &&
      !liveDiffers(el, key, value, svg)
    )
      continue;
    state.values.set(key, value);
    applyKey(el, key, value, state, svg);
  }
  for (const key of [...state.values.keys()]) {
    if (current.has(key)) continue;
    state.values.delete(key);
    // A prop that disappeared is applied as `undefined`: every branch of applyKey then undoes it (a ref cleanup
    // runs, a handler is unbound, the class, style and attribute go, a live property returns to empty).
    applyKey(el, key, undefined, state, svg);
  }
}

/**
 * Applies a whole props object to an element and keeps it in sync: the helper compiled JSX calls for
 * `{...props}` on an element. The props are read inside a render effect, so a getter (or the props
 * accessor) that changes rewrites only the keys whose values changed, and a key that disappears is
 * undone. Event listeners and the last `ref` cleanup are released when the owner is disposed.
 *
 * Keys: `class`/`className`, `classList` and `style` use the class and style helpers; `ref` is called
 * untracked with the element (a returned function is its cleanup); `on*` keys bind with React's
 * spelling (`onChange` on a text input is `input`, `onFocus` is `focusin`, `...Capture` listens
 * in the capture phase, `onWheel` is passive), delegated when the event allows it; `prop:` writes a
 * property, `attr:` and `bool:` an attribute; `innerHTML`, `dangerouslySetInnerHTML` and
 * `textContent` set the content; `value`, `checked`, `selected`, `muted`, `indeterminate`,
 * `defaultValue` and `defaultChecked` are written as properties and re-applied when the user changed
 * them; `autoFocus` applies once. Other keys are attributes, with React names mapped (`htmlFor` is
 * `for`, SVG `strokeWidth` is `stroke-width`). `key`, `suppressHydrationWarning`,
 * `suppressContentEditableWarning`, `__proto__`, `constructor` and `prototype` are ignored.
 *
 * @param el Target element.
 * @param props A props object, or a function returning one (read in the effect). `null` and other
 * values do nothing.
 * @param isSVG `true` for SVG elements: `class` is written as an attribute and SVG names are mapped.
 * Default: `false`.
 * @param skipChildren `true` ignores `children` (the compiler sets it when the JSX has its own
 * children). Default: `false`, which inserts `children` as the element's content; on a `<textarea>`,
 * `children` is its value instead.
 * @throws TypeError `INVALID_ATTRIBUTE_NAME` for an attribute name that is not valid, and
 * `SHADOW_EVENT_HANDLER` for an `on*` value that is not a handler.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { spread } from "@shadow-js/web";
 *
 * function SaveButton() {
 *   const [busy] = useSignal(false);
 *   const button = document.createElement("button");
 *   spread(button, {
 *     class: "btn",
 *     onClick: () => console.log("save"),
 *     get disabled() { return busy(); },
 *     children: "Save",
 *   });
 *   return button;
 * }
 * @see element
 * @since 1.0.0
 */
export function spread(el: Element, props: unknown, isSVG = false, skipChildren = false): void {
  if (props === null || (typeof props !== "object" && typeof props !== "function")) return;
  // A function is an accessor of the props (`{...props.attrs}` compiles to one): read it inside
  // the effects below so the element follows it.
  const read = (): unknown => (typeof props === "function" ? (props as () => unknown)() : props);
  const textarea = el.localName === "textarea";
  if (!skipChildren && !textarea) {
    // Spread children own the whole element; ssrElement may emit their text without region markers.
    const initial = claims.current.isClaiming()
      ? (claims.current.takeRegion(el, null) ?? Array.from(el.childNodes))
      : undefined;
    const region = createRegion(el, null, initial);
    bindRegion(region, () => (read() as { readonly children?: unknown } | null)?.children);
  }
  const state: SpreadState = {
    values: new Map(),
    unbinders: new Map(),
    styleValue: undefined,
    classListValue: undefined,
    refCleanup: undefined,
  };
  // Native listeners come off with the owner, even if the element outlives it.
  onCleanup(() => {
    for (const unbind of state.unbinders.values()) unbind();
    state.unbinders.clear();
    runRefCleanup(state);
  });
  useRenderEffect(
    () => readEntries(read(), textarea),
    (entries) => {
      applyEntries(el, entries, state, isSVG);
    },
  );
}
