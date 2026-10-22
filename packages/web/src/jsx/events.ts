/**
 * Event handler types for JSX. Each handler receives the precise DOM event subtype, with
 * `currentTarget` typed as the element that owns the attribute.
 *
 * Two forms are accepted:
 * - a function `(event) => void`;
 * - the tuple `[handler, data]`, called as `handler(data, event)`. Use it to avoid allocating a
 *   closure per row. Annotate the handler's first parameter: TypeScript cannot link it to `data`
 *   inside an attribute, so the tuple's data type is `unknown` at the JSX site.
 *
 * Event names are the React-style camelCase names (`onClick`, `onKeyDown`, `onDoubleClick`). The
 * compiler lower-cases them, so `onKeydown` and `onKeyDown` are the same listener.
 *
 * Namespaced forms `on:name`, `oncapture:name` accept lower-case DOM names. Custom events are typed
 * by declaration-merging the `CustomEvents` interface of `@shadow-js/web/jsx-runtime`.
 *
 * @since 1.0.0
 */

/**
 * A plain event handler. `event.currentTarget` is `T`; `event.target` is an `Element`.
 *
 * @typeParam T The element the handler is attached to.
 * @typeParam E The DOM event type.
 * @example
 * import type { EventHandler } from "@shadow-js/web";
 *
 * const onInput: EventHandler<HTMLInputElement, InputEvent> = (event) =>
 *   console.log(event.currentTarget.value);
 * const field = <input onInput={onInput} />;
 * @since 1.0.0
 */
export type EventHandler<T, E = Event> = (event: E & { currentTarget: T; target: Element }) => void;

/**
 * Handler and data as a tuple: `[(data, event) => void, data]`. The data is passed as the first
 * argument, the event second.
 *
 * The handler is declared with method-style (bivariant) parameters, so a handler that annotates its
 * data type is accepted at JSX sites, where the data type is `unknown`.
 *
 * @typeParam T The element the handler is attached to.
 * @typeParam E The DOM event type.
 * @typeParam D The data type. In JSX attributes it is `unknown`.
 * @example
 * import type { BoundEventHandler } from "@shadow-js/web";
 *
 * interface Row {
 *   id: number;
 * }
 * const select = (id: number, extend: boolean) => console.log(id, extend);
 * const onRowClick: BoundEventHandler<HTMLButtonElement, MouseEvent, Row> = [
 *   (row, event) => select(row.id, event.shiftKey),
 *   { id: 7 },
 * ];
 * @since 1.0.0
 */
export type BoundEventHandler<T, E = Event, D = unknown> = [BoundHandlerFunction<T, E, D>, D];

/**
 * What an event attribute accepts: a plain handler, a `[handler, data]` tuple, or a listener object.
 * Use it to type a prop that is forwarded to an element's event attribute.
 *
 * @typeParam T The element the handler is attached to.
 * @typeParam E The DOM event type.
 * @example
 * import type { EventHandlerProp } from "@shadow-js/web";
 *
 * function SaveButton(props: { onPress?: EventHandlerProp<HTMLButtonElement, MouseEvent> }) {
 *   return <button onClick={props.onPress}>Save</button>;
 * }
 * @since 1.0.0
 */
export type EventHandlerProp<T, E = Event> =
  | EventHandler<T, E>
  | BoundEventHandler<T, E>
  | ListenerObject<T, E>;

/**
 * A DOM-style listener object: `handleEvent` plus the `addEventListener` options. It is bound
 * natively (never delegated), so `once`, `passive`, `capture` and `signal` behave as in the DOM.
 *
 * @typeParam T The element the listener is attached to.
 * @typeParam E The DOM event type.
 * @example
 * import type { JSX } from "@shadow-js/web";
 *
 * const save = () => console.log("saved");
 * const button: JSX.Element = <button on:click={{ handleEvent: save, once: true }}>Save</button>;
 * @since 1.0.0
 */
export interface ListenerObject<T, E = Event> {
  /** Called with each event, batched and untracked. */
  handleEvent(event: E & { currentTarget: T; target: Element }): void;
  /**
   * Removes the listener after its first call.
   * @default false
   */
  once?: boolean;
  /**
   * Promises not to call `preventDefault`, so the browser can scroll without waiting.
   * @default undefined (the browser's default for the event and the target)
   */
  passive?: boolean;
  /**
   * Listens in the capture phase. The `oncapture:` prefix also sets it.
   * @default false
   */
  capture?: boolean;
  /**
   * Removes the listener when the signal aborts. The listener is also removed with its owner.
   * @default undefined (removed only with its owner)
   */
  signal?: AbortSignal;
}

/** The handler half of a bound tuple, with bivariant parameters. @internal */
type BoundHandlerFunction<T, E, D> = {
  bound(data: D, event: E & { currentTarget: T; target: Element }): void;
}["bound"];

/** Handler prop names mapped to the DOM event they listen for. Keys are React-style names. @internal */
export type HandlerNames = Record<string, string>;

/**
 * Attributes `onX` for the event names in `N`, typed from the DOM event map `M`.
 *
 * @internal
 */
export type HandlerProps<T, M, N extends HandlerNames> = {
  [H in keyof N]?: EventHandlerProp<T, M[N[H] & keyof M]> | undefined;
} & {
  /** The lowercase spelling (`onclick`) is accepted too, for code ported from HTML or Solid. */
  [H in keyof N as Lowercase<H & string>]?: EventHandlerProp<T, M[N[H] & keyof M]> | undefined;
};

/**
 * `on:event` attributes for the names in `N`.
 *
 * @internal
 */
export type OnProps<T, M, N extends HandlerNames> = {
  [H in keyof N as `on:${N[H] & string}`]?: EventHandlerProp<T, M[N[H] & keyof M]> | undefined;
};

/**
 * `oncapture:event` attributes for the names in `N`. The listener is registered in the capture phase.
 *
 * @internal
 */
export type CaptureProps<T, M, N extends HandlerNames> = {
  [H in keyof N as `oncapture:${N[H] & string}`]?:
    | EventHandlerProp<T, M[N[H] & keyof M]>
    | undefined;
};

/**
 * The custom events declared in the app's `CustomEvents` interface, as `on:name` and
 * `oncapture:name`. The entry passes its `CustomEvents` as `C`, so this module needs no import from
 * the entry (an import would create a cycle and split the declarations into a shared chunk).
 *
 * @typeParam T The element the handler is attached to.
 * @typeParam C The custom-event map (the entry's `CustomEvents`).
 * @internal
 */
export type CustomEventProps<T, C> = {
  [E in keyof C as `on:${E & string}`]?: EventHandlerProp<T, C[E]>;
} & {
  [E in keyof C as `oncapture:${E & string}`]?: EventHandlerProp<T, C[E]>;
};

/** Every DOM event that can be attached to an HTML, SVG or MathML element. @internal */
export type DomEventMap = GlobalEventHandlersEventMap & ElementEventMap;

/**
 * React-style handler names for the events every element dispatches (`GlobalEventHandlersEventMap`).
 *
 * @since 1.0.0
 */
export type GlobalEventNames = {
  onAbort: "abort";
  onAnimationCancel: "animationcancel";
  onAnimationEnd: "animationend";
  onAnimationIteration: "animationiteration";
  onAnimationStart: "animationstart";
  onAuxClick: "auxclick";
  onBeforeInput: "beforeinput";
  onBeforeMatch: "beforematch";
  onBeforeToggle: "beforetoggle";
  onBlur: "blur";
  onCancel: "cancel";
  onCanPlay: "canplay";
  onCanPlayThrough: "canplaythrough";
  onChange: "change";
  onClick: "click";
  onClose: "close";
  onCommand: "command";
  onCompositionEnd: "compositionend";
  onCompositionStart: "compositionstart";
  onCompositionUpdate: "compositionupdate";
  onContextLost: "contextlost";
  onContextMenu: "contextmenu";
  onContextRestored: "contextrestored";
  onCopy: "copy";
  onCueChange: "cuechange";
  onCut: "cut";
  onDoubleClick: "dblclick";
  onDblClick: "dblclick";
  onDrag: "drag";
  onDragEnd: "dragend";
  onDragEnter: "dragenter";
  onDragLeave: "dragleave";
  onDragOver: "dragover";
  onDragStart: "dragstart";
  onDrop: "drop";
  onDurationChange: "durationchange";
  onEmptied: "emptied";
  onEnded: "ended";
  onError: "error";
  onFocus: "focus";
  onFocusIn: "focusin";
  onFocusOut: "focusout";
  onFormData: "formdata";
  onGotPointerCapture: "gotpointercapture";
  onInput: "input";
  onInvalid: "invalid";
  onKeyDown: "keydown";
  /** @deprecated React deprecated `onKeyPress`; it still fires for `keypress`. Prefer `onKeyDown`. */
  onKeyPress: "keypress";
  onKeyUp: "keyup";
  onLoad: "load";
  onLoadedData: "loadeddata";
  onLoadedMetadata: "loadedmetadata";
  onLoadStart: "loadstart";
  onLostPointerCapture: "lostpointercapture";
  onMouseDown: "mousedown";
  onMouseEnter: "mouseenter";
  onMouseLeave: "mouseleave";
  onMouseMove: "mousemove";
  onMouseOut: "mouseout";
  onMouseOver: "mouseover";
  onMouseUp: "mouseup";
  onPaste: "paste";
  onPause: "pause";
  onPlay: "play";
  onPlaying: "playing";
  onPointerCancel: "pointercancel";
  onPointerDown: "pointerdown";
  onPointerEnter: "pointerenter";
  onPointerLeave: "pointerleave";
  onPointerMove: "pointermove";
  onPointerOut: "pointerout";
  onPointerOver: "pointerover";
  onPointerRawUpdate: "pointerrawupdate";
  onPointerUp: "pointerup";
  onProgress: "progress";
  onRateChange: "ratechange";
  onReset: "reset";
  onResize: "resize";
  onScroll: "scroll";
  onScrollEnd: "scrollend";
  onSecurityPolicyViolation: "securitypolicyviolation";
  onSeeked: "seeked";
  onSeeking: "seeking";
  onSelect: "select";
  onSelectionChange: "selectionchange";
  onSelectStart: "selectstart";
  onSlotChange: "slotchange";
  onStalled: "stalled";
  onSubmit: "submit";
  onSuspend: "suspend";
  onTimeUpdate: "timeupdate";
  onToggle: "toggle";
  onTouchCancel: "touchcancel";
  onTouchEnd: "touchend";
  onTouchMove: "touchmove";
  onTouchStart: "touchstart";
  onTransitionCancel: "transitioncancel";
  onTransitionEnd: "transitionend";
  onTransitionRun: "transitionrun";
  onTransitionStart: "transitionstart";
  onVolumeChange: "volumechange";
  onWaiting: "waiting";
  onWebkitAnimationEnd: "webkitanimationend";
  onWebkitAnimationIteration: "webkitanimationiteration";
  onWebkitAnimationStart: "webkitanimationstart";
  onWebkitTransitionEnd: "webkittransitionend";
  onWheel: "wheel";
};

/**
 * Handler names for the fullscreen events of `ElementEventMap`.
 *
 * @since 1.0.0
 */
export type ElementEventNames = {
  onFullscreenChange: "fullscreenchange";
  onFullscreenError: "fullscreenerror";
};

/**
 * Handler names for the `Window` events a `body`, `frameset` or root `svg` element also receives
 * (`WindowEventHandlersEventMap`).
 *
 * @since 1.0.0
 */
export type WindowEventNames = {
  onAfterPrint: "afterprint";
  onBeforePrint: "beforeprint";
  onBeforeUnload: "beforeunload";
  onGamepadConnected: "gamepadconnected";
  onGamepadDisconnected: "gamepaddisconnected";
  onHashChange: "hashchange";
  onLanguageChange: "languagechange";
  onMessage: "message";
  onMessageError: "messageerror";
  onOffline: "offline";
  onOnline: "online";
  onPageHide: "pagehide";
  onPageReveal: "pagereveal";
  onPageShow: "pageshow";
  onPageSwap: "pageswap";
  onPopState: "popstate";
  onRejectionHandled: "rejectionhandled";
  onStorage: "storage";
  onUnhandledRejection: "unhandledrejection";
  onUnload: "unload";
};

/**
 * Handler names for the encryption events of media elements (`audio`, `video`).
 *
 * @since 1.0.0
 */
export type MediaEventNames = {
  onEncrypted: "encrypted";
  onWaitingForKey: "waitingforkey";
};

/**
 * Handler names for the picture-in-picture events of `video`.
 *
 * @since 1.0.0
 */
export type VideoEventNames = {
  onEnterPictureInPicture: "enterpictureinpicture";
  onLeavePictureInPicture: "leavepictureinpicture";
};

/**
 * Event attributes every HTML, SVG and MathML element accepts. Handlers are typed from the DOM event
 * maps, so `onClick` on a `button` receives a `PointerEvent` whose `currentTarget` is the button.
 *
 * @typeParam T The element type, used for `currentTarget`.
 * @since 1.0.0
 */
export type EventAttributes<T> = HandlerProps<
  T,
  DomEventMap,
  GlobalEventNames & ElementEventNames
> &
  OnProps<T, DomEventMap, GlobalEventNames & ElementEventNames> &
  CaptureProps<T, DomEventMap, GlobalEventNames & ElementEventNames> &
  ReactCaptureProps<T, DomEventMap, GlobalEventNames & ElementEventNames>;

/**
 * React's capture spellings of the element events: `onClickCapture`, `onFocusCapture`, ... Each binds the
 * capture phase of the same DOM event, with the same rules as `oncapture:name`.
 *
 * @typeParam T The element type, used for `currentTarget`.
 * @internal
 */
export type ReactCaptureProps<T, M, N extends HandlerNames> = {
  [H in keyof N as `${H & string}Capture`]?: EventHandlerProp<T, M[N[H] & keyof M]> | undefined;
};

/**
 * Extra window events for `body`, `frameset` and the root `svg` element.
 *
 * @typeParam T The element type, used for `currentTarget`.
 * @since 1.0.0
 */
export type WindowEventAttributes<T> = HandlerProps<
  T,
  WindowEventHandlersEventMap,
  WindowEventNames
> &
  OnProps<T, WindowEventHandlersEventMap, WindowEventNames> &
  CaptureProps<T, WindowEventHandlersEventMap, WindowEventNames>;

/**
 * Extra media events for `audio` and `video`.
 *
 * @typeParam T The element type, used for `currentTarget`.
 * @since 1.0.0
 */
export type MediaEventAttributes<T> = HandlerProps<T, HTMLMediaElementEventMap, MediaEventNames> &
  OnProps<T, HTMLMediaElementEventMap, MediaEventNames> &
  CaptureProps<T, HTMLMediaElementEventMap, MediaEventNames>;

/**
 * Extra picture-in-picture events for `video`.
 *
 * @typeParam T The element type, used for `currentTarget`.
 * @since 1.0.0
 */
export type VideoEventAttributes<T> = HandlerProps<T, HTMLVideoElementEventMap, VideoEventNames> &
  OnProps<T, HTMLVideoElementEventMap, VideoEventNames> &
  CaptureProps<T, HTMLVideoElementEventMap, VideoEventNames>;
