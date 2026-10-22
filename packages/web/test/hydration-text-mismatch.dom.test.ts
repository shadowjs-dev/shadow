import { flushSync, useSignal } from "@shadow-js/core";
import { DEVTOOLS_EVENT } from "@shadow-js/core/extend";
import { createComponent, hydrate } from "@shadow-js/web";
import { bindRegion, createRegion } from "@shadow-js/web/extend";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "./support/compile";

const HOOK_KEY = "__SHADOWJS_DEVTOOLS_HOOK__";
const holder = globalThis as unknown as Record<string, unknown>;
const hosts: HTMLElement[] = [];
let restoreHook: (() => void) | undefined;

interface Report {
  readonly kind: number;
  readonly a: unknown;
}

/** Installs a devtools hook that records every report, and returns the list. Restored after the test. */
function recordDevtools(): Report[] {
  const reports: Report[] = [];
  const previous = holder[HOOK_KEY];
  holder[HOOK_KEY] = {
    version: 1,
    report(kind: number, a?: unknown) {
      reports.push({ kind, a });
    },
  };
  restoreHook = () => {
    if (previous === undefined) delete holder[HOOK_KEY];
    else holder[HOOK_KEY] = previous;
  };
  return reports;
}

function mismatchReports(reports: Report[]): Report[] {
  return reports.filter((report) => report.kind === DEVTOOLS_EVENT.HYDRATION_MISMATCH);
}

/** The text of every console.warn raised since the last call, and clears the spy. */
function takeWarnings(): string[] {
  const spy = vi.mocked(console.warn);
  const texts = spy.mock.calls.map((args) => args.map((arg) => String(arg)).join(" "));
  spy.mockClear();
  return texts;
}

function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  hosts.push(el);
  return el;
}

afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
  restoreHook?.();
  restoreHook = undefined;
});

type Value = () => unknown;

describe("hydration text check", () => {
  it("[HYD-TXT-1] a region that claims text and then gets the same text is silent and keeps its node", async () => {
    const [name] = useSignal("Ann");
    const mod = await load<{ App: (props: { name: () => string }) => unknown }>(
      'export const App = (props) => <p class="c">hello {props.name()} world</p>;',
    );
    const el = host('<p class="c" data-hk="0-0-0">hello <!--[-->Ann<!--]--> world</p>');
    const server = el.firstElementChild;
    const text = server?.childNodes[2];
    const reports = recordDevtools();
    hydrate(() => createComponent(mod.App, { name }), el);
    expect(takeWarnings()).toEqual([]);
    expect(mismatchReports(reports)).toEqual([]);
    expect(el.textContent).toBe("hello Ann world");
    expect(server?.childNodes[1]).toBe(text);
  });

  it("[HYD-TXT-2] a different text warns with the expected and the server text, and shows the client text", async () => {
    const mod = await load<{ App: (props: { name: Value }) => unknown }>(
      'export const App = (props) => <p class="c">hello {props.name()} world</p>;',
    );
    const el = host('<p class="c" data-hk="0-0-0">hello <!--[-->Ann<!--]--> world</p>');
    const server = el.firstElementChild;
    const reports = recordDevtools();
    hydrate(() => createComponent(mod.App, { name: () => "Bob" }), el);
    const expected = 'expected text "Bob" but the server sent text "Ann"';
    expect(takeWarnings()).toEqual([`[shadow HYDRATION_TEXT_MISMATCH] ${expected}`]);
    const mismatches = mismatchReports(reports);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.a).toBe(expected);
    expect(el.firstElementChild).toBe(server);
    expect(el.textContent).toBe("hello Bob world");
  });

  it("[HYD-TXT-3] escaped entities compare as their decoded DOM text, so equal text is silent", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[-->&lt;b&gt;<!--]--></p>');
    const reports = recordDevtools();
    hydrate(() => createComponent(mod.App, { v: () => "<b>" }), el);
    expect(takeWarnings()).toEqual([]);
    expect(mismatchReports(reports)).toEqual([]);
    expect(el.textContent).toBe("<b>");
  });

  it("[HYD-TXT-4] a number and the string it prints as are the same text", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[-->5<!--]--></p>');
    hydrate(() => createComponent(mod.App, { v: () => 5 }), el);
    expect(takeWarnings()).toEqual([]);
    expect(el.textContent).toBe("5");
  });

  it("[HYD-TXT-5] a region that claims text and then renders null warns with an empty expected text", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[-->x<!--]--></p>');
    const reports = recordDevtools();
    hydrate(() => createComponent(mod.App, { v: () => null }), el);
    const expected = 'expected text "" but the server sent text "x"';
    expect(takeWarnings()).toEqual([`[shadow HYDRATION_TEXT_MISMATCH] ${expected}`]);
    expect(mismatchReports(reports)[0]?.a).toBe(expected);
    expect(el.textContent).toBe("");
  });

  it("[HYD-TXT-6] an empty server region and a boolean render nothing: silent", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[--><!--]--></p>');
    hydrate(() => createComponent(mod.App, { v: () => false }), el);
    expect(takeWarnings()).toEqual([]);
    expect(el.textContent).toBe("");
  });

  it("[HYD-TXT-7] an empty server region claims no text, so client text is not compared: silent", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[--><!--]--></p>');
    hydrate(() => createComponent(mod.App, { v: () => "abc" }), el);
    expect(takeWarnings()).toEqual([]);
    expect(el.textContent).toBe("abc");
  });

  it("[HYD-TXT-8] several strings in one region compare as their joined text", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[-->ab<!--]--></p>');
    hydrate(() => createComponent(mod.App, { v: () => ["a", "b"] }), el);
    expect(takeWarnings()).toEqual([]);
    expect(el.textContent).toBe("ab");
  });

  it("[HYD-TXT-9] several strings that differ from the server text warn with their joined text", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[-->ax<!--]--></p>');
    hydrate(() => createComponent(mod.App, { v: () => ["a", "b"] }), el);
    expect(takeWarnings()).toEqual([
      '[shadow HYDRATION_TEXT_MISMATCH] expected text "ab" but the server sent text "ax"',
    ]);
    expect(el.textContent).toBe("ab");
  });

  it("[HYD-TXT-10] a region that claims an element and then gets text is silent, and the element is replaced as before", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[--><b>x</b><!--]--></p>');
    hydrate(() => createComponent(mod.App, { v: () => "y" }), el);
    expect(takeWarnings()).toEqual([]);
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toBe("y");
  });

  it("[HYD-TXT-11] a region that claims text and then gets an element is silent, and the element is shown", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host('<p data-hk="0-0-0"><!--[-->x<!--]--></p>');
    hydrate(
      () =>
        createComponent(mod.App, {
          v: () => {
            const b = document.createElement("b");
            b.textContent = "y";
            return b;
          },
        }),
      el,
    );
    expect(takeWarnings()).toEqual([]);
    expect(el.querySelector("b")?.textContent).toBe("y");
  });

  it("[HYD-TXT-12] only the first commit of a claimed region is compared: a later change is a normal update", async () => {
    const [name, setName] = useSignal("Ann");
    const mod = await load<{ App: (props: { name: () => string }) => unknown }>(
      'export const App = (props) => <p class="c">hello {props.name()} world</p>;',
    );
    const el = host('<p class="c" data-hk="0-0-0">hello <!--[-->Ann<!--]--> world</p>');
    hydrate(() => createComponent(mod.App, { name }), el);
    flushSync(() => setName("Bob"));
    expect(takeWarnings()).toEqual([]);
    expect(el.textContent).toBe("hello Bob world");
  });

  it("[HYD-TXT-13] a first commit that differs warns once, and later changes do not warn again", async () => {
    const [name, setName] = useSignal("Bob");
    const mod = await load<{ App: (props: { name: () => string }) => unknown }>(
      'export const App = (props) => <p class="c">hello {props.name()} world</p>;',
    );
    const el = host('<p class="c" data-hk="0-0-0">hello <!--[-->Ann<!--]--> world</p>');
    hydrate(() => createComponent(mod.App, { name }), el);
    expect(takeWarnings()).toEqual([
      '[shadow HYDRATION_TEXT_MISMATCH] expected text "Bob" but the server sent text "Ann"',
    ]);
    flushSync(() => setName("Cy"));
    expect(takeWarnings()).toEqual([]);
    expect(el.textContent).toBe("hello Cy world");
  });

  it("[HYD-TXT-14] both snippets are escaped and bounded to 40 characters with an ellipsis", async () => {
    const mod = await load<{ App: (props: { v: Value }) => unknown }>(
      "export const App = (props) => <p>{props.v()}</p>;",
    );
    const el = host(`<p data-hk="0-0-0"><!--[-->&lt;i&gt;\n${"z".repeat(300)}<!--]--></p>`);
    hydrate(() => createComponent(mod.App, { v: () => "<b>" }), el);
    const [warning] = takeWarnings();
    expect(warning).toBe(
      `[shadow HYDRATION_TEXT_MISMATCH] expected text "\\u003cb\\u003e" but the server sent text "\\u003ci\\u003e\\u000a${"z".repeat(21)}..."`,
    );
    expect(warning).not.toContain("<i>");
    expect(warning).not.toContain("\n");
  });

  it("[HYD-TXT-15] a region built outside a hydration pass is never compared: silent", () => {
    const parent = document.createElement("p");
    const text = document.createTextNode("Ann");
    parent.append(text);
    const region = createRegion(parent, null, [text]);
    bindRegion(region, "Bob");
    expect(takeWarnings()).toEqual([]);
    expect(parent.textContent).toBe("Bob");
  });
});
