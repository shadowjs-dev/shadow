/**
 * A located problem in a source module, carried by {@link CompileError} (and typed for
 * `CompileResult.diagnostics`). Offsets count UTF-16 code units, like string indexes.
 * @since 1.0.0
 */
export interface Diagnostic {
  /** Stable identifier of the problem, such as `PARSE_ERROR` or `INVALID_HTML_NESTING`. */
  code: string;
  /** Human-readable explanation, without the position. */
  message: string;
  /**
   * `"error"` stops compilation. The compiler itself only produces errors; a plugin may also
   * report `"warning"` and `"info"` findings, which are collected in `CompileResult.diagnostics`.
   */
  severity: "error" | "warning" | "info";
  /** UTF-16 offset in the original source where the problem starts. */
  start: number;
  /** UTF-16 offset in the original source where the problem ends (exclusive). */
  end: number;
  /** 1-based line of `start`. */
  line: number;
  /** 0-based column of `start`, counted from the start of its line. */
  column: number;
  /** Name of the compiler plugin that caused the finding; absent for the compiler's own. */
  plugin?: string;
}

/**
 * Thrown by {@link compile} for source the compiler cannot or refuses to transform. It carries the
 * {@link Diagnostic} with the position, a printable code frame, and the name of the file. The
 * message has the form `<id>:<line>:<column> <code>: <message>` followed by the frame.
 *
 * @example
 * import { CompileError, compile } from "@shadow-js/compiler";
 *
 * function check(source: string): string | null {
 *   try {
 *     compile(source, { filename: "view.tsx" });
 *     return null;
 *   } catch (error) {
 *     if (!(error instanceof CompileError)) throw error;
 *     return `${error.diagnostic.code} at line ${error.diagnostic.line}`;
 *   }
 * }
 * console.log(check("const view = <div>;")); // "PARSE_ERROR at line 1"
 * @see Diagnostic
 * @since 1.0.0
 */
export class CompileError extends Error {
  /** The problem: its code, message, severity and position in the original source. */
  readonly diagnostic: Diagnostic;
  /** Source excerpt of the offending line with a caret under the column, ready to print. */
  readonly frame: string;
  /** The `filename` the module was compiled with. */
  readonly id: string;

  /**
   * @param diagnostic The problem to report.
   * @param frame Code frame for the problem, as built by {@link codeFrame}.
   * @param id Name of the file the problem is in.
   */

  constructor(diagnostic: Diagnostic, frame: string, id: string) {
    super(
      `${id}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}: ${diagnostic.message}\n${frame}`,
    );
    this.name = "CompileError";
    this.diagnostic = diagnostic;
    this.frame = frame;
    this.id = id;
  }
}

/**
 * Converts an offset into a line and column.
 *
 * @param source The module text.
 * @param offset UTF-16 offset into `source`. An offset past the end counts as the end for the
 * line, so the column keeps growing past the last line.
 * @returns The 1-based `line` and the 0-based `column` of the offset.
 * @internal
 * @since 1.0.0
 */
export function locate(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const limit = Math.min(offset, source.length);
  for (let i = 0; i < limit; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart };
}

/**
 * Builds a printable excerpt of the line containing `offset`: the line number and the line, then
 * a second line with a caret under the column.
 *
 * @param source The module text.
 * @param offset UTF-16 offset into `source` that the caret points at.
 * @returns Two lines separated by `\n`.
 * @internal
 * @since 1.0.0
 */
export function codeFrame(source: string, offset: number): string {
  const { line, column } = locate(source, offset);
  const text = source.split("\n")[line - 1] ?? "";
  return `${String(line).padStart(4)} | ${text}\n     | ${" ".repeat(column)}^`;
}

/**
 * Creates a {@link Diagnostic}, computing `line` and `column` from `start`.
 *
 * @param source The module text the offsets refer to.
 * @param code Stable identifier of the problem.
 * @param message Human-readable explanation.
 * @param start UTF-16 offset where the problem starts.
 * @param end UTF-16 offset where the problem ends.
 * @param severity `"error"`, `"warning"` or `"info"`. Default `"error"`.
 * @returns The diagnostic.
 * @internal
 * @since 1.0.0
 */
export function makeDiagnostic(
  source: string,
  code: string,
  message: string,
  start: number,
  end: number,
  severity: "error" | "warning" | "info" = "error",
): Diagnostic {
  const { line, column } = locate(source, start);
  return { code, message, severity, start, end, line, column };
}
