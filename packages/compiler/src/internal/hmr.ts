import type MagicString from "magic-string";
import { type AstNode, isFunctionNode, isJsx, isNode, walk } from "./ast";
import type { Registry } from "./registry";

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9_$]*$/;

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

/** A function a framework can treat as a component: at most one parameter, plain function. */
function isComponentFunction(node: AstNode): boolean {
  if (
    node.type !== "FunctionDeclaration" &&
    node.type !== "FunctionExpression" &&
    node.type !== "ArrowFunctionExpression"
  ) {
    return false;
  }
  if (node["async"] === true || node["generator"] === true) return false;
  return list(node, "params").length <= 1;
}

interface Declared {
  name: string;
  /** The function itself, which the component test reads. */
  fn: AstNode;
  /** True when an `export` declares it, which a function that is left unwrapped must still report. */
  exported?: boolean;
  /** Statement end to append `Name = wrap(Name)` after (function declarations). */
  after?: number;
  /** Initializer range to wrap in place (variable declarators). */
  init?: AstNode;
}

function collect(statement: AstNode, out: Declared[], others: string[]): void {
  switch (statement.type) {
    case "FunctionDeclaration": {
      const id = at(statement, "id");
      const name = id === null ? undefined : str(id, "name");
      if (name !== undefined && COMPONENT_NAME.test(name) && isComponentFunction(statement)) {
        out.push({ name, fn: statement, after: statement.end });
      } else if (name !== undefined) {
        others.push(name);
      }
      return;
    }
    case "VariableDeclaration": {
      for (const declarator of list(statement, "declarations")) {
        const id = at(declarator, "id");
        const init = at(declarator, "init");
        const name = id !== null && id.type === "Identifier" ? str(id, "name") : undefined;
        if (name === undefined) {
          others.push("<pattern>");
        } else if (init !== null && COMPONENT_NAME.test(name) && isComponentFunction(init)) {
          out.push({ name, fn: init, init });
        } else {
          others.push(name);
        }
      }
      return;
    }
    default:
      return;
  }
}

/** The wrappers around an expression that do not change which expression it is. */
const TRANSPARENT = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
]);

function bare(node: AstNode): AstNode {
  let current = node;
  for (;;) {
    const inner = TRANSPARENT.has(current.type) ? at(current, "expression") : null;
    if (inner === null) return current;
    current = inner;
  }
}

/** Where a function reads its own `this` or has a scope of its own: a regular function or a class keeps its `this`. */
function ownsThis(node: AstNode): boolean {
  return (
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "ClassBody"
  );
}

/** True when `fn` reads `this` (its own, or the one it closes over, through arrows). */
function usesThis(fn: AstNode): boolean {
  let found = false;
  walk(fn, (node) => {
    if (found) return false;
    if (node.type === "ThisExpression") {
      found = true;
      return false;
    }
    return node === fn || !ownsThis(node);
  });
  return found;
}

/** The expressions `fn` returns: an arrow's expression body, and the argument of each `return` that belongs to `fn`. */
function returned(fn: AstNode): AstNode[] {
  const body = at(fn, "body");
  if (body === null) return [];
  if (body.type !== "BlockStatement") return [body];
  const out: AstNode[] = [];
  walk(body, (node) => {
    if (node.type === "ReturnStatement") {
      const argument = at(node, "argument");
      if (argument !== null) out.push(argument);
      return false;
    }
    return !isFunctionNode(node) && node.type !== "ClassBody";
  });
  return out;
}

/** The names of the plain functions that `expression` can evaluate to the call of (`cond ? A({}) : B({})`). */
function calledComponents(expression: AstNode, names: Set<string>): void {
  const pending: AstNode[] = [expression];
  while (pending.length > 0) {
    const node = bare(pending.pop() as AstNode);
    if (node.type === "ConditionalExpression") {
      for (const key of ["consequent", "alternate"]) {
        const branch = at(node, key);
        if (branch !== null) pending.push(branch);
      }
    } else if (node.type === "LogicalExpression") {
      for (const key of ["left", "right"]) {
        const operand = at(node, key);
        if (operand !== null) pending.push(operand);
      }
    } else if (node.type === "SequenceExpression") {
      const last = list(node, "expressions").at(-1);
      if (last !== undefined) pending.push(last);
    } else if (node.type === "CallExpression") {
      const callee = at(node, "callee");
      const name = callee === null ? undefined : str(bare(callee), "name");
      if (name !== undefined) names.add(name);
    }
  }
}

/** The root name of a tag: `Foo` for `<Foo>` and for `<Foo.Bar.Baz>`. */
function tagRoot(name: AstNode | null): string | undefined {
  let current = name;
  while (current !== null && current.type === "JSXMemberExpression")
    current = at(current, "object");
  return current !== null && current.type === "JSXIdentifier" ? str(current, "name") : undefined;
}

/** The names of the functions declared at the top level of the module (exported or not) that hold JSX. */
function renderingFunctions(program: AstNode): string[] {
  const names: string[] = [];
  const holdsJsx = (fn: AstNode): boolean => {
    let found = false;
    walk(fn, (node) => {
      if (isJsx(node)) found = true;
      return !found;
    });
    return found;
  };
  for (const statement of list(program, "body")) {
    const declaration =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
        ? at(statement, "declaration")
        : statement;
    if (declaration === null) continue;
    if (declaration.type === "FunctionDeclaration") {
      const id = at(declaration, "id");
      const name = id === null ? undefined : str(id, "name");
      if (name !== undefined && holdsJsx(declaration)) names.push(name);
    } else if (declaration.type === "VariableDeclaration") {
      for (const declarator of list(declaration, "declarations")) {
        const id = at(declarator, "id");
        const init = at(declarator, "init");
        const name = id !== null && id.type === "Identifier" ? str(id, "name") : undefined;
        if (name !== undefined && init !== null && isFunctionNode(init) && holdsJsx(init)) {
          names.push(name);
        }
      }
    }
  }
  return names;
}

/**
 * Keeps the declared functions that are components. A function that is called with `new` or reads `this` is a
 * constructor or a method, and one that neither holds JSX nor is a tag of this module nor returns the call of a
 * component cannot be told from a helper (`const Total = (n) => n * 2`): wrapping it would make `Total(2)` return a
 * function. Those stay as written, so they behave in `vite dev` as in a build. What the pass loses is the hot update of
 * a component that hides all three (a component that only returns `props.children` and is used as a tag by another
 * module): its module is then not self-accepting when it exports it, and its importers update as for any other export.
 */
function keepComponents(program: AstNode, declared: Declared[]): Declared[] {
  const constructed = new Set<string>();
  const tags = new Set<string>();
  walk(program, (node) => {
    if (node.type === "NewExpression") {
      const callee = at(node, "callee");
      const name = callee === null ? undefined : str(bare(callee), "name");
      if (name !== undefined) constructed.add(name);
    } else if (node.type === "JSXOpeningElement") {
      const name = tagRoot(at(node, "name"));
      if (name !== undefined) tags.add(name);
    }
    return true;
  });
  // A function of the module that renders (holds JSX) is what a component returns the call of, whatever its name or
  // parameters are (`function helper() { return <p />; }`).
  const known = new Set<string>(renderingFunctions(program));
  const pending = declared.filter((c) => !constructed.has(c.name) && !usesThis(c.fn));
  const kept = new Set<Declared>();
  const keep = (component: Declared): void => {
    kept.add(component);
    known.add(component.name);
  };
  const calls = new Map<Declared, Set<string>>();
  for (const component of pending) {
    let hasJsx = false;
    walk(component.fn, (node) => {
      if (isJsx(node)) hasJsx = true;
      return !hasJsx;
    });
    if (hasJsx || tags.has(component.name)) {
      keep(component);
      continue;
    }
    const names = new Set<string>();
    for (const expression of returned(component.fn)) calledComponents(expression, names);
    calls.set(component, names);
  }
  // A returned call makes a component of its caller; a chain of them settles in at most one pass per link.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [component, names] of calls) {
      if (kept.has(component)) continue;
      if ([...names].some((name) => known.has(name))) {
        keep(component);
        changed = true;
      }
    }
  }
  return declared.filter((c) => kept.has(c));
}

export interface HmrResult {
  /** True when the module exports only components (and types) and can accept its own update. */
  selfAccepting: boolean;
  components: number;
}

/**
 * Wraps top-level component definitions in stable proxies and appends the refresh registration, so
 * editing a component swaps it in place instead of reloading the page. Modules that export anything
 * other than components are left to Vite's normal propagation (their importers reload).
 */
export function applyHmr(
  program: AstNode,
  magic: MagicString,
  registry: Registry,
  _filename: string,
  runtimeModule: string,
): HmrResult {
  let components: Declared[] = [];
  const others: string[] = [];
  const exportedValues: Array<{ name: string; viaStatement: AstNode }> = [];
  let unknownExport = false;

  for (const statement of list(program, "body")) {
    if (statement.type === "ExportNamedDeclaration") {
      if (str(statement, "exportKind") === "type") continue;
      const declaration = at(statement, "declaration");
      // An overload signature (`export function f(): void;`) is a type: the implementation is the export.
      if (declaration !== null && declaration.type === "TSDeclareFunction") continue;
      if (declaration !== null) {
        const before = components.length;
        collect(declaration, components, others);
        for (const component of components.slice(before)) component.exported = true;
        const added = components.slice(before).map((c) => c.name);
        const declaredNames = declarationNames(declaration);
        for (const name of declaredNames) {
          if (!added.includes(name) && declaration.type !== "TSTypeAliasDeclaration") {
            exportedValues.push({ name, viaStatement: statement });
          }
        }
        if (declaredNames.length === 0 && !isTypeOnly(declaration)) unknownExport = true;
        // An enum or a namespace is a value that importers hold, but it is not a component.
        if (declaredNames.length === 0 && isRuntimeNamespace(declaration)) unknownExport = true;
      } else {
        for (const specifier of list(statement, "specifiers")) {
          if (str(specifier, "exportKind") === "type") continue;
          const local = at(specifier, "local");
          const name = local === null ? undefined : str(local, "name");
          if (name === undefined) unknownExport = true;
          else exportedValues.push({ name, viaStatement: statement });
        }
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      const declaration = at(statement, "declaration");
      if (declaration !== null && declaration.type === "TSDeclareFunction") continue;
      if (declaration !== null && declaration.type === "FunctionDeclaration") {
        const before = components.length;
        collect(declaration, components, others);
        for (const component of components.slice(before)) component.exported = true;
        if (components.length === before) unknownExport = true;
      } else if (declaration !== null && declaration.type === "Identifier") {
        const name = str(declaration, "name");
        if (name === undefined) unknownExport = true;
        else exportedValues.push({ name, viaStatement: statement });
      } else {
        unknownExport = true;
      }
    } else if (statement.type === "ExportAllDeclaration") {
      unknownExport = true;
    } else {
      collect(statement, components, others);
    }
  }

  const declared = components;
  components = keepComponents(program, declared);
  // An exported function that stays as written is an export that is not a component.
  for (const component of declared) {
    if (component.exported === true && !components.includes(component)) {
      exportedValues.push({ name: component.name, viaStatement: program });
    }
  }
  if (components.length === 0) return { selfAccepting: false, components: 0 };

  const names = new Set(components.map((c) => c.name));
  const nonComponentExport = unknownExport || exportedValues.some((e) => !names.has(e.name));
  const wrap = registry.helper("component", runtimeModule);
  for (const component of components) {
    const call = `${wrap}(${hotReg(registry, runtimeModule)}, ${JSON.stringify(component.name)}, `;
    if (component.init !== undefined) {
      magic.appendLeft(component.init.start, call);
      magic.appendRight(component.init.end, ")");
    } else if (component.after !== undefined) {
      magic.appendLeft(component.after, `\n${component.name} = ${call}${component.name});`);
    }
  }
  return { selfAccepting: !nonComponentExport, components: components.length };
}

function declarationNames(declaration: AstNode): string[] {
  if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
    const id = at(declaration, "id");
    const name = id === null ? undefined : str(id, "name");
    return name === undefined ? [] : [name];
  }
  if (declaration.type === "VariableDeclaration") {
    const names: string[] = [];
    for (const declarator of list(declaration, "declarations")) {
      const id = at(declarator, "id");
      const name = id !== null && id.type === "Identifier" ? str(id, "name") : undefined;
      names.push(name ?? "<pattern>");
    }
    return names;
  }
  return [];
}

function isTypeOnly(declaration: AstNode): boolean {
  return (
    declaration.type === "TSInterfaceDeclaration" ||
    declaration.type === "TSTypeAliasDeclaration" ||
    declaration.type === "TSEnumDeclaration" ||
    declaration.type === "TSModuleDeclaration"
  );
}

/** An `enum` or `namespace` that exists at run time (`declare` ones are types only). */
function isRuntimeNamespace(declaration: AstNode): boolean {
  return (
    (declaration.type === "TSEnumDeclaration" || declaration.type === "TSModuleDeclaration") &&
    declaration["declare"] !== true
  );
}

/** Variable holding this module's registry, declared by `hmrPrelude`. */
export function hotReg(registry: Registry, _runtimeModule: string): string {
  return registry.local("_$$reg");
}

/** Prelude statement creating the module registry. */
export function hmrPrelude(registry: Registry, runtimeModule: string, filename: string): string {
  return `const ${hotReg(registry, runtimeModule)} = ${registry.helper("registry", runtimeModule)}(import.meta.hot, ${JSON.stringify(filename)});\n`;
}

/**
 * Epilogue registering the update handler. The literal `import.meta.hot?.accept()` is what the
 * bundler reads to know the module accepts its own updates; a call made only through the helper is
 * invisible to it, and every edit would then reload the page. The helper still checks the
 * registry and commits the replaced components.
 */
export function hmrEpilogue(registry: Registry, runtimeModule: string): string {
  return `\nimport.meta.hot?.accept();\n${registry.helper("accept", runtimeModule)}(import.meta.hot, ${hotReg(registry, runtimeModule)});\n`;
}
