import { getCurrentScope } from "../../runtime/lifecycle";
import { ERRORS } from "../../errors";

/**
 * Run a function once when the component is first invoked.
 *
 * Note: This is synchronous and runs during component execution.
 *
 * @param fn The function to run once on mount.
 */
export function onMount(fn: () => void): void {
  if (typeof fn !== "function") {
    throw ERRORS.HOOK_INVALID_ARGUMENT("onMount", "fn", "function");
  }
  if (!getCurrentScope()) {
    throw ERRORS.HOOK_OUTSIDE_COMPONENT("onMount");
  }
  fn();
}
