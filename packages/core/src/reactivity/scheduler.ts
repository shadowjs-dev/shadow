/**
 * ShadowJS Effect Scheduler
 *
 * This module provides asynchronous effect scheduling for ShadowJS's reactive system.
 * It batches and defers effect execution to optimize performance and prevent redundant updates.
 *
 * The scheduler uses microtask queuing to ensure effects run after the current synchronous
 * execution context completes, allowing multiple related changes to batch together.
 *
 * @example
 * ```typescript
 * import { scheduleEffect } from "./scheduler";
 *
 * // Effects are batched and run asynchronously
 * scheduleEffect(() => console.log("Effect 1"));
 * scheduleEffect(() => console.log("Effect 2"));
 *
 * // Both effects will run in the same microtask
 * console.log("Synchronous code");
 * ```
 */

// Flag to track if a flush is already scheduled
let pending = false;

/**
 * Queue of effect functions waiting to be executed.
 * Using Set to prevent duplicate effects from being scheduled.
 */
const queue = new Set<() => void>();

/**
 * Flush the effect queue by executing all scheduled effects.
 *
 * This function:
 * 1. Resets the pending flag
 * 2. Creates a snapshot of current queued effects
 * 3. Clears the queue to prevent infinite loops
 * 4. Executes each effect, swallowing any errors to prevent one bad effect from breaking others
 *
 * @internal
 */
function flush() {
  pending = false;
  const tasks = Array.from(queue);
  queue.clear();
  for (const fn of tasks) {
    try {
      fn();
    } catch {
      // Silently swallow effect errors to prevent one bad effect
      // from breaking the entire reactive system. Effects should
      // handle their own error boundaries if needed.
    }
  }
}

/**
 * Schedule an effect to run asynchronously in the next microtask.
 *
 * Effects are batched together and executed after the current synchronous
 * execution context completes. This prevents redundant re-renders and
 * improves performance by grouping related updates.
 *
 * If multiple effects are scheduled in the same execution context,
 * they will all run together in a single microtask, ensuring consistency.
 *
 * @param fn - Effect function to execute asynchronously
 *
 * @example
 * ```typescript
 * // Effects are automatically batched
 * scheduleEffect(() => updateComponent1());
 * scheduleEffect(() => updateComponent2());
 *
 * // Both effects run together after synchronous code completes
 * doSyncWork();
 * ```
 */
export function scheduleEffect(fn: () => void) {
  queue.add(fn);
  if (!pending) {
    pending = true;
    queueMicrotask(flush);
  }
}

/**
 * Optional batching utility for synchronous operations.
 *
 * Currently this is a simple passthrough since ShadowJS's reactive system
 * already provides natural batching through the effect scheduling mechanism.
 * The function is provided for API compatibility and future enhancements.
 *
 * @param fn - Function to execute, potentially with batched updates
 * @returns The return value of the executed function
 *
 * @example
 * ```typescript
 * const result = batch(() => {
 *   // Multiple reactive updates here will be batched automatically
 *   setCount(count() + 1);
 *   setName("Updated");
 *   return computeValue();
 * });
 * ```
 */
export function batch<T>(fn: () => T): T {
  // Simple batch: run fn; enqueued effects will flush in same tick anyway
  return fn();
}
