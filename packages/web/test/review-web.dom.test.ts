import { createRoot, flushSync, useRenderEffect, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addEventListener,
  classList,
  createComponent,
  element,
  hydrate,
  setAttribute,
  setAttributeNS,
  spread,
} from "../src/index";
import { MAX_EARLY_EVENTS } from "../src/internal/early-events";
import {
  createServerPortals,
  generateHydrationScript,
  renderToString,
  ssrElement,
} from "../src/server/index";
import { load } from "./support/compile";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("review round: web DOM runtime", () => {
  it("[WEB-REV-1] classList treats names that Object.prototype also has as ordinary class names", () => {
    const el = document.createElement("div");
    const first = classList(el, { constructor: true, toString: true, plain: true });
    expect(Array.from(el.classList).sort()).toEqual(["constructor", "plain", "toString"]);
    // Switching them off must work too: the previous map is the only record of what was on.
    const second = classList(el, { plain: true }, first);
    expect(Array.from(el.classList)).toEqual(["plain"]);
    classList(el, undefined, second);
    expect(el.className).toBe("");
  });

  it("[WEB-REV-2] element() calls the ref untracked, so a signal read in it does not re-run the caller", () => {
    const [count, setCount] = useSignal(0);
    let builds = 0;
    createRoot(() => {
      useRenderEffect(
        () => {
          builds += 1;
          return element("div", {
            ref: () => {
              count();
            },
          });
        },
        () => undefined,
      );
    });
    setCount(1);
    flushSync();
    expect(builds).toBe(1);
  });

  it("[WEB-REV-3] a [handler, undefined] tuple gets (undefined, event) whether the event is delegated or native", () => {
    const calls: number[] = [];
    const record = (...args: unknown[]): void => {
      calls.push(args.length);
    };
    const button = document.createElement("button");
    document.body.append(button);
    createRoot(() => {
      addEventListener(button, "click", [record, undefined], true);
    });
    button.click();
    const field = document.createElement("input");
    document.body.append(field);
    createRoot(() => {
      addEventListener(field, "focus", [record, undefined], true);
    });
    field.dispatchEvent(new Event("focus"));
    expect(calls).toEqual([2, 2]);
  });
});

const TARGETED = `
import { Portal } from "@shadow-js/web";
export const Targeted = () => (
  <main>
    <Portal mount={() => document.getElementById("modal-root")}>
      <div role="dialog"><p>Saved</p></div>
    </Portal>
  </main>
);
`;

describe("review round: portal hydration", () => {
  it("[WEB-REV-4] a portal whose mount is missing while hydrating leaves no server block in the page", async () => {
    const ssr = await load<{ Targeted: () => unknown }>(TARGETED, "ssr");
    const dom = await load<{ Targeted: () => unknown }>(TARGETED, "dom");
    const portals = createServerPortals();
    const appHtml = renderToString(() => createComponent(ssr.Targeted, {}), { portals });
    const root = document.createElement("div");
    root.innerHTML = appHtml;
    document.body.append(root);
    document.body.insertAdjacentHTML("beforeend", portals.html());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    // No #modal-root exists on the client: the client renders nothing for this portal.
    hydrate(() => createComponent(dom.Targeted, {}), root, {});
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const warn = vi.mocked(console.warn);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[shadow PORTAL_TARGET_MISSING] Portal has no mount element; nothing is rendered.",
    ]);
    warn.mockClear();
  });
});

describe("review round: early event capture", () => {
  it("[WEB-REV-8] the capture queue is bounded: a page that never hydrates does not keep every event", () => {
    const early = generateHydrationScript({});
    const body = /<script[^>]*>([\s\S]*?)<\/script>/.exec(early)?.[1] ?? "";
    new Function(body)();
    const capture = Reflect.get(globalThis, "__SHADOWJS_EARLY__") as {
      queue: Event[];
      names: string[];
      listener: (event: Event) => void;
    };
    const button = document.createElement("button");
    document.body.append(button);
    for (let click = 0; click < 1000; click += 1) button.click();
    expect(capture.queue).toHaveLength(MAX_EARLY_EVENTS);
    // Drop the listener and the capture again, as hydrate() would.
    for (const name of capture.names) document.removeEventListener(name, capture.listener, true);
    Reflect.deleteProperty(globalThis, "__SHADOWJS_EARLY__");
  });
});

describe("review round: inline event attributes", () => {
  it("[WEB-REV-9] no on* attribute is written from a string, as on the server: a spread of untrusted keys cannot run script", () => {
    const el = document.createElement("div");
    const props = { ONCLICK: "alert(1)", "attr:onmouseover": "alert(2)", title: "kept" };
    createRoot(() => {
      spread(el, props);
    });
    setAttribute(el, "onerror", "alert(3)");
    setAttributeNS(el, "http://www.w3.org/2000/svg", "onload", "alert(4)");
    expect(el.outerHTML).toBe('<div title="kept"></div>');
    expect(ssrElement("div", props).t).toBe('<div title="kept"></div>');
    // Removing such an attribute stays possible.
    el.setAttribute("onclick", "x");
    setAttribute(el, "onclick", null);
    expect(el.hasAttribute("onclick")).toBe(false);
  });
});
