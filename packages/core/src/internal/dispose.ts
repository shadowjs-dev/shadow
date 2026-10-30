import type { Owner } from "./owner";
import { disposeTree as disposeSubtree } from "./owner";
import { hasPending } from "./queue";
import { flushThenThrow } from "./scheduler";
import { rt } from "./state";

/**
 * Disposes an owner and everything below it: children first, newest first, then each node's
 * cleanups, newest first. Use it to end an owner made with `createOwner`; disposing an owner that is
 * already disposed does nothing. Exported from `@shadow-js/core/extend` as `disposeOwner`.
 *
 * Cleanups run in an implicit batch (O-3): effects that depend on signals a cleanup wrote are
 * flushed before this returns, unless the disposal happens inside a computation, a batch or a flush,
 * whose own exit flushes.
 *
 * @param root The owner to dispose, with its whole subtree.
 * @throws The error of a cleanup that no error handler caught, once the whole tree is disposed
 * (several such errors are thrown together as an `AggregateError`); during a running flush, that
 * flush throws them instead. An error of the flush that
 * follows is thrown as is, or combined with the cleanup errors in an `AggregateError`.
 * @example
 * import { addCleanup, createOwner, disposeOwner } from "@shadow-js/core/extend";
 *
 * const owner = createOwner(null);
 * addCleanup(owner, () => console.log("released"));
 * disposeOwner(owner); // logs "released"
 * @see addCleanup
 * @since 1.0.0
 */
export function disposeTree(root: Owner): void {
  let failure: unknown;
  let failed = false;
  try {
    disposeSubtree(root);
  } catch (error) {
    failed = true;
    failure = error;
  }
  // Only the outermost disposal flushes: a nested one (a cleanup disposing another owner) would run
  // effects while the tree it sits in is half torn down.
  flushThenThrow(
    rt.running === null && rt.batches === 0 && rt.disposing === 0 && !rt.flushing && hasPending(),
    failed,
    failure,
    __DEV__ ? "Disposal and the following flush both threw." : "SHADOW_DISPOSE_FLUSH_ERRORS",
  );
}
