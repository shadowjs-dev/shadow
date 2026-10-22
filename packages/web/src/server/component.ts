import { untrack } from "@shadow-js/core";
import { createOwner, runInScope } from "@shadow-js/core/extend";
import { currentScope, enterComponent } from "../internal/hydration-scope";

/**
 * Calls a component on the server, untracked, with its own owner and hydration scope, so the
 * hydration keys it hands out depend only on where it sits in the tree. The server twin of the client
 * `createComponent`: compiled server output calls it for `<Component />`, and a hand-written render
 * entry calls it for the root component.
 *
 * @param component The component function.
 * @param props The props object; reactive props are getters.
 * @returns Whatever the component returns.
 * @throws TypeError when `component` is not a function. An error the component throws propagates.
 * @example
 * import { createComponent, renderToString } from "@shadow-js/web/server";
 *
 * function Card(props: { title: string }) {
 *   return <h2>{props.title}</h2>;
 * }
 * const html = renderToString(() => createComponent(Card, { title: "Hello" }));
 * @since 1.0.0
 */
export function createComponent<P>(component: (props: P) => unknown, props: P): unknown {
  if (typeof component !== "function") {
    throw new TypeError("createComponent(): the component must be a function.");
  }
  return enterComponent(() => {
    // The same owner structure as the browser, so `useId` prefixes agree (see the DOM createComponent).
    const owner = createOwner();
    owner.idPrefix = currentScope()?.id;
    // One scope switch (owner in, listener off): deep component trees are bounded by the call stack.
    return runInScope({ owner, listener: null }, () => component(props));
  });
}

/**
 * The server twin of `memo`: nothing is reactive during a server render, so it computes once, on the
 * first read, and returns the cached value on every later read. A call that throws is not cached
 * (the next read runs `fn` again).
 *
 * @param fn The computation; runs untracked, on the first read.
 * @returns An accessor of the cached value.
 * @throws TypeError from the accessor when `fn` reads the accessor itself while it runs, instead of
 * recursing. An error `fn` throws propagates from the read.
 * @example
 * import { memo } from "@shadow-js/web/server";
 *
 * const items = [3, 1, 2];
 * const sorted = memo(() => [...items].sort());
 * sorted(); // [1, 2, 3], computed now
 * sorted(); // the same array, cached
 * @since 1.0.0
 */
export function memo<T>(fn: () => T): () => T {
  let slot: { readonly value: T } | undefined;
  let running = false;
  return () => {
    if (slot !== undefined) return slot.value;
    if (running) throw new TypeError("memo(): the computation read itself.");
    running = true;
    try {
      const value = untrack(fn);
      slot = { value };
      return value;
    } finally {
      running = false;
    }
  };
}
