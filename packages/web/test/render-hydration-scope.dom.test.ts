import { createComponent, hydrate } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";
import { load } from "./support/compile";

const SOURCE = `
import { onCleanup } from "@shadow-js/core";
import { render } from "@shadow-js/web";
function Fresh() { return <strong>Fresh root</strong>; }
function Later() { return <em>Later sibling</em>; }
function mount(element) {
  if (element === undefined) return;
  const stop = render(() => <Fresh />, element);
  onCleanup(stop);
}
export function App() {
  return <section><div class="fresh" ref={mount} /><Later /></section>;
}
`;
type Mod = { App: () => unknown };

describe("independent roots during hydration", () => {
  it("[RND-HYD-01] a fresh render from a ref does not consume a later sibling's hydration keys", async () => {
    const server = await load<Mod>(SOURCE, "ssr");
    const client = await load<Mod>(SOURCE, "dom");
    const host = document.createElement("div");
    host.innerHTML = renderToString(() => createComponent(server.App, {}));
    const sibling = host.querySelector("em");
    const stop = hydrate(() => createComponent(client.App, {}), host);
    try {
      expect(host.querySelector(".fresh")?.textContent).toBe("Fresh root");
      expect(host.querySelector("em")).toBe(sibling);
      expect(host.querySelector("em")?.textContent).toBe("Later sibling");
    } finally {
      stop();
    }
  });
});
