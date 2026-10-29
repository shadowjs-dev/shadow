import { batch, getOwner, onCleanup, untrack } from "@shadow-js/core";

/**
 * Events that may be delegated: composed events, which leave a shadow root and reach the document.
 * `change` is not composed, so it is bound on its element (see the note on `bindEvent`).
 */
const DELEGATED_EVENTS =
  /^(?:click|dblclick|input|beforeinput|contextmenu|key(?:down|up|press)|(?:pointer|mouse)(?:down|up|move|over|out)|focus(?:in|out)|touch(?:start|end|move))$/;

/** Documents that already carry the delegated listener for a given event name. */
const installed = new WeakMap<Document, Set<string>>();

/** A handler together with its optional data; `tuple` records the `[fn, data]` form. */
interface Binding {
  readonly fn: (this: EventTarget, ...args: unknown[]) => unknown;
  readonly data: unknown;
  readonly tuple: boolean;
}

/** Calls `fn` with `this` = node, retargeting `currentTarget` for the duration of the call. */
function invoke(fn: Binding["fn"], node: EventTarget, event: Event, args: unknown[]): void {
  Object.defineProperty(event, "currentTarget", { configurable: true, get: () => node });
  try {
    untrack(() => fn.call(node, ...args));
  } finally {
    Reflect.deleteProperty(event, "currentTarget");
  }
}

/**
 * The one listener per (document, event). It walks `composedPath()` from the target outward,
 * calling `node.$$<type>` with `this = node`. Stops when a handler stops propagation.
 */
function dispatchDelegated(event: Event): void {
  // One batch per event: every handler on the path runs first, then the effects, so the DOM is
  // current when the event finishes (ADR-007).
  batch(() => dispatchPath(event));
}

function dispatchPath(event: Event): void {
  const key = `$$${event.type}`;
  const dataKey = `${key}Data`;
  const errors: unknown[] = [];
  for (const node of event.composedPath()) {
    if (event.cancelBubble) break;
    const fn = Reflect.get(node, key);
    if (typeof fn !== "function") continue;
    const data = Reflect.get(node, dataKey);
    try {
      invoke(fn as Binding["fn"], node, event, data === undefined ? [event] : [data, event]);
    } catch (error) {
      errors.push(error);
    }
  }
  const [first] = errors;
  if (errors.length === 1) throw first;
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      __DEV__ ? "Several event handlers threw." : "SHADOW_EVENT_ERRORS",
    );
}

/** A DOM-style listener object: `handleEvent` plus the `addEventListener` options. */
interface ListenerObject {
  handleEvent(event: Event): unknown;
  once?: boolean;
  passive?: boolean;
  capture?: boolean;
  signal?: AbortSignal;
}

function isListenerObject(handler: unknown): handler is ListenerObject {
  return (
    typeof handler === "object" &&
    handler !== null &&
    typeof (handler as { handleEvent?: unknown }).handleEvent === "function"
  );
}

/** Binds a listener object natively (never delegated), honoring its options. */
function bindListenerObject(
  el: Element,
  name: string,
  object: ListenerObject,
  capture: boolean,
): () => void {
  const { once, passive, signal } = object;
  // A member that is `undefined` counts as absent to the DOM, so none of them needs a check.
  const options = {
    capture: object.capture === true || capture,
    once,
    passive,
    signal,
  } as AddEventListenerOptions;
  const listener = (event: Event): void => {
    batch(() => untrack(() => object.handleEvent(event)));
  };
  el.addEventListener(name, listener, options);
  return () => {
    el.removeEventListener(name, listener, options);
  };
}

/** Normalizes a handler value into a binding; throws for values that are neither. */
function toBinding(handler: unknown): Binding {
  if (typeof handler === "function") {
    return { fn: handler as Binding["fn"], data: undefined, tuple: false };
  }
  if (Array.isArray(handler) && typeof handler[0] === "function") {
    return { fn: handler[0] as Binding["fn"], data: handler[1], tuple: true };
  }
  throw new TypeError(
    __DEV__
      ? "addEventListener(): the handler must be a function, [function, data] or an object with handleEvent."
      : "SHADOW_EVENT_HANDLER",
  );
}

/**
 * Combines several handlers for one event name on one element into one handler that calls them in
 * order with the same event. The compiler uses it when an element has, for example, both `onInput`
 * and a text input's `onChange`: the delegated slot holds one function.
 *
 * @param handlers The handlers, in source order. None gives a handler that does nothing.
 * @returns A handler that calls each of them with the same `this` and event. An error thrown by one
 * handler propagates and the later handlers do not run.
 * @example
 * import { addEventListener, chainEvents } from "@shadow-js/web";
 *
 * const input = document.createElement("input");
 * const onInput = chainEvents(
 *   (event) => console.log("validate", event.type),
 *   (event) => console.log("save", event.type),
 * );
 * addEventListener(input, "input", onInput);
 * @since 1.0.0
 */
export function chainEvents(
  ...handlers: Array<(this: EventTarget, event: Event) => unknown>
): (this: EventTarget, event: Event) => void {
  return function chained(this: EventTarget, event: Event): void {
    for (const handler of handlers) handler.call(this, event);
  };
}

/**
 * Installs the document listener that runs delegated handlers for each event name, once per
 * document and name; repeated calls do nothing. Compiled modules call it for the events they
 * delegate, so application code rarely needs it. The listener walks `composedPath()` from the target
 * outward and runs each element's delegated handler in one batch, stopping when a handler stops
 * propagation. A non-composed event raised inside a shadow root never reaches the document, so bind
 * such events natively.
 *
 * @param names Event names to delegate, such as `["click", "input"]`.
 * @param target Document that receives the listeners. Default: the global `document`.
 * @example
 * import { delegateEvents } from "@shadow-js/web";
 *
 * delegateEvents(["click", "input"]);
 * @see clearDelegatedEvents
 * @since 1.0.0
 */
export function delegateEvents(names: string[], target: Document = globalThis.document): void {
  let known = installed.get(target);
  if (known === undefined) {
    known = new Set<string>();
    installed.set(target, known);
  }
  for (const name of names) {
    if (known.has(name)) continue;
    known.add(name);
    target.addEventListener(name, dispatchDelegated);
  }
}

/**
 * Removes the delegated listeners {@link delegateEvents} installed on `target`. Delegated handlers stop
 * running until `delegateEvents` is called again (Solid's `clearDelegatedEvents`). Use it when a page
 * unmounts ShadowJS entirely, for example a micro-frontend that hands the document back. A document
 * without delegated listeners is left as is.
 *
 * @param target Document whose listeners are removed. Default: the global `document`.
 * @example
 * import { clearDelegatedEvents } from "@shadow-js/web";
 *
 * export function unmountApp(dispose: () => void): void {
 *   dispose();
 *   clearDelegatedEvents();
 * }
 * @see delegateEvents
 * @since 1.0.0
 */
export function clearDelegatedEvents(target: Document = globalThis.document): void {
  const known = installed.get(target);
  if (known === undefined) return;
  for (const name of known) target.removeEventListener(name, dispatchDelegated);
  installed.delete(target);
}

/**
 * The document that must carry the delegated listener for `el`. A template clone is owned by the
 * template's inert document (no window, never receives an event) until it is inserted, and handlers
 * are bound before that: use the page's document then, which is where the element will live.
 */
function delegationDocument(el: Element): Document {
  const owner = el.ownerDocument;
  return owner !== null && owner.defaultView !== null ? owner : globalThis.document;
}

/**
 * Binds one handler and returns the function that undoes it. A delegated event is stored on the
 * element as an expando; the document listener picks it up. Other events get a native listener.
 * Non-composed events (`change`, `select`, `load`, ...) never leave a shadow root, so they always get
 * a native listener, whatever the caller asked for.
 * @internal
 */
export function bindEvent(
  el: Element,
  name: string,
  handler: unknown,
  delegate: boolean,
  capture = false,
): (() => void) | undefined {
  if (handler === null || handler === undefined || handler === false) return undefined;
  if (isListenerObject(handler)) return bindListenerObject(el, name, handler, capture);
  const binding = toBinding(handler);
  // One delegated slot per event name: a second handler for the same name on this element (React's
  // onInput and onChange on one text input) binds natively, so both run.
  const slot = `$$${name}`;
  // The delegated slot tells a tuple from a plain handler by its data being defined, so a tuple whose
  // data is undefined is bound natively, where it still receives `(undefined, event)`.
  const plain = !binding.tuple || binding.data !== undefined;
  if (
    delegate &&
    plain &&
    !capture &&
    DELEGATED_EVENTS.test(name) &&
    Reflect.get(el, slot) === undefined
  ) {
    delegateEvents([name], delegationDocument(el));
    const dataKey = `${slot}Data`;
    Reflect.set(el, slot, binding.fn);
    if (binding.tuple) Reflect.set(el, dataKey, binding.data);
    else Reflect.deleteProperty(el, dataKey);
    return () => {
      if (Reflect.get(el, slot) === binding.fn) {
        Reflect.deleteProperty(el, slot);
        Reflect.deleteProperty(el, dataKey);
      }
    };
  }
  const listener = (event: Event): void => {
    const args: unknown[] = binding.tuple ? [binding.data, event] : [event];
    batch(() => untrack(() => binding.fn.call(el, ...args)));
  };
  el.addEventListener(name, listener, capture);
  return () => {
    el.removeEventListener(name, listener, capture);
  };
}

/**
 * Binds an event handler to an element: the helper compiled templates call for `onX` and the `on:`
 * and `oncapture:` prefixes. Handlers run batched and untracked, with `this` set to the element.
 * Inside an owner, the listener is removed when the owner is disposed, even if the element outlives
 * it.
 *
 * @param el Target element.
 * @param name Event name, lowercase, such as `click`.
 * @param handler A function (called with the event), a `[fn, data]` tuple (called as
 * `fn(data, event)`), or a listener object `{ handleEvent, once, passive, capture, signal }`, which
 * is always bound natively with those options. `null`, `undefined` and `false` bind nothing.
 * @param delegate `true` stores the handler on the element for the document listener of
 * {@link delegateEvents} (installed on demand) when `name` is a delegated event (`click`, `input`,
 * `keydown`, pointer, mouse, touch and focus events, ...) and the element has no delegated handler
 * for it yet. Otherwise, and when undefined, the handler gets a native listener.
 * @param capture `true` listens in the capture phase, never delegated. Undefined means the bubble phase.
 * @throws TypeError `SHADOW_EVENT_HANDLER` when `handler` is not a function, a tuple whose first item
 * is a function, or a listener object.
 * @example
 * import { addEventListener } from "@shadow-js/web";
 *
 * const button = document.createElement("button");
 * addEventListener(button, "click", () => console.log("pressed"), true);
 * addEventListener(button, "focus", [(id: string, event: Event) => console.log(id, event.type), "save"]);
 * @see delegateEvents
 * @since 1.0.0
 */
export function addEventListener(
  el: Element,
  name: string,
  handler: unknown,
  delegate?: boolean,
  capture?: boolean,
): void {
  const unbind = bindEvent(el, name, handler, delegate === true, capture === true);
  // The listener goes when the owner does, even if the element outlives it (moved, portaled, reused).
  if (unbind !== undefined && getOwner() !== null) onCleanup(unbind);
}
