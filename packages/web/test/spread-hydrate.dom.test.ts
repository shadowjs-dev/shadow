import { flushSync, useSignal } from "@shadow-js/core";
import { createComponent, hydrate } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";
import { load } from "./support/compile";

const SOURCE = `
export function App(props) {
  return <section><span class="content" {...props} /><p>Sibling</p></section>;
}
export function Child() { return <strong>Child</strong>; }
`;
type Mod = { App: (props: Record<string, unknown>) => unknown; Child: () => unknown };
const server = await load<Mod>(SOURCE, "ssr");
const client = await load<Mod>(SOURCE, "dom");

describe("spread children hydration", () => {
  it("[SPR-HYD-01] text supplied through spread children hydrates once and remains reactive", () => {
    const [text, setText] = useSignal("First");
    const props = {
      get children() {
        return text();
      },
    };
    const host = document.createElement("div");
    host.innerHTML = renderToString(() => createComponent(server.App, props));
    const content = host.querySelector(".content");
    const first = content?.firstChild;
    const stop = hydrate(() => createComponent(client.App, props), host);
    try {
      expect(content?.textContent).toBe("First");
      expect(content?.firstChild).toBe(first);
      setText("Second");
      flushSync();
      expect(content?.textContent).toBe("Second");
      expect(content?.firstChild).toBe(first);
    } finally {
      stop();
    }
  });

  it("[SPR-HYD-02] component children supplied through a spread keep their server node", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(() =>
      createComponent(server.App, {
        get children() {
          return createComponent(server.Child, {});
        },
      }),
    );
    const child = host.querySelector("strong");
    const stop = hydrate(
      () =>
        createComponent(client.App, {
          get children() {
            return createComponent(client.Child, {});
          },
        }),
      host,
    );
    try {
      expect(host.querySelector("strong")).toBe(child);
      expect(host.querySelector(".content")?.textContent).toBe("Child");
    } finally {
      stop();
    }
  });
});
