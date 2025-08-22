let globalIdCounter = 0;

/**
 * Generates the next unique ID string.
 */
function generateNextId(): string {
  globalIdCounter += 1;
  return String(globalIdCounter);
}

/**
 * Return a stable, globally unique id string for use in attributes
 * like `id` and `for`. Client-only counter-based implementation.
 *
 * @example
 * const id = useId();
 * <label for={id}>Name</label>
 * <input id={id} />
 *
 * @returns A unique id string, e.g., "sfid-1"
 */
export function useId(): string {
  const next = generateNextId();
  return `sfid-${next}`;
}
