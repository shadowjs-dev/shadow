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
 * Whether the unit at `index` ends a line, as in ECMAScript: LF, CR (but a CR that is followed by LF
 * belongs to the CR LF pair, which the LF ends), U+2028 and U+2029.
 */
function endsLine(source: string, index: number): boolean {
  const unit = source.charCodeAt(index);
  if (unit === 10 || unit === 0x2028 || unit === 0x2029) return true;
  return unit === 13 && source.charCodeAt(index + 1) !== 10;
}

/**
 * Converts an offset into a line and column.
 *
 * A line ends at LF, CR LF, a lone CR, U+2028 or U+2029. A CR that comes right before an LF is part of
 * the line it ends, so the positions in a file with CR LF line ends are those of the same file with LF.
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
    if (endsLine(source, i)) {
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
  // The column is measured from the start of the line, also for an offset past the end.
  const start = offset - column;
  let end = start;
  while (end < source.length && !endsLine(source, end)) end += 1;
  return `${String(line).padStart(4)} | ${source.slice(start, end)}\n     | ${" ".repeat(column)}^`;
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
