/**
 * Fast heuristic to detect JSX tags inside a snippet.
 * Skips strings and comments, looks for "<Tag" or "</Tag".
 */
export function hasJsxTag(src: string): boolean {
  let i = 0;
  let inStr: string | null = null;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

  while (i < src.length) {
    const c = src[i]!;

    if (inLine) {
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      if (c === "*" && src[i + 1] === "/") {
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
    if (c === "/" && src[i + 1] === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      inBlock = true;
      i += 2;
      continue;
    }

    if (c === "<") {
      // Look for <Tag or </Tag; Tag must start with a letter
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      if (src[j] === "/") {
        j++;
        while (j < src.length && /\s/.test(src[j]!)) j++;
      }
      const n = src[j];
      if (n && /[A-Za-z]/.test(n)) {
        return true;
      }
    }

    i++;
  }
  return false;
}
