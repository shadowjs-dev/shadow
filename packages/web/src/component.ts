import {
  addCleanup,
  createOwner,
  DEVTOOLS_EVENT,
  devtoolsReport,
  runInScope,
} from "@shadow-js/core/extend";
import { currentScope, enterComponent } from "./internal/hydration-scope";

/** Dev-only: the name each component was created with, for devtools. Weak, so components are not kept alive. */
const componentNames = new WeakMap<object, string>();

/**
 * Calls a component untracked, under a new owner that is a child of the current one: cleanups and
 * effects it creates are disposed with the enclosing scope. The name, given in development builds,
 * is recorded for devtools.
 *
 * @param component The component function.
 * @param props The props object (usually with getters for reactive props).
 * @param name Optional devtools name.
 * @returns Whatever the component returns.
 * @example
 * import { createComponent } from "@shadow-js/web";
 *
 * function Counter(props: { start: number }) {
 *   return `Count: ${props.start}`;
 * }
 *
 * const view = createComponent(Counter, { start: 0 }, "Counter");
 * @since 1.0.0
 */
export function createComponent<P>(
  component: (props: P) => unknown,
  props: P,
  name?: string,
): unknown {
  if (__DEV__ && name !== undefined) componentNames.set(component, name);
  return enterComponent(() => {
    // Every component runs under an owner of its own: devtools attribute updates to it, and
    // `useId` uses its hydration-scope key as a prefix, so ids agree between server and browser
    // even though the browser creates more owners (effects) than the server does.
    const owner = createOwner();
    owner.idPrefix = currentScope()?.id;
    // One scope switch (owner in, listener off): deep component trees are bounded by the call stack.
    const result = runInScope({ owner, listener: null }, () => component(props));
    if (__DEV__) {
      devtoolsReport(
        DEVTOOLS_EVENT.COMPONENT_MOUNTED,
        owner,
        componentNames.get(component),
        result,
      );
      addCleanup(owner, () => devtoolsReport(DEVTOOLS_EVENT.COMPONENT_UNMOUNTED, owner));
    }
    return result;
  });
}

/**
 * The devtools name recorded for a component in development builds, if any.
 * @internal
 */
export function componentName(component: object): string | undefined {
  return componentNames.get(component);
}
