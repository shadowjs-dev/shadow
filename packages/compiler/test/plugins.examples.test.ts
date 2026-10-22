import { describe, expect, it } from "vitest";
import { type CompilerPlugin, compile } from "../src/javascript";
import {
  i18nExtractor,
  registry,
  sortClassNames,
  stripTestIds,
  templateBudget,
} from "./support/example-plugins";

const VIEW = `import { t } from "./i18n";
export const Card = (props) => (
  <section data-testid="card" class="wide  box primary">
    <h2 data-testid={props.id} className={"title big"}>{t("card.title")}</h2>
    <button type="button" data-testid="save" class={props.active ? "on" : "off"}>{t(\`card.save\`)}</button>
    <img data-testid="logo" src="/a.png" alt={t(props.altKey)} />
    <p>{t("card.hint")} {t("card.title")}</p>
  </section>
);
`;

describe("the example plugins do real work", () => {
  it("[PLG-EX-01] the registry holds the three examples by name", () => {
    expect(Object.keys(registry)).toEqual(["stripTestIds", "i18nExtractor", "sortClassNames"]);
  });

  it("[PLG-EX-02] stripTestIds removes every data-testid in production output only", () => {
    const production = compile(VIEW, { filename: "card.tsx", plugins: [stripTestIds()] });
    expect(production.code).not.toContain("data-testid");
    expect(production.code).toContain('type=\\"button\\"');
    const development = compile(VIEW, {
      filename: "card.tsx",
      dev: true,
      plugins: [stripTestIds()],
    });
    expect(development.code).toContain("data-testid");
    expect(development.code).toBe(compile(VIEW, { filename: "card.tsx", dev: true }).code);
  });

  it("[PLG-EX-03] stripTestIds handles first, middle, last, spread-adjacent and self-closing attributes", () => {
    const source = `export const A = (p) => (
      <div data-testid="a" id="x">
        <b id="y" data-testid={p.t} class="z" />
        <i {...p} data-testid="s"></i>
        <u class="k" data-testid="end" />
      </div>
    );`;
    const code = compile(source, { filename: "a.tsx", plugins: [stripTestIds()] }).code;
    expect(code).not.toContain("data-testid");
    expect(code).toContain('id=\\"x\\"');
    expect(code).toContain('class=\\"z\\"');
    expect(code).toContain('class=\\"k\\"');
  });

  it("[PLG-EX-04] i18nExtractor collects the keys of t() calls and reports each one", () => {
    const extractor = i18nExtractor();
    const result = compile(VIEW, { filename: "card.tsx", plugins: [extractor] });
    expect(extractor.keys).toEqual(["card.title", "card.save", "card.hint", "card.title"]);
    const infos = result.diagnostics.filter((d) => d.code === "I18N_KEY");
    expect(infos.map((d) => d.message)).toEqual(
      ["card.title", "card.save", "card.hint", "card.title"].map(
        (key) => `plugin "i18n-extractor": ${key}`,
      ),
    );
    expect(infos.every((d) => d.severity === "info" && d.plugin === "i18n-extractor")).toBe(true);
    // The first report points at the string literal "card.title" on line 4.
    expect(infos[0]).toMatchObject({ line: 4 });
    expect((VIEW.split("\n")[3] ?? "").slice(infos[0]?.column, (infos[0]?.column ?? 0) + 12)).toBe(
      '"card.title"',
    );
    // A key that is not a literal is a warning, not a key.
    const dynamic = result.diagnostics.filter((d) => d.code === "I18N_DYNAMIC_KEY");
    expect(dynamic).toHaveLength(1);
    expect(dynamic[0]).toMatchObject({ severity: "warning", line: 6 });
    // The extractor changes nothing.
    expect(result.code).toBe(compile(VIEW, { filename: "card.tsx" }).code);
  });

  it("[PLG-EX-05] i18nExtractor works on modules that have no JSX", () => {
    const extractor = i18nExtractor();
    const result = compile('export const msg = t("a.b") + t("c.d");\n', {
      filename: "messages.ts",
      plugins: [extractor],
    });
    expect(extractor.keys).toEqual(["a.b", "c.d"]);
    expect(result.transformed).toBe(false);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("[PLG-EX-06] sortClassNames sorts literal class lists, in both spellings and both value forms", () => {
    const code = compile(VIEW, { filename: "card.tsx", plugins: [sortClassNames()] }).code;
    expect(code).toContain('class=\\"box primary wide\\"');
    expect(code).toContain("big title");
    expect(code).not.toContain("wide box primary");
    // A dynamic value is left alone.
    expect(code).toContain('props.active ? "on" : "off"');
  });

  it("[PLG-EX-07] sortClassNames is idempotent and leaves an already sorted list untouched", () => {
    const sorted = `export const A = () => <p class="a b c" />;`;
    const once = compile(sorted, { filename: "a.tsx", plugins: [sortClassNames()] });
    expect(once.code).toBe(compile(sorted, { filename: "a.tsx" }).code);
  });

  it("[PLG-EX-08] the three together, in any order, give the same module", () => {
    const keys = i18nExtractor();
    const abc = compile(VIEW, {
      filename: "card.tsx",
      plugins: [stripTestIds(), keys, sortClassNames()],
    });
    const cba = compile(VIEW, {
      filename: "card.tsx",
      plugins: [sortClassNames(), i18nExtractor(), stripTestIds()],
    });
    expect(cba.code).toBe(abc.code);
    expect(abc.code).not.toContain("data-testid");
    expect(abc.code).toContain("box primary wide");
    expect(keys.keys).toHaveLength(4);
  });

  it("[PLG-EX-09] a post plugin reads the generated code: the template budget", () => {
    const result = compile(VIEW, { filename: "card.tsx", plugins: [templateBudget(40)] });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "TEMPLATE_BUDGET",
      plugin: "template-budget",
    });
    expect(result.diagnostics[0]?.message).toMatch(
      /template of \d+ characters is over the budget of 40/,
    );
    expect(
      compile(VIEW, { filename: "card.tsx", plugins: [templateBudget(10_000)] }).diagnostics,
    ).toEqual([]);
  });

  it("[PLG-EX-10] JSX that a pre plugin inserts is compiled like any other JSX", () => {
    const wrap: CompilerPlugin = {
      name: "add-footer",
      transform(_ast, context) {
        context.walk({
          JSXElement(node) {
            if (
              node.openingElement.name.type !== "JSXIdentifier" ||
              node.openingElement.name.name !== "main"
            )
              return;
            const footer = context.create.jsxElement(
              "footer",
              [context.create.jsxAttribute("class", context.create.string("foot"))],
              [context.create.jsxText("made with ShadowJS")],
            );
            const last = node.children[node.children.length - 1];
            context.insertAfter(last ?? node.openingElement, footer);
          },
        });
      },
    };
    const code = compile("export const A = () => <main><p>body</p></main>;", {
      filename: "a.tsx",
      plugins: [wrap],
    }).code;
    expect(code).toContain('<footer class=\\"foot\\">made with ShadowJS</footer>');
  });
});
