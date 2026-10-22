import { flushSync, useSignal } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/load";

const containers: HTMLElement[] = [];

/** Mounts a view into a container attached to the document (the focus rules need a live document). */
function mount(view: () => unknown): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  containers.push(host);
  return { host, dispose: render(view, host) };
}

afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

describe("autoFocus runs in the browser DOM", () => {
  it("[AF-01] an input rendered by the first render takes focus", async () => {
    const mod = await load<{ view: () => unknown }>(
      `export const view = () => <div><input autoFocus /></div>;`,
    );
    const { host, dispose } = mount(mod.view);
    expect(document.activeElement).toBe(host.querySelector("input"));
    dispose();
  });

  it("[AF-02] an input inserted later by Show takes focus when it appears", async () => {
    const [open, setOpen] = useSignal(false);
    const mod = await load<{ make: (open: () => boolean) => () => unknown }>(
      `import { Show } from "@shadow-js/web";
       export const make = (open) => () => <div><Show when={open()}><input autoFocus /></Show></div>;`,
    );
    const { host, dispose } = mount(mod.make(open));
    expect(document.activeElement).not.toBe(host.querySelector("input"));
    flushSync(() => setOpen(true));
    expect(document.activeElement).toBe(host.querySelector("input"));
    dispose();
  });

  it("[AF-03] autoFocus focuses once: a later update does not take focus back", async () => {
    const [n, setN] = useSignal(0);
    const mod = await load<{ make: (n: () => number) => () => unknown }>(
      `export const make = (n) => () => <div><span>{n()}</span><input autoFocus /><button>b</button></div>;`,
    );
    const { host, dispose } = mount(mod.make(n));
    const input = host.querySelector("input");
    expect(document.activeElement).toBe(input);
    const button = host.querySelector("button");
    button?.focus();
    flushSync(() => setN(1));
    expect(host.querySelector("span")?.textContent).toBe("1");
    expect(document.activeElement).toBe(button);
    dispose();
  });

  it("[AF-04] an input rendered into a Portal takes focus", async () => {
    const [open, setOpen] = useSignal(false);
    const mod = await load<{ make: (open: () => boolean) => () => unknown }>(
      `import { Portal, Show } from "@shadow-js/web";
       export const make = (open) => () => <div><Show when={open()}><Portal><input autoFocus /></Portal></Show></div>;`,
    );
    const { dispose } = mount(mod.make(open));
    flushSync(() => setOpen(true));
    const input = document.body.querySelector(":scope > input");
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    dispose();
  });

  it("[AF-05] an autoFocus value of false does not focus", async () => {
    const mod = await load<{ view: () => unknown }>(
      `export const view = () => <div><input autoFocus={false} /></div>;`,
    );
    const { host, dispose } = mount(mod.view);
    expect(document.activeElement).not.toBe(host.querySelector("input"));
    dispose();
  });

  it("[AF-06] an element in a detached root is not focused (it is not in the document)", async () => {
    const mod = await load<{ view: () => unknown }>(
      `export const view = () => <div><input autoFocus /></div>;`,
    );
    const detached = document.createElement("div");
    const dispose = render(mod.view, detached);
    const input = detached.querySelector("input");
    expect(input).not.toBeNull();
    expect(document.activeElement).not.toBe(input);
    dispose();
  });

  it("[AF-07] a spread autoFocus prop focuses the element once, at its first application", async () => {
    const mod = await load<{ make: (props: () => Record<string, unknown>) => () => unknown }>(
      `export const make = (props) => () => <div><input {...props()} /></div>;`,
    );
    const [on, setOn] = useSignal(true);
    const { host, dispose } = mount(mod.make(() => ({ autoFocus: on(), name: "x" })));
    const input = host.querySelector("input");
    expect(document.activeElement).toBe(input);
    expect(input?.getAttribute("name")).toBe("x");
    expect(input?.hasAttribute("autofocus")).toBe(false);
    const other = document.createElement("button");
    host.append(other);
    other.focus();
    flushSync(() => setOn(false));
    flushSync(() => setOn(true));
    expect(document.activeElement).toBe(other);
    dispose();
  });
});
