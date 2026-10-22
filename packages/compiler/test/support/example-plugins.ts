import type { CompilerPlugin } from "../../src/javascript";

/**
 * Production build: removes every `data-testid` attribute (with the whitespace before it) so test
 * hooks never reach users. It does nothing in development output.
 */
export function stripTestIds(): CompilerPlugin {
  return {
    name: "strip-test-ids",
    transform(_ast, context) {
      if (context.dev) return;
      context.walk({
        JSXAttribute(node) {
          if (node.name.type !== "JSXIdentifier" || node.name.name !== "data-testid") return;
          let start = node.start;
          while (start > 0 && /\s/.test(context.source.charAt(start - 1))) start -= 1;
          context.remove({ start, end: node.end });
        },
      });
    },
  };
}

/** Collects the keys of `t("...")` calls and reports each one; a key that is not a literal is a warning. */
export function i18nExtractor(): CompilerPlugin & { readonly keys: string[] } {
  const keys: string[] = [];
  return {
    name: "i18n-extractor",
    keys,
    transform(_ast, context) {
      context.walk({
        CallExpression(node) {
          if (!context.is(node.callee, "Identifier") || node.callee.name !== "t") return;
          const first = node.arguments[0];
          let key: string | null = null;
          if (context.is(first, "Literal") && typeof first.value === "string") key = first.value;
          else if (context.is(first, "TemplateLiteral") && first.expressions.length === 0) {
            key = first.quasis[0]?.value.cooked ?? null;
          }
          if (key === null) {
            context.report({
              code: "I18N_DYNAMIC_KEY",
              message: "t() needs a string literal as its key.",
              severity: "warning",
              node,
            });
            return;
          }
          keys.push(key);
          context.report({ code: "I18N_KEY", message: key, severity: "info", node: first ?? node });
        },
      });
    },
  };
}

/** Sorts the class names of a literal `class` or `className` so the same set always reads the same. */
export function sortClassNames(): CompilerPlugin {
  return {
    name: "sort-class-names",
    transform(_ast, context) {
      context.walk({
        JSXAttribute(node) {
          if (node.name.type !== "JSXIdentifier") return;
          if (node.name.name !== "class" && node.name.name !== "className") return;
          const value = node.value;
          const literal = context.is(value, "JSXExpressionContainer") ? value.expression : value;
          if (!context.is(literal, "Literal") || typeof literal.value !== "string") return;
          const tokens = literal.value.split(/\s+/).filter((token) => token !== "");
          const sorted = [...tokens].sort();
          if (sorted.some((token) => /["'\\{}]/.test(token))) return;
          if (sorted.join(" ") === literal.value) return;
          context.replace(literal, context.create.string(sorted.join(" ")));
        },
      });
    },
  };
}

/** `post` plugin: warns about a hoisted template that is longer than `limit` characters. */
export function templateBudget(limit: number): CompilerPlugin {
  return {
    name: "template-budget",
    enforce: "post",
    transform(_ast, context) {
      context.walk({
        CallExpression(node) {
          if (!context.is(node.callee, "Identifier") || !node.callee.name.endsWith("template"))
            return;
          const html = node.arguments[0];
          if (
            context.is(html, "Literal") &&
            typeof html.value === "string" &&
            html.value.length > limit
          ) {
            context.report({
              code: "TEMPLATE_BUDGET",
              message: `template of ${html.value.length} characters is over the budget of ${limit}.`,
              node: html,
            });
          }
        },
      });
    },
  };
}

/** The three plugins a real project is likely to write first, by name. */
export const registry: {
  readonly stripTestIds: typeof stripTestIds;
  readonly i18nExtractor: typeof i18nExtractor;
  readonly sortClassNames: typeof sortClassNames;
} = { stripTestIds, i18nExtractor, sortClassNames };
