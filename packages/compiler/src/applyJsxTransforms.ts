import { findMatching } from "./findMatching";
import { hasJsxTag } from "./hasJsxTag";
import { isFunction } from "./isFunction";
import { transformSource } from "./transformSource";

function isBareRef(s: string) {
  // identifier or dotted path
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(s.trim());
}
function isAlreadyFnHead(s: string) {
  const t = s.trim();
  return (
    t.startsWith("(() =>") ||
    t.startsWith("() =>") ||
    t.startsWith("async () =>") ||
    isFunction(t)
  );
}

/**
 * Applies JSX-specific transformations to make expressions reactive.
 *
 * This function performs several key transformations:
 *
 * 1. **Ref Handling**: `ref={foo}` → `ref={(el) => foo = el}`
 *    - Converts ref attributes to assignment functions
 *
 * 2. **Control Flow Wrapping**: `when={expr}` → `when={() => (expr)}`
 *    - Wraps Show/Match conditions in functions if not already functions
 *    - Preserves bare references (like store getters) as-is
 *
 * 3. **Style Object Wrapping**: `style={{...}}` → `style={() => ({...})}`
 *    - Makes style objects reactive functions
 *
 * 4. **Child Expression Wrapping**: `{expr}` → `{() => (expr)}`
 *    - Wraps child expressions in reactive functions
 *    - Preserves existing functions and bare references
 *
 * 5. **Recursive JSX Processing**: Functions containing JSX are recursively transformed
 *
 * @param jsxContent - JSX content string to transform
 * @returns Transformed JSX with reactive expressions
 *
 * @example
 * ```tsx
 * // Input:
 * <div ref={myRef} style={{ color: "red" }}>
 *   <Show when={count > 0}>
 *     Items: {items.length}
 *   </Show>
 * </div>
 *
 * // Output:
 * <div ref={(el) => myRef = el} style={() => ({ color: "red" })}>
 *   <Show when={() => (count > 0)}>
 *     Items: {() => items.length}
 *   </Show>
 * </div>
 * ```
 */
export function applyJsxTransforms(jsxContent: string): string {
  // ref={foo} -> ref={(el) => foo = el}
  jsxContent = jsxContent.replace(
    /(ref\s*=\s*)\{\s*([A-Za-z_$][\w$]*)\s*\}/g,
    (_, prefix, ident) => `${prefix}{(el) => ${ident} = el}`
  );

  // Show when={...} -> when={() => (...)} if needed
  jsxContent = jsxContent.replace(
    /(<Show\b[^>]*\bwhen\s*=\s*)\{([\s\S]*?)\}/g,
    (full, prefix, expr) => {
      const t = String(expr).trim();
      if (isAlreadyFnHead(t) || isBareRef(t)) return full;
      return `${prefix}{() => (${expr})}`;
    }
  );

  // Match when={...} -> when={() => (...)} if needed
  jsxContent = jsxContent.replace(
    /(<Match\b[^>]*\bwhen\s*=\s*)\{([\s\S]*?)\}/g,
    (full, prefix, expr) => {
      const t = String(expr).trim();
      if (isAlreadyFnHead(t) || isBareRef(t)) return full;
      return `${prefix}{() => (${expr})}`;
    }
  );

  // For each={...} -> each={() => (...)} if needed
  // Important: do NOT wrap bare refs (like `users`) which are already callable stores.
  jsxContent = jsxContent.replace(
    /(<For\b[^>]*\beach\s*=\s*)\{([\s\S]*?)\}/g,
    (full, prefix, expr) => {
      const t = String(expr).trim();
      if (isAlreadyFnHead(t) || isBareRef(t)) return full;
      return `${prefix}{() => (${expr})}`;
    }
  );

  // style={{ ... }} -> style={() => ({ ... })}
  jsxContent = jsxContent.replace(
    /(style\s*=\s*)\{\{([\s\S]*?)\}\}/g,
    (full, prefix, inner) => {
      const trimmed = String(inner).trim();
      if (trimmed.startsWith("(() =>") || trimmed.startsWith("() =>")) {
        return full;
      }
      return `${prefix}{() => ({${inner}})}`;
    }
  );

  // Wrap only CHILD expressions; do not modify attribute values here
  const transformJsxExpressions = (input: string): string => {
    let out = "";
    let i = 0;
    const len = input.length;

    let inStr: string | null = null;
    let escaped = false;
    let inLine = false;
    let inBlock = false;
    let inTag = false;

    while (i < len) {
      const ch = input[i]!;

      if (inLine) {
        if (ch === "\n") inLine = false;
        out += ch;
        i++;
        continue;
      }
      if (inBlock) {
        if (ch === "*" && input[i + 1] === "/") {
          inBlock = false;
          out += "*/";
          i += 2;
          continue;
        }
        out += ch;
        i++;
        continue;
      }
      if (inStr) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === inStr) {
          inStr = null;
        }
        out += ch;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        out += ch;
        i++;
        continue;
      }
      if (ch === "/" && input[i + 1] === "/") {
        inLine = true;
        out += "//";
        i += 2;
        continue;
      }
      if (ch === "/" && input[i + 1] === "*") {
        inBlock = true;
        out += "/*";
        i += 2;
        continue;
      }

      if (ch === "<") {
        inTag = true;
        out += ch;
        i++;
        continue;
      }
      if (ch === ">") {
        inTag = false;
        out += ch;
        i++;
        continue;
      }

      if (ch === "{" && input[i + 1] !== "{") {
        const close = findMatching(input, i, "{", "}");
        if (close === -1) {
          out += input.slice(i);
          break;
        }

        const exprRaw = input.slice(i + 1, close);
        const exprTrim = exprRaw.trim();

        if (exprTrim.startsWith("/*")) {
          out += `{${exprRaw}}`;
          i = close + 1;
          continue;
        }

        if (isFunction(exprTrim) && hasJsxTag(exprTrim)) {
          out += `{${transformSource(exprRaw)}}`;
          i = close + 1;
          continue;
        }

        if (inTag) {
          // Attribute value: leave as-is here
          out += `{${exprRaw}}`;
        } else {
          // Child expression: make reactive unless it’s already a function
          // or a bare reference
          if (isAlreadyFnHead(exprTrim) || isBareRef(exprTrim)) {
            out += `{${exprRaw}}`;
          } else {
            out += `{(() => (${exprRaw}))}`;
          }
        }

        i = close + 1;
        continue;
      }

      out += ch;
      i++;
    }

    return out;
  };

  return transformJsxExpressions(jsxContent);
}
