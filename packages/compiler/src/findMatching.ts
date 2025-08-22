// File: packages/compiler/src/findMatching.ts

/**
 * Find the index of the closing character matching an opening one,
 * skipping over strings and comments.
 *
 * @param input Full source text.
 * @param openIndex Index of the opening character.
 * @param openChar The opening character (e.g., "(" or "{").
 * @param closeChar The closing character (e.g., ")" or "}").
 * @returns Index of the matching close or -1 if not found.
 */
export function findMatching(
  input: string,
  openIndex: number,
  openChar: string,
  closeChar: string
): number {
  let i = openIndex + 1;
  let depth = 1;
  let inStr: string | null = null;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

  while (i < input.length) {
    const c = input[i]!;

    // Line comment //
    if (inLine) {
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    // Block comment /* ... */
    if (inBlock) {
      if (c === "*" && input[i + 1] === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    // String literal " ' `
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
    if (c === "/" && input[i + 1] === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === "/" && input[i + 1] === "*") {
      inBlock = true;
      i += 2;
      continue;
    }

    // Nesting
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}
