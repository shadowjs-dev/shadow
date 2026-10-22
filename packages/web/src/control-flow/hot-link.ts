import { getOwner, type Owner } from "@shadow-js/core";
import type { ModuleRegistry } from "../hmr";

/**
 * The hot-update link between an error boundary and the modules its children were built from. Dev
 * only: the callers reach this code behind `__DEV__`, so production bundles never include it.
 *
 * A boundary that shows its fallback listens to those modules. When one of them is hot-replaced (the
 * edit is usually the fix), the boundary resets and builds its children again, so the user does not
 * have to press retry. The same module set is kept while the children are built: each component instance
 * adds its module to it when it is created (`hotModulesOf` in the proxy of `component()`).
 */

/** The key the module set is stored under in the owner context of a boundary's children. */
const HOT_MODULES: symbol = /* @__PURE__ */ Symbol("HotModules");

/**
 * Makes `modules` the set of the root that is being created (called inside its `createRoot`): every
 * component created below that root adds its module to it.
 * @internal
 */
export function attachHotModules(modules: Set<ModuleRegistry>): void {
  const root = getOwner();
  if (root === null) return;
  const map = Object.create(root.context) as Record<symbol, unknown>;
  map[HOT_MODULES] = modules;
  root.context = map;
}

/**
 * The module set of the nearest boundary above `owner`, or undefined when there is none.
 * @internal
 */
export function hotModulesOf(owner: Owner | null): Set<ModuleRegistry> | undefined {
  return owner?.context?.[HOT_MODULES] as Set<ModuleRegistry> | undefined;
}

/**
 * The link of one boundary: the modules its children were last built from, and the listener armed on
 * them while the boundary shows its fallback.
 * @internal
 */
export interface HotLink {
  /** The modules of the last children build. Cleared by the boundary before each build. */
  readonly modules: Set<ModuleRegistry>;
  /** Listens to every module in `modules`: a hot update of one of them calls the boundary's `onUpdate`. */
  arm(): void;
  /** Stops listening (the children built, or the boundary was disposed). */
  disarm(): void;
}

/**
 * Creates the link of a boundary. `onUpdate` runs after a hot update of a module the boundary listens to,
 * once the update is applied.
 * @internal
 */
export function createHotLink(onUpdate: () => void): HotLink {
  const modules = new Set<ModuleRegistry>();
  let armed: ModuleRegistry[] = [];
  const listener = (): void => {
    onUpdate();
  };
  const disarm = (): void => {
    for (const registry of armed) registry.listeners.delete(listener);
    armed = [];
  };
  const arm = (): void => {
    disarm();
    for (const registry of modules) {
      registry.listeners.add(listener);
      armed.push(registry);
    }
  };
  return { modules, arm, disarm };
}
