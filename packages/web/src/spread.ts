import { onCleanup, untrack, useRenderEffect } from "@shadow-js/core";
import { setAttribute, setAttributeNS, setBoolAttribute } from "./attributes";
import { autoFocus } from "./autofocus";
import { applyClass, asRecord, classList, style } from "./class-style";
import { bindEvent } from "./events";
import { bindRegion, createRegion, watchCommits } from "./insert";
import { claims } from "./internal/hydration-hooks";
import { attributeName, eventPlan, IGNORED_KEYS, isFlagAttribute } from "./internal/react-names";
import { plainText, setSelectValue } from "./select-value";

/** The namespace of `xlink:` attributes (SVG's legacy links). */
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Keys that would reach a prototype if written as properties. Ignored everywhere. */
const FORBIDDEN_NAMES = /^(?:__proto__|constructor|prototype)$/;

/** Mutable bookkeeping for one spread: the values last applied and the event bindings. */
interface SpreadState {
  readonly values: Map<string, unknown>;
  readonly unbind: Map<string, () => void>;
  styled?: unknown;
  listed?: Record<string, unknown> | undefined;
  /** Cleanup returned by the `ref` callback currently applied (React 19 ref cleanup). */
  unref?: (() => void) | undefined;
  /** `autoFocus` acts on the first application only, as React applies it once at commit. */
  focused?: boolean;
}

/** Runs and forgets the cleanup the last ref callback returned, if any. */
function runRefCleanup(state: SpreadState): void {
  const cleanup = state.unref;
  if (cleanup === undefined) return;
  state.unref = undefined;
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
      if (typeof cleanup === "function") state.unref = cleanup as () => void;
    }
    return;
  }
  if (key === "autoFocus") {
    if (!state.focused) {
      state.focused = true;
      autoFocus(el, value);
    }
    return;
  }
  if (key === "class" || key === "className") {
    applyClass(el, value, svg);
    return;
  }
  if (key === "style") {
    state.styled = style(el as HTMLElement | SVGElement, value, state.styled);
    return;
  }
  if (key === "classList") {
    state.listed = classList(el, asRecord(value), state.listed);
    return;
  }
  if (key.length > 2 && key.startsWith("on")) {
    state.unbind.get(key)?.();
    state.unbind.delete(key);
    // React's spelling: `onChange`, `onFocus`, `...Capture` and passive `onWheel` bind as React does.
    const plan = eventPlan(key, el.localName, el.getAttribute("type")?.toLowerCase() ?? null);
    const handler =
      plan.passive && typeof value === "function" ? { handleEvent: value, passive: true } : value;
    const unbind = bindEvent(el, plan.type, handler, true, plan.capture);
    if (unbind !== undefined) state.unbind.set(key, unbind);
    return;
  }
  if (key === "innerHTML" || key === "dangerouslySetInnerHTML") {
    // `dangerouslySetInnerHTML` holds `{ __html }`; null and undefined mean empty.
    el.innerHTML = plainText(
      key === "innerHTML"
        ? value
        : value !== null && typeof value === "object"
          ? Reflect.get(value, "__html")
          : undefined,
    );
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
  if (!svg && LIVE_PROPERTIES.test(key) && key in el) {
    // State the user changes (a typed value, a toggled box) lives in the property; the attribute is
    // only the default, and writing it stops the element following the data once it is dirty.
    liveDiffers(el, key, value, svg) &&
      Reflect.set(el, key, STRING_PROPERTIES.test(key) ? (value ?? "") : Boolean(value));
    // An input's `value` attribute is its default (what a form reset restores) and what the server
    // wrote; keep it equal to the live value like server markup, so both renders match.
    if (key === "value" && el instanceof HTMLInputElement) {
      el.defaultValue = plainText(value);
    }
    return;
  }
  // A `prop:` property, an `attr:` or `bool:` attribute, or an attribute under its React name. An `undefined`
  // value removes the attribute or resets the property, which is how a prop that disappeared is undone.
  if (key.startsWith("prop:")) {
    Reflect.set(el, key.slice(5), value);
  } else if (key.startsWith("attr:")) {
    setAttribute(el, key.slice(5), value);
  } else if (key.startsWith("bool:")) {
    setBoolAttribute(el, key.slice(5), value);
  } else {
    const wire = attributeName(key, svg);
    // The server writes these names as flags by truthiness (`disabled: 0` is absent): so does the client.
    if (isFlagAttribute(wire, value)) setBoolAttribute(el, wire, value);
    else if (wire.startsWith("xlink:")) setAttributeNS(el, XLINK_NS, wire, value);
    else setAttribute(el, wire, value);
  }
}

/** Props written as element properties, like the compiler does for the same names in JSX. */
const LIVE_PROPERTIES =
  /^(?:value|checked|selected|muted|indeterminate|defaultValue|defaultChecked)$/;
/** The properties of {@link LIVE_PROPERTIES} that hold text; the others are booleans. */
const STRING_PROPERTIES = /^(?:value|defaultValue)$/;

/**
 * True when a live property (typed value, toggled box) no longer matches the value last applied, so
 * an unchanged prop is written again and the element follows the data.
 */
function liveDiffers(el: Element, key: string, value: unknown, svg: boolean): boolean {
  if (svg || !LIVE_PROPERTIES.test(key) || !(key in el)) return false;
  // A select is written again whenever its props run: setting the value it already shows changes nothing.
  if (key === "value" && el instanceof HTMLSelectElement) return true;
  const live = Reflect.get(el, key);
  return STRING_PROPERTIES.test(key) ? live !== plainText(value) : live !== Boolean(value);
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
  const state = newState();
  if (!skipChildren && el.localName !== "textarea") {
    // Spread children own the whole element; ssrElement may emit their text without region markers.
    const initial = claims.current.isClaiming()
      ? (claims.current.takeRegion(el, null) ?? Array.from(el.childNodes))
      : undefined;
    const region = createRegion(el, null, initial);
    bindRegion(region, () => (read() as { readonly children?: unknown } | null)?.children);
    followOptions(el, isSVG, state);
  }
  applyProps(el, read, isSVG, state);
}

/**
 * New options replace the ones that held the selection, and the value effect does not read
 * `children`: a select spread selects its value again after every commit to its children, as the
 * compiled path does.
 */
function followOptions(el: Element, isSVG: boolean, state: SpreadState): void {
  if (isSVG || !(el instanceof HTMLSelectElement)) return;
  watchCommits(el, () => {
    const key = state.values.has("value") ? "value" : "defaultValue";
    if (state.values.has(key)) setSelectValue(el, state.values.get(key));
  });
}

/** The bookkeeping of a spread that has applied nothing yet. */
function newState(): SpreadState {
  return { values: new Map(), unbind: new Map() };
}

/**
 * Applies the props of `read()` to `el` and keeps them in sync, without a children region: what
 * {@link spread} does after it has bound the children. `Dynamic` calls it directly, because it binds
 * the children itself, so an app that only renders `Dynamic` does not carry the code for a spread's
 * children. A select still selects its value again when `Dynamic` commits new options.
 * @internal
 */
export function spreadProps(el: Element, props: unknown, isSVG: boolean): void {
  if (props === null || (typeof props !== "object" && typeof props !== "function")) return;
  const state = newState();
  followOptions(el, isSVG, state);
  applyProps(
    el,
    () => (typeof props === "function" ? (props as () => unknown)() : props),
    isSVG,
    state,
  );
}

function applyProps(el: Element, read: () => unknown, isSVG: boolean, state: SpreadState): void {
  const textarea = el.localName === "textarea";
  // Native listeners come off with the owner, even if the element outlives it.
  onCleanup(() => {
    for (const unbind of state.unbind.values()) unbind();
    state.unbind.clear();
    runRefCleanup(state);
  });
  useRenderEffect(
    // Reads every prop except children, inside the render effect so each read is tracked.
    () => {
      const props = read();
      const entries: Array<[string, unknown]> = [];
      if (props === null || typeof props !== "object") return entries;
      let value: unknown;
      let hasValue = false;
      for (const key of Object.keys(props)) {
        if (FORBIDDEN_NAMES.test(key.slice(key.indexOf(":") + 1)) || IGNORED_KEYS.test(key))
          continue;
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
    },
    // Applies the entries that changed since the last run and undoes the ones that disappeared.
    // Unchanged values are skipped by identity, so only changed keys touch the DOM.
    (entries) => {
      const current = new Set<string>();
      for (const [key, value] of entries) {
        current.add(key);
        if (
          state.values.has(key) &&
          Object.is(state.values.get(key), value) &&
          !liveDiffers(el, key, value, isSVG)
        )
          continue;
        state.values.set(key, value);
        applyKey(el, key, value, state, isSVG);
      }
      for (const key of [...state.values.keys()]) {
        if (current.has(key)) continue;
        state.values.delete(key);
        // A prop that disappeared is applied as `undefined`: every branch of applyKey then undoes it (a ref
        // cleanup runs, a handler is unbound, the class, style and attribute go, a live property returns to empty).
        applyKey(el, key, undefined, state, isSVG);
      }
    },
  );
}
