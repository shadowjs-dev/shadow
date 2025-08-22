/**
 * Centralized error factories for ShadowJS.
 *
 * Use these to throw consistent errors across the runtime.
 */
export const ERRORS = {
  // --- render ---
  RENDER_CONTAINER_REQUIRED: () =>
    new Error("Container element is required for rendering"),
  RENDER_INVALID_COMPONENT: () =>
    new Error("Invalid component type. Must be a function or DOM element"),
  RENDER_INVALID_RETURN: () =>
    new Error("Component must return a valid DOM element"),

  // --- portal ---
  PORTAL_MOUNT_REQUIRED: () => new Error("Portal: 'mount' element is required"),

  // --- for (each-only) ---
  FOR_CHILDREN_MUST_BE_FUNCTION: () =>
    new Error("<For> requires function children."),
  FOR_EACH_REQUIRES_ARRAY: () =>
    new Error("<For each> expects an array (or function returning an array)."),

  // --- show ---
  SHOW_INVALID_WHEN: () =>
    new Error(
      "<Show> 'when' must be a boolean or a function returning a boolean."
    ),

  // --- switch ---
  SWITCH_NO_CHILDREN_OR_FALLBACK: () =>
    new Error(
      "<Switch> requires at least one <Match when> child or a 'fallback'."
    ),

  // --- jsx ---
  JSX_INVALID_TAG: (tag: unknown) =>
    new Error(
      `Invalid JSX tag: expected a string (intrinsic) or function component, received ${typeof tag}`
    ),

  // --- lazy ---
  LAZY_INVALID_EXPORT: () =>
    new Error("Lazy component must have a default export or be a function"),
  LAZY_FAILED_AFTER_ATTEMPTS: (retries: number, reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    return new Error(
      `Failed to load lazy component after ${retries} attempts: ${msg}`
    );
  },

  // --- hooks ---
  HOOK_OUTSIDE_COMPONENT: (name: string) =>
    new Error(`${name} must be called during a component's execution`),
  HOOK_INVALID_DEPS: (name: string) =>
    new Error(`${name}: 'deps' must be an array of functions`),
  HOOK_INVALID_REDUCER: (name: string) =>
    new Error(`${name}: 'reducer' must be a function`),
  HOOK_INVALID_ARGUMENT: (hook: string, argName: string, expected: string) =>
    new Error(`${hook}: '${argName}' must be a ${expected}`),
} as const;
