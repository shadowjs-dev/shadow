/**
 * Types of the compiler plugin API. A plugin runs in the build, reads the syntax tree of one module
 * and changes its text through edits; see {@link CompilerPlugin}.
 * @packageDocumentation
 */

/**
 * When a plugin runs: `"pre"` on the tree of the source, before every compiler pass, `"post"` on
 * the tree of the generated code.
 * @since 1.0.0
 */
export type PluginStage = "pre" | "post";

/**
 * A syntax tree node: ESTree plus the JSX nodes of the parser. `start` and `end` are UTF-16 offsets
 * into {@link PluginContext.source}. Other properties are reached by name; the node interfaces of
 * {@link NodeMap} describe the common ones. The tree is read-only in practice: changing a node has
 * no effect, because the compiler never reads it back. Use the edits of {@link PluginContext}.
 * @since 1.0.0
 */
export interface PluginNode {
  /** The node type, such as `"Identifier"` or `"JSXElement"`. */
  readonly type: string;
  /** Offset of the first code unit of the node. */
  readonly start: number;
  /** Offset just after the last code unit of the node. */
  readonly end: number;
  /** Any other property of the node. */
  readonly [key: string]: unknown;
}

/**
 * A span of {@link PluginContext.source}: a {@link PluginNode}, or any object with `start` and `end`.
 * @since 1.0.0
 */
export interface PluginRange {
  /** Offset of the first code unit of the span. */
  readonly start: number;
  /** Offset just after the last code unit of the span. */
  readonly end: number;
}

/**
 * The root of a module's tree.
 * @since 1.0.0
 */
export interface ProgramNode extends PluginNode {
  /** `"Program"`. */
  readonly type: "Program";
  /** The statements of the module, in source order. */
  readonly body: readonly PluginNode[];
}

/**
 * An identifier reference, binding or property name.
 * @since 1.0.0
 */
export interface IdentifierNode extends PluginNode {
  /** `"Identifier"`. */
  readonly type: "Identifier";
  /** The name as written. */
  readonly name: string;
}

/**
 * A string, number, boolean, `null`, bigint or regular expression literal.
 * @since 1.0.0
 */
export interface LiteralNode extends PluginNode {
  /** `"Literal"`. */
  readonly type: "Literal";
  /** The value (a string for string literals, with escapes resolved). */
  readonly value: string | number | boolean | bigint | RegExp | null;
  /** The literal as written, quotes included. */
  readonly raw: string;
}

/**
 * One chunk of a template literal.
 * @since 1.0.0
 */
export interface TemplateElementNode extends PluginNode {
  /** `"TemplateElement"`. */
  readonly type: "TemplateElement";
  /** The text of the chunk: as written (`raw`) and with escapes resolved (`cooked`). */
  readonly value: { readonly raw: string; readonly cooked: string | null };
}

/**
 * A template literal such as `` `a${b}c` ``.
 * @since 1.0.0
 */
export interface TemplateLiteralNode extends PluginNode {
  /** `"TemplateLiteral"`. */
  readonly type: "TemplateLiteral";
  /** The text chunks; there is one more than there are expressions. */
  readonly quasis: readonly TemplateElementNode[];
  /** The `${}` expressions. */
  readonly expressions: readonly PluginNode[];
}

/**
 * A call such as `f(a, b)`.
 * @since 1.0.0
 */
export interface CallExpressionNode extends PluginNode {
  /** `"CallExpression"`. */
  readonly type: "CallExpression";
  /** What is called. */
  readonly callee: PluginNode;
  /** The arguments, in order. */
  readonly arguments: readonly PluginNode[];
}

/**
 * A member access such as `a.b` or `a[b]`.
 * @since 1.0.0
 */
export interface MemberExpressionNode extends PluginNode {
  /** `"MemberExpression"`. */
  readonly type: "MemberExpression";
  /** The expression before the dot or bracket. */
  readonly object: PluginNode;
  /** The property name (an {@link IdentifierNode}) or, when `computed`, the bracket expression. */
  readonly property: PluginNode;
  /** True for `a[b]`. */
  readonly computed: boolean;
}

/**
 * An `import` declaration.
 * @since 1.0.0
 */
export interface ImportDeclarationNode extends PluginNode {
  /** `"ImportDeclaration"`. */
  readonly type: "ImportDeclaration";
  /** The imported bindings; empty for `import "x"`. */
  readonly specifiers: readonly PluginNode[];
  /** The module specifier, a string {@link LiteralNode}. */
  readonly source: LiteralNode;
}

/**
 * An object literal.
 * @since 1.0.0
 */
export interface ObjectExpressionNode extends PluginNode {
  /** `"ObjectExpression"`. */
  readonly type: "ObjectExpression";
  /** The members: {@link PropertyNode} values and spread elements. */
  readonly properties: readonly PluginNode[];
}

/**
 * A `key: value` member of an object literal.
 * @since 1.0.0
 */
export interface PropertyNode extends PluginNode {
  /** `"Property"`. */
  readonly type: "Property";
  /** The key. */
  readonly key: PluginNode;
  /** The value. */
  readonly value: PluginNode;
  /** True for `[key]: value`. */
  readonly computed: boolean;
}

/**
 * A JSX tag name that is a plain word (`div`, `Button`).
 * @since 1.0.0
 */
export interface JSXIdentifierNode extends PluginNode {
  /** `"JSXIdentifier"`. */
  readonly type: "JSXIdentifier";
  /** The name as written; attribute names may contain dashes (`data-testid`). */
  readonly name: string;
}

/**
 * A JSX name with a namespace (`xlink:href`).
 * @since 1.0.0
 */
export interface JSXNamespacedNameNode extends PluginNode {
  /** `"JSXNamespacedName"`. */
  readonly type: "JSXNamespacedName";
  /** The part before the colon. */
  readonly namespace: JSXIdentifierNode;
  /** The part after the colon. */
  readonly name: JSXIdentifierNode;
}

/**
 * A JSX tag name with a dot (`Foo.Bar`).
 * @since 1.0.0
 */
export interface JSXMemberExpressionNode extends PluginNode {
  /** `"JSXMemberExpression"`. */
  readonly type: "JSXMemberExpression";
  /** The part before the last dot. */
  readonly object: PluginNode;
  /** The part after the last dot. */
  readonly property: JSXIdentifierNode;
}

/**
 * A JSX attribute such as `class="a"` or `onClick={f}`.
 * @since 1.0.0
 */
export interface JSXAttributeNode extends PluginNode {
  /** `"JSXAttribute"`. */
  readonly type: "JSXAttribute";
  /** The attribute name. */
  readonly name: JSXIdentifierNode | JSXNamespacedNameNode;
  /** The value: a string literal, a `{}` container, a JSX element, or `null` for a bare attribute. */
  readonly value: LiteralNode | JSXExpressionContainerNode | JSXElementNode | null;
}

/**
 * A spread attribute `{...props}`.
 * @since 1.0.0
 */
export interface JSXSpreadAttributeNode extends PluginNode {
  /** `"JSXSpreadAttribute"`. */
  readonly type: "JSXSpreadAttribute";
  /** The spread expression. */
  readonly argument: PluginNode;
}

/**
 * The opening tag of a JSX element, with its attributes.
 * @since 1.0.0
 */
export interface JSXOpeningElementNode extends PluginNode {
  /** `"JSXOpeningElement"`. */
  readonly type: "JSXOpeningElement";
  /** The tag name. */
  readonly name: JSXIdentifierNode | JSXNamespacedNameNode | JSXMemberExpressionNode;
  /** The attributes, in source order. */
  readonly attributes: readonly (JSXAttributeNode | JSXSpreadAttributeNode)[];
  /** True for `<tag />`. */
  readonly selfClosing: boolean;
}

/**
 * A JSX element.
 * @since 1.0.0
 */
export interface JSXElementNode extends PluginNode {
  /** `"JSXElement"`. */
  readonly type: "JSXElement";
  /** The opening tag. */
  readonly openingElement: JSXOpeningElementNode;
  /** The closing tag, or `null` for a self-closing element. */
  readonly closingElement: PluginNode | null;
  /** The children: text, `{}` containers and elements. */
  readonly children: readonly PluginNode[];
}

/**
 * A JSX fragment `<>...</>`.
 * @since 1.0.0
 */
export interface JSXFragmentNode extends PluginNode {
  /** `"JSXFragment"`. */
  readonly type: "JSXFragment";
  /** The children. */
  readonly children: readonly PluginNode[];
}

/**
 * A `{}` container in JSX, as an attribute value or a child.
 * @since 1.0.0
 */
export interface JSXExpressionContainerNode extends PluginNode {
  /** `"JSXExpressionContainer"`. */
  readonly type: "JSXExpressionContainer";
  /** The expression, or a `JSXEmptyExpression` for `{}`. */
  readonly expression: PluginNode;
}

/**
 * Text between JSX tags.
 * @since 1.0.0
 */
export interface JSXTextNode extends PluginNode {
  /** `"JSXText"`. */
  readonly type: "JSXText";
  /** The text with entities resolved. */
  readonly value: string;
  /** The text as written. */
  readonly raw: string;
}

/**
 * The node types with a typed interface, by name. A {@link Visitor} has an optional member for each.
 * @since 1.0.0
 */
export interface NodeMap {
  /** The module. */
  Program: ProgramNode;
  /** An identifier. */
  Identifier: IdentifierNode;
  /** A literal. */
  Literal: LiteralNode;
  /** A template literal. */
  TemplateLiteral: TemplateLiteralNode;
  /** A call. */
  CallExpression: CallExpressionNode;
  /** A member access. */
  MemberExpression: MemberExpressionNode;
  /** An import declaration. */
  ImportDeclaration: ImportDeclarationNode;
  /** An object literal. */
  ObjectExpression: ObjectExpressionNode;
  /** An object member. */
  Property: PropertyNode;
  /** A JSX element. */
  JSXElement: JSXElementNode;
  /** A JSX fragment. */
  JSXFragment: JSXFragmentNode;
  /** An opening tag. */
  JSXOpeningElement: JSXOpeningElementNode;
  /** A JSX attribute. */
  JSXAttribute: JSXAttributeNode;
  /** A JSX spread attribute. */
  JSXSpreadAttribute: JSXSpreadAttributeNode;
  /** A JSX word. */
  JSXIdentifier: JSXIdentifierNode;
  /** A JSX dotted name. */
  JSXMemberExpression: JSXMemberExpressionNode;
  /** A JSX namespaced name. */
  JSXNamespacedName: JSXNamespacedNameNode;
  /** A JSX `{}` container. */
  JSXExpressionContainer: JSXExpressionContainerNode;
  /** JSX text. */
  JSXText: JSXTextNode;
}

/**
 * A visitor function: called with the node and its parent (`null` for the node the walk started at).
 * Returning `false` from an `enter` skips the children of the node.
 * @since 1.0.0
 */
export type Visit<N> = (node: N, parent: PluginNode | null) => void | false;

/**
 * Enter and leave callbacks for one node type.
 * @since 1.0.0
 */
export interface VisitorEntry<N> {
  /** Called before the children of the node. Return `false` to skip them. */
  enter?: Visit<N>;
  /** Called after the children of the node (also when `enter` skipped them). */
  leave?: (node: N, parent: PluginNode | null) => void;
}

/**
 * What {@link PluginContext.walk} takes: a function or an enter/leave pair for the node types of
 * {@link NodeMap}, and an untyped `enter` and `leave` for every node. For one node the untyped
 * `enter` runs first, then the typed one; after the children the typed `leave` runs, then the
 * untyped one.
 * @since 1.0.0
 */
export type Visitor = {
  [K in keyof NodeMap]?: Visit<NodeMap[K]> | VisitorEntry<NodeMap[K]>;
} & VisitorEntry<PluginNode>;

/**
 * Builds source text for the edits of a plugin. Every method returns code to pass to
 * {@link PluginContext.replace}, {@link PluginContext.insertBefore} or
 * {@link PluginContext.insertAfter}; names are validated and strings are quoted, so a value from
 * the module cannot break out of the text that is built. The compiler parses the module again after
 * the edits, so text that is not valid is reported with the plugin's name.
 * @since 1.0.0
 */
export interface NodeFactory {
  /**
   * An identifier.
   * @param name A name that is a valid identifier and not a reserved word.
   * @returns The name.
   * @throws TypeError When `name` is not a valid identifier.
   */
  identifier(name: string): string;
  /**
   * A string literal.
   * @param value Any string.
   * @returns The literal with quotes and escapes.
   */
  string(value: string): string;
  /**
   * A call expression.
   * @param callee An identifier or a dotted path (`console.log`).
   * @param args Code for each argument.
   * @returns `callee(arg, arg)`.
   * @throws TypeError When `callee` is not an identifier path.
   */
  call(callee: string, args?: readonly string[]): string;
  /**
   * A JSX attribute.
   * @param name The attribute name (`data-testid`, `xlink:href`).
   * @param value Code for the value, written as `name={value}`. Omit it for a bare attribute.
   * @returns The attribute text.
   * @throws TypeError When `name` is not a valid attribute name.
   */
  jsxAttribute(name: string, value?: string): string;
  /**
   * JSX text that cannot be read as markup.
   * @param value Any string.
   * @returns `{"value"}`.
   */
  jsxText(value: string): string;
  /**
   * A JSX element.
   * @param tag A tag name (`div`, `Button`, `Foo.Bar`, `my-element`).
   * @param attributes Attribute texts, as built by {@link NodeFactory.jsxAttribute}.
   * @param children Child texts: elements, or {@link NodeFactory.jsxText}.
   * @returns `<tag attributes>children</tag>`, or `<tag attributes />` without children.
   * @throws TypeError When `tag` is not a valid tag name.
   */
  jsxElement(tag: string, attributes?: readonly string[], children?: readonly string[]): string;
}

/**
 * A finding of a plugin.
 * @since 1.0.0
 */
export interface PluginDiagnostic {
  /** Stable identifier of the finding. Default `PLUGIN_DIAGNOSTIC`. */
  readonly code?: string;
  /** Explanation, without the position. */
  readonly message: string;
  /**
   * `"error"` stops the compilation once the plugin returns, `"warning"` and `"info"` are collected
   * in the result.
   * @default "warning"
   */
  readonly severity?: "error" | "warning" | "info";
  /** The place it applies to. Default: the start of the file. */
  readonly node?: PluginRange;
}

/**
 * What a plugin gets with the tree: facts about the compilation, reporting, the walk, and the edits.
 * Edits are recorded and applied together once `transform` returns; they refer to
 * {@link PluginContext.source}, whatever order they are made in.
 * @since 1.0.0
 */
export interface PluginContext {
  /** The `filename` option of the compilation (default `"module.tsx"`). */
  readonly filename: string;
  /** The `generate` option: `"dom"` or `"ssr"`. */
  readonly target: "dom" | "ssr";
  /** The stage this call belongs to. */
  readonly stage: PluginStage;
  /** The `dev` option. */
  readonly dev: boolean;
  /** The text the tree was parsed from; every offset of the tree and of the edits refers to it. */
  readonly source: string;
  /** Builders for source text. */
  readonly create: NodeFactory;
  /**
   * Reports a finding. An `"error"` stops the compilation after `transform` returns, as a
   * {@link CompileError} with the plugin's name.
   * @param diagnostic The finding.
   */
  report(diagnostic: PluginDiagnostic): void;
  /**
   * Visits `root` and its descendants depth first, in source order, without recursion.
   * @param visitor Callbacks by node type.
   * @param root Where to start. Default: the whole tree.
   */
  walk(visitor: Visitor, root?: PluginNode): void;
  /**
   * Narrows a node to the typed interface of its type.
   * @param node A node, or `null` or `undefined` (for an optional child), which is never a match.
   * @param type A key of {@link NodeMap}.
   * @returns True when `node.type` is `type`.
   */
  is<K extends keyof NodeMap>(node: PluginNode | null | undefined, type: K): node is NodeMap[K];
  /**
   * The text of a span.
   * @param range A node or any `{ start, end }`.
   * @returns `source.slice(range.start, range.end)`.
   */
  text(range: PluginRange): string;
  /**
   * Replaces the text of a span. When the span is exactly one identifier, its original name is kept
   * in the source map.
   * @param range The span to replace.
   * @param code The new text.
   * @throws RangeError When the span is outside the source or reversed.
   */
  replace(range: PluginRange, code: string): void;
  /**
   * Inserts text where a span starts. Several inserts at one position keep their call order.
   * @param range Where to insert (at `range.start`).
   * @param code The text.
   * @throws RangeError When the span is outside the source or reversed.
   */
  insertBefore(range: PluginRange, code: string): void;
  /**
   * Inserts text where a span ends. Several inserts at one position keep their call order.
   * @param range Where to insert (at `range.end`).
   * @param code The text.
   * @throws RangeError When the span is outside the source or reversed.
   */
  insertAfter(range: PluginRange, code: string): void;
  /**
   * Removes a span.
   * @param range The span to remove.
   * @throws RangeError When the span is outside the source or reversed.
   */
  remove(range: PluginRange): void;
  /**
   * Adds `import { imported as <local> } from "from"` to the module (once per pair, after the
   * directive prologue) and returns the local name. The pair must be listed in the plugin's
   * {@link CompilerPlugin.imports}.
   * @param from The module specifier.
   * @param imported The exported name (`default` for the default export).
   * @returns A local name that does not collide with a name of the module.
   * @throws CompileError `PLUGIN_UNDECLARED_IMPORT` when the pair is not declared.
   */
  addImport(from: string, imported: string): string;
}

/**
 * An import a plugin adds to the modules it changes.
 * @since 1.0.0
 */
export interface PluginImport {
  /** The module specifier, such as `"@my/i18n"`. */
  readonly from: string;
  /** The names imported from it (`"default"` for the default export, `"*"` for a namespace). */
  readonly names: readonly string[];
}

/**
 * A compiler plugin: a build-time function over the tree of one module. Plugins run in the order of
 * the list, `"pre"` plugins before the compiler passes and `"post"` plugins after code generation.
 * They are passed as values to `compile` (`plugins`) or to the Vite plugin; nothing loads them by
 * name. A plugin must be deterministic and synchronous.
 *
 * @example
 * import { compile, type CompilerPlugin } from "@shadow-js/compiler";
 *
 * const dropTestIds: CompilerPlugin = {
 *   name: "drop-test-ids",
 *   transform(ast, context) {
 *     context.walk({
 *       JSXAttribute(node) {
 *         if (node.name.type === "JSXIdentifier" && node.name.name === "data-testid") {
 *           context.remove({ start: node.start - 1, end: node.end });
 *         }
 *       },
 *     });
 *   },
 * };
 * const result = compile(`export const A = () => <b data-testid="x">hi</b>;`, {
 *   plugins: [dropTestIds],
 * });
 * console.log(result.code.includes("data-testid")); // false
 * @since 1.0.0
 */
export interface CompilerPlugin {
  /** Unique name; it appears in every diagnostic and error the plugin causes. */
  readonly name: string;
  /**
   * `"pre"` runs on the tree of the source, before every compiler pass; `"post"` runs on the tree
   * of the generated code.
   * @default "pre"
   */
  readonly enforce?: PluginStage;
  /** Every import the plugin may add. Absent means none. */
  readonly imports?: readonly PluginImport[];
  /**
   * Reads the tree and records edits and reports on `context`. Synchronous, and returns nothing.
   * @param ast The tree of the module as of this stage.
   * @param context Facts, reporting, the walk and the edits.
   */
  transform(ast: ProgramNode, context: PluginContext): void;
}
