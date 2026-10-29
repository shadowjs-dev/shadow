import { describe, expect, it } from "vitest";
import shadow from "../src/index";
import { shadowMdx } from "../src/mdx";

type Hook = (
  this: { error(message: string): never; warn(message: string): void },
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => unknown;

const SOURCE = "export const App = () => <button onClick={() => 1}>hi</button>;";

function hookOf(plugin: { transform?: unknown }): Hook {
  const hook = plugin.transform as Hook | { handler: Hook } | undefined;
  if (hook === undefined) throw new Error("plugin has no transform");
  return typeof hook === "function" ? hook : hook.handler;
}

const warnings: string[] = [];
const context = {
  error(message: string): never {
    throw new Error(message);
  },
  warn(message: string): void {
    warnings.push(message);
  },
};

/** A module id the way Vite hands it to `transform`: the file and its query. */
const REQUESTS_FOR_BYTES = [
  "/app/a.tsx?raw",
  "/app/a.tsx?url",
  "/app/a.tsx?import&raw",
  "/app/a.tsx?v=1&url",
  "/app/a.tsx?raw&v=1",
];
const MODULE_REQUESTS = [
  "/app/a.tsx",
  "/app/a.tsx?import",
  "/app/a.tsx?v=123",
  "/app/a.tsx?t=1700000000000",
  "/app/a.tsx?v=raw",
  "/app/a.tsx?rawish",
  "/app/a.tsx?curl",
];

describe("vite plugin review round", () => {
  it("[VIT-REV-1] ?raw and ?url requests are a file's bytes, not a module to compile", () => {
    const run = hookOf(shadow());
    for (const id of REQUESTS_FOR_BYTES) {
      expect(run.call(context, SOURCE, id, { ssr: false }), id).toBeNull();
    }
    for (const id of MODULE_REQUESTS) {
      expect(run.call(context, SOURCE, id, { ssr: false }), id).not.toBeNull();
    }
  });

  it("[VIT-REV-2] ?raw and ?url requests of a plain module that calls useStore are left alone", () => {
    const run = hookOf(shadow());
    const code = 'import { useStore } from "@shadow-js/core";\nexport const c = useStore(0);\n';
    expect(run.call(context, code, "/app/store.ts?raw", { ssr: false })).toBeNull();
    expect(run.call(context, code, "/app/store.ts", { ssr: false })).not.toBeNull();
  });

  it("[VIT-REV-3] MDX: a ?raw or ?url request is the file's text, not MDX to compile", async () => {
    let compiled = 0;
    const plugin = shadowMdx({
      mdx: async () => {
        compiled += 1;
        return { value: "export default function Page() { return <p>x</p>; }" };
      },
    });
    const run = hookOf(plugin) as unknown as (...args: Parameters<Hook>) => Promise<unknown>;
    for (const id of ["/a/b.mdx?raw", "/a/b.mdx?url", "/a/b.mdx?import&raw"]) {
      expect(await run.call(context, 'export default "# x"', id, { ssr: false }), id).toBeNull();
    }
    expect(compiled).toBe(0);
    expect(await run.call(context, "# x", "/a/b.mdx?v=1", { ssr: false })).not.toBeNull();
    expect(compiled).toBe(1);
    expect(warnings).toEqual([]);
  });
});

describe("[VIT-R2-10] MDX: Dynamic comes from the module the options name", () => {
  /** Runs the plugin's own recma pass over a tree with one looked-up element, and returns the import it adds. */
  async function importSource(moduleName: string | undefined): Promise<unknown> {
    let source: unknown;
    const plugin = shadowMdx({
      ...(moduleName === undefined ? {} : { moduleName }),
      mdx: async (_file, options) => {
        const attach = options.recmaPlugins?.at(-1);
        if (typeof attach !== "function") throw new Error("no elements plugin");
        const tree = {
          type: "Program",
          body: [
            {
              type: "ExpressionStatement",
              expression: {
                type: "JSXElement",
                openingElement: {
                  type: "JSXOpeningElement",
                  name: {
                    type: "JSXMemberExpression",
                    object: { type: "JSXIdentifier", name: "_components" },
                    property: { type: "JSXIdentifier", name: "h1" },
                  },
                  attributes: [],
                },
                closingElement: null,
                children: [],
              },
            },
          ],
        };
        (attach() as (tree: unknown) => void)(tree);
        const first: unknown = tree.body[0];
        source =
          typeof first === "object" && first !== null
            ? (Reflect.get(first, "source") as { value?: unknown } | undefined)?.value
            : undefined;
        return { value: "export default function Page() { return <p>x</p>; }" };
      },
    });
    const run = hookOf(plugin) as unknown as (...args: Parameters<Hook>) => Promise<unknown>;
    await run.call(context, "# x", "/a/b.mdx", { ssr: false });
    return source;
  }

  it("[VIT-R2-10.1] without moduleName the import is @shadow-js/web", async () => {
    expect(await importSource(undefined)).toBe("@shadow-js/web");
  });

  it("[VIT-R2-10.2] a custom moduleName is where Dynamic is imported from", async () => {
    expect(await importSource("my-web-runtime")).toBe("my-web-runtime");
  });

  it("[VIT-R2-10.3] the SSR helpers entry has no Dynamic, so it is read from the main entry", async () => {
    expect(await importSource("@shadow-js/web/server")).toBe("@shadow-js/web");
  });
});
