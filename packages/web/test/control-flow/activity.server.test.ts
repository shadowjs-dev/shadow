import { describe, expect, it } from "vitest";
import { renderToString } from "../../src/server";
import { load } from "../support/compile";

const SRC = `
import { onCleanup, useEffect, useSignal } from "@shadow-js/core";
import { Activity } from "@shadow-js/web";

export const log = { effects: [], cleanups: 0, renders: 0 };
export const api = {};

export function Panel() {
  const [count, setCount] = useSignal(0);
  api.inc = () => setCount(count() + 1);
  api.count = count;
  useEffect(() => {
    log.effects.push(count());
    return () => {
      log.cleanups += 1;
    };
  });
  return (
    <section class="panel">
      <p class="count">{count()}</p>
      <input class="name" />
      <div class="scroller" style="height: 20px; overflow: auto">
        <p>line</p>
      </div>
    </section>
  );
}

export function App(props) {
  const [mode, setMode] = useSignal(props.mode ?? "visible");
  api.setMode = setMode;
  return (
    <div class="app">
      <Activity mode={mode()}>
        <Panel />
      </Activity>
      <span class="after">after</span>
    </div>
  );
}
`;

/** The server markup of this app with mode="hidden": the hydration test starts from exactly this. */
const GOLDEN =
  '<div data-hk="0-0" class="app"><!--[--><section data-hk="0-2-0" class="panel"><p class="count"><!--[-->0<!--]--></p><input class="name"><div class="scroller" style="height: 20px; overflow: auto"><p>line</p></div></section><!--]--><span class="after">after</span></div>';

describe("Activity on the server", () => {
  it("[ACT-S1] a hidden Activity renders its children; the server does not hide them (hydration does)", async () => {
    const ssr = await load<{ App: (props: { mode?: string }) => unknown }>(SRC, "ssr");
    expect(renderToString(() => ssr.App({ mode: "hidden" }))).toBe(GOLDEN);
  });
});
