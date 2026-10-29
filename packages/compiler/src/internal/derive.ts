import { type AstNode, childNodes, isFunctionNode, isJsx, isNode, unwrapParens, walk } from "./ast";
import { isDynamic } from "./classify";
import { joinRopes, type Origin, originOf, Rope, type SpliceEdit, splice } from "./origin";

/**
 * Forgiving reactivity: inside a component, a `const` computed from reactive reads (`const double =
 * count() * 2`, `const { title } = props`) stays live wherever it is used, without a function or a
 * `useMemo`. The declaration becomes a derived value and its references read it, so
 * `{double}` and `{double()}` both work and update. Plain constants, hooks and functions are left
 * alone. Runs as a source-to-source pass before JSX compilation.
 */

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9_$]*$/;
const HOOK_NAME =
  /^(?:use|create)[A-Z]|^(?:batch|untrack|onMount|onCleanup|onError|catchError|mapArray|indexArray|mergeProps|splitProps|children|lazy|render|hydrate|flushSync|runWithOwner|getOwner)$/;
/** TypeScript wrappers whose `expression` child is real code. */
const TS_TRANSPARENT = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

type Edit = SpliceEdit;

function str(node: AstNode, key: string): string | undefined {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
}
function at(node: AstNode, key: string): AstNode | null {
  const value = node[key];
  return isNode(value) ? value : null;
}
function list(node: AstNode, key: string): AstNode[] {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function isHookInit(init: AstNode): boolean {
  const root = unwrapParens(init);
  if (root.type === "AwaitExpression" || root.type === "YieldExpression") return true;
  if (root.type !== "CallExpression") return false;
  const callee = at(root, "callee");
  if (callee === null) return false;
  if (callee.type === "Identifier") return HOOK_NAME.test(str(callee, "name") ?? "");
  if (callee.type === "MemberExpression") {
    const property = at(callee, "property");
    return property !== null && HOOK_NAME.test(str(property, "name") ?? "");
  }
  return false;
}

interface ComponentFunction {
  node: AstNode;
  name: string;
}

/** Finds PascalCase-named functions with at most one parameter. */
function components(program: AstNode): ComponentFunction[] {
  const found: ComponentFunction[] = [];
  const consider = (fn: AstNode, name: string | undefined): void => {
    if (name === undefined || !COMPONENT_NAME.test(name)) return;
    if (!isFunctionNode(fn) || fn["async"] === true || fn["generator"] === true) return;
    if (list(fn, "params").length > 1) return;
    found.push({ node: fn, name });
  };
  walk(program, (node) => {
    if (node.type === "FunctionDeclaration") {
      const id = at(node, "id");
      consider(node, id === null ? undefined : str(id, "name"));
    } else if (node.type === "VariableDeclarator") {
      const id = at(node, "id");
      const init = at(node, "init");
      if (id !== null && id.type === "Identifier" && init !== null) {
        const target = unwrapParens(init);
        if (target.type === "ArrowFunctionExpression" || target.type === "FunctionExpression") {
          consider(target, str(id, "name"));
        }
      }
    }
    return true;
  });
  return found;
}

function containsJsx(node: AstNode): boolean {
  let found = false;
  walk(node, (current) => {
    if (found) return false;
    if (isJsx(current)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

interface Candidate {
  name: string;
  /** Statement/declarator context for the rewrite. */
  declarator: AstNode;
  /** For `const x = init`: the initializer. For props patterns: the replacement is built from `member`. */
  init: AstNode | null;
  /** Props pattern entries expand to `props.key`. */
  fromProps?: { propsName: string; key: string; fallback: AstNode | null };
  wrapped: boolean;
  used: boolean;
}

interface Reference {
  node: AstNode;
  parent: AstNode;
  callee: boolean;
}

/** All simple identifier references to `names` inside `root`, skipping declarations and non-references. */
function references(
  root: AstNode,
  names: ReadonlySet<string>,
): {
  refs: Map<string, Array<Reference & { inClosure: boolean; inJsx: boolean }>>;
  redeclared: Set<string>;
} {
  const refs = new Map<string, Array<Reference & { inClosure: boolean; inJsx: boolean }>>();
  const redeclared = new Set<string>();
  const stack: Array<{
    node: AstNode;
    parent: AstNode | null;
    closure: boolean;
    jsx: boolean;
    depth: number;
  }> = [{ node: root, parent: null, closure: false, jsx: false, depth: 0 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { node, parent, closure, jsx, depth } = frame;
    if (node.type.startsWith("TS") && !TS_TRANSPARENT.has(node.type)) continue;
    let childClosure = closure;
    let childJsx = jsx;
    if (node !== root && isFunctionNode(node)) {
      childClosure = true;
      for (const param of list(node, "params")) collectBindingNames(param, names, redeclared);
      const id = at(node, "id");
      if (id !== null) collectBindingNames(id, names, redeclared);
    }
    if (node.type === "JSXExpressionContainer" || node.type === "JSXSpreadAttribute")
      childJsx = true;
    if (node.type === "VariableDeclarator") {
      // Declarations of the same name below the component's own top level shadow it.
      const id = at(node, "id");
      if (id !== null && (frame.closure || depth > 2)) collectBindingNames(id, names, redeclared);
      // The declared identifiers are not references; only the initializer is read.
      const init = at(node, "init");
      if (init !== null)
        stack.push({
          node: init,
          parent: node,
          closure: childClosure,
          jsx: childJsx,
          depth: depth + 1,
        });
      continue;
    }
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && depth >= 1) {
      const id = at(node, "id");
      if (id !== null) collectBindingNames(id, names, redeclared);
    }
    if (node.type === "CatchClause") {
      const param = at(node, "param");
      if (param !== null) collectBindingNames(param, names, redeclared);
    }
    if ((node.type === "Identifier" || node.type === "JSXIdentifier") && parent !== null) {
      const name = str(node, "name");
      // `<ui.Button />` reads `ui`; a bare `<ui>` is an element and `ui=` an attribute name.
      const read =
        node.type === "JSXIdentifier"
          ? parent.type === "JSXMemberExpression" && at(parent, "object") === node
          : isReference(node, parent);
      if (name !== undefined && names.has(name) && read) {
        const entry: Reference & { inClosure: boolean; inJsx: boolean } = {
          node,
          parent,
          callee: parent.type === "CallExpression" && at(parent, "callee") === node,
          inClosure: closure,
          // A tag is part of the JSX, whatever encloses it.
          inJsx: jsx || node.type === "JSXIdentifier",
        };
        const bucket = refs.get(name);
        if (bucket === undefined) refs.set(name, [entry]);
        else bucket.push(entry);
      }
      continue;
    }
    const kids = TS_TRANSPARENT.has(node.type)
      ? [at(node, "expression")].filter((n): n is AstNode => n !== null)
      : childNodes(node);
    for (const child of kids) {
      stack.push({
        node: child,
        parent: node,
        closure: childClosure,
        jsx: childJsx,
        depth: depth + 1,
      });
    }
  }
  return { refs, redeclared };
}

function collectBindingNames(pattern: AstNode, names: ReadonlySet<string>, out: Set<string>): void {
  const stack: AstNode[] = [pattern];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.type === "Identifier") {
      const name = str(node, "name");
      if (name !== undefined && names.has(name)) out.add(name);
    } else if (node.type === "ObjectPattern") {
      for (const property of list(node, "properties")) {
        stack.push(
          property.type === "RestElement" ? property : (at(property, "value") ?? property),
        );
      }
    } else if (node.type === "ArrayPattern") {
      for (const element of list(node, "elements")) stack.push(element);
    } else if (node.type === "AssignmentPattern") {
      const left = at(node, "left");
      if (left !== null) stack.push(left);
    } else if (node.type === "RestElement") {
      const argument = at(node, "argument");
      if (argument !== null) stack.push(argument);
    }
  }
}

/** True when `node` (an Identifier) is read as a value in `parent`. */
function isReference(node: AstNode, parent: AstNode): boolean {
  switch (parent.type) {
    case "MemberExpression":
      return at(parent, "object") === node || parent["computed"] === true;
    case "Property":
      // `{ key: value }`: only the value is a reference; computed keys are references too.
      return at(parent, "value") === node || parent["computed"] === true;
    case "VariableDeclarator":
      return at(parent, "init") === node;
    case "AssignmentExpression":
      return at(parent, "right") === node;
    case "UpdateExpression":
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
    case "MethodDefinition":
    case "PropertyDefinition":
    case "ExportSpecifier":
    case "ImportSpecifier":
      return false;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return at(parent, "body") === node;
    default:
      return true;
  }
}

/** Top-level `return` arguments of a component (or its concise body), parentheses removed. */
function returnedExpressions(bodyNode: AstNode): AstNode[] {
  if (bodyNode.type !== "BlockStatement") return [unwrapParens(bodyNode)];
  const out: AstNode[] = [];
  for (const statement of list(bodyNode, "body")) {
    if (statement.type !== "ReturnStatement") continue;
    const argument = at(statement, "argument");
    if (argument !== null) out.push(unwrapParens(argument));
  }
  return out;
}

/**
 * A component that returns `cond() ? <A /> : <B />` (or `x && <A />`) is made live: the returned
 * expression becomes an accessor, so the branch follows the condition. Only expressions with JSX in
 * a branch and a reactive read in the condition are touched; early `return`s are left as written.
 * `derivedNames` are the constants this pass turns into derived values; reading one is reactive.
 */
function liveReturnEdits(
  bodyNode: AstNode,
  source: string,
  derivedNames: ReadonlySet<string>,
): Edit[] {
  const edits: Edit[] = [];
  for (const expression of returnedExpressions(bodyNode)) {
    let condition: AstNode | null = null;
    let branches: AstNode[] = [];
    if (expression.type === "ConditionalExpression") {
      condition = at(expression, "test");
      branches = [at(expression, "consequent"), at(expression, "alternate")].filter(
        (n): n is AstNode => n !== null,
      );
    } else if (expression.type === "LogicalExpression") {
      condition = at(expression, "left");
      const right = at(expression, "right");
      branches = right === null ? [] : [right];
    }
    if (condition === null || !branches.some(containsJsx)) continue;
    const reactiveCondition =
      isDynamic(condition, source) ||
      (derivedNames.size > 0 && references(condition, derivedNames).refs.size > 0);
    if (!reactiveCondition) continue;
    edits.push({ start: expression.start, end: expression.start, text: "() => (" });
    edits.push({ start: expression.end, end: expression.end, text: ")" });
  }
  return edits;
}

export interface DeriveResult {
  code: string;
  changed: boolean;
  /** Where each part of `code` comes from in the text that was read; `null` when unchanged. */
  origin: Origin | null;
}

/**
 * Rewrites derived constants inside components. `importFrom` is the module that exports `derived`.
 */
export function deriveLocals(source: string, program: AstNode, importFrom: string): DeriveResult {
  const structural: Edit[] = [];
  const referenceEdits: Edit[] = [];
  let used = false;
  let changedReturns = false;

  for (const component of components(program)) {
    const fn = component.node;
    if (!containsJsx(fn)) continue;
    const bodyNode = at(fn, "body");
    if (bodyNode === null) continue;
    const params = list(fn, "params");
    const param = params[0];

    // 1. Candidate declarations.
    const candidates: Candidate[] = [];
    let propsName: string | undefined;
    let paramPatternEdit: { replace: AstNode; text: Rope; declarations: string } | undefined;
    if (param !== undefined && param.type === "Identifier") propsName = str(param, "name");
    if (param !== undefined && param.type === "ObjectPattern") {
      const entries = patternEntries(param);
      if (entries !== undefined) {
        propsName = "_$props";
        const annotation = at(param, "typeAnnotation");
        const text = new Rope(param.start).write("_$props");
        if (annotation !== null) text.copy(source, annotation.start, annotation.end);
        for (const entry of entries) {
          candidates.push({
            name: entry.name,
            declarator: param,
            init: null,
            fromProps: { propsName: "_$props", key: entry.key, fallback: entry.fallback },
            wrapped: true,
            used: true,
          });
        }
        paramPatternEdit = { replace: param, text, declarations: "" };
      }
    }

    const statements = bodyNode.type === "BlockStatement" ? list(bodyNode, "body") : [];
    for (const statement of statements) {
      if (statement.type !== "VariableDeclaration" || str(statement, "kind") !== "const") continue;
      for (const declarator of list(statement, "declarations")) {
        const id = at(declarator, "id");
        const init = at(declarator, "init");
        if (id === null || init === null) continue;
        if (id.type === "Identifier") {
          const target = unwrapParens(init);
          if (isFunctionNode(target) || isJsx(target) || target.type === "ClassExpression")
            continue;
          if (isHookInit(init)) continue;
          candidates.push({
            name: str(id, "name") ?? "",
            declarator,
            init,
            wrapped: false,
            used: false,
          });
        } else if (id.type === "ObjectPattern" && propsName !== undefined) {
          const rooted = unwrapParens(init);
          if (rooted.type !== "Identifier" || str(rooted, "name") !== propsName) continue;
          const entries = patternEntries(id);
          if (entries === undefined) continue;
          for (const entry of entries) {
            candidates.push({
              name: entry.name,
              declarator,
              init: null,
              fromProps: { propsName, key: entry.key, fallback: entry.fallback },
              wrapped: true,
              used: true,
            });
          }
        }
      }
    }
    if (candidates.length === 0) {
      const edits = liveReturnEdits(bodyNode, source, new Set());
      structural.push(...edits);
      if (edits.length > 0) changedReturns = true;
      continue;
    }

    // 2. Which ones are read later (in JSX or in closures)? Fixpoint over dependent constants.
    const names = new Set(candidates.map((c) => c.name));
    const found = references(bodyNode, names);
    const byName = new Map<string, Candidate>();
    for (const candidate of candidates) {
      if (found.redeclared.has(candidate.name) || byName.has(candidate.name)) {
        candidate.wrapped = false;
        candidate.used = false;
        continue;
      }
      byName.set(candidate.name, candidate);
    }
    // Reactive: reads signals/props directly, or reads another reactive constant (to a fixpoint).
    const reactive = new Set<string>();
    for (const candidate of byName.values()) {
      if (candidate.fromProps !== undefined) reactive.add(candidate.name);
      else if (candidate.init !== null && isDynamic(candidate.init, source))
        reactive.add(candidate.name);
    }
    const readsOf = new Map<string, Set<string>>();
    for (const candidate of byName.values()) {
      if (candidate.init === null) continue;
      readsOf.set(
        candidate.name,
        new Set(references(candidate.init, new Set(byName.keys())).refs.keys()),
      );
    }
    for (let grew = true; grew; ) {
      grew = false;
      for (const [name, reads] of readsOf) {
        if (reactive.has(name)) continue;
        if ([...reads].some((n) => reactive.has(n))) {
          reactive.add(name);
          grew = true;
        }
      }
    }
    // Used: read later in JSX or a closure, or read by the initializer of a used constant.
    const usedNames = new Set<string>();
    for (const candidate of byName.values()) {
      const refsOf = found.refs.get(candidate.name) ?? [];
      if (candidate.fromProps !== undefined || refsOf.some((r) => r.inJsx || r.inClosure)) {
        usedNames.add(candidate.name);
      }
    }
    for (let grew = true; grew; ) {
      grew = false;
      for (const name of [...usedNames]) {
        for (const read of readsOf.get(name) ?? []) {
          if (!usedNames.has(read)) {
            usedNames.add(read);
            grew = true;
          }
        }
      }
    }
    for (const candidate of byName.values()) {
      candidate.used = usedNames.has(candidate.name);
      candidate.wrapped =
        candidate.fromProps !== undefined || (reactive.has(candidate.name) && candidate.used);
    }
    const wrapped = new Set([...byName.values()].filter((c) => c.wrapped).map((c) => c.name));
    const returnEdits = liveReturnEdits(bodyNode, source, wrapped);
    structural.push(...returnEdits);
    if (returnEdits.length > 0) changedReturns = true;
    if (wrapped.size === 0) continue;
    used = true;

    // 3. Reference rewrites (not inside the declaration identifiers themselves).
    for (const name of wrapped) {
      for (const ref of found.refs.get(name) ?? []) {
        if (ref.parent.type === "Property" && ref.parent["shorthand"] === true) {
          referenceEdits.push({
            start: ref.parent.start,
            end: ref.parent.end,
            text: `${name}: ${name}.value`,
          });
        } else if (!ref.callee) {
          // A called reference (`double()`) is left alone: the derived value is callable itself.
          referenceEdits.push({ start: ref.node.start, end: ref.node.end, text: `${name}.value` });
        }
      }
    }

    // 4. Declaration rewrites.
    const render = (start: number, end: number): Rope =>
      splice(
        source,
        start,
        end,
        referenceEdits.filter((e) => e.start >= start && e.end <= end),
      );
    const emitDerived = (candidate: Candidate): Rope | undefined => {
      const out = new Rope(candidate.declarator.start);
      if (!wrapped.has(candidate.name)) {
        if (candidate.fromProps === undefined) return undefined;
        // A shadowed name keeps plain destructuring semantics (read once).
        const { propsName: p, key, fallback } = candidate.fromProps;
        const access = `${p}[${JSON.stringify(key)}]`;
        if (fallback === null) return out.write(`${candidate.name} = ${access}`);
        return out
          .write(`${candidate.name} = ${access} === undefined ? (`)
          .append(render(fallback.start, fallback.end))
          .write(`) : ${access}`);
      }
      if (candidate.fromProps !== undefined) {
        const { propsName: p, key, fallback } = candidate.fromProps;
        const access = `${p}[${JSON.stringify(key)}]`;
        if (fallback === null) return out.write(`${candidate.name} = _$derived(() => ${access})`);
        return out
          .write(
            `${candidate.name} = _$derived(() => { const _$v = ${access}; return _$v === undefined ? (`,
          )
          .append(render(fallback.start, fallback.end))
          .write(") : _$v; })");
      }
      const init = candidate.init;
      if (init === null) return undefined;
      return out
        .write(`${candidate.name} = _$derived(() => (`)
        .append(render(init.start, init.end))
        .write("))");
    };
    const handled = new Set<AstNode>();
    for (const candidate of byName.values()) {
      if (candidate.declarator === param) continue;
      if (handled.has(candidate.declarator)) continue;
      const siblings = [...byName.values()].filter((c) => c.declarator === candidate.declarator);
      const parts = siblings.map(emitDerived);
      if (parts.every((part) => part === undefined)) continue;
      if (candidate.fromProps !== undefined) {
        const declarations = parts.filter((p): p is Rope => p !== undefined);
        structural.push({
          start: candidate.declarator.start,
          end: candidate.declarator.end,
          text: joinRopes(declarations, ", ", candidate.declarator.start),
        });
      } else {
        const [part] = parts;
        const init = candidate.init;
        const id = at(candidate.declarator, "id");
        if (part !== undefined && init !== null && id !== null) {
          structural.push({
            start: candidate.declarator.start,
            end: candidate.declarator.end,
            text: part,
          });
        }
      }
      handled.add(candidate.declarator);
    }

    // 5. Destructured parameter: becomes `_$props`, declarations are inserted at the body start.
    if (paramPatternEdit !== undefined) {
      const derivedFromParam = [...byName.values()].filter(
        (c) => c.declarator === paramPatternEdit.replace,
      );
      const declarations = derivedFromParam
        .map(emitDerived)
        .filter((p): p is Rope => p !== undefined);
      structural.push({
        start: paramPatternEdit.replace.start,
        end: paramPatternEdit.replace.end,
        text: paramPatternEdit.text,
      });
      if (declarations.length > 0) {
        const decl = new Rope(bodyNode.start)
          .write("const ")
          .append(joinRopes(declarations, ", ", bodyNode.start))
          .write(";");
        if (bodyNode.type === "BlockStatement") {
          structural.push({
            start: bodyNode.start + 1,
            end: bodyNode.start + 1,
            text: new Rope(bodyNode.start + 1).write("\n").append(decl).write("\n"),
          });
        } else {
          structural.push({
            start: bodyNode.start,
            end: bodyNode.start,
            text: new Rope(bodyNode.start).write("{\n").append(decl).write("\nreturn "),
          });
          structural.push({ start: bodyNode.end, end: bodyNode.end, text: ";\n}" });
        }
      }
    }
  }

  if (!used) {
    if (!changedReturns) return { code: source, changed: false, origin: null };
    const rewritten = splice(source, 0, source.length, structural);
    return { code: rewritten.text, changed: true, origin: originOf(rewritten, source.length) };
  }

  // Reference edits that sit inside a structural edit were already rendered into it.
  const outside = referenceEdits.filter(
    (edit) =>
      !structural.some((s) => edit.start >= s.start && edit.end <= s.end && !(s.start === s.end)),
  );
  const importLine = `import { derived as _$derived } from ${JSON.stringify(importFrom)};\n`;
  const insertAt = leadingDirectivesEnd(source, program);
  // Every edit lies after the leading directives. The import is the first edit, so where another
  // edit starts at the same offset, the import precedes it.
  const importEdit = {
    start: insertAt,
    end: insertAt,
    text: insertAt === 0 ? importLine : `\n${importLine}`,
  };
  const rewritten = splice(source, 0, source.length, [importEdit, ...structural, ...outside]);
  return { code: rewritten.text, changed: true, origin: originOf(rewritten, source.length) };
}

function leadingDirectivesEnd(source: string, program: AstNode): number {
  let end = 0;
  if (source.startsWith("#!")) {
    const newline = source.indexOf("\n");
    end = newline === -1 ? source.length : newline + 1;
  }
  for (const statement of list(program, "body")) {
    if (statement.type === "ExpressionStatement" && typeof statement["directive"] === "string") {
      end = Math.max(end, statement.end);
    } else break;
  }
  return end;
}

interface PatternEntry {
  name: string;
  key: string;
  fallback: AstNode | null;
}

/** Simple `{ a, b: c, d = 1 }` patterns only; anything else (rest, nesting, computed) is left alone. */
function patternEntries(pattern: AstNode): PatternEntry[] | undefined {
  const out: PatternEntry[] = [];
  for (const property of list(pattern, "properties")) {
    if (property.type !== "Property" || property["computed"] === true) return undefined;
    const key = at(property, "key");
    const value = at(property, "value");
    if (key === null || value === null) return undefined;
    const keyName =
      key.type === "Identifier"
        ? str(key, "name")
        : key.type === "Literal"
          ? String(key["value"])
          : undefined;
    if (keyName === undefined) return undefined;
    if (value.type === "Identifier") {
      out.push({ name: str(value, "name") ?? "", key: keyName, fallback: null });
    } else if (value.type === "AssignmentPattern") {
      const left = at(value, "left");
      const right = at(value, "right");
      if (left === null || right === null || left.type !== "Identifier") return undefined;
      out.push({ name: str(left, "name") ?? "", key: keyName, fallback: right });
    } else {
      return undefined;
    }
  }
  return out;
}
