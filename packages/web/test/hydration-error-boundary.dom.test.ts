import { flushSync, useSignal } from "@shadow-js/core";
import { createComponent, hydrate } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "./support/compile";

/** The same JSX source compiled for both targets: server markup -> hydrate on the client. */
async function both<T extends Record<string, unknown>>(
  source: string,
): Promise<{ dom: T; ssr: T }> {
  return { dom: await load<T>(source, "dom"), ssr: await load<T>(source, "ssr") };
}

const hosts: HTMLElement[] = [];
function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  hosts.push(el);
  return el;
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});
function comments(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let n = 0;
  while (walker.nextNode()) n += 1;
  return n;
}
function click(target: Element | null | undefined): void {
  target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}
/** The console.warn messages raised so far (the setup fails the test on any that are not consumed). */
function warnings(): string[] {
  return vi.mocked(console.warn).mock.calls.map((args) => String(args[0]));
}
/** Consumes the warnings raised so far, so only later output is checked. */
function takeWarnings(): string[] {
  const raised = warnings();
  vi.mocked(console.warn).mockClear();
  return raised;
}
/** No warning and no console error may have been raised since the last takeWarnings(). */
function expectNoWarnings(): void {
  expect(warnings()).toEqual([]);
  expect(vi.mocked(console.error).mock.calls).toEqual([]);
}

/**
 * Hydration key of the fallback's root element: the server rendered the healthy child, never the
 * fallback. The inline fallback of FIRST_RENDER_SOURCE is key `0-0-1-1`; the component fallback of
 * AUTO_RECOVERY_SOURCE is `0-0-1-1-0` (one scope deeper).
 */
const FALLBACK_MISS = '[shadow HYDRATION_KEY_MISS] No server element for key "0-0-1-1".';
const COMPONENT_FALLBACK_MISS =
  '[shadow HYDRATION_KEY_MISS] No server element for key "0-0-1-1-0".';

/**
 * The child throws while `probe.throwsLeft` is positive (decremented on each throw). The server
 * render passes a probe with no throws, so the server markup is the healthy child.
 */
const FIRST_RENDER_SOURCE = `
  export function Child(props) {
    props.probe.renders += 1;
    if (props.probe.throwsLeft > 0) {
      props.probe.throwsLeft -= 1;
      throw new Error("first render");
    }
    return <p class="child">ready</p>;
  }
  export const App = (props) => (
    <section class="root">
      <ErrorBoundary fallback={(error, reset) => (
        <div class="fallback"><span class="msg">{error.message}</span><button onClick={reset}>retry</button></div>
      )}>
        <Child probe={props.probe} />
      </ErrorBoundary>
      <aside class="sibling">side</aside>
    </section>
  );
`;

/**
 * The fallback resets the boundary from `onMount`, so the recovery runs inside the hydration pass
 * (the auto-recovery case), before `hydrate()` returns.
 */
const AUTO_RECOVERY_SOURCE = `
  import { onMount } from "@shadow-js/core";
  export function Child(props) {
    props.probe.renders += 1;
    if (props.probe.throwsLeft > 0) {
      props.probe.throwsLeft -= 1;
      throw new Error("first render");
    }
    return <p class="child">ready</p>;
  }
  function AutoRetry(props) {
    onMount(() => props.reset());
    return <div class="fallback"><span class="msg">{props.error.message}</span></div>;
  }
  export const App = (props) => (
    <section class="root">
      <ErrorBoundary fallback={(error, reset) => <AutoRetry error={error} reset={reset} />}>
        <Child probe={props.probe} />
      </ErrorBoundary>
      <aside class="sibling">side</aside>
    </section>
  );
`;

/**
 * The child reads `props.broken()` inside a reactive computation. Set it to true after hydration to
 * raise a client error that is not present on the first render.
 */
const LATE_ERROR_SOURCE = `
  export function Child(props) {
    return <p class="child">{(() => { if (props.broken()) throw new Error("late"); return "ready"; })()}</p>;
  }
  export const App = (props) => (
    <section class="root">
      <ErrorBoundary fallback={(error, reset) => (
        <div class="fallback"><span class="msg">{error.message}</span><button onClick={reset}>retry</button></div>
      )}>
        <Child broken={props.broken} />
      </ErrorBoundary>
      <aside class="sibling">side</aside>
    </section>
  );
`;

type ProbeApp = { App: (props: { probe: { throwsLeft: number; renders: number } }) => unknown };
type LateErrorApp = { App: (props: { broken: () => boolean }) => unknown };

describe("hydration and ErrorBoundary recovery", () => {
  it("[WEB-HYD-EB-01] a child that throws on its first render during hydration shows the fallback; reset rebuilds it and nothing else warns", async () => {
    const { dom, ssr } = await both<ProbeApp>(
      `import { ErrorBoundary } from "@shadow-js/web";\n${FIRST_RENDER_SOURCE}`,
    );
    const html = renderToString(() =>
      createComponent(ssr.App, { probe: { throwsLeft: 0, renders: 0 } }),
    );
    const el = host(html);
    const section = el.querySelector("section");
    const sibling = el.querySelector("aside");
    const serverChild = el.querySelector("p.child");
    expect(serverChild).not.toBeNull();

    const probe = { throwsLeft: 1, renders: 0 };
    const dispose = hydrate(() => createComponent(dom.App, { probe }), el);
    flushSync();

    // The hydrated child threw: the boundary replaced the server node with the fallback. The only
    // warning is the fallback's own key, which the server never sent (the documented miss for a
    // client that renders a different tree); nothing else may warn.
    expect(probe.renders).toBe(1);
    expect(el.querySelector(".fallback .msg")?.textContent).toBe("first render");
    expect(el.querySelector("p.child")).toBeNull();
    expect(serverChild?.isConnected).toBe(false);
    expect(el.querySelector("section")).toBe(section);
    expect(el.querySelector("aside")).toBe(sibling);
    expect(comments(el)).toBe(0);
    expect(takeWarnings()).toEqual([FALLBACK_MISS]);

    // Recovery after hydration: reset rebuilds the child, which renders the second time.
    click(el.querySelector("button"));
    flushSync();
    expect(probe.renders).toBe(2);
    expect(el.querySelector(".fallback")).toBeNull();
    const child = el.querySelector("p.child");
    expect(child?.textContent).toBe("ready");
    expect(child).not.toBe(serverChild);
    expect(el.querySelector("section")).toBe(section);
    expect(el.querySelector("aside")).toBe(sibling);
    expect(el.querySelector("[data-hk]")).toBeNull();
    expect(comments(el)).toBe(0);
    expectNoWarnings();
    dispose();
  });

  it("[WEB-HYD-EB-02] a client error after hydration shows the fallback; reset rebuilds the child with no hydration warnings", async () => {
    const { dom, ssr } = await both<LateErrorApp>(
      `import { ErrorBoundary } from "@shadow-js/web";\n${LATE_ERROR_SOURCE}`,
    );
    const html = renderToString(() => createComponent(ssr.App, { broken: () => false }));
    const el = host(html);
    const section = el.querySelector("section");
    const sibling = el.querySelector("aside");
    const serverChild = el.querySelector("p.child");
    expect(serverChild).not.toBeNull();

    const [broken, setBroken] = useSignal(false);
    const dispose = hydrate(() => createComponent(dom.App, { broken }), el);
    flushSync();
    // Hydration finished with the server node intact and no warning.
    expect(el.querySelector("p.child")).toBe(serverChild);
    expect(serverChild?.textContent).toBe("ready");
    expectNoWarnings();

    // A plain client error after hydration: the boundary replaces the child with the fallback.
    flushSync(() => setBroken(true));
    expect(el.querySelector(".fallback .msg")?.textContent).toBe("late");
    expect(el.querySelector("p.child")).toBeNull();
    expect(serverChild?.isConnected).toBe(false);
    expect(el.querySelector("section")).toBe(section);
    expect(el.querySelector("aside")).toBe(sibling);
    expectNoWarnings();

    // Recovery: the error condition is gone, reset rebuilds the child.
    flushSync(() => setBroken(false));
    click(el.querySelector("button"));
    flushSync();
    expect(el.querySelector(".fallback")).toBeNull();
    expect(el.querySelector("p.child")?.textContent).toBe("ready");
    expect(el.querySelector("p.child")).not.toBe(serverChild);
    expect(el.querySelector("section")).toBe(section);
    expect(el.querySelector("aside")).toBe(sibling);
    expect(comments(el)).toBe(0);
    expectNoWarnings();
    dispose();
  });

  it("[WEB-HYD-EB-03] a reset that runs inside the hydration pass reclaims the server element, with no miss for the rebuilt child", async () => {
    const { dom, ssr } = await both<ProbeApp>(
      `import { ErrorBoundary } from "@shadow-js/web";\n${AUTO_RECOVERY_SOURCE}`,
    );
    const html = renderToString(() =>
      createComponent(ssr.App, { probe: { throwsLeft: 0, renders: 0 } }),
    );
    const el = host(html);
    const section = el.querySelector("section");
    const sibling = el.querySelector("aside");
    const serverChild = el.querySelector("p.child");
    expect(serverChild).not.toBeNull();

    const probe = { throwsLeft: 1, renders: 0 };
    const dispose = hydrate(() => createComponent(dom.App, { probe }), el);
    flushSync();

    // The fallback's onMount reset the boundary during the pass: the child rendered again and
    // claimed the server's <p> by its key. The only warning is the fallback's own miss (raised when
    // the fallback was built); the rebuilt child produces no miss.
    expect(probe.renders).toBe(2);
    expect(el.querySelector(".fallback")).toBeNull();
    expect(el.querySelector("p.child")).toBe(serverChild);
    expect(serverChild?.textContent).toBe("ready");
    expect(el.querySelector("section")).toBe(section);
    expect(el.querySelector("aside")).toBe(sibling);
    expect(el.querySelector("[data-hk]")).toBeNull();
    expect(comments(el)).toBe(0);
    expect(takeWarnings()).toEqual([COMPONENT_FALLBACK_MISS]);
    expectNoWarnings();
    dispose();
  });
});
