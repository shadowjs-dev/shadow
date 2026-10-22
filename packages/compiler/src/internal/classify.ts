import { type AstNode, isFunctionNode, isNode, unwrapParens, walk } from "./ast";

const STATIC_MARKER = /\/\*\s*@(?:static|once)\s*\*\/\s*$/;

/**
 * The single authority deciding whether an expression must be re-evaluated reactively.
 * Dynamic means it contains a call, member access, optional chain, tagged template or `in`
 * test outside nested functions. A bare identifier is static: if it holds a function, the runtime
 * treats it as an accessor. `/*@static*\/` (or Solid's `/*@once*\/`) before an expression forces static.
 */
export function isDynamic(node: AstNode, source: string): boolean {
  if (STATIC_MARKER.test(source.slice(Math.max(0, node.start - 40), node.start))) return false;
  const root = unwrapParens(node);
  if (isFunctionNode(root)) return false;
  let dynamic = false;
  walk(root, (current) => {
    if (dynamic) return false;
    if (isFunctionNode(current)) return false;
    switch (current.type) {
      case "CallExpression":
      case "MemberExpression":
      case "TaggedTemplateExpression":
      case "ChainExpression":
        dynamic = true;
        return false;
      case "BinaryExpression":
        if (current["operator"] === "in") {
          dynamic = true;
          return false;
        }
        return true;
      case "JSXElement":
      case "JSXFragment":
        // Creating nodes is a one-time effect; reactivity lives in the expressions inside them.
        return false;
      default:
        return true;
    }
  });
  return dynamic;
}

/** True when the subtree creates JSX outside nested functions (JSX inside a function is lazy already). */
export function containsJsx(node: AstNode): boolean {
  let found = false;
  walk(node, (current) => {
    if (found) return false;
    if (isFunctionNode(current)) return false;
    if (current.type === "JSXElement" || current.type === "JSXFragment") {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/** Operators {@link constantValue} evaluates on two literals. */
const FOLDED_OPERATORS = new Set(["+", "-", "*"]);

/** Nesting {@link constantValue} follows into operators; a deeper chain is left to the runtime. */
const FOLD_DEPTH = 24;

type Constant = string | number | boolean | null;

/** A number result only counts when it is finite and not negative zero (both print differently as code). */
function plainNumber(value: number): number | undefined {
  return Number.isFinite(value) && !Object.is(value, -0) ? value : undefined;
}

function literalValue(root: AstNode): Constant | undefined {
  if (root.type === "Literal") {
    const value = root["value"];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      if (root["regex"] === undefined && root["bigint"] === undefined) return value;
    }
    return undefined;
  }
  if (root.type === "TemplateLiteral") {
    const expressions = root["expressions"];
    const quasis = root["quasis"];
    if (
      Array.isArray(expressions) &&
      expressions.length === 0 &&
      Array.isArray(quasis) &&
      quasis.length === 1
    ) {
      const quasi = quasis[0];
      if (isNode(quasi)) {
        const value = quasi["value"];
        if (typeof value === "object" && value !== null) {
          const cooked = (value as { cooked?: unknown }).cooked;
          if (typeof cooked === "string") return cooked;
        }
      }
    }
  }
  return undefined;
}

function evaluate(node: AstNode, depth: number): Constant | undefined {
  const root = unwrapParens(node);
  if (root.type === "UnaryExpression") {
    const argument = root["argument"];
    if (depth >= FOLD_DEPTH || !isNode(argument)) return undefined;
    const operator = root["operator"];
    if (operator !== "-" && operator !== "+") return undefined;
    const value = evaluate(argument, depth + 1);
    if (typeof value !== "number") return undefined;
    return plainNumber(operator === "-" ? -value : value);
  }
  if (root.type === "BinaryExpression") {
    const operator = root["operator"];
    const left = root["left"];
    const right = root["right"];
    if (depth >= FOLD_DEPTH || typeof operator !== "string" || !FOLDED_OPERATORS.has(operator))
      return undefined;
    if (!isNode(left) || !isNode(right)) return undefined;
    const a = evaluate(left, depth + 1);
    const b = evaluate(right, depth + 1);
    if (
      (typeof a !== "string" && typeof a !== "number") ||
      (typeof b !== "string" && typeof b !== "number")
    )
      return undefined;
    if (operator === "+") {
      return typeof a === "number" && typeof b === "number" ? plainNumber(a + b) : `${a}${b}`;
    }
    if (typeof a !== "number" || typeof b !== "number") return undefined;
    return plainNumber(operator === "-" ? a - b : a * b);
  }
  return literalValue(root);
}

/**
 * Literal value of a confidently constant expression, else `undefined`: a string, number, boolean
 * or `null` literal, a template literal without holes, a unary `-` or `+` on a number, and `+`, `-`
 * and `*` on those (a result that is not finite, or is negative zero, is not constant). The value is
 * the one the runtime would compute, so folding it is not observable.
 */
export function constantValue(node: AstNode): string | number | boolean | null | undefined {
  return evaluate(node, 0);
}
