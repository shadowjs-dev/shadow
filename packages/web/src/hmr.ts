import { batch, getOwner, untrack, useSignal } from "@shadow-js/core";
import { createComputation, readComputation } from "@shadow-js/core/extend";
import { hotModulesOf } from "./control-flow/hot-link";

/**
 * The subset of Vite's `import.meta.hot` the runtime uses. The compiled output passes
 * `import.meta.hot` to `registry`, so any object with these three members works (a test runner can
 * supply its own).
 * @since 1.0.0
 */
export interface HotContext {
  /** Data kept across hot updates of the module: values stored in a `dispose` callback arrive here. */
  readonly data: Record<string, unknown>;
  /** Declares that the module accepts its own update, so the page is not reloaded. */
  accept(): void;
  /** Registers a callback that runs before the module is replaced and may store values in `data`. */
  dispose(callback: (data: Record<string, unknown>) => void): void;
}

type ComponentFunction = (props: never) => unknown;

interface Entry {
  implementation: ComponentFunction;
  readonly version: () => number;
  readonly bump: () => void;
  readonly proxy: ComponentFunction;
  dirty: boolean;
}

const REGISTRY_KEY = "shadowjs:hmr-registry";

/**
 * The components of one module, kept across hot updates. Instances are created through a stable
 * proxy that follows the current implementation, so an edit re-renders only the edited component's
 * instances; parents and siblings keep their state. Produced by `registry`; the compiled output
 * of a development build is its only user.
 *
 * @example
 * import { type HotContext, registry } from "@shadow-js/web/hmr";
 *
 * declare const hot: HotContext | undefined;
 * const modules = registry(hot, "src/app.tsx");
 * console.log(modules.managed); // false when there is no hot context (production, server)
 * @see registry
 * @since 1.0.0
 */
export class ModuleRegistry {
  /** The components of the module by name, each with the proxy instances are created through. */
  readonly entries: Map<string, Entry> = new Map<string, Entry>();
  /** True when the module can hot update (a hot context was given); false makes the registry inert. */
  readonly managed: boolean;
  /**
   * Told after each update of this module, once its components are re-rendered. An error boundary
   * that shows its fallback listens here, so the edit that fixes its error rebuilds its children.
   */
  readonly listeners: Set<() => void> = new Set<() => void>();

  /**
   * Creates an empty registry.
   *
   * @param managed Whether the module can hot update. When false, `component` returns each
   * implementation unchanged.
   */
  constructor(managed: boolean) {
    this.managed = managed;
  }

  /**
   * Re-renders every instance of the components replaced during the last module evaluation, then tells
   * the listeners. The listeners are read before the re-render: a boundary that starts listening because
   * this very update failed is not reset by it.
   */
  commit(): void {
    const listening = [...this.listeners];
    batch(() => {
      for (const entry of this.entries.values()) {
        if (!entry.dirty) continue;
        entry.dirty = false;
        entry.bump();
      }
    });
    for (const listener of listening) listener();
  }
}

/**
 * Returns the registry of the module identified by `hot`, reusing the one from the previous
 * evaluation of the same module. Without `hot` (production, server) the registry is inert.
 * @internal
 */
export function registry(hot: HotContext | undefined, _id: string): ModuleRegistry {
  // A test runner may define `import.meta.hot` without a `data` bag: nothing can hot update there.
  if (hot === undefined || typeof hot.data !== "object" || hot.data === null) {
    return new ModuleRegistry(false);
  }
  const previous = hot.data[REGISTRY_KEY];
  if (previous instanceof ModuleRegistry) return previous;
  const created = new ModuleRegistry(true);
  hot.dispose((data) => {
    data[REGISTRY_KEY] = created;
  });
  return created;
}

/**
 * Registers a component implementation and returns the function to use in its place. On the first
 * evaluation that is a proxy; on later evaluations the same proxy, now backed by the new code.
 * @internal
 */
export function component<P>(
  reg: ModuleRegistry,
  name: string,
  implementation: (props: P) => unknown,
): (props: P) => unknown {
  if (!reg.managed) return implementation;
  const existing = reg.entries.get(name);
  if (existing !== undefined) {
    existing.implementation = implementation as ComponentFunction;
    existing.dirty = true;
    return existing.proxy as (props: P) => unknown;
  }
  const [version, setVersion] = useSignal(0);
  const entry: Entry = {
    implementation: implementation as ComponentFunction,
    version,
    bump: () => {
      setVersion((n) => n + 1);
    },
    proxy: undefined as unknown as ComponentFunction,
    dirty: false,
  };
  const proxy = (props: P): (() => unknown) => {
    // The error boundary above this instance (if any) learns that its children come from this module.
    hotModulesOf(getOwner())?.add(reg);
    // A memo per instance: an update re-renders this component only, not the arrays or regions
    // that merely contain it. It runs component setup, which may write state it owns.
    const node = createComputation({
      kind: "memo",
      allowWrites: true,
      fn: () => {
        entry.version();
        return untrack(() => (entry.implementation as (props: P) => unknown)(props));
      },
    });
    return () => readComputation<unknown>(node);
  };
  Object.defineProperty(proxy, "name", { value: name });
  (entry as { proxy: ComponentFunction }).proxy = proxy as unknown as ComponentFunction;
  reg.entries.set(name, entry);
  return proxy;
}

/**
 * Marks the module as able to update itself and applies the replaced components.
 * @internal
 */
export function accept(hot: HotContext | undefined, reg: ModuleRegistry): void {
  if (hot === undefined || !reg.managed) return;
  hot.accept();
  reg.commit();
}
