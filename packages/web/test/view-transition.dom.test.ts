import { flushSync } from "@shadow-js/core";
import { render, startViewTransition } from "@shadow-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "./support/compile";

const SRC = `
import { ViewTransition } from "@shadow-js/web";
export function Card() { return <section class="card"><h2>title</h2></section>; }
export function App(props) {
  return <ViewTransition name={props.name} class={props.cls}><Card /></ViewTransition>;
}
`;

let cases = 0;
function fresh<T>(): Promise<T> {
  cases += 1;
  return load<T>(`${SRC}\n// case ${cases}`);
}

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

function mount(view: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(view, host);
  flushSync();
  return host;
}

describe("ViewTransition component", () => {
  it("[VTC-01] name sets view-transition-name on the element it wraps, without a wrapper element", async () => {
    const mod = await fresh<{ App: (props: { name?: string; cls?: string }) => unknown }>();
    const host = mount(() => mod.App({ name: "hero" }));
    const card = host.querySelector<HTMLElement>(".card");
    expect(card?.style.getPropertyValue("view-transition-name")).toBe("hero");
    expect(host.querySelectorAll("*").length).toBe(2);
  });

  it("[VTC-02] class sets view-transition-class", async () => {
    const mod = await fresh<{ App: (props: { name?: string; cls?: string }) => unknown }>();
    const host = mount(() => mod.App({ name: "hero", cls: "slide" }));
    const card = host.querySelector<HTMLElement>(".card");
    expect(card?.style.getPropertyValue("view-transition-class")).toBe("slide");
  });

  it("[VTC-03] without a name the element carries no view transition style", async () => {
    const mod = await fresh<{ App: (props: { name?: string; cls?: string }) => unknown }>();
    const host = mount(() => mod.App({}));
    expect(
      host.querySelector<HTMLElement>(".card")?.style.getPropertyValue("view-transition-name"),
    ).toBe("");
    expect(host.querySelector("h2")?.textContent).toBe("title");
  });

  it("[VTC-04] startViewTransition passes its types to the browser API", async () => {
    const calls: unknown[] = [];
    (document as { startViewTransition?: unknown }).startViewTransition = vi.fn(
      (options: { update: () => void; types?: string[] }) => {
        calls.push(options.types);
        options.update();
        return { finished: Promise.resolve() };
      },
    );
    let ran = false;
    await startViewTransition(
      () => {
        ran = true;
      },
      { types: ["slide"] },
    );
    expect(ran).toBe(true);
    expect(calls).toEqual([["slide"]]);
  });

  it("[VTC-05] without the browser API the update runs at once and the promise resolves", async () => {
    let ran = false;
    await startViewTransition(
      () => {
        ran = true;
      },
      { types: ["slide"] },
    );
    expect(ran).toBe(true);
  });
});
