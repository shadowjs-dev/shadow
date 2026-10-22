import type { DecodedSourceMap, SourceMapSegment } from "magic-string";
import { CompileError, codeFrame, makeDiagnostic } from "./diagnostics";

/**
 * Where the text of a source-to-source pass comes from.
 *
 * The `useStore` pass and the derived-constant pass rewrite the module before the JSX is compiled,
 * and every later stage reads (and reports positions in) the rewritten text. The caller wrote the
 * text before the rewrite, so a position of the rewritten text has to be traced back to it. A pass
 * builds its output as a {@link Rope}: runs of text copied from the text it read, and synthetic runs
 * it wrote itself. The {@link Origin} of that rope answers, for any offset of the new text, the offset
 * of the old text it comes from: exact inside a copied run, the anchor of the run (the place in the old
 * text where the run was written) inside a synthetic one.
 *
 * Offsets count UTF-16 code units, like string indexes.
 *
 * @internal
 */

/** A run of a rewritten text: copied from the old text at `from`, or written by the pass at `from`. */
interface Piece {
  readonly text: string;
  readonly from: number;
  readonly copied: boolean;
}

/** A text built from runs of an old text and runs a pass wrote. */
export class Rope {
  text = "";
  readonly pieces: Piece[] = [];
  /** Where in the old text the next synthetic run is anchored: the end of the last copy. */
  anchor: number;

  constructor(anchor: number) {
    this.anchor = anchor;
  }

  /** Adds a synthetic run, anchored where the rope has reached in the old text. */
  write(text: string): this {
    if (text.length === 0) return this;
    this.text += text;
    this.pieces.push({ text, from: this.anchor, copied: false });
    return this;
  }

  /** Adds the old text from `start` to `end` as it is. */
  copy(source: string, start: number, end: number): this {
    this.anchor = end;
    if (end <= start) return this;
    const text = source.slice(start, end);
    this.text += text;
    this.pieces.push({ text, from: start, copied: true });
    return this;
  }

  /** Adds another rope; the old text it reached is where this rope has reached now. */
  append(other: Rope): this {
    this.text += other.text;
    for (const piece of other.pieces) this.pieces.push(piece);
    this.anchor = other.anchor;
    return this;
  }
}

/** Joins ropes with a synthetic separator. */
export function joinRopes(parts: readonly Rope[], separator: string, anchor: number): Rope {
  const out = new Rope(anchor);
  parts.forEach((part, index) => {
    if (index > 0) out.write(separator);
    out.append(part);
  });
  return out;
}

/** A replacement of the old text from `start` to `end`: plain text (synthetic) or a rope. */
export interface SpliceEdit {
  start: number;
  end: number;
  text: string | Rope;
}

/**
 * Applies edits to the old text between `from` and `to`. The edits are in the coordinates of
 * `source`, sorted by start (a stable sort); one that starts inside the previous one is skipped.
 *
 * @param source The old text.
 * @param from Where the result starts.
 * @param to Where the result ends.
 * @param edits The replacements.
 * @returns The new text between `from` and `to`, with its origin.
 */
export function splice(
  source: string,
  from: number,
  to: number,
  edits: readonly SpliceEdit[],
): Rope {
  const out = new Rope(from);
  let position = from;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.start < position) continue;
    out.copy(source, position, edit.start);
    if (typeof edit.text === "string") out.write(edit.text);
    else out.append(edit.text);
    out.anchor = edit.end;
    position = edit.end;
  }
  out.copy(source, position, to);
  out.anchor = to;
  return out;
}

/** The offsets of a new text traced to the old text it was built from. */
export interface Origin {
  /** Offset in the new text where each piece starts. */
  readonly starts: readonly number[];
  readonly pieces: readonly Piece[];
  /** Length of the new text. */
  readonly length: number;
  /** Length of the old text. */
  readonly oldLength: number;
}

/** The origin of a rope that was built from an old text of `oldLength` code units. */
export function originOf(rope: Rope, oldLength: number): Origin {
  const starts: number[] = [];
  let at = 0;
  for (const piece of rope.pieces) {
    starts.push(at);
    at += piece.text.length;
  }
  return { starts, pieces: rope.pieces, length: at, oldLength };
}

function pieceAt(origin: Origin, offset: number): number {
  let low = 0;
  let high = origin.starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((origin.starts[middle] ?? 0) <= offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** The offset of the old text for an offset of the new one (where a position starts). */
export function toOldStart(origin: Origin, offset: number): number {
  if (offset >= origin.length) return origin.oldLength + (offset - origin.length);
  const index = pieceAt(origin, offset);
  const piece = origin.pieces[index];
  if (piece === undefined) return offset;
  return piece.copied ? piece.from + (offset - (origin.starts[index] ?? 0)) : piece.from;
}

/**
 * The offset of the old text for an offset of the new one that ends a range (exclusive): the end
 * of the last character the range holds, when that character was copied.
 */
export function toOldEnd(origin: Origin, offset: number): number {
  if (offset > 0 && offset <= origin.length) {
    const index = pieceAt(origin, offset - 1);
    const piece = origin.pieces[index];
    if (piece?.copied === true) return piece.from + (offset - (origin.starts[index] ?? 0));
  }
  return toOldStart(origin, offset);
}

/**
 * Traces an offset of the text after the passes back to the text before them.
 *
 * @param chain The origins of the passes in the order they ran.
 */
function trace(
  chain: readonly Origin[],
  offset: number,
  step: (origin: Origin, offset: number) => number,
): number {
  let at = offset;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const origin = chain[i];
    if (origin !== undefined) at = step(origin, at);
  }
  return at;
}

/**
 * Re-expresses an error of the passes after a source-to-source rewrite in terms of the module as it
 * was written: the offsets are traced back, and the line, the column, the message and the code frame
 * are those of the original text.
 *
 * @param error The error, with positions in the rewritten text.
 * @param chain The origins of the rewrites in the order they ran.
 * @param source The module text as it was written.
 * @returns A new error with the original positions, or `error` itself when nothing was rewritten.
 */
export function errorInSource(
  error: CompileError,
  chain: readonly Origin[],
  source: string,
): CompileError {
  if (chain.length === 0) return error;
  const { diagnostic } = error;
  const start = trace(chain, diagnostic.start, toOldStart);
  const end = Math.max(start, trace(chain, diagnostic.end, toOldEnd));
  const moved = makeDiagnostic(
    source,
    diagnostic.code,
    diagnostic.message,
    start,
    end,
    diagnostic.severity,
  );
  if (diagnostic.plugin !== undefined) moved.plugin = diagnostic.plugin;
  return new CompileError(moved, codeFrame(source, start), error.id);
}

/** Offset where each line of a text starts. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** The last entry of `starts` that is at or before `offset`. */
function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Points the segments of a source map of the rewritten text at the text as it was written.
 *
 * @param map Decoded map whose sources positions are in the rewritten text.
 * @param chain The origins of the rewrites in the order they ran.
 * @param rewritten The text the map points at.
 * @param source The module text as it was written; it becomes the embedded content.
 * @returns The map with the traced positions and `source` as the content (when the map had content).
 */
export function mapInSource(
  map: DecodedSourceMap,
  chain: readonly Origin[],
  rewritten: string,
  source: string,
): DecodedSourceMap {
  const from = lineStarts(rewritten);
  const to = lineStarts(source);
  const mappings = map.mappings.map((line) =>
    line.map((segment): SourceMapSegment => {
      if (segment.length === 1) return segment;
      const offset = (from[segment[2]] ?? 0) + segment[3];
      const traced = trace(chain, offset, toOldStart);
      const row = lineOf(to, traced);
      const moved: [number, number, number, number] = [
        segment[0],
        segment[1],
        row,
        traced - (to[row] ?? 0),
      ];
      return segment.length === 5 ? [...moved, segment[4]] : moved;
    }),
  );
  const out: DecodedSourceMap = { sources: map.sources, names: map.names, mappings };
  if (map.sourcesContent !== undefined) out.sourcesContent = [source];
  if (map.file !== undefined) out.file = map.file;
  return out;
}
