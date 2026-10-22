import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { createComponent, ErrorBoundary, render } from "@shadow-js/web";
import { describe, expect, it } from "vitest";
import { accept, component, type HotContext, registry } from "../src/hmr";

/** A minimal stand-in for Vite's `import.meta.hot` that survives "module reloads". */
function makeHot(data: Record<string, unknown>) {
  const disposers: Array<(d: Record<string, unknown>) => void> = [];
  const hot: HotContext & { accepted: number } = {
    data,
    accepted: 0,
    accept() {
      this.accepted += 1;
    },
    dispose(cb) {
      disposers.push(cb);
    },
  };
  return {
    hot,
    runDisposers: () => {
      for (const cb of disposers) cb(data);
    },
  };
}

describe("hmr runtime", () => {
  it("[HMR-10] an edited component re-renders in place; siblings keep their DOM and state", () => {
    const data: Record<string, unknown> = {};
    const v1 = makeHot(data);
    const reg1 = registry(v1.hot, "m");
    const Edited = component(reg1, "Edited", (props: { label: string }) => {
      const p = document.createElement("p");
      p.textContent = `v1:${props.label}`;
      return p;
    });
    accept(v1.hot, reg1);

    const [label] = useSignal("x");
    const host = document.createElement("div");
    const sibling = document.createElement("i");
    let created = 0;
    const dispose = render(
      () => [
        createComponent(Edited, {
          get label() {
            return label();
          },
        }),
        sibling,
      ],
      host,
    );
    expect(host.innerHTML).toBe("<p>v1:x</p><i></i>");
    created = host.querySelectorAll("p").length;

    // "Reload" the module with new code.
    v1.runDisposers();
    const v2 = makeHot(data);
    const reg2 = registry(v2.hot, "m");
    expect(reg2).toBe(reg1);
    const Edited2 = component(reg2, "Edited", (props: { label: string }) => {
      const p = document.createElement("p");
      p.textContent = `v2:${props.label}`;
      return p;
    });
    expect(Edited2).toBe(Edited);
    expect(host.innerHTML).toBe("<p>v1:x</p><i></i>");
    accept(v2.hot, reg2);
    flushSync();
    expect(host.innerHTML).toBe("<p>v2:x</p><i></i>");
    expect(host.querySelector("i")).toBe(sibling);
    expect(created).toBe(1);
    expect(v2.hot.accepted).toBe(1);
    dispose();
  });

  it("[HMR-11] only components replaced in the reload re-render", () => {
    const data: Record<string, unknown> = {};
    const first = makeHot(data);
    const reg = registry(first.hot, "m");
    let aRuns = 0;
    let bRuns = 0;
    const A = component(reg, "A", () => {
      aRuns += 1;
      return "a";
    });
    const B = component(reg, "B", () => {
      bRuns += 1;
      return "b";
    });
    accept(first.hot, reg);
    const host = document.createElement("div");
    render(() => [createComponent(A, {}), createComponent(B, {})], host);
    expect([aRuns, bRuns]).toEqual([1, 1]);
    first.runDisposers();
    const second = makeHot(data);
    const reg2 = registry(second.hot, "m");
    component(reg2, "A", () => {
      aRuns += 1;
      return "a2";
    });
    accept(second.hot, reg2);
    flushSync();
    expect([aRuns, bRuns]).toEqual([2, 1]);
    expect(host.textContent).toBe("a2b");
  });

  it("[HMR-12] without a hot context components are returned untouched", () => {
    const reg = registry(undefined, "m");
    const impl = () => "x";
    expect(component(reg, "A", impl)).toBe(impl);
    expect(() => accept(undefined, reg)).not.toThrow();
  });

  it("[HMR-13] instances disposed before an update do not leak or re-render", () => {
    const data: Record<string, unknown> = {};
    const hot = makeHot(data);
    const reg = registry(hot.hot, "m");
    let runs = 0;
    const A = component(reg, "A", () => {
      runs += 1;
      return "a";
    });
    accept(hot.hot, reg);
    const host = document.createElement("div");
    const dispose = render(() => createComponent(A, {}), host);
    dispose();
    hot.runDisposers();
    const next = makeHot(data);
    const reg2 = registry(next.hot, "m");
    component(reg2, "A", () => {
      runs += 1;
      return "b";
    });
    accept(next.hot, reg2);
    flushSync();
    expect(runs).toBe(1);
    createRoot(() => undefined);
  });
});

describe("hmr: component setup", () => {
  it("[HMR-W1] a component that writes state during setup does not trip the write-in-memo guard", () => {
    const { hot } = makeHot({});
    const reg = registry(hot, "m");
    const View = component(reg, "View", () => {
      const [value, setValue] = useSignal(0);
      setValue(5);
      return value();
    });
    accept(hot, reg);
    const out = createRoot(() => (View({}) as () => unknown)());
    expect(out).toBe(5);
  });
});

describe("hmr: an error boundary that failed on a hot-replaced module shows its children again", () => {
  it("[HMR-20] the fallback of a failed component is replaced by its children when the component's module is hot-replaced, without a retry", () => {
    const data: Record<string, unknown> = {};
    const v1 = makeHot(data);
    const reg1 = registry(v1.hot, "boundary-module");
    const Greeting = component(reg1, "Greeting", () => {
      throw new Error("boom v1");
    });
    accept(v1.hot, reg1);
    const host = document.createElement("div");
    const dispose = render(
      () =>
        ErrorBoundary({
          fallback: (error: unknown) => `caught: ${(error as Error).message}`,
          get children() {
            return createComponent(Greeting, {});
          },
        }),
      host,
    );
    flushSync();
    expect(host.textContent).toBe("caught: boom v1");

    v1.runDisposers();
    const v2 = makeHot(data);
    const reg2 = registry(v2.hot, "boundary-module");
    component(reg2, "Greeting", () => "hello v2");
    accept(v2.hot, reg2);
    flushSync();
    expect(host.textContent).toBe("hello v2");
    dispose();
  });

  it("[HMR-21] an update of a module that built none of the boundary's children leaves the fallback in place", () => {
    const data: Record<string, unknown> = {};
    const v1 = makeHot(data);
    const failing = registry(v1.hot, "failing-module");
    const Greeting = component(failing, "Greeting", () => {
      throw new Error("boom");
    });
    const unrelated = registry(v1.hot, "unrelated-module");
    component(unrelated, "Other", () => "other");
    accept(v1.hot, failing);
    accept(v1.hot, unrelated);
    const host = document.createElement("div");
    const dispose = render(
      () =>
        ErrorBoundary({
          fallback: "caught",
          get children() {
            return createComponent(Greeting, {});
          },
        }),
      host,
    );
    flushSync();
    expect(host.textContent).toBe("caught");

    v1.runDisposers();
    const v2 = makeHot(data);
    const next = registry(v2.hot, "unrelated-module");
    component(next, "Other", () => "other v2");
    accept(v2.hot, next);
    flushSync();
    expect(host.textContent).toBe("caught");
    dispose();
  });

  it("[HMR-22] an update that still throws shows the fallback with the new error, and a later fix recovers", () => {
    const data: Record<string, unknown> = {};
    const v1 = makeHot(data);
    const reg1 = registry(v1.hot, "boundary-module");
    const Greeting = component(reg1, "Greeting", () => {
      throw new Error("boom v1");
    });
    accept(v1.hot, reg1);
    const host = document.createElement("div");
    const dispose = render(
      () =>
        ErrorBoundary({
          fallback: (error: unknown) => `caught: ${(error as Error).message}`,
          get children() {
            return createComponent(Greeting, {});
          },
        }),
      host,
    );
    flushSync();
    expect(host.textContent).toBe("caught: boom v1");

    v1.runDisposers();
    const v2 = makeHot(data);
    const reg2 = registry(v2.hot, "boundary-module");
    component(reg2, "Greeting", () => {
      throw new Error("boom v2");
    });
    accept(v2.hot, reg2);
    flushSync();
    expect(host.textContent).toBe("caught: boom v2");

    v2.runDisposers();
    const v3 = makeHot(data);
    const reg3 = registry(v3.hot, "boundary-module");
    component(reg3, "Greeting", () => "hello v3");
    accept(v3.hot, reg3);
    flushSync();
    expect(host.textContent).toBe("hello v3");
    dispose();
  });
});
