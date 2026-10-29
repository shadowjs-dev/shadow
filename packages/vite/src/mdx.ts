import { CompileError, type CompilerPlugin, compile, validatePlugins } from "@shadow-js/compiler";
import type { Plugin } from "vite";
import { moduleFile } from "./internal/ids";

/**
 * `shadowMdx()`: a Vite plugin that turns `.mdx` (and `.md`) files into ShadowJS components. MDX is compiled to JSX by
 * `@mdx-js/mdx`, an optional peer, and the JSX goes through the ShadowJS compiler in the same step, so an MDX file needs no
 * other plugin to be compiled. The default export of a module is the component; the `export`s of the file (a `frontmatter`
 * from `remark-mdx-frontmatter`, a `meta` object) are named exports.
 * @packageDocumentation
 */

/** The file `@mdx-js/mdx` answers: a `VFile`, whose `value` holds the code. */
interface MdxOutput {
  readonly value: string | Uint8Array;
}

/** What `compile` of `@mdx-js/mdx` accepts (the options this plugin sets, and the lists it hands on). */
interface MdxCompileOptions {
  readonly jsx: true;
  readonly jsxImportSource: string;
  readonly development: false;
  readonly format: "mdx" | "md";
  readonly remarkPlugins?: readonly unknown[];
  readonly rehypePlugins?: readonly unknown[];
  readonly recmaPlugins?: readonly unknown[];
  readonly remarkRehypeOptions?: Readonly<Record<string, unknown>>;
  readonly providerImportSource?: string;
}

/** `compile` of `@mdx-js/mdx`, or a function with its shape. @since 1.0.0 */
export type MdxCompile = (
  file: { readonly value: string; readonly path: string },
  options: MdxCompileOptions,
) => Promise<MdxOutput>;

/** Options of {@link shadowMdx}. @since 1.0.0 */
export interface ShadowMdxOptions {
  /** Files to compile, matched against the module id without its query string. Default `/\.mdx$/`. Add `.md` to read Markdown files too. */
  readonly include?: RegExp;
  /** Files to skip; checked first. Default: any path with a `node_modules` segment. */
  readonly exclude?: RegExp;
  /** Plugins of the Markdown syntax tree (`remark-frontmatter`, `remark-mdx-frontmatter`, `remark-gfm`, ...), as `@mdx-js/mdx` takes them. */
  readonly remarkPlugins?: readonly unknown[];
  /** Plugins of the HTML syntax tree (`rehype-slug`, `rehype-autolink-headings`, ...). */
  readonly rehypePlugins?: readonly unknown[];
  /** Plugins of the JavaScript syntax tree. They run before the plugin's own pass over the elements. */
  readonly recmaPlugins?: readonly unknown[];
  /**
   * How the elements of Markdown (`h1`, `p`, `a`, `code`, ...) are rendered.
   *
   * - `"overridable"`: each one is looked up in the `components` prop (and the provider), so an app can replace `a` or `h1`
   *   for every page. Each looked-up element is rendered by `Dynamic`.
   * - `"static"`: each one is a plain element in the page's template, cloned in one call. The `components` prop still
   *   supplies components the file names itself (`<Chart />`) and the `wrapper`, but cannot replace `h1` or `a`.
   *
   * Choose `"static"` for pages that never replace a Markdown element: documentation and blog posts render faster and ship
   * less code.
   * @default "overridable"
   */
  readonly elements?: "overridable" | "static";
  /** Options of `remark-rehype`. */
  readonly remarkRehypeOptions?: Readonly<Record<string, unknown>>;
  /**
   * A module that exports `useMDXComponents`, whose components every MDX file may use without a `components` prop (the
   * way `@mdx-js/react` works for React). Default: none; pass `components` to the file's component instead.
   */
  readonly providerImportSource?: string;
  /** `@mdx-js/mdx`, by module name, or your own `compile`. Default `"@mdx-js/mdx"`. */
  readonly mdx?: string | MdxCompile;
  /** Compiler plugins that run on the JSX of every MDX file (see `ShadowPluginOptions.plugins`). */
  readonly plugins?: readonly CompilerPlugin[];
  /**
   * Module the compiled code imports its runtime helpers from. Default `"@shadow-js/web"` (`"@shadow-js/web/server"` for SSR).
   * With `elements: "overridable"` the file also imports `Dynamic` from it, so a custom module must export `Dynamic`;
   * `"@shadow-js/web/server"` has none, so `Dynamic` is then imported from `"@shadow-js/web"`.
   */
  readonly moduleName?: string;
}

/** A node of the JavaScript syntax tree `@mdx-js/mdx` hands to recma plugins (ESTree with JSX), read structurally. */
interface EsNode {
  type: string;
  [key: string]: unknown;
}

function isNode(value: unknown): value is EsNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * The module `Dynamic` is imported from: the one `moduleName` names, so a project that points the runtime at
 * its own module (an alias, a re-export) does not need `@shadow-js/web` resolvable as well. The one exception
 * is the SSR helpers entry `@shadow-js/web/server`: it holds the server helpers and no `Dynamic`, which the
 * main entry provides (and Vite resolves to its server build in an SSR build).
 */
function dynamicSourceOf(moduleName: string | undefined): string {
  if (moduleName === undefined || moduleName === "@shadow-js/web/server") return "@shadow-js/web";
  return moduleName;
}

/** The identifier `@mdx-js/mdx` binds the element lookup table to. */
const LOOKUP = "_components";
/** The local name of `Dynamic`: it cannot clash with a name the file exports or imports. */
const DYNAMIC = "_ShadowDynamic";

/**
 * Rewrites the elements `@mdx-js/mdx` looks up in its table (`<_components.h1>`): into plain `<h1>` for `"static"`, into
 * `<Dynamic component={_components.h1}>` for `"overridable"`. The lookup yields a string for a default element and a
 * function for an override, and a ShadowJS component tag must be a function.
 */
function elementsPlugin(
  mode: "overridable" | "static",
  dynamicSource: string,
): () => (tree: EsNode) => void {
  return () => (tree) => {
    let rewritten = 0;
    const pending: unknown[] = [tree];
    while (pending.length > 0) {
      const node = pending.pop();
      if (Array.isArray(node)) {
        for (const child of node) pending.push(child);
        continue;
      }
      if (!isNode(node)) continue;
      if (node.type === "JSXElement") {
        const opening = node["openingElement"];
        const closing = node["closingElement"];
        if (isNode(opening) && lookupName(opening["name"]) !== undefined) {
          const tag = lookupName(opening["name"]) as string;
          if (mode === "static") {
            opening["name"] = identifier(tag);
          } else {
            opening["name"] = identifier(DYNAMIC);
            const attributes = opening["attributes"] as unknown[];
            attributes.unshift({
              type: "JSXAttribute",
              name: identifier("component"),
              value: {
                type: "JSXExpressionContainer",
                expression: {
                  type: "MemberExpression",
                  object: { type: "Identifier", name: LOOKUP },
                  property: { type: "Identifier", name: tag },
                  computed: false,
                  optional: false,
                },
              },
            });
            rewritten += 1;
          }
          if (isNode(closing)) closing["name"] = identifier(mode === "static" ? tag : DYNAMIC);
        }
      }
      for (const value of Object.values(node)) {
        if (typeof value === "object" && value !== null) pending.push(value);
      }
    }
    if (rewritten > 0) {
      const body = tree["body"] as unknown[];
      body.unshift({
        type: "ImportDeclaration",
        specifiers: [
          {
            type: "ImportSpecifier",
            imported: { type: "Identifier", name: "Dynamic" },
            local: { type: "Identifier", name: DYNAMIC },
          },
        ],
        source: { type: "Literal", value: dynamicSource, raw: JSON.stringify(dynamicSource) },
        attributes: [],
      });
    }
  };
}

/** The element name of `_components.name` as a JSX tag name, otherwise `undefined`. */
function lookupName(name: unknown): string | undefined {
  if (!isNode(name) || name.type !== "JSXMemberExpression") return undefined;
  const object = name["object"];
  const property = name["property"];
  if (!isNode(object) || object.type !== "JSXIdentifier" || object["name"] !== LOOKUP)
    return undefined;
  return isNode(property) && typeof property["name"] === "string" ? property["name"] : undefined;
}

function identifier(name: string): EsNode {
  return { type: "JSXIdentifier", name };
}

const DEFAULT_INCLUDE = /\.mdx$/;
const DEFAULT_EXCLUDE = /[\\/]node_modules[\\/]/;

/** `@mdx-js/mdx` warns with a position; so do the errors of its parsers. */
interface Positioned {
  readonly message?: string;
  readonly line?: number | null;
  readonly column?: number | null;
  readonly reason?: string;
}

async function loadMdx(specifier: string): Promise<MdxCompile> {
  let loaded: { compile?: unknown };
  try {
    loaded = (await import(specifier)) as { compile?: unknown };
  } catch (cause) {
    throw new Error(
      `shadowMdx: cannot load "${specifier}". Install it with "npm install --save-dev ${specifier}", or pass your own function as mdx.`,
      { cause },
    );
  }
  if (typeof loaded.compile !== "function") {
    throw new TypeError(`shadowMdx: the module "${specifier}" has no compile function.`);
  }
  const compileMdx = loaded.compile;
  return (file, options) =>
    Reflect.apply(compileMdx, undefined, [file, options]) as Promise<MdxOutput>;
}

/**
 * Creates the plugin that compiles MDX to ShadowJS components. It runs before Vite's own handling (`enforce: "pre"`), so Vite
 * never sees MDX or JSX. A file is compiled for the browser, or for the server in an SSR build; a syntax error in the MDX is
 * reported with its file, line and column. Hot updates reload the page: an MDX file has no component state worth keeping.
 *
 * @param options Which files, the remark, rehype and recma plugins, and the MDX compiler.
 * @returns A Vite plugin named `shadowjs-mdx`.
 * @throws TypeError when `include` or `exclude` is not a `RegExp`, or `plugins` is not a list of valid compiler plugins.
 * @example
 * // vite.config.ts
 * import { shadow } from "@shadow-js/vite";
 * import { shadowMdx } from "@shadow-js/vite/mdx";
 * import remarkFrontmatter from "remark-frontmatter";
 * import remarkMdxFrontmatter from "remark-mdx-frontmatter";
 *
 * export default {
 *   plugins: [
 *     shadowMdx({ remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter] }),
 *     shadow(),
 *   ],
 * };
 * @since 1.0.0
 */
export function shadowMdx(options: ShadowMdxOptions = {}): Plugin {
  for (const name of ["include", "exclude"] as const) {
    const value = options[name];
    if (value !== undefined && !(value instanceof RegExp)) {
      throw new TypeError(`shadowMdx(): "${name}" must be a RegExp (got ${typeof value}).`);
    }
  }
  const plugins =
    options.plugins === undefined ? [] : validatePlugins(options.plugins, "shadowMdx(): plugins");
  const include = statelessPattern(options.include ?? DEFAULT_INCLUDE);
  const exclude = statelessPattern(options.exclude ?? DEFAULT_EXCLUDE);
  let compileMdx: Promise<MdxCompile> | undefined;
  let dev = false;
  return {
    name: "shadowjs-mdx",
    enforce: "pre",
    config(_config, env) {
      dev = env.command === "serve";
    },
    async transform(code, id, transformOptions) {
      const { file, skip } = moduleFile(id);
      if (skip || exclude.test(file) || !include.test(file)) return null;
      compileMdx ??=
        typeof options.mdx === "function"
          ? Promise.resolve(options.mdx)
          : loadMdx(options.mdx ?? "@mdx-js/mdx");
      const mdx = await compileMdx;
      let jsx: string;
      try {
        const output = await mdx(
          { value: code, path: file },
          {
            jsx: true,
            jsxImportSource: options.moduleName ?? "@shadow-js/web",
            development: false,
            format: file.endsWith(".mdx") ? "mdx" : "md",
            ...(options.remarkPlugins === undefined
              ? {}
              : { remarkPlugins: options.remarkPlugins }),
            ...(options.rehypePlugins === undefined
              ? {}
              : { rehypePlugins: options.rehypePlugins }),
            recmaPlugins: [
              ...(options.recmaPlugins ?? []),
              elementsPlugin(
                options.elements ?? "overridable",
                dynamicSourceOf(options.moduleName),
              ),
            ],
            ...(options.remarkRehypeOptions === undefined
              ? {}
              : { remarkRehypeOptions: options.remarkRehypeOptions }),
            ...(options.providerImportSource === undefined
              ? {}
              : { providerImportSource: options.providerImportSource }),
          },
        );
        jsx =
          typeof output.value === "string"
            ? output.value
            : Buffer.from(output.value).toString("utf8");
      } catch (error) {
        const found = error as Positioned;
        const position =
          typeof found.line === "number" && found.line > 0
            ? { line: found.line, column: Math.max((found.column ?? 1) - 1, 0) }
            : undefined;
        return this.error(found.reason ?? found.message ?? String(error), position);
      }
      try {
        const result = compile(jsx, {
          filename: `${file}.tsx`,
          generate: transformOptions?.ssr === true ? "ssr" : "dom",
          dev,
          autoReactive: true,
          hmr: false,
          ...(options.moduleName === undefined ? {} : { moduleName: options.moduleName }),
          ...(plugins.length > 0 ? { plugins } : {}),
        });
        for (const diagnostic of result.diagnostics) {
          if (diagnostic.severity === "warning") {
            this.warn(diagnostic.message, { line: diagnostic.line, column: diagnostic.column });
          }
        }
        return {
          code: result.transformed ? result.code : jsx,
          map: result.transformed ? result.map : null,
        };
      } catch (error) {
        if (error instanceof CompileError) {
          return this.error(
            error.message,
            error.diagnostic.line === 0
              ? undefined
              : { line: error.diagnostic.line, column: error.diagnostic.column },
          );
        }
        throw error;
      }
    },
  };
}

/** The same pattern without the `g` and `y` flags, so `test()` does not remember where the last call ended. */
function statelessPattern(pattern: RegExp): RegExp {
  return pattern.global || pattern.sticky
    ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""))
    : pattern;
}
