import { children, createRoot, flushSync, mapArray, useMemo, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it } from "vitest";
import { createComponent } from "../../src/component";
import {
  Dynamic,
  ErrorBoundary,
  For,
  Index,
  lazy,
  Match,
  Show,
  Suspense,
  Switch,
} from "../../src/control-flow/index";
import { insert } from "../../src/insert";
import { use } from "../../src/reactive";
import { cleanupDom, mount } from "../support/dom";

/**
 * Control-flow components build their children inside a memo. What runs there is not a derivation:
 * it is component setup, a `ref` callback or a directive, and all of them may write signals (a
 * counter, a registry, a context). WRITE_IN_MEMO guards `useMemo` functions that compute values,
 * not the places user code is merely created in.
 */

afterEach(cleanupDom);

/** Mounts `view` (a thunk returning what the control-flow component returned) and flushes. */
function mountView(view: () => unknown): HTMLElement {
  const host = mount();
  createRoot(() => {
    insert(host, view());
  });
  flushSync();
  return host;
}

/** A component that writes `target` while it is being set up. */
function writer(target: () => void): () => unknown {
  return () =>
    createComponent(() => {
      target();
      return document.createElement("i");
    }, {});
}

describe("structural memos allow signal writes while children are built", () => {
  it("[CF-W-1] Show: a component body, a ref-style callback and a directive may write", () => {
    const [on, setOn] = useSignal(false);
    const [seen, setSeen] = useSignal(0);
    const host = mountView(() =>
      Show({
        get when() {
          return on();
        },
        get children() {
          const el = document.createElement("span");
          use(() => setSeen((n) => n + 1), el);
          return [el, writer(() => setSeen((n) => n + 10))()];
        },
      }),
    );
    setOn(true);
    flushSync();
    expect(seen()).toBe(11);
    expect(host.querySelector("span")).not.toBeNull();
  });

  it("[CF-W-2] Show fallback and Switch/Match branches may write", () => {
    const [on, setOn] = useSignal(true);
    const [seen, setSeen] = useSignal(0);
    mountView(() => [
      Show({
        get when() {
          return on();
        },
        get fallback() {
          return writer(() => setSeen((n) => n + 1))();
        },
        children: "x",
      }),
      Switch({
        children: [
          Match({
            get when() {
              return !on();
            },
            get children() {
              return writer(() => setSeen((n) => n + 10))();
            },
          }),
        ],
      }),
    ]);
    setOn(false);
    flushSync();
    expect(seen()).toBe(11);
  });

  it("[CF-W-3] For and Index rows may write in their callback", () => {
    const [list, setList] = useSignal<number[]>([]);
    const [seen, setSeen] = useSignal(0);
    mountView(() => [
      For({
        get each() {
          return list();
        },
        children: () => writer(() => setSeen((n) => n + 1))(),
      }),
      Index({
        get each() {
          return list();
        },
        children: () => writer(() => setSeen((n) => n + 10))(),
      }),
    ]);
    setList([1, 2]);
    flushSync();
    expect(seen()).toBe(22);
  });

  it("[CF-W-4] Dynamic may write while its component is built", () => {
    const [on, setOn] = useSignal(false);
    const [seen, setSeen] = useSignal(0);
    mountView(() =>
      Dynamic({
        get component() {
          return on() ? () => writer(() => setSeen((n) => n + 1))() : undefined;
        },
      }),
    );
    setOn(true);
    flushSync();
    expect(seen()).toBe(1);
  });

  it("[CF-W-5] ErrorBoundary rebuilds its children after reset, and Suspense builds them, with writes", () => {
    const [seen, setSeen] = useSignal(0);
    let attempts = 0;
    let resetBoundary: () => void = () => undefined;
    const host = mountView(() => [
      ErrorBoundary({
        fallback: (_error: unknown, reset: () => void) => {
          resetBoundary = reset;
          return "failed";
        },
        get children() {
          return createComponent(() => {
            attempts += 1;
            if (attempts === 1) throw new Error("first attempt");
            setSeen((n) => n + 1);
            return document.createElement("i");
          }, {});
        },
      }),
      Suspense({
        fallback: "loading",
        get children() {
          return writer(() => setSeen((n) => n + 10))();
        },
      }),
    ]);
    expect(host.textContent).toBe("failed");
    resetBoundary();
    flushSync();
    expect(seen()).toBe(11);
    expect(host.querySelectorAll("i").length).toBe(2);
  });

  it("[CF-W-6] a lazy component may write once loaded", async () => {
    const [seen, setSeen] = useSignal(0);
    const Lazy = lazy(async () => ({
      default: () => {
        setSeen((n) => n + 1);
        return document.createElement("i");
      },
    }));
    mountView(() => Suspense({ fallback: "loading", children: createComponent(Lazy, {}) }));
    await Lazy.preload();
    flushSync();
    expect(seen()).toBe(1);
  });

  it("[CF-W-7] children() and mapArray callbacks may write", () => {
    const [seen, setSeen] = useSignal(0);
    createRoot(() => {
      const resolved = children(() => {
        setSeen((n) => n + 1);
        return "x";
      });
      resolved();
      const [list] = useSignal([1, 2]);
      const rows = mapArray(list, (item) => {
        setSeen((n) => n + 10);
        return item;
      });
      rows();
    });
    expect(seen()).toBe(21);
  });

  it("[CF-W-8] a plain useMemo that computes a value still rejects writes", () => {
    const [, setOther] = useSignal(0);
    const bad = useMemo(
      () => {
        setOther(1);
        return 1;
      },
      { lazy: true },
    );
    expect(() => bad()).toThrow(/WRITE_IN_MEMO/);
  });
});
