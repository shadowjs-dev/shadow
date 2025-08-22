import { getCurrentScope, registerCleanup } from "../../runtime/lifecycle";
import { ERRORS } from "../../errors";

/**
 * Register a cleanup to run when the current component unmounts.
 *
 * @param fn Cleanup callback.
 */
export function onCleanup(fn: () => void): void {
  if (typeof fn !== "function") {
    throw ERRORS.HOOK_INVALID_ARGUMENT("onCleanup", "fn", "function");
  }
  if (!getCurrentScope()) {
    throw ERRORS.HOOK_OUTSIDE_COMPONENT("onCleanup");
  }
  registerCleanup(fn);
}
