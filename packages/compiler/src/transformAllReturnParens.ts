import { applyJsxTransforms } from "./applyJsxTransforms";
import { findMatching } from "./findMatching";
import { hasJsxTag } from "./hasJsxTag";

/**
 * Transform "return ( ... )" blocks whose inner content contains JSX.
 * This lets us inject our per-prop JSX expression transforms inside returns.
 */
export function transformAllReturnParens(code: string): string {
  let out = "";
  let i = 0;
  let last = 0;

  let inStr: string | null = null;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

  const isWordBoundary = (s: string, idx: number) => {
    const prev = idx > 0 ? s[idx - 1]! : "";
    const next = s[idx + 6] ?? "";
    return (!prev || /\W/.test(prev)) && (!next || /\W/.test(next as string));
  };

  while (i < code.length) {
    const c = code[i]!;

    if (inLine) {
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      if (c === "*" && code[i + 1] === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === inStr) {
        inStr = null;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      inBlock = true;
      i += 2;
      continue;
    }

    // Match "return ( ... )" and transform the inner JSX if present
    if (code.startsWith("return", i) && isWordBoundary(code, i)) {
      let k = i + 6;
      while (k < code.length && /\s/.test(code[k]!)) k++;
      if (code[k] === "(") {
        const close = findMatching(code, k, "(", ")");
        if (close !== -1) {
          const inner = code.slice(k + 1, close);
          if (hasJsxTag(inner)) {
            const transformed = applyJsxTransforms(inner);
            out += code.slice(last, k + 1) + transformed + ")";
            i = close + 1;
            last = i;
            continue;
          }
        }
      }
    }

    i++;
  }

  out += code.slice(last);
  return out;
}
