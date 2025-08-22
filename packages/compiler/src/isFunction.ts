/**
 * Heuristic to check if a substring looks like a function or arrow func.
 */
export function isFunction(s: string) {
  return (
    /^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(s) ||
    /^function\b/.test(s)
  );
}
