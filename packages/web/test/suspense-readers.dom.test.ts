import { flushSync } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/compile";

const SOURCE = `
import { useResource, useSignal } from "@shadow-js/core";
import { Show, Suspense } from "@shadow-js/web";

export const control = { setTab: (tab) => {} };
export function App() {
  const [tab, setTab] = useSignal("a");
  control.setTab = setTab;
  // Created outside the boundary: it stays alive, and pending, when its reader goes.
  const never = useResource(() => new Promise(() => {}));
  return (
    <Suspense fallback={<i>loading</i>}>
      <div>
        <Show when={tab() === "a"} fallback={<b>tab b needs nothing</b>}>
          <p>a:{never()}</p>
        </Show>
      </div>
    </Suspense>
  );
}
`;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe("Suspense and the readers that hold it", () => {
  it("[SUS-G12] a boundary whose only pending reader was removed shows its content: it does not wait for a load nothing under it reads", async () => {
    const mod = await load<{ App: () => unknown; control: { setTab: (tab: string) => void } }>(
      SOURCE,
    );
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const dispose = render(() => mod.App(), host);
    flushSync();
    expect(host.textContent).toBe("loading");

    mod.control.setTab("b");
    flushSync();
    // The hold is given back one microtask after the reader went, when a reader that only ran again has read again.
    await Promise.resolve();
    flushSync();
    expect(host.textContent).toBe("tab b needs nothing");

    // Back to the tab that reads the pending resource: the boundary is held again.
    mod.control.setTab("a");
    flushSync();
    expect(host.textContent).toBe("loading");
    dispose();
  });
});
