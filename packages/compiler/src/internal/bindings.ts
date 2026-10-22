import { type AstNode, isNode, walk } from "./ast";

/** Names bound by a declaration's pattern (`a`, `{ a, b: [c] }`, `...rest`): every identifier in it. */
function addPattern(into: Set<string>, pattern: unknown): void {
  if (!isNode(pattern)) return;
  walk(pattern, (node) => {
    if (node.type === "Identifier" && typeof node["name"] === "string") into.add(node["name"]);
    return true;
  });
}

/** The parameters and the name of a function or class: all of them can be assigned. */
function addAssignable(into: Set<string>, node: AstNode): void {
  if ("id" in node) addPattern(into, node["id"]);
  const params = node["params"];
  if (Array.isArray(params)) for (const param of params) addPattern(into, param);
}

/**
 * The names of a module that can never be assigned: bindings declared `const` and imports, unless
 * the same name is also declared assignable (`let`, `var`, a parameter, a function or class name)
 * anywhere in the file. Scopes are not resolved, so a name declared in two places counts as
 * assignable. The compiler uses it to emit a `ref` assignment only where one is legal: assigning a
 * `const` is a compile error in the bundler, even in a branch that never runs.
 *
 * @param program The ESTree program of the module.
 * @returns The names that must not be assigned.
 * @internal
 */
export function unassignableNames(program: AstNode): ReadonlySet<string> {
  const constant = new Set<string>();
  const assignable = new Set<string>();
  walk(program, (node) => {
    if (node.type === "VariableDeclaration") {
      const target = node["kind"] === "const" ? constant : assignable;
      const declarations = node["declarations"];
      if (Array.isArray(declarations)) {
        for (const declarator of declarations) {
          if (isNode(declarator)) addPattern(target, declarator["id"]);
        }
      }
    } else if (node.type === "ImportDeclaration") {
      const specifiers = node["specifiers"];
      if (Array.isArray(specifiers)) {
        for (const specifier of specifiers) {
          if (isNode(specifier)) addPattern(constant, specifier["local"]);
        }
      }
    } else if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ClassDeclaration" ||
      node.type === "ClassExpression"
    ) {
      addAssignable(assignable, node);
    } else if (node.type === "CatchClause") {
      addPattern(assignable, node["param"]);
    }
    return true;
  });
  const names = new Set<string>();
  for (const name of constant) if (!assignable.has(name)) names.add(name);
  return names;
}
