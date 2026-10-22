/** Minimal structural view of the ESTree nodes oxc-parser returns (positions are UTF-16 offsets). */
export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}

/** Child nodes of `node` in source order. */
export function childNodes(node: AstNode): AstNode[] {
  const out: AstNode[] = [];
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Depth-first walk without recursion (source depth is user controlled). `enter` returns `false`
 * to skip the children of a node.
 */
export function walk(
  root: AstNode,
  enter: (node: AstNode, parent: AstNode | null) => boolean | undefined,
): void {
  const stack: Array<[AstNode, AstNode | null]> = [[root, null]];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    const [node, parent] = entry;
    if (enter(node, parent) === false) continue;
    const children = childNodes(node);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child !== undefined) stack.push([child, node]);
    }
  }
}

export const isJsx = (node: AstNode): boolean =>
  node.type === "JSXElement" || node.type === "JSXFragment";

/** Removes wrapping parentheses (`ParenthesizedExpression`) around an expression. */
export function unwrapParens(node: AstNode): AstNode {
  let current = node;
  while (current.type === "ParenthesizedExpression" && isNode(current["expression"])) {
    current = current["expression"];
  }
  return current;
}

export function isFunctionNode(node: AstNode): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

/**
 * Offset just after a shebang and the directive prologue of a module (`"use client";`). Code that is
 * added at the top of a module goes here, so the directives keep their meaning.
 */
export function leadingEnd(source: string, program: AstNode): number {
  let end = 0;
  if (source.startsWith("#!")) {
    const newline = source.indexOf("\n");
    end = newline === -1 ? source.length : newline + 1;
  }
  const body = program["body"];
  if (Array.isArray(body)) {
    for (const statement of body as AstNode[]) {
      if (statement.type === "ExpressionStatement" && typeof statement["directive"] === "string") {
        end = Math.max(end, statement.end);
      } else {
        break;
      }
    }
  }
  return end;
}
