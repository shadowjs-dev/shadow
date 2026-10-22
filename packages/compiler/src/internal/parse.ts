import { parseSync } from "oxc-parser";
import type { AstNode } from "./ast";
import { CompileError, codeFrame, makeDiagnostic } from "./diagnostics";

export interface ParsedModule {
  program: AstNode;
  comments: Array<{ type: string; value: string; start: number; end: number }>;
}

export type Language = "jsx" | "tsx" | "ts" | "js";

export function languageOf(filename: string): Language {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "ts";
  if (lower.endsWith(".jsx")) return "jsx";
  return "jsx";
}

/** Parses a module; syntax errors become a CompileError with a code frame (never swallowed). */
export function parseModule(source: string, filename: string): ParsedModule {
  const result = parseSync(filename, source, { lang: languageOf(filename), sourceType: "module" });
  const first = result.errors[0];
  if (first !== undefined) {
    const label = first.labels?.[0];
    const start = label?.start ?? 0;
    const diagnostic = makeDiagnostic(
      source,
      "PARSE_ERROR",
      first.message,
      start,
      label?.end ?? start + 1,
    );
    throw new CompileError(diagnostic, codeFrame(source, start), filename);
  }
  return {
    program: result.program as unknown as AstNode,
    comments: result.comments as unknown as ParsedModule["comments"],
  };
}
