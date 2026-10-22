/**
 * The value a reader throws when a transition reads data that is still loading inside a Suspense
 * boundary that is showing content. The reader keeps its previous value (a memo keeps its value, an
 * effect leaves the DOM as it is) until the boundary releases it. A single frozen object: identity is
 * the test, so user code cannot forge it. {@link holdReader} throws it for you; a custom primitive
 * that catches errors must let it through, which {@link isSuspension} checks.
 *
 * @example
 * import { SUSPENSION } from "@shadow-js/core/extend";
 *
 * function rethrowIfHeld(error: unknown): void {
 *   if (error === SUSPENSION) throw error; // not a failure: the boundary resumes the reader later
 * }
 * @see isSuspension
 * @since 1.0.0
 */
export const SUSPENSION: { readonly suspended: true } = /* @__PURE__ */ Object.freeze({
  suspended: true as const,
});

/**
 * Tells whether a caught value is the suspension sentinel rather than an error. Use it in a custom
 * primitive's `catch` so a transition's held read is passed on instead of being reported as a
 * failure.
 *
 * @param value The caught value.
 * @returns True when `value` is {@link SUSPENSION}.
 * @example
 * import { isSuspension } from "@shadow-js/core/extend";
 *
 * function attempt(run: () => void, onError: (error: unknown) => void): void {
 *   try {
 *     run();
 *   } catch (error) {
 *     if (isSuspension(error)) throw error;
 *     onError(error);
 *   }
 * }
 * @since 1.0.0
 */
export function isSuspension(value: unknown): boolean {
  return value === SUSPENSION;
}
