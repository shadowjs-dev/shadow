import { flushSync } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "../support/compile";

const SRC = `
import { useResource, useSignal } from "@shadow-js/core";
import { Activity, Suspense } from "@shadow-js/web";

export const api = {};
export function Slow() {
  const data = useResource(() => new Promise((resolve) => setTimeout(() => resolve("loaded"), 10)), { name: "slow" });
  return <p class="slow">{data()}</p>;
}
export function App(props) {
  const [mode, setMode] = useSignal(props.mode);
  api.setMode = setMode;
  return (
    <div class="app">
      <Activity mode={mode()}>
        <Suspense fallback={<p class="loading">loading</p>}>
          <Slow />
        </Suspense>
      </Activity>
    </div>
  );
}
`;

let cases = 0;
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe("Activity with Suspense", () => {
  it("[ACT-12] data that arrives while the Activity is hidden is shown when it becomes visible", async () => {
    cases += 1;
    const mod = await load<{
      App: (props: { mode: string }) => unknown;
      api: { setMode: (mode: string) => void };
    }>(`${SRC}\n// case ${cases}`);
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    render(() => mod.App({ mode: "hidden" }), host);
    flushSync();
    expect(host.querySelector<HTMLElement>(".app > *")?.style.display).toBe("none");
    expect(host.querySelector(".loading")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 40));
    flushSync();
    // The boundary settled while hidden: its DOM update waits for the Activity to be shown.
    expect(host.querySelector(".loading")).not.toBeNull();
    expect(host.querySelector(".slow")).toBeNull();
    mod.api.setMode("visible");
    flushSync();
    expect(host.querySelector(".slow")?.textContent).toBe("loaded");
    expect(host.querySelector<HTMLElement>(".app > *")?.style.display).toBe("");
  });
});
