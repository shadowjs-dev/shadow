import { describe, expect, it } from "vitest";
import { NoHydration } from "../../src/control-flow/index";
import {
  createComponent,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
  escape,
  renderToString,
  ssr,
  ssrHydrationKey,
} from "../../src/server/index";
import { load } from "../support/compile";
import { LAYOUT_HTML, SERVER_HTML } from "../support/no-hydration-fixture";

const Keyed = (props: { text: string }): unknown =>
  ssr(["<p", ">", "</p>"], ssrHydrationKey(), escape(props.text));

describe("NoHydration on the server", () => {
  it("[NOH-01] renders its children without hydration keys, and siblings keep theirs", () => {
    const html = renderToString(() => [
      createComponent(Keyed, { text: "a" }),
      createComponent(NoHydration, {
        get children() {
          return createComponent(Keyed, { text: "static" });
        },
      }),
      createComponent(Keyed, { text: "b" }),
    ]);
    expect(html).toBe(
      '<p data-hk="0-0-0">a</p><!--nh:0-1-0--><p>static</p><!--/nh--><p data-hk="0-2-0">b</p>',
    );
  });

  it("[NOH-04] a compiled page renders the article without keys, between region markers", async () => {
    const ssr = await load<{ App: (props: unknown) => unknown }>(
      `import { NoHydration } from "@shadow-js/web";
export const App = (props) => (
  <main class="page">
    <h1>{props.title()}</h1>
    <NoHydration>
      <article class="prose" innerHTML={props.html} />
    </NoHydration>
    <footer>{props.title()}</footer>
  </main>
);`,
      "ssr",
    );
    const html = renderToString(() =>
      createComponent(ssr.App, { title: () => "Guide", html: "<p>Long static body</p>" }),
    );
    expect(html).toBe(SERVER_HTML);
  });

  it("[NOH-06] passed through a layout's children, the article sits between region markers", async () => {
    const ssr = await load<{ App: (props: unknown) => unknown }>(
      `import { NoHydration } from "@shadow-js/web";
const Layout = (props) => (<div class="layout"><nav>nav</nav>{props.children}</div>);
export const App = (props) => (
  <Layout>
    <NoHydration>
      <article class="prose" innerHTML={props.html} />
    </NoHydration>
  </Layout>
);`,
      "ssr",
    );
    const html = renderToString(() =>
      createComponent(ssr.App, { html: "<p>Long static body</p>" }),
    );
    expect(html).toBe(LAYOUT_HTML);
  });
});
