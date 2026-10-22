import { decodeHTMLStrict } from "entities";

/**
 * Applies the JSX whitespace rules to raw JSXText (after decoding entities): lines are trimmed at
 * the places a newline was, empty lines vanish, remaining lines join with one space.
 */
export function cleanJsxText(raw: string): string {
  const decoded = decodeHTMLStrict(raw);
  const lines = decoded.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (/[^ \t]/.test(lines[i] ?? "")) lastNonEmpty = i;
  }
  let out = "";
  for (let i = 0; i < lines.length; i += 1) {
    let line = (lines[i] ?? "").replace(/\t/g, " ");
    if (i !== 0) line = line.replace(/^ +/, "");
    if (i !== lines.length - 1) line = line.replace(/ +$/, "");
    if (line.length > 0) {
      if (i !== lastNonEmpty) line += " ";
      out += line;
    }
  }
  return out;
}

/** Escapes text for an HTML template string. */
export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes a value for a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Property key for an object literal: bare identifier when possible, else a JSON string. */
export function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}
