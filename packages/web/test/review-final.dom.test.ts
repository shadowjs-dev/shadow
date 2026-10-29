import { useSignal } from "@shadow-js/core";
import { createComponent } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";
import { load } from "./support/compile";

type App = (props: Record<string, unknown>) => unknown;

function serverHtml(app: App, props: Record<string, unknown>): string {
  const flagGlobal = globalThis as unknown as { __SERVER__: boolean };
  flagGlobal.__SERVER__ = true;
  try {
    return renderToString(() => createComponent(app, props));
  } finally {
    flagGlobal.__SERVER__ = false;
  }
}

describe("review final: text-only elements", () => {
  it("[REVIEW-FINAL-2] a false or true child of a title or style with several children writes nothing, as it does alone", async () => {
    const source = `export const App = (props) => (
      <div>
        <title>{props.on() && "Loading "}My App</title>
        <style>a {props.show()} b</style>
      </div>
    );`;
    const dom = await load<{ App: App }>(source, "dom");
    const ssr = await load<{ App: App }>(source, "ssr");
    const [on] = useSignal(false);
    const [show] = useSignal(true);
    const props = { on, show };
    const client = createComponent(dom.App, props) as Element;
    expect(client.querySelector("title")?.textContent).toBe("My App");
    expect(client.querySelector("style")?.textContent).toBe("a  b");
    const html = serverHtml(ssr.App, props);
    expect(html).toContain("<title>My App</title>");
    expect(html).toContain("<style>a  b</style>");
  });
});
