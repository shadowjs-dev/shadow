import { applyJsxTransforms } from "./applyJsxTransforms";
import { findMatching } from "./findMatching";
import { hasJsxTag } from "./hasJsxTag";

/**
 * When an arrow function has an implicit body that contains JSX,
 * transform the body’s JSX expressions as needed.
 *
 * E.g.:
 *   const Comp = () => (<div style={{color:"red"}} />);
 */
export function transformArrowImplicitBodies(code: string): string {
  let out = "";
  let i = 0;
  let last = 0;

  // Simple lexer state for skipping strings/comments
  let inStr: string | null = null;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

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

    // Look for "=> ( ... )" and transform the parentheses body if it has JSX
    if (c === "=" && code[i + 1] === ">") {
      // after =>
      let j = i + 2;
      while (j < code.length && /\s/.test(code[j]!)) j++;
      if (code[j] === "(") {
        const close = findMatching(code, j, "(", ")");
        if (close !== -1) {
          const body = code.slice(j + 1, close);
          if (hasJsxTag(body)) {
            const transformed = applyJsxTransforms(body);
            out += code.slice(last, j + 1) + transformed + ")";
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
