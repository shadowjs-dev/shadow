/**
 * The TypeScript implementation of the compiler on its own (`@shadow-js/compiler/javascript`): no native addon, no WebAssembly and no
 * Node.js API, so it runs in a browser, a worker or any other environment, and a bundler that imports only this entry includes nothing
 * of the other implementations. It is the reference the Rust implementation is tested against, and the answer for what the Rust
 * implementation does not handle (compiler plugins).
 *
 * @packageDocumentation
 */
import type { BackendInfo } from "./backend-info";
import { type CompileOptions, type CompileResult, compile } from "./internal/assemble";

export type { BackendInfo } from "./backend-info";
export type { CompileOptions, CompileResult, Target } from "./internal/assemble";
export type { Diagnostic } from "./internal/diagnostics";
export { CompileError } from "./internal/diagnostics";
export type {
  CallExpressionNode,
  CompilerPlugin,
  IdentifierNode,
  ImportDeclarationNode,
  JSXAttributeNode,
  JSXElementNode,
  JSXExpressionContainerNode,
  JSXFragmentNode,
  JSXIdentifierNode,
  JSXMemberExpressionNode,
  JSXNamespacedNameNode,
  JSXOpeningElementNode,
  JSXSpreadAttributeNode,
  JSXTextNode,
  LiteralNode,
  MemberExpressionNode,
  NodeFactory,
  NodeMap,
  ObjectExpressionNode,
  PluginContext,
  PluginDiagnostic,
  PluginImport,
  PluginNode,
  PluginRange,
  PluginStage,
  ProgramNode,
  PropertyNode,
  TemplateElementNode,
  TemplateLiteralNode,
  Visit,
  Visitor,
  VisitorEntry,
} from "./internal/plugin-types";
export { validatePlugins } from "./internal/plugins";
export { compile };
/**
 * Tells which implementation {@link compile} uses. Here it is always the TypeScript implementation; the entry that chooses between
 * the Rust addon, WebAssembly and TypeScript is `@shadow-js/compiler`, which has the same name and the same shape.
 *
 * @returns `{ name: "javascript", source: "@shadow-js/compiler", notes: [] }`.
 * @example
 * import { getBackend } from "@shadow-js/compiler/javascript";
 *
 * console.log(getBackend().name); // "javascript"
 * @since 1.0.0
 */
export function getBackend(): BackendInfo {
  return { name: "javascript", source: "@shadow-js/compiler", notes: [] };
}

/**
 * Compiles a module without blocking the caller's turn: the promise settles with what `compile` would have returned, or rejects with
 * the {@link CompileError} it would have thrown. It exists so that code written for `@shadow-js/compiler` runs unchanged on this entry.
 *
 * @param source Module text to compile.
 * @param options What to generate and how; see {@link CompileOptions}.
 * @returns A promise of the result.
 * @example
 * import { compileAsync } from "@shadow-js/compiler/javascript";
 *
 * const result = await compileAsync("export const A = () => <b>x</b>;");
 * console.log(result.transformed); // true
 * @see compile
 * @since 1.0.0
 */
export async function compileAsync(
  source: string,
  options?: CompileOptions,
): Promise<CompileResult> {
  return compile(source, options);
}
