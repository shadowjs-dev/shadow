import {
  createContext,
  createRoot,
  onCleanup,
  useContext,
  useEffect,
  useMemo,
  useRenderEffect,
  useResource,
  useSignal,
} from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { For, Show } from "../../src/control-flow/index";
import { Suspense } from "../../src/control-flow/suspense";
import {
  createComponent,
  // biome-ignore lint/suspicious/noShadowRestrictedNames: the name "escape" is part of the compiler contract (SSR output).
  escape,
  renderToString,
  ssr,
  ssrElement,
  ssrHydrationKey,
  ssrRaw,
} from "../../src/server/index";

/** A component whose root element carries a hydration key. */
const Item = (props: { label: string }) =>
  ssr(["<i", ">", "</i>"], ssrHydrationKey(), escape(props.label));

describe("renderToString basics", () => {
  it("[SSR-83] renders an SsrNode to HTML", () => {
    expect(renderToString(() => ssr(["<p>", "</p>"], "x"))).toBe("<p>x</p>");
  });

  it("[SSR-84] escapes a string result", () => {
    expect(renderToString(() => "<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("[SSR-85] the root element key is 0-0 with the default render id", () => {
    expect(renderToString(() => ssr(["<p", ">x</p>"], ssrHydrationKey()))).toBe(
      '<p data-hk="0-0">x</p>',
    );
  });

  it("[SSR-86] components get distinct ids and their keys are scoped to them", () => {
    const out = renderToString(() => [
      createComponent(Item, { label: "a" }),
      createComponent(Item, { label: "b" }),
    ]);
    expect(out).toBe('<i data-hk="0-0-0">a</i><i data-hk="0-1-0">b</i>');
  });

  it("[SSR-87] the same input renders the same output twice", () => {
    const code = () => [
      createComponent(Item, { label: "a" }),
      ssr(["<p", ">", "</p>"], ssrHydrationKey(), "x"),
    ];
    expect(renderToString(code)).toBe(renderToString(code));
  });

  it("[SSR-88] renderId changes the key prefix", () => {
    expect(renderToString(() => ssr(["<p", ">x</p>"], ssrHydrationKey()), { renderId: "7" })).toBe(
      '<p data-hk="7-0">x</p>',
    );
  });

  it("[SSR-89] a renderId that is not a plain token is rejected before it reaches markup", () => {
    expect(() => renderToString(() => "x", { renderId: 'x"><script>' })).toThrow(TypeError);
    expect(() => renderToString(() => "x", { renderId: "" })).toThrow(TypeError);
  });

  it("[SSR-90] renderToString disposes its root after rendering", () => {
    let disposed = 0;
    renderToString(() => {
      onCleanup(() => {
        disposed += 1;
      });
      return "x";
    });
    expect(disposed).toBe(1);
  });

  it("[SSR-91] an error in the app disposes the root and propagates", () => {
    let disposed = 0;
    expect(() =>
      renderToString(() => {
        onCleanup(() => {
          disposed += 1;
        });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(disposed).toBe(1);
  });

  it("[SSR-92] effects never run on the server", () => {
    let ran = 0;
    renderToString(() => {
      useEffect(() => {
        ran += 1;
      });
      useRenderEffect(
        () => 1,
        () => {
          ran += 1;
        },
      );
      return "x";
    });
    expect(ran).toBe(0);
  });

  it("[SSR-93] signals and memos read during render give their current values", () => {
    const out = renderToString(() => {
      const [count, setCount] = useSignal(1);
      setCount((n) => n + 1);
      const doubled = useMemo(() => count() * 2);
      return escape(doubled());
    });
    expect(out).toBe("4");
  });

  it("[SSR-94] a context provider supplies its value to nested components", () => {
    const Theme = createContext("light");
    const out = renderToString(() =>
      Theme({
        value: "dark",
        get children() {
          return ssrElement("span", { title: useContext(Theme) }, undefined, false);
        },
      }),
    );
    expect(out).toBe('<span title="dark"></span>');
  });

  it("[SSR-95] a nested renderToString restores the outer scope when it returns", () => {
    const out = renderToString(() => [
      ssr(["<a", ">", "</a>"], ssrHydrationKey(), "1"),
      ssrRaw(renderToString(() => ssr(["<b", ">", "</b>"], ssrHydrationKey(), "2"))),
      ssr(["<c", ">", "</c>"], ssrHydrationKey(), "3"),
    ]);
    expect(out).toBe('<a data-hk="0-0">1</a><b data-hk="0-0">2</b><c data-hk="0-1">3</c>');
  });

  it("[SSR-96] a scope is restored even when a component throws", () => {
    const Broken = (): never => {
      throw new Error("component failed");
    };
    expect(() => renderToString(() => [createComponent(Broken, {})])).toThrow("component failed");
    expect(renderToString(() => ssr(["<p", ">x</p>"], ssrHydrationKey()))).toBe(
      '<p data-hk="0-0">x</p>',
    );
  });

  it("[SSR-97] the output of the render is escaped once, nested accessors included", () => {
    expect(renderToString(() => [() => ["<", () => ">"]])).toBe("&lt;&gt;");
  });
});

describe("Suspense and control flow on the server", () => {
  it("[SSR-98] a pending resource renders the Suspense fallback in sync mode", () => {
    const Slow = () => {
      const data = useResource(() => new Promise<string>(() => undefined));
      return escape(data());
    };
    const out = renderToString(() =>
      Suspense({
        fallback: ssr(["<p>", "</p>"], "loading"),
        get children() {
          return createComponent(Slow, {});
        },
      }),
    );
    expect(out).toBe("<p>loading</p>");
  });

  it("[SSR-99] a resource that resolves synchronously shows the content", () => {
    const Quick = () => {
      const data = useResource(() => "ready");
      return escape(data());
    };
    const out = renderToString(() =>
      Suspense({
        fallback: "loading",
        get children() {
          return createComponent(Quick, {});
        },
      }),
    );
    expect(out).toBe("ready");
  });

  it("[SSR-100] a nested Suspense shows its own fallback while the outer content is shown", () => {
    const Pending = () => {
      const data = useResource(() => new Promise<string>(() => undefined));
      // Reading it inside the boundary is what holds the boundary.
      data();
      return "never";
    };
    const out = renderToString(() =>
      Suspense({
        fallback: "outer",
        get children() {
          return [
            "before:",
            Suspense({
              fallback: "inner",
              get children() {
                return createComponent(Pending, {});
              },
            }),
          ];
        },
      }),
    );
    expect(out).toBe("before:inner");
  });

  it("[SSR-101] Show renders its children when true and its fallback when false", () => {
    const render = (ok: boolean) =>
      renderToString(() =>
        Show({
          get when() {
            return ok;
          },
          fallback: ssr(["<em>", "</em>"], "no"),
          get children() {
            return ssr(["<strong>", "</strong>"], "yes") as never;
          },
        }),
      );
    expect(render(true)).toBe("<strong>yes</strong>");
    expect(render(false)).toBe("<em>no</em>");
  });

  it("[SSR-102] For renders one row per item in order and renders the fallback for an empty list", () => {
    const list = (items: readonly string[]) =>
      renderToString(() =>
        For({
          each: items,
          fallback: "empty",
          children: (item: string) => ssr(["<li>", "</li>"], escape(item)),
        }),
      );
    expect(list(["a", "<b>"])).toBe("<li>a</li><li>&lt;b&gt;</li>");
    expect(list([])).toBe("empty");
  });

  it("[SSR-103] raw markup from a Suspense child is passed through the boundary untouched", () => {
    const out = renderToString(() =>
      Suspense({
        fallback: "wait",
        get children() {
          return ssrRaw("<hr>");
        },
      }),
    );
    expect(out).toBe("<hr>");
  });
});

describe("scope and root lifecycle", () => {
  it("[SSR-104] a root created by the app is disposed with the render", () => {
    let disposed = false;
    renderToString(() => {
      createRoot((dispose) => {
        onCleanup(() => {
          disposed = true;
        });
        return dispose;
      });
      return "x";
    });
    expect(disposed).toBe(true);
  });
});
