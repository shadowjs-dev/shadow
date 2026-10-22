import { type AstNode, isNode, leadingEnd, walk } from "./ast";
import { type Origin, originOf, type SpliceEdit, splice } from "./origin";
import { parseModule } from "./parse";

/**
 * Pay for what you use: `useStore(<single value>)` builds a reactive cell, and a cell needs none of
 * the deep store (the proxies, the reconciler, the draft transactions). When the initial value is a
 * primitive, `null`, `undefined`, a function or a `Date` literal, the call is rewritten to the cell
 * path: `useSignal` from `@shadow-js/core`, the primitive `useStore` builds its cell from.
 *
 * The behavior is the same. `useStore` only wraps plain data that is written into a single-value
 * cell, and a cell whose type is a primitive (or `null`) cannot hold plain data in typed code, so
 * the rewrite applies only when there is no type argument or the type argument is one of those
 * primitive keywords. Object and array literals keep `useStore` (they need the store anyway), and
 * so does any dynamic initial value, because only the run-time value says which path applies.
 *
 * Only calls of `useStore` imported from `@shadow-js/core` (or its `/store` entry, or as a
 * namespace member) are rewritten. A name bound more than once in the module (a shadowing parameter,
 * a second import) is left alone, and so is a wrapper re-exported from another package. The
 * rewritten call is the alias `useShadowSignal`, imported from `@shadow-js/core`. Its name still
 * matches the `use[A-Z]` hook pattern, so later passes read it as a hook.
 *
 * @internal
 */

const CORE = "@shadow-js/core";
const SOURCES = new Set([CORE, `${CORE}/store`]);
const ALIAS = "useShadowSignal";
/** Type arguments that keep a call on the cell path: the primitives, `null` and `undefined`. */
const CELL_TYPES = new Set([
  "TSNumberKeyword",
  "TSStringKeyword",
  "TSBooleanKeyword",
  "TSBigIntKeyword",
  "TSSymbolKeyword",
  "TSNullKeyword",
  "TSUndefinedKeyword",
]);

/**
 * Result of the pass: the rewritten text, whether any call was rewritten, and (when it was) where
 * each part of the rewritten text comes from.
 */
export interface StoreCellResult {
  readonly code: string;
  readonly changed: boolean;
  readonly origin: Origin | null;
}

function nameOf(node: AstNode | null | undefined): string | undefined {
  if (node === null || node === undefined) return undefined;
  const name = node["name"];
  return node.type === "Identifier" && typeof name === "string" ? name : undefined;
}

function childNode(node: AstNode, key: string): AstNode | null {
  const value = node[key];
  return isNode(value) ? value : null;
}

function childList(node: AstNode, key: string): AstNode[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
}

/**
 * How many times each name is bound in the module: declarations, parameters, function and class
 * names, catch parameters and import bindings. A name bound once (by its import) is unshadowed.
 * Scopes are not resolved, so a repeated name counts as shadowed, which is the safe answer.
 */
function bindingCounts(program: AstNode): Map<string, number> {
  const counts = new Map<string, number>();
  const bind = (pattern: AstNode | null): void => {
    if (pattern === null) return;
    walk(pattern, (node) => {
      const name = nameOf(node);
      if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
      return true;
    });
  };
  const bindParams = (node: AstNode): void => {
    for (const param of childList(node, "params")) bind(param);
  };
  walk(program, (node) => {
    switch (node.type) {
      case "VariableDeclarator":
        bind(childNode(node, "id"));
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ClassDeclaration":
      case "ClassExpression":
        bind(childNode(node, "id"));
        bindParams(node);
        break;
      case "CatchClause":
        bind(childNode(node, "param"));
        break;
      case "ImportDeclaration":
        for (const specifier of childList(node, "specifiers")) bind(childNode(specifier, "local"));
        break;
      default:
        break;
    }
    return true;
  });
  return counts;
}

/** The names under which `useStore` is reachable from the core module: named and namespace imports. */
function importedNames(program: AstNode): { named: Set<string>; namespaces: Set<string> } {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of childList(program, "body")) {
    if (statement.type !== "ImportDeclaration" || statement["importKind"] === "type") continue;
    const source = childNode(statement, "source")?.["value"];
    if (typeof source !== "string" || !SOURCES.has(source)) continue;
    for (const specifier of childList(statement, "specifiers")) {
      const local = nameOf(childNode(specifier, "local"));
      if (local === undefined || specifier["importKind"] === "type") continue;
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(local);
      } else if (specifier.type === "ImportSpecifier") {
        const imported = childNode(specifier, "imported");
        const importedName =
          imported?.type === "Identifier" ? nameOf(imported) : imported?.["value"];
        if (importedName === "useStore") named.add(local);
      }
    }
  }
  return { named, namespaces };
}

/** True for a call's type arguments that keep it on the cell path (none, or one primitive keyword). */
function cellTypeArguments(call: AstNode): boolean {
  const typeArguments = childNode(call, "typeArguments");
  if (typeArguments === null) return true;
  const params = childList(typeArguments, "params");
  const [only] = params;
  return params.length === 1 && only !== undefined && CELL_TYPES.has(only.type);
}

/** True for an options argument that carries only `name` (the one option a cell uses). */
function nameOnlyOptions(node: AstNode): boolean {
  if (node.type !== "ObjectExpression") return false;
  return childList(node, "properties").every((property) => {
    if (property.type !== "Property" || property["kind"] !== "init") return false;
    if (property["computed"] === true || property["method"] === true) return false;
    const key = childNode(property, "key");
    return key !== null && (nameOf(key) === "name" || key["value"] === "name");
  });
}

/**
 * True when the initial value is a single value at run time whatever the expression evaluates to:
 * a primitive, `null`, `undefined`, a function or a `Date`. Anything else (identifiers, calls,
 * conditionals, objects, arrays) stays on `useStore`.
 */
function isCellInitial(node: AstNode, counts: Map<string, number>): boolean {
  switch (node.type) {
    case "Literal": {
      if (node["regex"] !== undefined) return false;
      if (typeof node["bigint"] === "string") return true;
      const value = node["value"];
      return (
        typeof value === "number" ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (value === null && node["raw"] === "null")
      );
    }
    case "TemplateLiteral":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return true;
    case "UnaryExpression": {
      const argument = childNode(node, "argument");
      return (
        (node["operator"] === "-" || node["operator"] === "+") &&
        argument !== null &&
        argument.type === "Literal" &&
        (typeof argument["value"] === "number" || typeof argument["bigint"] === "string")
      );
    }
    case "Identifier":
      return nameOf(node) === "undefined" && (counts.get("undefined") ?? 0) === 0;
    case "NewExpression":
      return nameOf(childNode(node, "callee")) === "Date" && (counts.get("Date") ?? 0) === 0;
    default:
      return false;
  }
}

/** A name for the rewritten call that no identifier of the module already uses. */
function aliasFor(source: string): string {
  let alias = ALIAS;
  for (let n = 2; new RegExp(`\\b${alias}\\b`).test(source); n += 1) alias = `${ALIAS}${n}`;
  return alias;
}

/**
 * Rewrites `useStore(<single value>)` calls of the core module to the cell path. Returns the
 * source unchanged (and `changed: false`) when no call qualifies. Pure: a source-to-source pass
 * that runs before the JSX pass and the derivation pass.
 *
 * @param source Module text.
 * @param filename File name, used to choose the parser language.
 * @returns The rewritten text and whether it changed.
 * @internal
 */
export function specializeStoreCells(source: string, filename: string): StoreCellResult {
  const unchanged: StoreCellResult = { code: source, changed: false, origin: null };
  if (!source.includes("useStore")) return unchanged;
  const { program } = parseModule(source, filename);
  const { named, namespaces } = importedNames(program);
  if (named.size === 0 && namespaces.size === 0) return unchanged;
  const counts = bindingCounts(program);
  const bound = (name: string): boolean => counts.get(name) === 1;
  const edits: SpliceEdit[] = [];
  walk(program, (node) => {
    if (node.type !== "CallExpression" || node["optional"] === true) return true;
    const callee = childNode(node, "callee");
    if (callee === null) return true;
    const qualifies =
      callee.type === "Identifier"
        ? named.has(nameOf(callee) ?? "") && bound(nameOf(callee) ?? "")
        : callee.type === "MemberExpression" &&
          callee["computed"] !== true &&
          callee["optional"] !== true &&
          namespaces.has(nameOf(childNode(callee, "object")) ?? "") &&
          bound(nameOf(childNode(callee, "object")) ?? "") &&
          nameOf(childNode(callee, "property")) === "useStore";
    if (!qualifies || !cellTypeArguments(node)) return true;
    const args = childList(node, "arguments");
    const [initial, options] = args;
    if (initial === undefined || args.length > 2) return true;
    if (options !== undefined && !nameOnlyOptions(options)) return true;
    if (!isCellInitial(initial, counts)) return true;
    edits.push({ start: callee.start, end: callee.end, text: "" });
    return true;
  });
  if (edits.length === 0) return unchanged;

  const alias = aliasFor(source);
  for (const edit of edits) edit.text = alias;
  const insertAt = leadingEnd(source, program);
  const importLine = `import { useSignal as ${alias} } from "${CORE}";`;
  // Start of a line (or of the module): the import takes the line. After a directive: a new line first.
  const startsLine = insertAt === 0 || source[insertAt - 1] === "\n";
  // The import is the first edit: where a call starts at the same offset, the import precedes it.
  const importEdit = {
    start: insertAt,
    end: insertAt,
    text: startsLine ? `${importLine}\n` : `\n${importLine}`,
  };
  const rewritten = splice(source, 0, source.length, [importEdit, ...edits]);
  return { code: rewritten.text, changed: true, origin: originOf(rewritten, source.length) };
}
