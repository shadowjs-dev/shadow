/**
 * Source map helpers of the MDX plugin. `@mdx-js/mdx` turns the `.mdx` text into JSX, and the ShadowJS
 * compiler turns that JSX into the final code, so the plugin holds two maps: final code to JSX, and JSX
 * to `.mdx`. Build tools need the one map from the final code to the `.mdx` file, which {@link composeToSource}
 * builds. The helpers read and write the map format (version 3, base 64 VLQ) themselves: the plugin has
 * no runtime dependency besides the compiler, and the work is a few lines.
 */

/** One decoded segment: generated column, then (source index, line, column and optionally a name index). */
export type Segment =
  | readonly [number]
  | readonly [number, number, number, number]
  | readonly [number, number, number, number, number];

/** The parts of a version 3 source map this module reads. */
export interface RawMap {
  readonly mappings: string;
  readonly names?: readonly string[];
}

/** A version 3 source map this module writes. */
export interface ComposedMap {
  version: 3;
  file?: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
const VLQ_MASK = VLQ_BASE - 1;
const VLQ_CONTINUE = VLQ_BASE;

/** Appends one signed number, as a base 64 VLQ, to `out`. */
function writeVlq(out: string[], value: number): void {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  do {
    let digit = rest & VLQ_MASK;
    rest >>>= VLQ_BASE_SHIFT;
    if (rest > 0) digit |= VLQ_CONTINUE;
    out.push(BASE64.charAt(digit));
  } while (rest > 0);
}

/**
 * Decodes the `mappings` of a source map.
 *
 * @param mappings The `mappings` string: lines separated by `;`, segments by `,`.
 * @returns One list of segments per generated line.
 * @throws SyntaxError when a character is not base 64 or a number is cut off.
 * @internal
 */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let column = 0;
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;
  let numbers: number[] = [];
  let value = 0;
  let shift = 0;
  const finishSegment = (): void => {
    if (numbers.length === 0) return;
    const [dc = 0, ds, dl, dk, dn] = numbers;
    column += dc;
    if (numbers.length === 1) {
      line.push([column]);
    } else if (
      (numbers.length !== 4 && numbers.length !== 5) ||
      ds === undefined ||
      dl === undefined ||
      dk === undefined
    ) {
      throw new SyntaxError(`source map: a segment has ${numbers.length} fields.`);
    } else {
      source += ds;
      sourceLine += dl;
      sourceColumn += dk;
      if (dn === undefined) {
        line.push([column, source, sourceLine, sourceColumn]);
      } else {
        name += dn;
        line.push([column, source, sourceLine, sourceColumn, name]);
      }
    }
    numbers = [];
  };
  for (let i = 0; i < mappings.length; i += 1) {
    const char = mappings.charAt(i);
    if (char === ";" || char === ",") {
      if (shift !== 0) throw new SyntaxError("source map: a number is cut off.");
      finishSegment();
      if (char === ";") {
        lines.push(line);
        line = [];
        column = 0;
      }
      continue;
    }
    const digit = BASE64.indexOf(char);
    if (digit === -1) throw new SyntaxError(`source map: "${char}" is not a base 64 digit.`);
    value += (digit & VLQ_MASK) * 2 ** shift;
    if ((digit & VLQ_CONTINUE) !== 0) {
      shift += VLQ_BASE_SHIFT;
    } else {
      numbers.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
      value = 0;
      shift = 0;
    }
  }
  if (shift !== 0) throw new SyntaxError("source map: a number is cut off.");
  finishSegment();
  lines.push(line);
  return lines;
}

/**
 * Encodes decoded mappings.
 *
 * @param lines One list of segments per generated line, each list sorted by generated column.
 * @returns The `mappings` string.
 * @internal
 */
export function encodeMappings(lines: readonly (readonly Segment[])[]): string {
  const out: string[] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let name = 0;
  lines.forEach((line, index) => {
    if (index > 0) out.push(";");
    let column = 0;
    line.forEach((segment, position) => {
      if (position > 0) out.push(",");
      writeVlq(out, segment[0] - column);
      column = segment[0];
      if (segment.length === 1) return;
      writeVlq(out, segment[1] - source);
      writeVlq(out, segment[2] - sourceLine);
      writeVlq(out, segment[3] - sourceColumn);
      source = segment[1];
      sourceLine = segment[2];
      sourceColumn = segment[3];
      if (segment.length === 5) {
        writeVlq(out, segment[4] - name);
        name = segment[4];
      }
    });
  });
  return out.join("");
}

/** The last segment of a line that starts at or before `column` and maps to a source position. */
function segmentAt(
  line: readonly Segment[] | undefined,
  column: number,
): Exclude<Segment, readonly [number]> | undefined {
  if (line === undefined) return undefined;
  let low = 0;
  let high = line.length - 1;
  let found: Exclude<Segment, readonly [number]> | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = line[middle];
    if (segment === undefined) break;
    if (segment[0] <= column) {
      if (segment.length > 1) found = segment as Exclude<Segment, readonly [number]>;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Composes two maps into one that points at the first text. `outer` maps the final code to the middle
 * text (the JSX), `inner` maps the middle text to the original (the `.mdx` file). A position of the final
 * code that falls where `inner` maps nothing gets no mapping. A name recorded by `inner` wins, because it is
 * the earlier spelling.
 *
 * @param outer Final code to middle text.
 * @param inner Middle text to original text; the original is its only source.
 * @param source The name of the original file.
 * @param content The text of the original file.
 * @param file The name of the final file, if known.
 * @returns The map from the final code to the original file.
 * @internal
 */
export function composeToSource(
  outer: RawMap,
  inner: RawMap,
  source: string,
  content: string,
  file?: string,
): ComposedMap {
  const inside = decodeMappings(inner.mappings);
  const names = [...(inner.names ?? [])];
  const known = new Map<string, number>(names.map((name, index) => [name, index]));
  const nameIndex = (name: string): number => {
    const existing = known.get(name);
    if (existing !== undefined) return existing;
    names.push(name);
    known.set(name, names.length - 1);
    return names.length - 1;
  };
  const lines = decodeMappings(outer.mappings).map((line) => {
    const out: Segment[] = [];
    for (const segment of line) {
      if (segment.length === 1) continue;
      const target = segmentAt(inside[segment[2]], segment[3]);
      if (target === undefined) continue;
      if (target.length === 5) {
        out.push([segment[0], 0, target[2], target[3], target[4]]);
        continue;
      }
      const outerName = segment.length === 5 ? outer.names?.[segment[4]] : undefined;
      out.push(
        outerName === undefined
          ? [segment[0], 0, target[2], target[3]]
          : [segment[0], 0, target[2], target[3], nameIndex(outerName)],
      );
    }
    return out;
  });
  const composed: ComposedMap = {
    version: 3,
    sources: [source],
    sourcesContent: [content],
    names,
    mappings: encodeMappings(lines),
  };
  if (file !== undefined) composed.file = file;
  return composed;
}

/**
 * The map of `@mdx-js/mdx` as a complete map of the original file: its one source named and embedded.
 *
 * @param map Middle text to original text; the original is its only source.
 * @param source The name of the original file.
 * @param content The text of the original file.
 * @returns The map.
 * @internal
 */
export function mapOfSource(map: RawMap, source: string, content: string): ComposedMap {
  return {
    version: 3,
    sources: [source],
    sourcesContent: [content],
    names: [...(map.names ?? [])],
    mappings: map.mappings,
  };
}

/** What `astring`, the JavaScript printer of `@mdx-js/mdx`, hands to `addMapping`. */
interface Mapping {
  readonly generated: { readonly line: number; readonly column: number };
  readonly original: { readonly line: number; readonly column: number } | null;
  readonly source?: string;
  readonly name?: string;
}

/**
 * The `SourceMapGenerator` the MDX plugin hands to `@mdx-js/mdx`, which uses it to record where each piece
 * of the JSX it prints came from. It has the part of the interface of the generator of the `source-map`
 * package that the printer calls (`addMapping`, `toJSON`), so the plugin needs no such package: `@mdx-js/mdx`
 * brings its own, which a package manager need not hoist to where this plugin can import it.
 *
 * @internal
 */
export class MappingCollector {
  readonly #file: string | undefined;
  readonly #sources: string[] = [];
  readonly #names: string[] = [];
  readonly #entries: Array<{
    line: number;
    column: number;
    source: number;
    sourceLine: number;
    sourceColumn: number;
    name: number | undefined;
  }> = [];

  /** @param options `file` is the name of the generated file. */
  constructor(options?: { readonly file?: string }) {
    this.#file = options?.file;
  }

  /** Records that the generated position came from the original one. A mapping without an original is skipped. */
  addMapping(mapping: Mapping): void {
    if (mapping.original === null) return;
    const origin = mapping.source ?? this.#file ?? "";
    let source = this.#sources.indexOf(origin);
    if (source === -1) source = this.#sources.push(origin) - 1;
    let name: number | undefined;
    if (mapping.name !== undefined) {
      name = this.#names.indexOf(mapping.name);
      if (name === -1) name = this.#names.push(mapping.name) - 1;
    }
    this.#entries.push({
      line: mapping.generated.line - 1,
      column: mapping.generated.column,
      source,
      sourceLine: mapping.original.line - 1,
      sourceColumn: mapping.original.column,
      name,
    });
  }

  /** The map as a version 3 source map object. */
  toJSON(): { version: 3; file?: string; sources: string[]; names: string[]; mappings: string } {
    const lines: Segment[][] = [];
    // The printer emits in order, but a stable sort keeps the map valid whatever the order.
    const sorted = [...this.#entries].sort((a, b) => a.line - b.line || a.column - b.column);
    for (const entry of sorted) {
      while (lines.length <= entry.line) lines.push([]);
      lines[entry.line]?.push(
        entry.name === undefined
          ? [entry.column, entry.source, entry.sourceLine, entry.sourceColumn]
          : [entry.column, entry.source, entry.sourceLine, entry.sourceColumn, entry.name],
      );
    }
    const map: {
      version: 3;
      file?: string;
      sources: string[];
      names: string[];
      mappings: string;
    } = {
      version: 3,
      sources: [...this.#sources],
      names: [...this.#names],
      mappings: encodeMappings(lines),
    };
    if (this.#file !== undefined) map.file = this.#file;
    return map;
  }
}
