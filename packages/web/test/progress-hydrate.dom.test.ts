import { flushSync, useSignal } from "@shadow-js/core";
import { createComponent, hydrate, render } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";
import { load } from "./support/compile";

/**
 * `<progress value={undefined}>` is indeterminate: no `value` attribute. The client used to assign the
 * property (`progress.value = ""`), which writes `value="0"` and makes the bar determinate, so a server
 * page and its hydrated client disagreed. `meter` takes the same path.
 */

const SOURCE = `
export function Direct(props) {
  return <section><progress max="100" value={props.v()} /><meter max="10" value={props.v()} /></section>;
}
export function Spread(props) {
  return <section><progress max="100" {...{ value: props.v() }} /><meter max="10" {...{ value: props.v() }} /></section>;
}
export function Plain(props) {
  return <section><progress max="100" value="40" /><meter max="10" value="4" /></section>;
}
`;
type Mod = Record<"Direct" | "Spread" | "Plain", (props: { v: () => unknown }) => unknown>;
const server = await load<Mod>(SOURCE, "ssr");
const client = await load<Mod>(SOURCE, "dom");

const VALUES: unknown[] = [undefined, null, 0, 0.5, "40", false];

/** The `value` attribute of the progress bar and of the meter, `null` when absent. */
function attributes(root: Element): [string | null, string | null] {
  return [
    root.querySelector("progress")?.getAttribute("value") ?? null,
    root.querySelector("meter")?.getAttribute("value") ?? null,
  ];
}

describe("[WEB-PRG] a progress bar or meter without a value has no value attribute", () => {
  for (const name of ["Direct", "Spread"] as const) {
    it(`[WEB-PRG-1] ${name}: the client writes the attribute the server wrote, for every value`, () => {
      for (const value of VALUES) {
        const [get] = useSignal(value);
        const served = document.createElement("div");
        served.innerHTML = renderToString(() => createComponent(server[name], { v: get }));
        const drawn = document.createElement("div");
        const stop = render(() => createComponent(client[name], { v: get }), drawn);
        try {
          expect(attributes(drawn), `${name} ${String(value)}`).toEqual(attributes(served));
        } finally {
          stop();
        }
      }
    });

    it(`[WEB-PRG-2] ${name}: hydrating server markup of an indeterminate bar keeps it indeterminate`, () => {
      const [value, setValue] = useSignal<unknown>(undefined);
      const host = document.createElement("div");
      host.innerHTML = renderToString(() => createComponent(server[name], { v: value }));
      expect(attributes(host)).toEqual([null, null]);
      const bar = host.querySelector("progress");
      const stop = hydrate(() => createComponent(client[name], { v: value }), host);
      try {
        expect(host.querySelector("progress")).toBe(bar);
        expect(attributes(host)).toEqual([null, null]);
        setValue(0.5);
        flushSync();
        expect(attributes(host)).toEqual(["0.5", "0.5"]);
        setValue(undefined);
        flushSync();
        expect(attributes(host)).toEqual([null, null]);
        setValue(null);
        flushSync();
        expect(attributes(host)).toEqual([null, null]);
      } finally {
        stop();
      }
    });
  }

  it("[WEB-PRG-3] a literal value stays in the template and hydrates unchanged", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(() => createComponent(server.Plain, { v: () => undefined }));
    expect(attributes(host)).toEqual(["40", "4"]);
    const stop = hydrate(() => createComponent(client.Plain, { v: () => undefined }), host);
    try {
      expect(attributes(host)).toEqual(["40", "4"]);
    } finally {
      stop();
    }
  });
});

describe("[WEB-PRG-4] the progress and meter check reads the tag, not a global class", () => {
  it("[WEB-PRG-4] spread works where HTMLMeterElement is not defined (an iframe realm, a minimal DOM), and still writes a bar's value as an attribute", async () => {
    const { spread } = await import("../src/spread");
    const { createRoot } = await import("@shadow-js/core");
    const saved = Object.getOwnPropertyDescriptor(globalThis, "HTMLMeterElement");
    Reflect.deleteProperty(globalThis, "HTMLMeterElement");
    try {
      const input = document.createElement("input");
      expect(() =>
        createRoot((dispose) => {
          spread(input, { value: "x" });
          dispose();
        }),
      ).not.toThrow();
      expect(input.value).toBe("x");
    } finally {
      if (saved !== undefined) Object.defineProperty(globalThis, "HTMLMeterElement", saved);
    }
    const bar = document.createElement("progress");
    createRoot((dispose) => {
      spread(bar, { value: 0.5 });
      expect(bar.getAttribute("value")).toBe("0.5");
      spread(bar, { value: undefined });
      expect(bar.hasAttribute("value")).toBe(false);
      dispose();
    });
  });
});

describe("[WEB-PRG-5] a list item's value through spread", () => {
  it("[WEB-PRG-5] spread leaves no value attribute on an li for undefined, as the compiled path and the server do", async () => {
    const { spread } = await import("../src/spread");
    const { createRoot } = await import("@shadow-js/core");
    const item = document.createElement("li");
    createRoot((dispose) => {
      spread(item, { value: 3 });
      expect(item.getAttribute("value")).toBe("3");
      spread(item, { value: undefined });
      expect(item.hasAttribute("value")).toBe(false);
      dispose();
    });
  });
});
