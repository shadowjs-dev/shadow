import { createRoot, flushSync, onCleanup, useRenderEffect, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { componentName } from "../src/component";
import { createComponent, effect, memo, render, use } from "../src/index";
import { cleanupDom, hasComment, mount, shape } from "./support/dom";

afterEach(cleanupDom);

describe("render()", () => {
  it("[RND-01] inserts the output into the container and returns a dispose function", () => {
    const container = mount();
    const dispose = render(() => "hello", container);
    expect(container.textContent).toBe("hello");
    expect(typeof dispose).toBe("function");
  });

  it("[RND-02] dispose removes everything it inserted, leaving the container empty", () => {
    const container = mount();
    const dispose = render(() => ["a", document.createElement("b")], container);
    dispose();
    expect(container.childNodes.length).toBe(0);
  });

  it("[RND-03] after dispose, signal changes no longer reach the DOM, and a second dispose is harmless", () => {
    const container = mount();
    const [value, setValue] = useSignal("first");
    const dispose = render(value, container);
    dispose();
    setValue("second");
    flushSync();
    expect(container.childNodes.length).toBe(0);
    expect(() => dispose()).not.toThrow();
  });

  it("[RND-04] rendering twice into the same container appends, and each dispose removes only its own nodes", () => {
    const container = mount();
    const disposeA = render(() => "a", container);
    const disposeB = render(() => "b", container);
    expect(container.textContent).toBe("ab");
    disposeA();
    expect(container.textContent).toBe("b");
    disposeB();
    expect(container.childNodes.length).toBe(0);
  });

  it("[RND-05] code runs once; an accessor it returns updates the output until disposed", () => {
    const container = mount();
    const [value, setValue] = useSignal("x");
    let runs = 0;
    render(() => {
      runs += 1;
      return value;
    }, container);
    setValue("y");
    flushSync();
    expect(container.textContent).toBe("y");
    expect(runs).toBe(1);
  });

  it("[RND-06] arrays with nodes and text render in order", () => {
    const container = mount();
    const span = document.createElement("span");
    render(() => [span, "t"], container);
    expect(shape(container)).toEqual(["span", "#t:t"]);
  });

  it("[RND-07] the rendered tree never contains comment nodes", () => {
    const container = mount();
    render(() => [document.createElement("i"), null, "text"], container);
    expect(hasComment(container)).toBe(false);
  });

  it("[RND-08] a DocumentFragment works as a container", () => {
    const fragment = document.createDocumentFragment();
    render(() => "in fragment", fragment);
    expect(fragment.textContent).toBe("in fragment");
  });

  it("[RND-09] rendering into a container with children appends after them", () => {
    const container = mount();
    container.appendChild(document.createElement("hr"));
    render(() => "after", container);
    expect(shape(container)).toEqual(["hr", "#t:after"]);
  });
});

describe("use()", () => {
  it("[USE-01] calls fn(el, accessor): the directive reads the argument where it wants", () => {
    const el = mount();
    const fn = vi.fn((node: Element, value: () => string) => {
      node.setAttribute("data-value", value());
    });
    use(fn, el, () => "v");
    expect(el.getAttribute("data-value")).toBe("v");
    expect(fn.mock.calls[0]?.[0]).toBe(el);
  });

  it("[USE-02] the accessor is not read by use() itself, so an enclosing effect is not re-run", () => {
    const el = mount();
    const [value, setValue] = useSignal(1);
    let runs = 0;
    createRoot(() => {
      useRenderEffect(() => {
        runs += 1;
        use(
          () => undefined,
          el,
          () => value(),
        );
      });
    });
    setValue(2);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[USE-03] the directive function itself runs untracked", () => {
    const el = mount();
    const [value, setValue] = useSignal(1);
    let runs = 0;
    createRoot(() => {
      useRenderEffect(() => {
        runs += 1;
        use(
          () => {
            value();
          },
          el,
          () => 0,
        );
      });
    });
    setValue(2);
    flushSync();
    expect(runs).toBe(1);
  });
});

describe("createComponent()", () => {
  it("[CMP-01] calls the component with the same props object and returns its output", () => {
    const props = { title: "t" };
    const seen: unknown[] = [];
    const result = createComponent((received: { title: string }) => {
      seen.push(received);
      return `title:${received.title}`;
    }, props);
    expect(result).toBe("title:t");
    expect(seen[0]).toBe(props);
  });

  it("[CMP-02] the component runs untracked inside the enclosing effect", () => {
    const [value, setValue] = useSignal(1);
    let runs = 0;
    createRoot(() => {
      useRenderEffect(() => {
        runs += 1;
        createComponent(() => value(), {});
      });
    });
    setValue(2);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[CMP-03] cleanups registered by a component belong to the current owner", () => {
    const cleanup = vi.fn();
    let dispose: () => void = () => undefined;
    createRoot((stop) => {
      dispose = stop;
      createComponent(() => {
        onCleanup(cleanup);
        return null;
      }, {});
    });
    dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("[CMP-04] an optional devtools name is recorded for the component and returned output is unchanged", () => {
    const component = (): string => "named";
    const result = createComponent(component, {}, "Named");
    expect(result).toBe("named");
    expect(componentName(component)).toBe("Named");
  });
});

describe("effect() and memo()", () => {
  it("[EFF-01] effect(fn) runs synchronously, cleans up before each re-run, and cleans up on dispose", () => {
    const [value, setValue] = useSignal(0);
    const log: string[] = [];
    let dispose: () => void = () => undefined;
    createRoot((stop) => {
      dispose = stop;
      effect(() => {
        const current = value();
        log.push(`run${current}`);
        return () => {
          log.push(`clean${current}`);
        };
      });
    });
    expect(log).toEqual(["run0"]);
    setValue(1);
    flushSync();
    expect(log).toEqual(["run0", "clean0", "run1"]);
    dispose();
    expect(log).toEqual(["run0", "clean0", "run1", "clean1"]);
  });

  it("[EFF-02] effect(compute, apply) receives the value and the previous value", () => {
    const [value, setValue] = useSignal(0);
    const seen: Array<[number, number | undefined]> = [];
    createRoot(() => {
      effect(
        () => value(),
        (current, previous) => {
          seen.push([current, previous]);
        },
      );
    });
    setValue(1);
    flushSync();
    expect(seen).toEqual([
      [0, undefined],
      [1, 0],
    ]);
  });

  it("[EFF-03] memo caches its value until a dependency changes", () => {
    const [value, setValue] = useSignal(2);
    let calls = 0;
    let doubled: (() => number) | undefined;
    createRoot(() => {
      doubled = memo(() => {
        calls += 1;
        return value() * 2;
      });
    });
    const read = doubled ?? (() => -1);
    expect(read()).toBe(4);
    expect(read()).toBe(4);
    expect(calls).toBe(1);
    setValue(5);
    flushSync();
    expect(read()).toBe(10);
    expect(calls).toBe(2);
  });
});
