import { transformAllReturnParens } from "./transformAllReturnParens";
import { transformArrowImplicitBodies } from "./transformArrowImplicitBodies";

/**
 * Main entry point for Shadow JSX compiler transformations.
 *
 * This function applies a series of transformations to convert JSX code
 * into Shadow-compatible reactive expressions. The transformations include:
 *
 * 1. **Arrow Function Implicit Bodies**: Transforms JSX in arrow function bodies
 *    like `() => (<div>...</div>)` to inject reactive thunks
 *
 * 2. **Return Statement Parentheses**: Transforms JSX in return statements
 *    like `return (<div>...</div>)` to inject reactive thunks
 *
 * The compiler ensures that:
 * - JSX expressions become reactive functions
 * - Component refs are properly handled
 * - Style objects become reactive
 * - Control flow (Show, Match, For) conditions are wrapped in functions
 * - Child expressions are made reactive unless already functions
 *
 * @param code - Raw source code containing JSX to transform
 * @returns Transformed source code with Shadow-compatible reactive expressions
 * @throws Error if transformation fails with details about the failure
 *
 * @example
 * ```typescript
 * // Input
 * const App = () => (
 *   <div>
 *     <Show when={count() > 0} fallback={<div>No items</div>}>
 *       <div>Count: {count()}</div>
 *     </Show>
 *   </div>
 * );
 *
 * // Output (simplified)
 * const App = () => (
 *   <div>
 *     <Show when={() => count() > 0} fallback={() => <div>No items</div>}>
 *       <div>Count: {() => count()}</div>
 *     </Show>
 *   </div>
 * );
 * ```
 */
export function transformSource(code: string): string {
  try {
    let s = code;
    s = transformArrowImplicitBodies(s);
    s = transformAllReturnParens(s);
    return s;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`ShadowJS compiler: transform failed: ${msg}`);
  }
}
