// biome-ignore-all lint/a11y: fixtures check typing of attribute values; accessibility rules do not apply
/**
 * Type tests: event handlers. Each handler's event subtype and `currentTarget` are checked, the
 * `[handler, data]` tuple form, the `on:` and `oncapture:` namespaces, and custom events.
 *
 * @since 1.0.0
 */
import type { BoundEventHandler, EventHandler } from "@shadow-js/web/jsx-runtime";
import { sink } from "./support";

type Row = { id: number; label: string };
declare const row: Row;
declare function select(id: number, extend: boolean): void;
declare function takeButton(element: HTMLButtonElement): boolean;
declare function takeInput(element: HTMLInputElement): boolean;

// ---- Element-typed currentTarget, precise event subtypes ----------------------------------------
sink(<button onClick={(e) => takeButton(e.currentTarget)} />);
sink(<input onInput={(e) => e.currentTarget.value + String(e.inputType)} />);
sink(<select onChange={(e) => e.currentTarget.selectedIndex} />);
sink(<input onKeyDown={(e) => e.key.length + (e.shiftKey ? 1 : 0)} />);
sink(<div onPointerDown={(e) => e.pointerId + e.pressure} />);
sink(<form onSubmit={(e) => e.submitter?.tagName} />);
sink(<form onReset={(e) => e.currentTarget.action} />);
sink(<form onFormData={(e) => e.formData.get("name")} />);
sink(<input onFocus={(e) => e.relatedTarget} onBlur={(e) => e.currentTarget.name} />);
sink(<div onDragStart={(e) => e.dataTransfer?.setData("text", "x")} />);
sink(<div onDrop={(e) => e.dataTransfer?.files.length} />);
sink(<div onWheel={(e) => e.deltaY * 2} />);
sink(<div onScroll={(e) => e.currentTarget.scrollTop} />);
sink(<div onContextMenu={(e) => e.clientX} />);
sink(<div onDoubleClick={(e) => e.detail} />);
sink(<div onDblClick={(e) => e.detail} />);
sink(<div onMouseEnter={(e) => e.buttons} onMouseLeave={(e) => e.altKey} />);
sink(<div onAuxClick={(e) => e.button} />);
sink(<div onTouchStart={(e) => e.touches.length} onTouchEnd={(e) => e.changedTouches.length} />);
sink(<div onPaste={(e) => e.clipboardData?.getData("text")} />);
sink(<div onCopy={(e) => e.clipboardData} />);
sink(<div onCompositionEnd={(e) => e.data} />);
sink(<div onBeforeInput={(e) => e.inputType} />);
sink(<div onAnimationEnd={(e) => e.animationName} onAnimationStart={(e) => e.elapsedTime} />);
sink(<div onWebkitAnimationEnd={(e) => e.type} />);
sink(<div onTransitionEnd={(e) => e.propertyName} />);
sink(<div onFullscreenChange={(e) => e.type} />);
sink(<div onGotPointerCapture={(e) => e.pointerType} />);
sink(<details onToggle={(e) => e.newState} />);
sink(<dialog onClose={(e) => e.currentTarget.returnValue} onCancel={(e) => e.type} />);
sink(<img src="/a.png" onLoad={(e) => e.type} onError={(e) => e.message} />);
sink(<input onInvalid={(e) => e.currentTarget.validationMessage} onSelect={(e) => e.type} />);
sink(<input onChange={(e) => e.currentTarget.value} />);
sink(<textarea onInput={(e) => e.currentTarget.value.length} />);
sink(<div onSlotChange={(e) => e.type} onSecurityPolicyViolation={(e) => e.blockedURI} />);
sink(<div onPointerRawUpdate={(e) => e.type} />);
sink(<div onBeforeToggle={(e) => e.newState} onBeforeMatch={(e) => e.type} />);
sink(<div onCommand={(e) => e.type} />);

// ---- Window events, body and frameset only --------------------------------------------------------
sink(<body onPopState={(e) => e.state} onHashChange={(e) => e.newURL} />);
sink(<body onMessage={(e) => e.data} onStorage={(e) => e.key} onBeforeUnload={(e) => e.type} />);
sink(
  <body
    onOnline={(e) => e.type}
    onOffline={(e) => e.type}
    onUnhandledRejection={(e) => e.reason}
  />,
);
sink(<frameset onPageShow={(e) => e.persisted} />);
// @ts-expect-error window events are not attached to a div
sink(<div onPopState={(e) => e.state} />);

// ---- Media and picture-in-picture -----------------------------------------------------------------
sink(<video onPlay={(e) => e.type} onTimeUpdate={(e) => e.currentTarget.currentTime} />);
sink(<video onEnterPictureInPicture={(e) => e.pictureInPictureWindow.width} />);
sink(<video onLeavePictureInPicture={(e) => e.type} onWaitingForKey={(e) => e.type} />);
sink(<audio onEncrypted={(e) => e.initDataType} onEnded={(e) => e.currentTarget.paused} />);

// ---- event.target is an Element; custom elements take handlers too -----------------------------
sink(<div onClick={(e) => e.target.tagName} />);
sink(<ul onClick={(e) => (e.target instanceof HTMLElement ? e.target.dataset : undefined)} />);
sink(<my-widget onChange={(e) => e.currentTarget.tagName} style={{ "--tone": "dark" }} />);

// ---- Function handlers and the [handler, data] tuple --------------------------------------------
sink(<button onClick={[(item: Row, e) => select(item.id, e.shiftKey), row]} />);
sink(<li onKeyDown={[(item: Row, e) => e.key + item.label, row]} />);
sink(<button onClick={[(id: number) => id, 7]} />);
sink(<button onClick={[(label: string) => label, "text"]} />);
const tupled: BoundEventHandler<HTMLButtonElement, MouseEvent, Row> = [
  (item, e) => item.id + e.button,
  row,
];
sink(<button onClick={tupled} />);
const plain: EventHandler<HTMLInputElement, InputEvent> = (e) => e.currentTarget.value;
sink(<input onInput={plain} />);

// ---- on: and oncapture: namespaces ------------------------------------------------------------
sink(<div on:click={(e) => e.button} on:keydown={(e) => e.key} />);
sink(<div oncapture:click={(e) => e.clientX} oncapture:focusin={(e) => e.type} />);
sink(<div on:animationend={(e) => e.animationName} on:dblclick={(e) => e.detail} />);
sink(<video on:play={(e) => e.type} on:encrypted={(e) => e.initDataType} />);
sink(<body on:popstate={(e) => e.state} />);
sink(<input on:input={(e) => e.currentTarget.value} />);
sink(<div on:click={[(id: number, e) => id + e.button, 1]} />);
sink(<div on:toast={(e) => e.detail.message} />);
sink(<div oncapture:toast={(e) => e.detail.message} />);
sink(<div on:toast={[(id: number, e) => id + e.detail.message.length, 1]} />);

// ---- Negatives ------------------------------------------------------------------------------------
// @ts-expect-error a click on a button is a PointerEvent, not a KeyboardEvent
sink(<button onClick={(e: KeyboardEvent) => e.key} />);
// @ts-expect-error a div has no value to read from currentTarget
sink(<div onInput={(e) => e.currentTarget.value} />);
// @ts-expect-error currentTarget on a button is HTMLButtonElement, not an input
sink(<button onClick={(e) => takeInput(e.currentTarget)} />);
// @ts-expect-error a submit event is a SubmitEvent, not a MouseEvent
sink(<form onSubmit={(e: MouseEvent) => e.button} />);
// @ts-expect-error event handlers must be functions, not strings
sink(<button onKeyDown="alert(1)" />);
// @ts-expect-error event handlers must be functions
sink(<button onClick={5} />);
// NOTE: the lowercase spelling is accepted too (forgiving, for HTML and Solid code); camelCase is the documented form.
sink(<button onclick={() => undefined} />);
// @ts-expect-error unknown event name
sink(<div onFooBar={() => undefined} />);
// @ts-expect-error unknown on: name: declare it in CustomEvents first
sink(<div on:whatever={(e) => e} />);
// @ts-expect-error the custom event payload has no field named nope
sink(<div on:toast={(e) => e.detail.nope} />);
// @ts-expect-error a bound handler's event parameter must match the event
sink(<button onClick={[(item: number, e: KeyboardEvent) => e.key + item, 1]} />);
// @ts-expect-error a plain handler's event parameter must match the event
sink(<input onInput={(e: MouseEvent) => e.button} />);

// An optional handler can be forwarded as is: `undefined` binds nothing.
declare const optionalHandler: ((event: MouseEvent) => void) | undefined;
sink(<button onClick={optionalHandler} on:click={optionalHandler} />);
