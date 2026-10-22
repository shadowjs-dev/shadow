#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
/**
 * Writes `tests/fixtures/tree.jsonl`: for every distinct source of the parity corpus, the pre-order
 * list of the ESTree nodes that `oxc-parser` returns (type, start, end, depth), walked the way the
 * reference compiler walks a tree (children sorted by start). The Rust test `tests/tree.rs`
 * rebuilds the same list from its own tree and requires equality, which proves that the Rust view
 * of the syntax tree is the one the reference passes were written against.
 *
 * Types the Rust tree does not tell apart are normalized the way `Ty` normalizes them: a type that
 * starts with `TS` and is not listed becomes `Ts`, every other unlisted type becomes `Other`.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const require = createRequire(join(repo, "packages/compiler/package.json"));
const { parseSync } = require("oxc-parser");

const LISTED = new Set(
  `Program Identifier JSXIdentifier ThisExpression Literal TemplateLiteral TemplateElement
TaggedTemplateExpression MemberExpression CallExpression NewExpression ChainExpression
ParenthesizedExpression BinaryExpression LogicalExpression UnaryExpression UpdateExpression
ConditionalExpression AssignmentExpression SequenceExpression AwaitExpression YieldExpression
ArrowFunctionExpression FunctionExpression FunctionDeclaration ClassDeclaration ClassExpression
ClassBody MethodDefinition PropertyDefinition ObjectExpression ArrayExpression Property SpreadElement
VariableDeclaration VariableDeclarator ExpressionStatement BlockStatement ReturnStatement
ObjectPattern ArrayPattern AssignmentPattern RestElement CatchClause LabeledStatement
BreakStatement ContinueStatement ImportDeclaration ImportSpecifier ExportSpecifier
ExportNamedDeclaration ExportDefaultDeclaration ExportAllDeclaration JSXElement JSXFragment
JSXOpeningElement JSXAttribute JSXSpreadAttribute JSXExpressionContainer JSXEmptyExpression JSXText
JSXSpreadChild JSXNamespacedName JSXMemberExpression TSAsExpression TSSatisfiesExpression
TSNonNullExpression TSTypeAssertion TSInstantiationExpression TSNumberKeyword TSStringKeyword
TSBooleanKeyword TSBigIntKeyword TSSymbolKeyword TSNullKeyword TSUndefinedKeyword TSTypeAnnotation
TSParameterProperty`.split(/\s+/),
);

const normalize = (type) => (LISTED.has(type) ? type : type.startsWith("TS") ? "Ts" : "Other");

const isNode = (value) =>
  typeof value === "object" && value !== null && typeof value.type === "string";

function childNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function dump(program) {
  const out = [];
  const stack = [[program, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop();
    out.push(`${normalize(node.type)}:${node.start}:${node.end}:${depth}`);
    const kids = childNodes(node);
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push([kids[i], depth + 1]);
  }
  return out;
}

function languageOf(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "ts";
  return "jsx";
}

const corpus = join(repo, "packages/compiler/test/native/corpus");
const seen = new Map();
for (const name of ["tests.jsonl.gz", "real.jsonl.gz", "errors.jsonl.gz"]) {
  for (const line of gunzipSync(readFileSync(join(corpus, name)))
    .toString("utf8")
    .split("\n")) {
    if (line === "") continue;
    const entry = JSON.parse(line);
    const filename = entry.options?.filename ?? "module.tsx";
    const key = `${filename}\u0000${entry.source}`;
    if (!seen.has(key)) seen.set(key, { filename, source: entry.source });
  }
}

const lines = [];
for (const { filename, source } of seen.values()) {
  const result = parseSync(filename, source, { lang: languageOf(filename), sourceType: "module" });
  if (result.errors.length > 0) continue;
  lines.push(JSON.stringify({ filename, source, nodes: dump(result.program).join(" ") }));
}
writeFileSync(
  join(here, "../tests/fixtures/tree.jsonl.gz"),
  gzipSync(`${lines.join("\n")}\n`, { level: 9 }),
);
console.log(`tree.jsonl.gz: ${lines.length} sources`);
