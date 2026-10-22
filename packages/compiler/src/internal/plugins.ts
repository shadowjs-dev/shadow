import MagicString, { type DecodedSourceMap } from "magic-string";
import { type AstNode, childNodes, isNode, leadingEnd, walk } from "./ast";
import { CompileError, codeFrame, type Diagnostic, makeDiagnostic } from "./diagnostics";
import { parseModule } from "./parse";
import type {
  CompilerPlugin,
  NodeFactory,
  NodeMap,
  PluginContext,
  PluginDiagnostic,
  PluginNode,
  PluginRange,
  PluginStage,
  ProgramNode,
  Visit,
  Visitor,
  VisitorEntry,
} from "./plugin-types";
import { composeMaps, traceBack } from "./sourcemap";

/** Edits one plugin call may record. A loop that never ends stops here instead of using all memory. */
const MAX_EDITS = 100_000;

const NAME_LIMIT = 100;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it rejects
const CONTROL = /[\u0000-\u001f\u007f]/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const IDENTIFIER_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const ATTRIBUTE_NAME = /^[A-Za-z_$][A-Za-z0-9_$-]*(?::[A-Za-z_$][A-Za-z0-9_$-]*)?$/;
const TAG_NAME = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/;

const RESERVED = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/** Plugin lists that `validatePlugins` already accepted, so the compiler checks a list once. */
const accepted = new WeakSet<object>();

function describe(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "an array" : typeof value;
}

function validateImports(imports: unknown, where: string): void {
  if (imports === undefined) return;
  if (!Array.isArray(imports)) throw new TypeError(`${where}.imports must be an array.`);
  imports.forEach((entry: unknown, index) => {
    const at = `${where}.imports[${index}]`;
    if (typeof entry !== "object" || entry === null) {
      throw new TypeError(`${at} must be an object with "from" and "names".`);
    }
    const { from, names } = entry as { from?: unknown; names?: unknown };
    if (typeof from !== "string" || from === "" || CONTROL.test(from)) {
      throw new TypeError(`${at}.from must be a non-empty string without control characters.`);
    }
    if (!Array.isArray(names)) throw new TypeError(`${at}.names must be an array of names.`);
    for (const name of names as unknown[]) {
      const valid =
        typeof name === "string" && (name === "*" || name === "default" || IDENTIFIER.test(name));
      if (!valid) {
        throw new TypeError(
          `${at}.names must hold identifiers, "default" or "*" (got ${String(name)}).`,
        );
      }
    }
  });
}

/**
 * Checks a list of compiler plugins and returns it as a frozen copy. The same list (or a list this
 * function returned) is accepted again at no cost.
 *
 * @param plugins The value to check, normally the `plugins` option.
 * @param label How the error messages name the option.
 * @returns The plugins in the given order.
 * @throws TypeError When `plugins` is not an array, or a member is not an object with a unique,
 * non-empty `name`, a `transform` function, an `enforce` of `"pre"` or `"post"` (or none), and
 * well-formed `imports`. The message names the member (`plugins[1].name`).
 * @example
 * import { validatePlugins } from "@shadow-js/compiler";
 *
 * const list = validatePlugins([{ name: "noop", transform() {} }]);
 * console.log(list.length); // 1
 * try {
 *   validatePlugins([{ name: "", transform() {} }]);
 * } catch (error) {
 *   console.log(String(error).includes("plugins[0].name")); // true
 * }
 * @see CompilerPlugin
 * @since 1.0.0
 */
export function validatePlugins(
  plugins: unknown,
  label = "compile(): plugins",
): readonly CompilerPlugin[] {
  if (typeof plugins === "object" && plugins !== null && accepted.has(plugins)) {
    return plugins as readonly CompilerPlugin[];
  }
  if (!Array.isArray(plugins)) {
    throw new TypeError(
      `${label} must be an array of compiler plugins (got ${describe(plugins)}).`,
    );
  }
  const names = new Map<string, number>();
  (plugins as unknown[]).forEach((plugin, index) => {
    const where = `${label}[${index}]`;
    if (typeof plugin !== "object" || plugin === null) {
      throw new TypeError(`${where} must be a plugin object (got ${describe(plugin)}).`);
    }
    const { name, transform, enforce, imports } = plugin as Record<string, unknown>;
    if (
      typeof name !== "string" ||
      name === "" ||
      name !== name.trim() ||
      name.length > NAME_LIMIT ||
      CONTROL.test(name)
    ) {
      throw new TypeError(
        `${where}.name must be a non-empty string of at most ${NAME_LIMIT} characters, without surrounding spaces or control characters.`,
      );
    }
    const first = names.get(name);
    if (first !== undefined) {
      throw new TypeError(`${where}.name "${name}" is already the name of ${label}[${first}].`);
    }
    names.set(name, index);
    if (typeof transform !== "function") {
      throw new TypeError(`${where}.transform must be a function (got ${describe(transform)}).`);
    }
    if (enforce !== undefined && enforce !== "pre" && enforce !== "post") {
      throw new TypeError(`${where}.enforce must be "pre" or "post" (got ${String(enforce)}).`);
    }
    validateImports(imports, where);
  });
  const list = Object.freeze([...(plugins as CompilerPlugin[])]);
  accepted.add(list);
  return list;
}

// ---------- node factory ----------

function need(ok: boolean, message: string): void {
  if (!ok) throw new TypeError(message);
}

const factory: NodeFactory = Object.freeze({
  identifier(name: string): string {
    need(
      IDENTIFIER.test(name) && !RESERVED.has(name),
      `create.identifier(): "${name}" is not a valid identifier.`,
    );
    return name;
  },
  string(value: string): string {
    return JSON.stringify(value);
  },
  call(callee: string, args: readonly string[] = []): string {
    need(IDENTIFIER_PATH.test(callee), `create.call(): "${callee}" is not an identifier path.`);
    return `${callee}(${args.join(", ")})`;
  },
  jsxAttribute(name: string, value?: string): string {
    need(ATTRIBUTE_NAME.test(name), `create.jsxAttribute(): "${name}" is not an attribute name.`);
    return value === undefined ? name : `${name}={${value}}`;
  },
  jsxText(value: string): string {
    return `{${JSON.stringify(value)}}`;
  },
  jsxElement(
    tag: string,
    attributes: readonly string[] = [],
    children: readonly string[] = [],
  ): string {
    need(TAG_NAME.test(tag), `create.jsxElement(): "${tag}" is not a tag name.`);
    const open = attributes.length === 0 ? tag : `${tag} ${attributes.join(" ")}`;
    return children.length === 0 ? `<${open} />` : `<${open}>${children.join("")}</${tag}>`;
  },
});

// ---------- positions ----------

/** Line starts of a text, to turn offsets into lines and columns (and back) without rescanning. */
class Lines {
  private readonly starts: number[] = [0];
  private readonly text: string;
  constructor(text: string) {
    this.text = text;
    for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }

  /** 0-based line and column of an offset. */
  at(offset: number): { line: number; column: number } {
    const target = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.starts[middle] ?? 0) <= target) low = middle;
      else high = middle - 1;
    }
    return { line: low, column: target - (this.starts[low] ?? 0) };
  }

  /** Offset of a 0-based line and column, clamped to the text. */
  offset(line: number, column: number): number {
    const start = this.starts[Math.min(line, this.starts.length - 1)] ?? 0;
    return Math.min(start + column, this.text.length);
  }
}

// ---------- state ----------

/**
 * What the stages share for one module.
 * @internal
 * @since 1.0.0
 */
export interface PluginState {
  /** The text the caller passed; positions in diagnostics refer to it. */
  readonly original: string;
  readonly filename: string;
  readonly target: "dom" | "ssr";
  readonly dev: boolean;
  /** The modules the generated code imports its runtime from. */
  readonly runtime: readonly string[];
  /** The text the current stage works on. */
  text: string;
  /** The tree of `text`. */
  program: AstNode;
  /** Map from `text` to `original`; `null` while the two are the same text. */
  trail: DecodedSourceMap | null;
  /** True once any plugin changed the module. */
  edited: boolean;
  /** Warnings and findings the plugins reported. */
  readonly diagnostics: Diagnostic[];
  readonly originalLines: Lines;
}

/**
 * Starts the shared state of the stages of one compilation.
 *
 * @param original The module text.
 * @param options The facts the plugins can read.
 * @returns The state, with no edits.
 * @internal
 * @since 1.0.0
 */
export function createPluginState(
  original: string,
  options: {
    filename: string;
    target: "dom" | "ssr";
    dev: boolean;
    runtime: readonly string[];
  },
): PluginState {
  return {
    original,
    filename: options.filename,
    target: options.target,
    dev: options.dev,
    runtime: options.runtime,
    text: original,
    program: { type: "Program", start: 0, end: 0, body: [] },
    trail: null,
    edited: false,
    diagnostics: [],
    originalLines: new Lines(original),
  };
}

/**
 * The plugins of one stage, in list order. A plugin without `enforce` belongs to `"pre"`.
 *
 * @param list The validated plugin list.
 * @param stage The stage to select.
 * @returns The plugins of that stage.
 * @internal
 * @since 1.0.0
 */
export function pluginsOf(list: readonly CompilerPlugin[], stage: PluginStage): CompilerPlugin[] {
  return list.filter((plugin) => (plugin.enforce ?? "pre") === stage);
}

/** Offset in the original text for an offset of the current text. */
function toOriginal(state: PluginState, lines: Lines, offset: number): number {
  if (state.trail === null) return Math.min(offset, state.original.length);
  const position = lines.at(offset);
  const found = traceBack(state.trail, position.line, position.column);
  return found === undefined ? 0 : state.originalLines.offset(found.line, found.column);
}

function pluginDiagnostic(
  state: PluginState,
  lines: Lines,
  plugin: string,
  code: string,
  message: string,
  severity: "error" | "warning" | "info",
  range: PluginRange | undefined,
): Diagnostic {
  let start = 0;
  let end = 0;
  if (
    range !== undefined &&
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start &&
    range.end <= state.text.length
  ) {
    start = toOriginal(state, lines, range.start);
    end = Math.max(start, toOriginal(state, lines, range.end));
  }
  return {
    ...makeDiagnostic(state.original, code, `plugin "${plugin}": ${message}`, start, end, severity),
    plugin,
  };
}

function toError(state: PluginState, diagnostic: Diagnostic): CompileError {
  return new CompileError(diagnostic, codeFrame(state.original, diagnostic.start), state.filename);
}

/**
 * Re-expresses an error the compiler raised on text a plugin had edited in terms of the original
 * source: the line and column in the error are traced back through the plugin's edits.
 *
 * @param state The state after the `pre` stage.
 * @param error The error from the compiler passes.
 * @returns A new error with the original position, or `error` itself when no plugin edited the module.
 * @internal
 * @since 1.0.0
 */
export function remapCompileError(state: PluginState, error: CompileError): CompileError {
  if (state.trail === null) return error;
  const { diagnostic } = error;
  const found = traceBack(state.trail, diagnostic.line - 1, diagnostic.column);
  if (found === undefined) return error;
  const start = state.originalLines.offset(found.line, found.column);
  const length = Math.max(0, diagnostic.end - diagnostic.start);
  const moved: Diagnostic = {
    ...makeDiagnostic(
      state.original,
      diagnostic.code,
      diagnostic.message,
      start,
      Math.min(start + length, state.original.length),
      diagnostic.severity,
    ),
  };
  if (diagnostic.plugin !== undefined) moved.plugin = diagnostic.plugin;
  return toError(state, moved);
}

// ---------- imports ----------

const SEPARATOR = "\u0000";

/** The imports of a tree as `module + NUL + imported name`; a side-effect import ends in NUL alone. */
function importEntries(program: AstNode): Set<string> {
  const out = new Set<string>();
  const body = program["body"];
  if (!Array.isArray(body)) return out;
  for (const statement of body as unknown[]) {
    if (!isNode(statement) || statement.type !== "ImportDeclaration") continue;
    if (statement["importKind"] === "type") continue;
    const source = statement["source"];
    const from = isNode(source) ? String(source["value"]) : "";
    const specifiers = statement["specifiers"];
    if (!Array.isArray(specifiers) || specifiers.length === 0) {
      out.add(`${from}${SEPARATOR}`);
      continue;
    }
    for (const specifier of specifiers as unknown[]) {
      if (!isNode(specifier) || specifier["importKind"] === "type") continue;
      let imported = "*";
      if (specifier.type === "ImportDefaultSpecifier") imported = "default";
      else if (specifier.type === "ImportSpecifier") {
        const name = specifier["imported"];
        imported = isNode(name) ? String(name["name"] ?? name["value"]) : "?";
      }
      out.add(`${from}${SEPARATOR}${imported}`);
    }
  }
  return out;
}

function isDeclared(plugin: CompilerPlugin, entry: string): boolean {
  const split = entry.indexOf(SEPARATOR);
  const from = entry.slice(0, split);
  const imported = entry.slice(split + 1);
  return (plugin.imports ?? []).some(
    (declared) => declared.from === from && (imported === "" || declared.names.includes(imported)),
  );
}

// ---------- one plugin call ----------

interface Replacement {
  start: number;
  end: number;
  code: string;
  named: boolean;
}

const own = new WeakSet<CompileError>();

function runPlugin(plugin: CompilerPlugin, stage: PluginStage, state: PluginState): void {
  const lines = new Lines(state.text);
  const replacements = new Map<string, Replacement>();
  const inserts: Array<{ at: number; code: string }> = [];
  const aliases = new Map<string, string>();
  const taken = new Set<string>();
  let takenReady = false;
  let edits = 0;
  let live = true;
  let current: AstNode | null = null;
  const errors: Diagnostic[] = [];
  const found: Diagnostic[] = [];

  const fail = (code: string, message: string, range?: PluginRange): CompileError => {
    const error = toError(
      state,
      pluginDiagnostic(state, lines, plugin.name, code, message, "error", range),
    );
    own.add(error);
    return error;
  };

  /** An error at a position that is already in the original text. */
  const failAt = (code: string, message: string, start: number, end: number): CompileError => {
    const error = toError(state, {
      ...makeDiagnostic(state.original, code, `plugin "${plugin.name}": ${message}`, start, end),
      plugin: plugin.name,
    });
    own.add(error);
    return error;
  };

  /** The context works while `transform` runs; a callback that fires later must not edit a finished module. */
  const alive = (): void => {
    if (!live) throw new Error("the plugin context is only valid while transform runs.");
  };

  const checkRange = (range: PluginRange): void => {
    alive();
    const { start, end } = range as { start: unknown; end: unknown };
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > state.text.length
    ) {
      throw new RangeError(
        `edit range [${String(start)}, ${String(end)}) is not inside the source (length ${state.text.length}).`,
      );
    }
  };

  const count = (): void => {
    edits += 1;
    if (edits > MAX_EDITS) {
      throw fail("PLUGIN_TOO_MANY_EDITS", `more than ${MAX_EDITS} edits in one call.`);
    }
  };

  const insertAt = (at: number, code: string): void => {
    if (typeof code !== "string") throw new TypeError("edit text must be a string.");
    count();
    if (code !== "") inserts.push({ at, code });
  };

  const replace = (range: PluginRange, code: string): void => {
    checkRange(range);
    if (typeof code !== "string") throw new TypeError("edit text must be a string.");
    if (range.start === range.end) {
      insertAt(range.start, code);
      return;
    }
    count();
    const type = (range as { type?: unknown }).type;
    replacements.set(`${range.start}:${range.end}`, {
      start: range.start,
      end: range.end,
      code,
      named: type === "Identifier" || type === "JSXIdentifier",
    });
  };

  const names = (): Set<string> => {
    if (!takenReady) {
      takenReady = true;
      walk(state.program, (node) => {
        if (node.type === "Identifier" || node.type === "JSXIdentifier") {
          const name = node["name"];
          if (typeof name === "string") taken.add(name);
        }
        return true;
      });
    }
    return taken;
  };

  const entryFor = (
    cache: Map<string, VisitorEntry<PluginNode> | null>,
    visitor: Visitor,
    type: string,
  ): VisitorEntry<PluginNode> | null => {
    const cached = cache.get(type);
    if (cached !== undefined) return cached;
    let entry: VisitorEntry<PluginNode> | null = null;
    if (type !== "enter" && type !== "leave" && Object.hasOwn(visitor, type)) {
      const value = (visitor as Record<string, unknown>)[type];
      if (typeof value === "function") entry = { enter: value as Visit<PluginNode> };
      else if (typeof value === "object" && value !== null)
        entry = value as VisitorEntry<PluginNode>;
    }
    cache.set(type, entry);
    return entry;
  };

  interface Frame {
    node: AstNode;
    parent: AstNode | null;
    children: AstNode[] | null;
    next: number;
  }
  const walkTree = (visitor: Visitor, root: PluginNode): void => {
    if (typeof visitor !== "object" || visitor === null) {
      throw new TypeError("walk() needs a visitor object.");
    }
    if (!isNode(root)) throw new TypeError("walk() needs a node to start from.");
    const generic = visitor as VisitorEntry<PluginNode>;
    const cache = new Map<string, VisitorEntry<PluginNode> | null>();
    const stack: Frame[] = [{ node: root as AstNode, parent: null, children: null, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const node = frame.node as unknown as PluginNode;
      const parent = frame.parent as unknown as PluginNode | null;
      if (frame.children === null) {
        current = frame.node;
        const typed = entryFor(cache, visitor, frame.node.type);
        let skip = generic.enter?.(node, parent) === false;
        if (typed?.enter?.(node, parent) === false) skip = true;
        frame.children = skip ? [] : childNodes(frame.node);
      }
      const child = frame.children[frame.next];
      if (child !== undefined) {
        frame.next += 1;
        stack.push({ node: child, parent: frame.node, children: null, next: 0 });
        continue;
      }
      current = frame.node;
      entryFor(cache, visitor, frame.node.type)?.leave?.(node, parent);
      generic.leave?.(node, parent);
      stack.pop();
    }
    current = null;
  };

  const context: PluginContext = Object.freeze({
    filename: state.filename,
    target: state.target,
    stage,
    dev: state.dev,
    source: state.text,
    create: factory,
    report(diagnostic: PluginDiagnostic): void {
      alive();
      const severity = diagnostic.severity ?? "warning";
      if (severity !== "error" && severity !== "warning" && severity !== "info") {
        throw new TypeError(`report(): unknown severity "${String(severity)}".`);
      }
      const built = pluginDiagnostic(
        state,
        lines,
        plugin.name,
        diagnostic.code ?? "PLUGIN_DIAGNOSTIC",
        String(diagnostic.message),
        severity,
        diagnostic.node,
      );
      (severity === "error" ? errors : found).push(built);
    },
    walk(visitor: Visitor, root?: PluginNode): void {
      alive();
      walkTree(visitor, root ?? (state.program as unknown as PluginNode));
    },
    is<K extends keyof NodeMap>(node: PluginNode | null | undefined, type: K): node is NodeMap[K] {
      return node !== null && node !== undefined && node.type === type;
    },
    text(range: PluginRange): string {
      checkRange(range);
      return state.text.slice(range.start, range.end);
    },
    replace,
    insertBefore(range: PluginRange, code: string): void {
      checkRange(range);
      insertAt(range.start, code);
    },
    insertAfter(range: PluginRange, code: string): void {
      checkRange(range);
      insertAt(range.end, code);
    },
    remove(range: PluginRange): void {
      replace(range, "");
    },
    addImport(from: string, imported: string): string {
      alive();
      if (typeof from !== "string" || typeof imported !== "string") {
        throw new TypeError("addImport() needs the module and the imported name as strings.");
      }
      if (!isDeclared(plugin, `${from}${SEPARATOR}${imported}`) || imported === "") {
        throw fail(
          "PLUGIN_UNDECLARED_IMPORT",
          `import of "${imported}" from "${from}" is not declared in the plugin's "imports".`,
        );
      }
      if (imported !== "default" && !IDENTIFIER.test(imported)) {
        throw new TypeError(`addImport(): "${imported}" is not an identifier.`);
      }
      const key = `${from}${SEPARATOR}${imported}`;
      const existing = aliases.get(key);
      if (existing !== undefined) return existing;
      const used = names();
      let alias = `_$p_${imported}`;
      let n = 1;
      while (used.has(alias)) {
        n += 1;
        alias = `_$p_${imported}${n}`;
      }
      used.add(alias);
      aliases.set(key, alias);
      return alias;
    },
  });

  const wrapThrown = (error: unknown): CompileError => {
    if (error instanceof CompileError && own.has(error)) return error;
    const reason = error instanceof Error ? error.message : String(error);
    const where = current === null ? undefined : { start: current.start, end: current.end };
    const wrapped = fail("PLUGIN_ERROR", reason, where);
    wrapped.cause = error;
    return wrapped;
  };

  let returned: unknown;
  try {
    returned = plugin.transform(state.program as unknown as ProgramNode, context);
  } catch (error) {
    live = false;
    throw wrapThrown(error);
  }
  live = false;
  if (returned !== undefined) {
    const thenable = typeof (returned as { then?: unknown } | null)?.then === "function";
    throw fail(
      "PLUGIN_BAD_RETURN",
      thenable
        ? "transform returned a promise; a plugin is synchronous."
        : "transform returned a value; a plugin returns nothing and edits through its context.",
    );
  }
  const first = errors[0];
  if (first !== undefined) throw toError(state, first);
  state.diagnostics.push(...found);
  if (edits === 0 && aliases.size === 0) return;

  // ---- apply ----
  const sorted = [...replacements.values()].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i += 1) {
    const before = sorted[i - 1];
    const after = sorted[i];
    if (before !== undefined && after !== undefined && before.end > after.start) {
      throw fail("PLUGIN_EDIT_CONFLICT", "two edits overlap.", after);
    }
  }
  for (const insert of inserts) {
    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const edit = sorted[middle];
      if (edit === undefined) break;
      if (insert.at <= edit.start) high = middle - 1;
      else if (insert.at >= edit.end) low = middle + 1;
      else throw fail("PLUGIN_EDIT_CONFLICT", "an insert is inside a replaced span.", edit);
    }
  }
  const magic = new MagicString(state.text);
  try {
    for (const edit of sorted) {
      if (edit.code === "") magic.remove(edit.start, edit.end);
      else
        magic.overwrite(edit.start, edit.end, edit.code, {
          storeName: edit.named,
          contentOnly: true,
        });
    }
    // The import comes first, so an insert at the same position follows it.
    if (aliases.size > 0) {
      const byModule = new Map<string, string[]>();
      for (const [key, alias] of aliases) {
        const split = key.indexOf(SEPARATOR);
        const from = key.slice(0, split);
        const list = byModule.get(from) ?? [];
        list.push(`${key.slice(split + 1)} as ${alias}`);
        byModule.set(from, list);
      }
      const declarations = [...byModule].map(
        ([from, specifiers]) => `import { ${specifiers.join(", ")} } from ${JSON.stringify(from)};`,
      );
      const at = leadingEnd(state.text, state.program);
      magic.appendLeft(
        at,
        at === 0 ? `${declarations.join("\n")}\n` : `\n${declarations.join("\n")}`,
      );
    }
    for (const insert of inserts) magic.appendLeft(insert.at, insert.code);
  } catch (error) {
    throw fail("PLUGIN_EDIT_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  const text = magic.toString();
  if (text === state.text) return;
  // Before the passes every character is mapped, so positions in the original stay exact through any
  // number of edits; after them the map keeps the granularity of the compiler's own.
  const step = magic.generateDecodedMap({
    source: state.filename,
    hires: stage === "pre" ? true : "boundary",
    includeContent: true,
  });
  const trail = state.trail === null ? step : composeMaps(step, state.trail);
  let program: AstNode;
  try {
    program = parseModule(text, state.filename).program;
  } catch (error) {
    if (!(error instanceof CompileError)) throw error;
    const probe: PluginState = { ...state, text, trail };
    const moved = remapCompileError(probe, error);
    throw failAt(
      "PLUGIN_INVALID_OUTPUT",
      `the edited module does not parse: ${error.diagnostic.message}`,
      moved.diagnostic.start,
      moved.diagnostic.end,
    );
  }
  const before = importEntries(state.program);
  const after = importEntries(program);
  for (const entry of after) {
    if (!before.has(entry) && !isDeclared(plugin, entry)) {
      const split = entry.indexOf(SEPARATOR);
      throw fail(
        "PLUGIN_UNDECLARED_IMPORT",
        `the edits add an import from "${entry.slice(0, split)}" that the plugin does not declare in "imports".`,
      );
    }
  }
  if (stage === "post") {
    for (const entry of before) {
      const from = entry.slice(0, entry.indexOf(SEPARATOR));
      if (state.runtime.includes(from) && !after.has(entry)) {
        throw fail(
          "PLUGIN_IMPORT_MODIFIED",
          `the edits remove or change an import from "${from}" that the generated code needs.`,
        );
      }
    }
  }
  state.text = text;
  state.program = program;
  state.trail = trail;
  state.edited = true;
}

/**
 * Runs the plugins of one stage in order. Each plugin sees the module as the plugins before it
 * left it. The state is updated in place: text, tree, map to the original, diagnostics.
 *
 * @param plugins The plugins of the stage, in list order.
 * @param stage The stage the plugins belong to.
 * @param state The shared state, with `text` and `program` set for this stage.
 * @throws CompileError For any plugin failure (see the plugin contract).
 * @internal
 * @since 1.0.0
 */
export function runStage(
  plugins: readonly CompilerPlugin[],
  stage: PluginStage,
  state: PluginState,
): void {
  for (const plugin of plugins) runPlugin(plugin, stage, state);
}
