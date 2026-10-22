/**
 * The ShadowJS compiler: JSX into calls to the ShadowJS runtime, for the browser, for server rendering and for hydration.
 *
 * One package, three implementations of the same compiler, chosen once per process: the Rust addon (prebuilt for eight platforms, about
 * ten times faster on large apps), the same Rust code as WebAssembly, and the TypeScript implementation. They produce the same output
 * byte for byte and throw the same `CompileError`; {@link getBackend} tells which one runs. Browsers, workers and any other environment
 * without Node.js get the TypeScript implementation (`@shadow-js/compiler/javascript`) through the package conditions.
 *
 * @packageDocumentation
 */
export type {
  BackendInfo,
  CallExpressionNode,
  CompileOptions,
  CompileResult,
  CompilerPlugin,
  Diagnostic,
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
  Target,
  TemplateElementNode,
  TemplateLiteralNode,
  Visit,
  Visitor,
  VisitorEntry,
} from "./auto";
export {
  CompileError,
  compile,
  compileAsync,
  getBackend,
  validatePlugins,
} from "./auto";
