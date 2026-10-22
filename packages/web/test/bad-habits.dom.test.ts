import { createRoot, useSignal } from "@shadow-js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../src/index";
import { resetWebWarningDedupe } from "../src/internal/diagnostics";
import { load } from "./support/compile";

/**
 * Bad habits in the DOM runtime: each test writes markup the way a React developer often does, then
 * asserts what the runtime actually does. A habit that silently produces the wrong DOM with no
 * diagnostic is asserted as it behaves and named as a bug. Dev warnings are `console.warn` lines
 * (`warnOnce`), so the global console spy from `vitest.setup.ts` is the assertion surface.
 */

const SOURCE = `
export const ClassNames = () => (
  <div class="a" className="b">x</div>
);
export const ReactClass = () => <div className="card">x</div>;
export const ChangeText = (props) => (
  <input type="text" value={props.value()} onChange={props.onChange} />
);
export const UnsafeLink = () => <a href="javascript:alert(1)">bad</a>;
export const DynamicLink = (props) => <a href={props.url}>bad</a>;
export const LowerTabIndex = () => <div tabindex="2">x</div>;
export const HtmlFor = () => <label htmlFor="name">Name</label>;
export const StringStyle = () => <div style="color: red">x</div>;
export const LowerOnClick = (props) => <button onclick={props.onClick}>go</button>;
export const CamelOnClick = (props) => <button onClick={props.onClick}>go</button>;
`;

interface Module {
  readonly ClassNames: () => HTMLElement;
  readonly ReactClass: () => HTMLElement;
  readonly ChangeText: (props: {
    value: () => string;
    onChange: (event: Event) => void;
  }) => HTMLElement;
  readonly UnsafeLink: () => HTMLElement;
  readonly DynamicLink: (props: { url: string }) => HTMLElement;
  readonly LowerTabIndex: () => HTMLElement;
  readonly HtmlFor: () => HTMLElement;
  readonly StringStyle: () => HTMLElement;
  readonly LowerOnClick: (props: { onClick: () => void }) => HTMLElement;
  readonly CamelOnClick: (props: { onClick: () => void }) => HTMLElement;
}

let mod: Module;
let container: HTMLElement;

beforeEach(async () => {
  resetWebWarningDedupe();
  mod = await load<Module>(SOURCE, "dom");
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  container.remove();
  resetWebWarningDedupe();
});

/** Mounts `view` into the test container and returns the dispose function. */
function mount(view: () => unknown): () => void {
  return render(view as () => unknown, container);
}

/** Returns the console.warn messages so far and clears the spy, as R-TEST-7 requires. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const messages = spy.mock.calls.map((args) => String(args[0]));
  spy.mockClear();
  return messages;
}

describe("bad habits: DOM markup", () => {
  it("[BAD-WEB-01] class and className on one element: the first attribute wins and a dev warning names the drop", () => {
    const dispose = mount(() => mod.ClassNames());
    const node = container.querySelector("div") as HTMLElement;
    expect(node.getAttribute("class")).toBe("a");
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[shadow DUPLICATE_CLASS_ATTRIBUTE]");
    expect(warnings[0]).toContain("class");
    dispose();
  });

  it("[BAD-WEB-02] React's className spelling is accepted and renders the class attribute", () => {
    const dispose = mount(() => mod.ReactClass());
    expect(container.querySelector("div")?.className).toBe("card");
    dispose();
  });

  it("[BAD-WEB-03] onChange on a text input fires on every input event, not on blur as in plain HTML", () => {
    const seen: string[] = [];
    let value: () => string = () => "";
    let dispose: (() => void) | undefined;
    createRoot((done) => {
      dispose = done;
      const [read] = useSignal("");
      value = read;
    });
    const unmount = mount(() =>
      mod.ChangeText({
        value,
        onChange: (event) => seen.push((event.target as HTMLInputElement).value),
      }),
    );
    const input = container.querySelector("input") as HTMLInputElement;
    input.value = "a";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "ab";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen).toEqual(["a", "ab"]);
    unmount();
    dispose?.();
    expect(takeWarnings()).toEqual([]);
  });

  it("[BAD-WEB-04] a static javascript: href is blocked like a dynamic one and the dev build prints UNSAFE_URL_BLOCKED", () => {
    const dispose = mount(() => mod.UnsafeLink());
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.hasAttribute("href")).toBe(false);
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[shadow UNSAFE_URL_BLOCKED]");
    dispose();
  });

  it("[BAD-WEB-05] a dynamic javascript: href is blocked and the dev build prints UNSAFE_URL_BLOCKED", () => {
    const dispose = mount(() => mod.DynamicLink({ url: "javascript:alert(1)" }));
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.hasAttribute("href")).toBe(false);
    const warnings = takeWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[shadow UNSAFE_URL_BLOCKED]");
    dispose();
  });

  it("[BAD-WEB-06] a dynamic href with leading space and mixed case is still blocked", () => {
    const dispose = mount(() => mod.DynamicLink({ url: " JaVaScRiPt:alert(1)" }));
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.hasAttribute("href")).toBe(false);
    expect(takeWarnings().some((message) => message.includes("UNSAFE_URL_BLOCKED"))).toBe(true);
    dispose();
  });

  it("[BAD-WEB-07] lowercase tabindex in JSX sets the attribute with its literal name", () => {
    const dispose = mount(() => mod.LowerTabIndex());
    const node = container.querySelector("div") as HTMLElement;
    expect(node.getAttribute("tabindex")).toBe("2");
    expect(takeWarnings()).toEqual([]);
    dispose();
  });

  it("[BAD-WEB-08] htmlFor on a label renders the for attribute, as React does", () => {
    const dispose = mount(() => mod.HtmlFor());
    expect(container.querySelector("label")?.getAttribute("for")).toBe("name");
    dispose();
  });

  it("[BAD-WEB-09] a string style prop is applied as CSS text (a habit React rejects)", () => {
    const dispose = mount(() => mod.StringStyle());
    const node = container.querySelector("div") as HTMLElement;
    expect(node.style.color).toBe("red");
    dispose();
  });

  it("[BAD-WEB-10] lowercase onclick in JSX binds the handler as a native listener, once per click", () => {
    let clicks = 0;
    const dispose = mount(() => mod.LowerOnClick({ onClick: () => clicks++ }));
    (container.querySelector("button") as HTMLButtonElement).click();
    expect(clicks).toBe(1);
    expect(container.querySelector("button")?.hasAttribute("onclick")).toBe(false);
    dispose();
  });

  it("[BAD-WEB-11] onClick in JSX binds the handler once per click", () => {
    let clicks = 0;
    const dispose = mount(() => mod.CamelOnClick({ onClick: () => clicks++ }));
    (container.querySelector("button") as HTMLButtonElement).click();
    expect(clicks).toBe(1);
    dispose();
  });
});
