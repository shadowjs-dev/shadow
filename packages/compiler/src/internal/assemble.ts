import MagicString, { type DecodedSourceMap, SourceMap } from "magic-string";
import { type AstNode, isJsx, leadingEnd, unwrapParens, walk } from "./ast";
import { unassignableNames } from "./bindings";
import { deriveLocals } from "./derive";
import { CompileError, codeFrame, type Diagnostic, makeDiagnostic } from "./diagnostics";
import { type DomContext, generateDom } from "./dom";
import { applyHmr, hmrEpilogue, hmrPrelude } from "./hmr";
import { type LowerContext, lowerJsx, MAX_JSX_DEPTH } from "./lower";
import { errorInSource, mapInSource, type Origin } from "./origin";
import { parseModule } from "./parse";
import type { CompilerPlugin } from "./plugin-types";
import {
  createPluginState,
  pluginsOf,
  remapCompileError,
  runStage,
  validatePlugins,
} from "./plugins";
import { Registry } from "./registry";
import { composeMaps } from "./sourcemap";
import { generateSsr } from "./ssr";
import { specializeStoreCells } from "./store-cells";

/**
 * Which kind of output {@link compile} produces: `"dom"` for browser rendering (also used to
 * hydrate server markup) and `"ssr"` for server rendering to strings.
 * @since 1.0.0
 */
export type Target = "dom" | "ssr";

/**
 * Options of {@link compile}.
 * @since 1.0.0
 */
export interface CompileOptions {
  /**
   * Name of the module being compiled. Its extension selects the parser language (`.tsx`, `.ts`,
   * `.mts`, `.cts`; anything else, including `.jsx` and `.js`, parses as JSX), and the name is used as
   * the `id` of a {@link CompileError} and as the source of the source map.
   * @default "module.tsx"
   */
  filename?: string;
  /**
   * Output flavor: `"dom"` emits template cloning and reactive bindings, `"ssr"` emits strings
   * with hydration keys.
   * @default "dom"
   */
  generate?: Target;
  /**
   * Module the generated code imports its runtime helpers from. The `dom` output then imports from
   * it (and the `hmr` output from `<moduleName>/hmr`).
   * @default "@shadow-js/web" for the dom target, "@shadow-js/web/server" for the ssr target
   */
  moduleName?: string;
  /**
   * Development output. On the `dom` target, component calls also pass the component's name as a
   * third argument, so devtools can label it. It does not enable HMR and has no effect on the
   * `ssr` target.
   * @default false
   */
  dev?: boolean;
  /**
   * Forgiving reactivity: inside a component, a `const` computed from reactive reads stays live
   * wherever it is used, without a function or a `useMemo`. Set `false` to leave such constants as
   * written. It does not affect the `useStore` rewrite, which always runs.
   * @default true
   */
  autoReactive?: boolean;
  /**
   * Wrap the top-level components of the module so an edit swaps them in place; a module that
   * exports only components also accepts hot updates itself (`import.meta.hot`). Applies to the `dom` target only; it is
   * ignored for `ssr`, and it does not depend on {@link CompileOptions.dev}: callers such as
   * `@shadow-js/vite` pass it only in development.
   * @default false
   */
  hmr?: boolean;
  /**
   * `ssr` target only: mark each template root with a hydration key so the browser can attach to
   * the server markup. Set `false` for markup that is never hydrated.
   * @default true
   */
  hydratable?: boolean;
  /**
   * Produce a source map in {@link CompileResult.map}. When `false`, `map` is `null`.
   * @default true
   */
  sourceMap?: boolean;
  /**
   * Compiler plugins. They run in the build, on one module at a time: `"pre"` plugins (the default)
   * on the syntax tree of the source before every compiler pass, `"post"` plugins on the tree of
   * the generated code, each group in list order. A plugin reports findings and changes the module
   * through edits; its errors are {@link CompileError}s that carry the plugin's name. See
   * {@link CompilerPlugin}. An absent or empty list costs nothing.
   * @default undefined (no plugins)
   */
  plugins?: readonly CompilerPlugin[];
}

/**
 * What {@link compile} returns.
 * @since 1.0.0
 */
export interface CompileResult {
  /** The module text. Code outside JSX and `useStore` calls keeps its exact text. */
  code: string;
  /**
   * Source map from `code` back to the input, with the sources embedded. `null` when
   * `sourceMap` is `false` and when nothing was rewritten as JSX (so `transformed` can be `true`
   * with a `null` map when only `useStore` calls were rewritten).
   */
  map: ReturnType<MagicString["generateMap"]> | null;
  /**
   * Non-fatal findings: the `"warning"` and `"info"` diagnostics that compiler plugins reported, in
   * report order. Empty without plugins: the compiler itself reports problems by throwing a
   * {@link CompileError}.
   */
  diagnostics: Diagnostic[];
  /** False when nothing was rewritten: no JSX to compile and no `useStore` call to specialize. */
  transformed: boolean;
}

/** A cheap test before parsing: `<` then what can start a tag name (JSX names are Unicode identifiers) or `>`. */
const JSX_HINT = /<[\p{ID_Start}_$>]/u;

/** True when the module contains a JSX element or fragment anywhere (the walk stops at the first). */
function containsJsx(program: AstNode): boolean {
  let found = false;
  walk(program, (node) => {
    if (found) return false;
    if (isJsx(node)) found = true;
    return !found;
  });
  return found;
}

/** A JSX root found in a program, with the node that holds it and the parentheses around it. */
interface RootSite {
  jsx: AstNode;
  /** The root, or the outermost `ParenthesizedExpression` around it. */
  top: AstNode;
  /** What holds `top`; `null` when `top` is where the search started. */
  owner: AstNode | null;
}

/** Notes the parent of a parenthesized JSX expression, so a root can find the node that holds it. */
function noteParentheses(
  node: AstNode,
  parent: AstNode | null,
  seen: Map<AstNode, AstNode | null>,
): void {
  if (node.type === "ParenthesizedExpression" && isJsx(unwrapParens(node))) seen.set(node, parent);
}

function siteOf(
  jsx: AstNode,
  parent: AstNode | null,
  seen: Map<AstNode, AstNode | null>,
): RootSite {
  let top = jsx;
  let owner = parent;
  while (owner !== null && owner.type === "ParenthesizedExpression") {
    top = owner;
    owner = seen.get(owner) ?? null;
  }
  return { jsx, top, owner };
}

/**
 * Compiles the JSX in a module into calls to the ShadowJS runtime, and rewrites single-value
 * `useStore` calls to signal cells. It is a pure function: the output depends only on the
 * arguments. Code outside JSX keeps its exact text and position, so TypeScript syntax survives for
 * later stages.
 *
 * @param sourceText Module text to compile.
 * @param options Target, module name, development and reactivity switches. Undefined uses the
 * defaults of each option.
 * @returns The new code, a source map, and `transformed`, which is `false` (with the code unchanged)
 * when the module has no JSX and no `useStore` call to rewrite.
 * @throws CompileError `PARSE_ERROR` when the module has a syntax error. Unsupported JSX throws too:
 * `INVALID_HTML_NESTING`, `STRING_EVENT_HANDLER`, `BAD_TAG`, `NAMESPACED_TAG`, `BAD_ATTRIBUTE`,
 * `EMPTY_ATTRIBUTE_EXPRESSION`, `UNKNOWN_NAMESPACE`, `CHILDREN_ATTRIBUTE`, `CHILDREN_CONFLICT`,
 * `SPREAD_CHILD`, `BAD_CHILD`, `JSX_TOO_DEEP`, `VOID_CHILDREN`, `RAW_TEXT_CLOSE`, and on the `ssr`
 * target `INNER_HTML_CHILDREN` and `TEXT_CONTENT_CHILDREN`. `INTERNAL` marks a compiler bug.
 * @example
 * import { compile } from "@shadow-js/compiler";
 *
 * const source = `export const Hello = () => <h1>Hello</h1>;`;
 * const dom = compile(source, { filename: "hello.tsx" });
 * console.log(dom.transformed); // true
 * console.log(dom.code.includes('from "@shadow-js/web"')); // true
 * const ssr = compile(source, { filename: "hello.tsx", generate: "ssr" });
 * console.log(ssr.code.includes('from "@shadow-js/web/server"')); // true
 * @see CompileOptions
 * @see CompileError
 * @since 1.0.0
 */
export function compile(sourceText: string, options: CompileOptions = {}): CompileResult {
  if (options.plugins === undefined) return run(sourceText, options, false);
  const plugins = validatePlugins(options.plugins);
  if (plugins.length === 0) return run(sourceText, options, false);
  return runWithPlugins(sourceText, options, plugins);
}

/** The result of the compiler passes, with the map in decoded form when a caller composes it. */
interface Run extends CompileResult {
  decoded: DecodedSourceMap | null;
}

/**
 * The compiler passes. Two of them rewrite the text before the JSX is compiled (the `useStore` cells
 * and the derived constants), so the positions of the later passes are positions of the rewritten
 * text; the origin of each rewrite is kept, and an error and the source map are traced back to the text
 * the caller passed in.
 */
function run(sourceText: string, options: CompileOptions, wantDecoded: boolean): Run {
  const chain: Origin[] = [];
  try {
    return runPasses(sourceText, options, wantDecoded, chain);
  } catch (error) {
    throw error instanceof CompileError ? errorInSource(error, chain, sourceText) : error;
  }
}

function runPasses(
  sourceText: string,
  options: CompileOptions,
  wantDecoded: boolean,
  chain: Origin[],
): Run {
  const filename = options.filename ?? "module.tsx";
  // `useStore(<single value>)` calls become cell calls first (see store-cells.ts). The rewrite runs
  // on modules without JSX too, which is why it is reported through `transformed` on every path.
  const cells = specializeStoreCells(sourceText, filename);
  if (cells.origin !== null) chain.push(cells.origin);
  let source = cells.code;
  if (!JSX_HINT.test(source))
    return { code: source, map: null, decoded: null, diagnostics: [], transformed: cells.changed };

  let input = source;
  let parsed = parseModule(input, filename);
  // A module with no JSX (a plain `.ts` that only has generics) has nothing to derive or lower.
  if (!containsJsx(parsed.program))
    return {
      code: cells.code,
      map: null,
      decoded: null,
      diagnostics: [],
      transformed: cells.changed,
    };
  if (options.autoReactive !== false) {
    const runtime =
      options.moduleName ??
      ((options.generate ?? "dom") === "ssr" ? "@shadow-js/web/server" : "@shadow-js/web");
    const derived = deriveLocals(input, parsed.program, runtime);
    if (derived.changed) {
      if (derived.origin !== null) chain.push(derived.origin);
      input = derived.code;
      parsed = parseModule(input, filename);
    }
  }
  const { program } = parsed;
  // From here on `source` is the (possibly rewritten) text every node position refers to.
  source = input;
  const roots: RootSite[] = [];
  const taken = new Set<string>();
  const parenthesized = new Map<AstNode, AstNode | null>();
  walk(program, (node, parent) => {
    if (node.type === "Identifier" || node.type === "JSXIdentifier") {
      const name = node["name"];
      if (typeof name === "string" && (name.startsWith("_") || name.startsWith("$")))
        taken.add(name);
    }
    noteParentheses(node, parent, parenthesized);
    if (isJsx(node)) {
      roots.push(siteOf(node, parent, parenthesized));
      return false;
    }
    return true;
  });
  if (roots.length === 0)
    return {
      code: cells.code,
      map: null,
      decoded: null,
      diagnostics: [],
      transformed: cells.changed,
    };

  const target: Target = options.generate ?? "dom";
  const registry = new Registry(
    taken,
    options.moduleName ?? (target === "ssr" ? "@shadow-js/web/server" : "@shadow-js/web"),
  );
  const context: DomContext = {
    source,
    id: filename,
    reg: registry,
    immutable: unassignableNames(program),
    dev: options.dev === true,
    hydratable: options.hydratable !== false,
    blocks: new Map(),
    text(node: AstNode): string {
      return textOf(node);
    },
  };
  const lowerContext: LowerContext = context;

  // JSX inside an expression of JSX (`<a x={<b y={<c />} />} />`, `{ok && <b />}`) is generated while its
  // parent is, so these calls nest on the stack. `lowerJsx` bounds the depth of one tree; this bounds
  // the trees inside each other, so no input reaches a stack overflow instead of a diagnostic.
  let nesting = 0;
  // The generated code of a root, by root. A conditional child is read twice (whole, then its test and
  // branches for the memoized form), and every read generates the JSX inside it again: without this a
  // conditional nested n deep costs 2^n. Generating a root twice registers nothing the first time did
  // not (templates and helpers are deduplicated), so the output is the same. The map lives for one
  // compile and holds at most one entry per JSX node of the module.
  const generated = new Map<AstNode, string>();
  const generate = (root: AstNode): string => {
    const known = generated.get(root);
    if (known !== undefined) return known;
    const code = generateOnce(root);
    generated.set(root, code);
    return code;
  };
  const generateOnce = (root: AstNode): string => {
    nesting += 1;
    try {
      if (nesting > MAX_JSX_DEPTH) {
        const diagnostic = makeDiagnostic(
          source,
          "JSX_TOO_DEEP",
          `JSX is nested more than ${MAX_JSX_DEPTH} levels deep inside expressions.`,
          root.start,
          root.end,
        );
        throw new CompileError(diagnostic, codeFrame(source, root.start), filename);
      }
      return (target === "ssr" ? generateSsr : generateDom)(
        context,
        lowerJsx(lowerContext, root, "html"),
      );
    } finally {
      nesting -= 1;
    }
  };

  /**
   * The span of the source that a root replaces, and its text. An element root that is the whole
   * body of a function (`return <el/>;`, `() => <el/>`) replaces that body with the statements
   * of the element, so no function is created to run them.
   */
  function place(site: RootSite): { start: number; end: number; text: string } {
    const code = generate(site.jsx);
    const body = context.blocks.get(code);
    const owner = site.owner;
    if (body !== undefined && owner !== null) {
      if (owner.type === "ReturnStatement" && owner["argument"] === site.top)
        return { start: owner.start, end: owner.end, text: `{\n${body}\n}` };
      if (
        owner.type === "ArrowFunctionExpression" &&
        owner["expression"] === true &&
        owner["body"] === site.top
      )
        return { start: site.top.start, end: site.top.end, text: `{\n${body}\n}` };
    }
    return { start: site.jsx.start, end: site.jsx.end, text: code };
  }

  function textOf(node: AstNode): string {
    const nested: RootSite[] = [];
    const seen = new Map<AstNode, AstNode | null>();
    walk(node, (current, parent) => {
      noteParentheses(current, parent, seen);
      if (isJsx(current)) {
        nested.push(siteOf(current, parent, seen));
        return false;
      }
      return true;
    });
    if (nested.length === 0) return source.slice(node.start, node.end);
    let out = "";
    let position = node.start;
    for (const site of nested) {
      const placed = place(site);
      out += source.slice(position, placed.start) + placed.text;
      position = placed.end;
    }
    return out + source.slice(position, node.end);
  }

  const magic = new MagicString(source);
  for (const site of roots) {
    const placed = place(site);
    magic.overwrite(placed.start, placed.end, placed.text);
  }
  const hmrRuntime = `${options.moduleName ?? "@shadow-js/web"}/hmr`;
  let hmrPrefix = "";
  let hmrSuffix = "";
  if (options.hmr === true && target === "dom") {
    const result = applyHmr(program, magic, registry, filename, hmrRuntime);
    if (result.components > 0) {
      hmrPrefix = hmrPrelude(registry, hmrRuntime, filename);
      if (result.selfAccepting) hmrSuffix = hmrEpilogue(registry, hmrRuntime);
    }
  }
  const epilogue = registry.epilogue() + hmrSuffix;
  const prelude = registry.prelude() + hmrPrefix;
  const insertAt = leadingEnd(source, program);
  if (prelude.length > 0) {
    if (insertAt === 0) magic.prepend(prelude);
    else magic.appendLeft(insertAt, `\n${prelude}`);
  }
  if (epilogue.length > 0) magic.append(epilogue);
  const mapOptions = { source: filename, hires: "boundary", includeContent: true } as const;
  let map: Run["map"] = null;
  let decoded: DecodedSourceMap | null = null;
  if (chain.length === 0) {
    if (options.sourceMap !== false) map = magic.generateMap(mapOptions);
    if (wantDecoded) decoded = magic.generateDecodedMap(mapOptions);
  } else if (options.sourceMap !== false || wantDecoded) {
    // The positions of the map are those of the rewritten text: trace them back to the module.
    decoded = mapInSource(magic.generateDecodedMap(mapOptions), chain, source, sourceText);
    if (options.sourceMap !== false) map = new SourceMap(decoded);
    if (!wantDecoded) decoded = null;
  }
  return { code: magic.toString(), map, decoded, diagnostics: [], transformed: true };
}

/**
 * The compiler passes with plugins around them: `pre` plugins on the source, the passes on what they
 * leave, `post` plugins on the generated code. The source map of every edit is composed with the
 * map of the passes, so the result still points at the module as it was written.
 */
function runWithPlugins(
  sourceText: string,
  options: CompileOptions,
  plugins: readonly CompilerPlugin[],
): CompileResult {
  const filename = options.filename ?? "module.tsx";
  const target: Target = options.generate ?? "dom";
  const runtime = options.moduleName ?? "@shadow-js/web";
  const state = createPluginState(sourceText, {
    filename,
    target,
    dev: options.dev === true,
    runtime: [
      options.moduleName ?? (target === "ssr" ? "@shadow-js/web/server" : "@shadow-js/web"),
      `${runtime}/hmr`,
    ],
  });
  const pre = pluginsOf(plugins, "pre");
  if (pre.length > 0) {
    state.program = parseModule(sourceText, filename).program;
    runStage(pre, "pre", state);
  }
  let compiled: Run;
  try {
    compiled = run(state.text, options, true);
  } catch (error) {
    throw error instanceof CompileError ? remapCompileError(state, error) : error;
  }
  if (compiled.decoded !== null) {
    state.trail =
      state.trail === null ? compiled.decoded : composeMaps(compiled.decoded, state.trail);
  }
  state.text = compiled.code;
  const post = pluginsOf(plugins, "post");
  if (post.length > 0) {
    state.program = parseModule(state.text, filename).program;
    runStage(post, "post", state);
  }
  let map: CompileResult["map"] = null;
  if (options.sourceMap !== false) {
    if (!state.edited) map = compiled.map;
    else if (state.trail !== null) map = new SourceMap(state.trail);
  }
  return {
    code: state.text,
    map,
    diagnostics: state.diagnostics,
    transformed: compiled.transformed || state.edited,
  };
}
