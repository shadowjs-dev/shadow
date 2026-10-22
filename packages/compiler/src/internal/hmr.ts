import type MagicString from "magic-string";
import { type AstNode, isNode } from "./ast";
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
        out.push({ name, after: statement.end });
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
          out.push({ name, init });
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
  const components: Declared[] = [];
  const others: string[] = [];
  const exportedValues: Array<{ name: string; viaStatement: AstNode }> = [];
  let unknownExport = false;

  for (const statement of list(program, "body")) {
    if (statement.type === "ExportNamedDeclaration") {
      if (str(statement, "exportKind") === "type") continue;
      const declaration = at(statement, "declaration");
      if (declaration !== null) {
        const before = components.length;
        collect(declaration, components, others);
        const added = components.slice(before).map((c) => c.name);
        const declaredNames = declarationNames(declaration);
        for (const name of declaredNames) {
          if (!added.includes(name) && declaration.type !== "TSTypeAliasDeclaration") {
            exportedValues.push({ name, viaStatement: statement });
          }
        }
        if (declaredNames.length === 0 && !isTypeOnly(declaration)) unknownExport = true;
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
      if (declaration !== null && declaration.type === "FunctionDeclaration") {
        const before = components.length;
        collect(declaration, components, others);
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
