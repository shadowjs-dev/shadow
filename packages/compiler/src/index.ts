/**
 * Shadow JSX Compiler
 *
 * This package provides compilation utilities that transform JSX code into
 * Shadow-compatible reactive expressions. The compiler performs static analysis
 * and transformation of source code to enable Shadow's reactive programming model.
 *
 * Key Features:
 * - **JSX Expression Wrapping**: Automatically wraps JSX expressions in reactive functions
 * - **Ref Handling**: Converts ref attributes to assignment functions
 * - **Control Flow Enhancement**: Wraps conditions in Show/Match/For components
 * - **Style Object Reactivity**: Makes style objects reactive
 * - **Recursive Processing**: Handles nested JSX and function expressions
 *
 * The compiler is designed to work with Vite and other build tools that support
 * custom transformers. It processes source code before it reaches the Shadow runtime,
 * enabling compile-time optimizations and better developer experience.
 *
 * @example
 * ```typescript
 * import { transformSource } from "shadow-compiler";
 *
 * const sourceCode = `
 *   const App = () => (
 *     <div>
 *       <Show when={count() > 0}>
 *         <div>Count: {count()}</div>
 *       </Show>
 *     </div>
 *   );
 * `;
 *
 * const transformed = transformSource(sourceCode);
 * console.log(transformed);
 * ```
 */

// Main compiler entry point
export { transformSource } from "./transformSource";
