import { registerCleanup } from "../../runtime/lifecycle";
import { ERRORS } from "../../errors";

/**
 * The currently executing effect function (if any).
 * Stores use this to subscribe the effect when they are read.
 *
 * Important: this is a function reference (the effect runner),
 * not the user's callback.
 */
export let __currentEffect: (() => void) | null = null;

/**
 * While an effect is executing, each store read will:
 * - add __currentEffect to its subscriber Set<() => void>
 * - add its subscriber set to this collection so we can later unsubscribe
 *
 * This is a "set of sets": Set<Set<() => void>>
 */
export let __currentEffectDeps: Set<Set<() => void>> | null = null;

/**
 * Supports nested effects by keeping a stack and restoring parent on exit.
 */
const __effectStack: (() => void)[] = [];

/**
 * Create a reactive effect that re-runs whenever its dependencies change.
 *
 * Modes:
 * - Auto-tracked (no deps array): reads from stores inside fn() subscribe
 *   this effect automatically. Any store update re-runs the effect.
 * - Dep-tracked (deps array): fn() re-runs only when deps() values change.
 *   Stores read inside fn() are NOT tracked automatically in this mode.
 *
 * Cleanup:
 * - If fn() returns a function, it runs before next run and on unmount.
 *
 * Correctness details:
 * - We unsubscribe from the previously tracked stores BEFORE each re-run
 *   (both modes). This prevents "ghost" updates caused by stale subscriptions.
 */
export function useEffect(
  fn: () => void | (() => void),
  deps?: (() => unknown)[]
) {
  if (typeof fn !== "function") {
    throw ERRORS.HOOK_INVALID_ARGUMENT("useEffect", "fn", "function");
  }
  if (deps !== undefined) {
    if (!Array.isArray(deps) || deps.some((d) => typeof d !== "function")) {
      throw ERRORS.HOOK_INVALID_DEPS("useEffect");
    }
  }

  // Last evaluated dep() values for deps mode
  let lastDepsValues: unknown[] = [];
  let isInitialized = false;

  // User-provided cleanup returned by fn()
  let userCleanup: (() => void) | null = null;
  const runUserCleanup = () => {
    if (userCleanup) {
      try {
        userCleanup();
      } catch {
        // ignore cleanup errors
      }
      userCleanup = null;
    }
  };

  // Compare deps for deps mode
  function hasDepChanged(): boolean {
    if (!deps) return true;
    const current = deps.map((dep) => dep());
    if (lastDepsValues.length !== current.length) {
      lastDepsValues = current;
      return true;
    }
    for (let i = 0; i < current.length; i++) {
      if (current[i] !== lastDepsValues[i]) {
        lastDepsValues = current;
        return true;
      }
    }
    return false;
  }

  // The last sets of store subscribers this effect was added to.
  // We keep them to unsubscribe before the next run and on unmount.
  let latestDepsSetsForAuto: Set<Set<() => void>> = new Set();
  let latestDepsSetsForDep: Set<Set<() => void>> = new Set();

  // Helper: unsubscribe a given effect function from all recorded sets
  const unsubscribeSets = (
    sets: Set<Set<() => void>>,
    effectFn: () => void
  ) => {
    sets.forEach((s) => s.delete(effectFn));
  };

  /**
   * Auto-tracked runner (no deps array):
   * - Unsubscribes from previous stores before re-run
   * - Runs in "tracking mode" so store reads subscribe this runner
   */
  const execute = () => {
    if (!deps) {
      // Unsubscribe this effect from previous stores before collecting new ones
      unsubscribeSets(latestDepsSetsForAuto, execute);
    }

    if (deps) {
      // Deps mode: do not auto-track stores during fn(); deps() drive re-runs
      if (!isInitialized) {
        isInitialized = true;
        lastDepsValues = deps.map((dep) => dep());
        const ret = fn();
        if (typeof ret === "function") userCleanup = ret;
      } else if (hasDepChanged()) {
        runUserCleanup();
        const ret = fn();
        if (typeof ret === "function") userCleanup = ret;
      }
    } else {
      // Auto-tracked mode: collect store subscriptions during fn()
      runUserCleanup();
      __currentEffect = execute;
      __effectStack.push(execute);
      __currentEffectDeps = new Set();
      try {
        const ret = fn();
        if (typeof ret === "function") userCleanup = ret;
      } finally {
        // Save the sets of subscribers we were added to
        latestDepsSetsForAuto = __currentEffectDeps!;
        __currentEffectDeps = null;
        __effectStack.pop();
        __currentEffect = __effectStack[__effectStack.length - 1] || null;
      }
    }
  };

  if (deps) {
    /**
     * Dep-tracked runner:
     * - Runs deps() in tracking mode to subscribe to only those stores
     * - Unsubscribes from previous dep store sets before re-collecting
     * - Calls execute() when deps values actually change
     */
    const depEffect = () => {
      // Unsubscribe this depEffect from previous deps-store sets
      unsubscribeSets(latestDepsSetsForDep, depEffect);

      __currentEffect = depEffect;
      __effectStack.push(depEffect);
      __currentEffectDeps = new Set();
      try {
        // Reading deps() here subscribes depEffect to any stores they touch
        deps!.forEach((dep) => dep());
        // Keep latest sets to allow unsubscription on next run/unmount
        latestDepsSetsForDep = __currentEffectDeps!;
        if (!isInitialized || hasDepChanged()) {
          execute();
        }
      } finally {
        __currentEffectDeps = null;
        __effectStack.pop();
        __currentEffect = __effectStack[__effectStack.length - 1] || null;
      }
    };

    // Initial run
    depEffect();

    // On unmount: unsubscribe from last deps sets and run user's cleanup
    registerCleanup(() => {
      unsubscribeSets(latestDepsSetsForDep, depEffect);
      runUserCleanup();
    });

    return depEffect;
  } else {
    // Initial run for auto-tracked effects
    execute();

    // On unmount: unsubscribe and run user's cleanup
    registerCleanup(() => {
      unsubscribeSets(latestDepsSetsForAuto, execute);
      runUserCleanup();
    });

    return execute;
  }
}

/**
 * Read reactive values without subscribing the current effect.
 * Use this to compute DOM for reactive sections without making the
 * outer effect depend on inner component stores.
 */
export function untrack<T>(fn: () => T): T {
  const prevEffect = __currentEffect;
  const prevDeps = __currentEffectDeps;
  __currentEffect = null;
  __currentEffectDeps = null;
  try {
    return fn();
  } finally {
    __currentEffect = prevEffect;
    __currentEffectDeps = prevDeps;
  }
}
