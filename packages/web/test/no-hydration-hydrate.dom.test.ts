import { afterEach, describe, expect, it } from "vitest";
import { createComponent, hydrate, render } from "../src/index";
import { load } from "./support/compile";
import { LAYOUT_HTML, SERVER_HTML } from "./support/no-hydration-fixture";

/**
 * NoHydration inside a page layout: the server renders the article, the browser must leave that
 * exact element in place while it hydrates the rest of the page.
 */
const APP = `
import { NoHydration } from "@shadow-js/web";
export const App = (props) => (
  <main class="page">
    <h1>{props.title()}</h1>
    <NoHydration>
      <article class="prose" innerHTML={props.html} />
    </NoHydration>
    <footer>{props.title()}</footer>
  </main>
);
`;

const LAYOUT_APP = `
import { NoHydration } from "@shadow-js/web";
const Layout = (props) => (<div class="layout"><nav>nav</nav>{props.children}</div>);
export const App = (props) => (
  <Layout>
    <NoHydration>
      <article class="prose" innerHTML={props.html} />
    </NoHydration>
  </Layout>
);
`;

interface AppModule {
  readonly App: (props: { title: () => string; html: string }) => unknown;
}

const props = { title: () => "Guide", html: "<p>Long static body</p>" };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NoHydration while the browser hydrates", () => {
  it("[NOH-02] the server's article stays the same element after hydrate", async () => {
    const dom = await load<AppModule>(APP, "dom");
    const root = document.createElement("div");
    root.innerHTML = SERVER_HTML;
    document.body.append(root);
    const serverArticle = root.querySelector("article");
    expect(serverArticle).not.toBeNull();
    hydrate(() => createComponent(dom.App, props), root, {});
    expect(root.querySelector("article")).toBe(serverArticle);
    expect(root.querySelector("article")?.innerHTML).toBe("<p>Long static body</p>");
    expect(root.querySelector("footer")?.textContent).toBe("Guide");
  });

  it("[NOH-03] rendered by the browser alone, the article is built", async () => {
    const dom = await load<AppModule>(APP, "dom");
    const root = document.createElement("div");
    document.body.append(root);
    render(() => createComponent(dom.App, props), root);
    expect(root.querySelector("article")?.innerHTML).toBe("<p>Long static body</p>");
  });

  it("[NOH-05] passed through a layout's children, the article stays the same element", async () => {
    const dom = await load<AppModule>(LAYOUT_APP, "dom");
    const root = document.createElement("div");
    root.innerHTML = LAYOUT_HTML;
    document.body.append(root);
    const serverArticle = root.querySelector("article");
    expect(serverArticle).not.toBeNull();
    hydrate(() => createComponent(dom.App, props), root, {});
    expect(root.querySelector("article")).toBe(serverArticle);
  });
});
