import { DEVTOOLS_EVENT } from "@shadow-js/core/extend";
import { createComponent, hydrate } from "@shadow-js/web";
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

describe("hydration tag check", () => {
  it("[HYD-TAG-1] a matching tag produces no console.warn and no devtools report", async () => {
    const mod = await load<{ App: () => unknown }>('export const App = () => <p class="c">hi</p>;');
    const el = host('<p class="c" data-hk="0-0-0">hi</p>');
    const server = el.firstElementChild;
    const reports = recordDevtools();
    hydrate(() => createComponent(mod.App, {}), el);
    expect(takeWarnings()).toEqual([]);
    expect(mismatchReports(reports)).toEqual([]);
    expect(el.firstElementChild).toBe(server);
  });

  it("[HYD-TAG-2] a different server tag warns once with both tags, and the server element is still adopted", async () => {
    const mod = await load<{ App: () => unknown }>('export const App = () => <p class="c">hi</p>;');
    const el = host('<span class="c" data-hk="0-0-0">hi</span>');
    const server = el.firstElementChild;
    const reports = recordDevtools();
    hydrate(() => createComponent(mod.App, {}), el);
    expect(takeWarnings()).toEqual([
      '[shadow HYDRATION_MISMATCH] expected <p> but the server sent <span>; server markup: "\\u003cspan class=\\u0022c\\u0022\\u003e"; text: "hi"',
    ]);
    const mismatches = mismatchReports(reports);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.a).toBe(
      'expected <p> but the server sent <span>; server markup: "\\u003cspan class=\\u0022c\\u0022\\u003e"; text: "hi"',
    );
    expect(el.firstElementChild).toBe(server);
    expect(el.firstElementChild?.localName).toBe("span");
    expect(server?.textContent).toBe("hi");
    expect(server?.hasAttribute("data-hk")).toBe(false);
  });

  it("[HYD-TAG-3] the server markup snippet is bounded to about 80 characters with an ellipsis", async () => {
    const mod = await load<{ App: () => unknown }>('export const App = () => <p class="c">hi</p>;');
    const long = "a".repeat(300);
    const el = host(`<span class="c" data-hk="0-0-0" data-long="${long}">hi</span>`);
    hydrate(() => createComponent(mod.App, {}), el);
    const [warning] = takeWarnings();
    const markup = /server markup: "([^"]*)"/.exec(warning ?? "")?.[1];
    expect(markup).toBeDefined();
    expect(markup).toMatch(/\.\.\.$/);
    expect((markup ?? "").length).toBeLessThanOrEqual(120);
    expect(warning).not.toContain(long);
  });

  it("[HYD-TAG-4] the snippet escapes markup and control characters, so raw script text is never printed", async () => {
    const mod = await load<{ App: () => unknown }>('export const App = () => <p class="c">hi</p>;');
    const el = host('<span data-hk="0-0-0">&lt;script&gt;\nx</span>');
    hydrate(() => createComponent(mod.App, {}), el);
    const [warning] = takeWarnings();
    expect(warning).toContain('text: "\\u003cscript\\u003e\\u000ax"');
    expect(warning).not.toContain("<script>");
    expect(warning).not.toContain("\n");
  });

  it("[HYD-TAG-5] a mismatch on the element() path warns with the same snippet and keeps the server element", async () => {
    const mod = await load<{ App: () => unknown }>(
      `import { element } from "@shadow-js/web";
       export const App = () => element("p", { id: "c" });`,
    );
    const el = host('<span id="c" data-hk="0-0-0"></span>');
    const server = el.firstElementChild;
    hydrate(() => createComponent(mod.App, {}), el);
    expect(takeWarnings()).toEqual([
      '[shadow HYDRATION_MISMATCH] expected <p> but the server sent <span>; server markup: "\\u003cspan id=\\u0022c\\u0022\\u003e"',
    ]);
    expect(el.firstElementChild).toBe(server);
  });
});
