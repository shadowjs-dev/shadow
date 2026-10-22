import { flushSync, useRenderEffect, useResource } from "@shadow-js/core";
import { createComponent, render, Suspense, SuspenseList } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
/** An element showing a resource, read inside the component so the boundary around it holds. */
function reader(data: () => string | undefined): HTMLElement {
  const el = document.createElement("span");
  useRenderEffect(() => {
    el.textContent = data() ?? "";
  });
  return el;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

/** Three boundaries whose data the test resolves by hand. */
function app(props: {
  revealOrder?: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  const loads = [deferred<string>(), deferred<string>(), deferred<string>()];
  const Item = (p: { i: number }): unknown => {
    const data = useResource(() => loads[p.i]?.promise as Promise<string>, { key: `i${p.i}` });
    return reader(data);
  };
  const boundary = (i: number): unknown =>
    createComponent(Suspense, {
      fallback: `[wait ${i}]`,
      get children() {
        return createComponent(Item, { i });
      },
    });
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(
    () =>
      createComponent(SuspenseList, {
        ...props,
        get children() {
          return [boundary(0), boundary(1), boundary(2)];
        },
      }),
    host,
  );
  return { host, loads };
}

describe("SuspenseList", () => {
  it("[SPL-01] forwards: a boundary that is ready waits for the ones before it", async () => {
    const { host, loads } = app({ revealOrder: "forwards" });
    flushSync();
    expect(host.textContent).toBe("[wait 0][wait 1][wait 2]");
    loads[1]?.resolve("B");
    await settle();
    expect(host.textContent).toBe("[wait 0][wait 1][wait 2]");
    loads[0]?.resolve("A");
    await settle();
    expect(host.textContent).toBe("AB[wait 2]");
    loads[2]?.resolve("C");
    await settle();
    expect(host.textContent).toBe("ABC");
  });

  it("[SPL-02] backwards: reveals from the last boundary", async () => {
    const { host, loads } = app({ revealOrder: "backwards" });
    flushSync();
    loads[0]?.resolve("A");
    await settle();
    expect(host.textContent).toBe("[wait 0][wait 1][wait 2]");
    loads[2]?.resolve("C");
    await settle();
    expect(host.textContent).toBe("[wait 0][wait 1]C");
    loads[1]?.resolve("B");
    await settle();
    expect(host.textContent).toBe("ABC");
  });

  it("[SPL-03] together: everything appears at once when the last one is ready", async () => {
    const { host, loads } = app({ revealOrder: "together" });
    flushSync();
    loads[0]?.resolve("A");
    loads[1]?.resolve("B");
    await settle();
    expect(host.textContent).toBe("[wait 0][wait 1][wait 2]");
    loads[2]?.resolve("C");
    await settle();
    expect(host.textContent).toBe("ABC");
  });

  it("[SPL-04] tail collapsed shows only the next fallback; hidden shows none", async () => {
    const collapsed = app({ revealOrder: "forwards", tail: "collapsed" });
    flushSync();
    expect(collapsed.host.textContent).toBe("[wait 0]");
    collapsed.loads[0]?.resolve("A");
    await settle();
    expect(collapsed.host.textContent).toBe("A[wait 1]");
    const hidden = app({ revealOrder: "forwards", tail: "hidden" });
    flushSync();
    expect(hidden.host.textContent).toBe("");
    hidden.loads[0]?.resolve("A");
    hidden.loads[1]?.resolve("B");
    hidden.loads[2]?.resolve("C");
    await settle();
    expect(hidden.host.textContent).toBe("ABC");
  });

  it("[SPL-05] without a reveal order each boundary reveals on its own", async () => {
    const { host, loads } = app({});
    flushSync();
    loads[2]?.resolve("C");
    await settle();
    expect(host.textContent).toBe("[wait 0][wait 1]C");
  });

  it("[SPL-06] a Suspense outside any list behaves as before", async () => {
    const d = deferred<string>();
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const Item = (): unknown => {
      const data = useResource(() => d.promise, { key: "x" });
      return reader(data);
    };
    render(
      () =>
        createComponent(Suspense, {
          fallback: "wait",
          get children() {
            return createComponent(Item, {});
          },
        }),
      host,
    );
    flushSync();
    expect(host.textContent).toBe("wait");
    d.resolve("done");
    await settle();
    expect(host.textContent).toBe("done");
  });
});
