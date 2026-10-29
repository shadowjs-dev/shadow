// biome-ignore-all lint/a11y: fixtures check typing of ARIA and attribute values; accessibility rules do not apply
/**
 * Type tests: attributes every element shares (class, style, ref, ARIA, data-*, namespaces) and the
 * React-style aliases.
 *
 * @since 1.0.0
 */
import type { CSSProperties, Maybe, Ref } from "@shadow-js/web/jsx-runtime";
import { sink } from "./support";

// ---- class and className -------------------------------------------------------------------------
sink(<div class="card" />);
sink(<div className="card card--wide" />);
sink(<div class={["card", { "card--active": true }, undefined, null, false, 0, ["nested"]]} />);
sink(<div class={{ on: true, off: false, "two words": true }} />);
sink(<div class={count() > 0 ? "some" : undefined} />);
sink(<div class={[]} />);
sink(<div class={1} />);
sink(<div className={null} />);
// @ts-expect-error class is a clsx value, not a function
sink(<div class={() => "x"} />);
// @ts-expect-error a Date is not a class map
sink(<div class={new Date()} />);

// ---- classList and class: ------------------------------------------------------------------------
sink(<div classList={{ active: true, "is-open": false, missing: undefined }} />);
sink(<div classList={undefined} />);
sink(<div class:active={true} class:hidden={false} class:selected />);
// @ts-expect-error classList values are booleans
sink(<div classList={{ active: "yes" }} />);

// ---- style and style: ----------------------------------------------------------------------------
sink(<div style="color: red; margin: 0" />);
sink(<div style={{ color: "red", backgroundColor: "blue", marginTop: 4, zIndex: 1 }} />);
sink(<div style={{ "--accent": "#f00", "--gap": 8 }} />);
sink(<div style={{ fontSize: null, lineHeight: undefined }} />);
sink(<div style={undefined} />);
sink(<div style:color="red" style:font-size="12px" />);
// @ts-expect-error css property names are camelCase; this one is misspelled
sink(<div style={{ backgroundcolor: "red" }} />);
// @ts-expect-error a boolean is not a css value
sink(<div style={{ color: true }} />);
// @ts-expect-error style is a string or an object, not a number
sink(<div style={42} />);
sink(<div style={["color: red", { marginTop: 4 }, null, false]} />);
// @ts-expect-error style arrays are not nested
sink(<div style={[["color: red"]]} />);

// ---- ref -----------------------------------------------------------------------------------------
let div: HTMLDivElement | undefined;
let input: HTMLInputElement | undefined;
sink(<div ref={div} />);
sink(<input ref={input} />);
sink(<div ref={(el) => el.scrollTop} />);
sink(<input ref={(el) => el.select()} />);
sink(<span ref={(el) => el.textContent} />);
const reference: Ref<HTMLFormElement> = (el) => el.reset();
sink(<form ref={reference} />);
// @ts-expect-error a ref callback receives the element type of this tag
sink(<input ref={(el: HTMLSelectElement) => el.options} />);
// @ts-expect-error a ref must be an element or a callback
sink(<div ref="main" />);

// ---- ARIA ----------------------------------------------------------------------------------------
sink(<div role="button" aria-label="Close" aria-pressed="true" aria-expanded={false} />);
sink(<div aria-hidden />);
sink(<div aria-hidden={true} />);
sink(<div aria-checked="mixed" aria-current="page" aria-haspopup="menu" />);
sink(<div aria-valuenow={40} aria-valuemin="0" aria-valuemax={100} aria-valuetext="40%" />);
sink(<div aria-live="polite" aria-atomic aria-busy={false} aria-relevant="additions text" />);
sink(<div aria-controls="panel" aria-describedby="help" aria-labelledby="title" aria-owns="x" />);
sink(<div aria-activedescendant={undefined} aria-sort="descending" aria-orientation="vertical" />);
sink(
  <div aria-level={2} aria-posinset={1} aria-setsize={3} aria-rowcount={10} aria-colindex={2} />,
);
sink(<div role="tablist" aria-multiselectable aria-selected={true} />);
sink(<div role="none" aria-description="decorative" aria-keyshortcuts="Control+S" />);
// @ts-expect-error aria-hidden takes a boolean or true/false strings
sink(<div aria-hidden="maybe" />);
// @ts-expect-error aria-live is off, assertive or polite
sink(<div aria-live="loud" />);
// @ts-expect-error role is a closed set of ARIA roles
sink(<div role="nope" />);
// @ts-expect-error aria-sort has a closed set of values
sink(<th aria-sort="up" />);
// NOTE: TypeScript does not excess-check hyphenated JSX names (aria-*, data-*) against their pattern
// types, so an unknown aria-* name or a non-scalar data-* value is not a compile error. Named aria-*
// values below are checked.
// @ts-expect-error aria-valuenow is a number or a string
sink(<div aria-valuenow={{}} />);

// ---- data-* and namespaces ----------------------------------------------------------------------
sink(
  <div data-id="7" data-count={3} data-enabled={true} data-empty={null} data-gone={undefined} />,
);
sink(<div data-test-id="x" data-long-attribute-name="y" />);
sink(<div attr:title="hello" attr:count={2} attr:flag={false} />);
sink(<div bool:hidden={true} bool:disabled={false} />);
sink(<div prop:innerHTML="x" prop:anything={{ any: "value" }} />);
// @ts-expect-error attr values are scalars, not objects
sink(<div attr:config={{ a: 1 }} />);
// @ts-expect-error bool: values are booleans
sink(<div bool:checked="yes" />);

// ---- use: directives -----------------------------------------------------------------------------
sink(<button use:tooltip="Save" />);
sink(<button use:untyped={{ anything: true }} />);
// @ts-expect-error the tooltip directive takes a string
sink(<button use:tooltip={5} />);

// ---- Core and React-style aliases ----------------------------------------------------------------
sink(<div id="root" lang="en" dir="auto" title="Root" hidden />);
sink(<div hidden="until-found" translate="no" inert />);
sink(<div tabIndex={-1} tabindex="0" accessKey="s" autoFocus />);
sink(<div contentEditable="plaintext-only" spellCheck={false} draggable="true" />);
sink(<div autoCapitalize="words" enterKeyHint="send" inputMode="numeric" />);
sink(<div slot="content" part="label" exportparts="icon" nonce="abc" is="x-button" />);
sink(<div itemscope itemtype="https://schema.org/Thing" itemprop="name" itemid="a" itemref="b" />);
sink(<div popover="auto" />);
sink(<div innerHTML="<b>x</b>" textContent="x" />);
sink(<div innerText={1} />);
// @ts-expect-error a non-boolean popover value outside the closed set
sink(<div popover="always" />);
// @ts-expect-error tabindex is a number or string
sink(<div tabIndex={{}} />);
// @ts-expect-error inputMode is a closed set
sink(<div inputMode="fax" />);
// @ts-expect-error translate is yes, no or a boolean
sink(<div translate="maybe" />);

// ---- Typed helper values -------------------------------------------------------------------------
const styles: CSSProperties = { color: "red", "--token": 1 };
sink(<div style={styles} />);
const maybeTitle: Maybe<string> = undefined;
sink(<div title={maybeTitle} />);
declare function count(): number;
