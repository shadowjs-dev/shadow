import type { DecodedSourceMap, SourceMapSegment } from "magic-string";

type Mapped = Exclude<SourceMapSegment, [number]>;

const isMapped = (segment: SourceMapSegment | undefined): segment is Mapped =>
  segment !== undefined && segment.length > 1;

/**
 * The last segment of a generated line that starts at or before `column` and maps to a source
 * position (the rule every source map reader uses).
 */
function segmentAt(
  line: readonly SourceMapSegment[] | undefined,
  column: number,
): Mapped | undefined {
  if (line === undefined) return undefined;
  let low = 0;
  let high = line.length - 1;
  let found: Mapped | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = line[middle];
    if (segment === undefined) break;
    if (segment[0] <= column) {
      if (isMapped(segment)) found = segment;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Composes two source maps: `outer` maps text B back to text A, `inner` maps text A back to text
 * Z. The result maps B to Z. A position of B that falls where `inner` has no mapping (text that was
 * inserted into A, for example) gets no mapping. A name recorded by `inner` wins over one recorded by
 * `outer`, because it is the earlier spelling.
 *
 * @param outer Map from the newer text to the middle text.
 * @param inner Map from the middle text to the oldest text; its sources and content are kept.
 * @returns The composed map.
 * @internal
 * @since 1.0.0
 */
export function composeMaps(outer: DecodedSourceMap, inner: DecodedSourceMap): DecodedSourceMap {
  const names = [...inner.names];
  const known = new Map<string, number>(names.map((name, index) => [name, index]));
  const nameIndex = (name: string): number => {
    const existing = known.get(name);
    if (existing !== undefined) return existing;
    names.push(name);
    known.set(name, names.length - 1);
    return names.length - 1;
  };
  const mappings = outer.mappings.map((line) => {
    const out: SourceMapSegment[] = [];
    for (const segment of line) {
      if (segment.length === 1) continue;
      const target = segmentAt(inner.mappings[segment[2]], segment[3]);
      if (target === undefined) continue;
      if (target.length === 5) {
        out.push([segment[0], target[1], target[2], target[3], target[4]]);
      } else if (segment.length === 5) {
        const name = outer.names[segment[4]];
        out.push(
          name === undefined
            ? [segment[0], target[1], target[2], target[3]]
            : [segment[0], target[1], target[2], target[3], nameIndex(name)],
        );
      } else {
        out.push([segment[0], target[1], target[2], target[3]]);
      }
    }
    return out;
  });
  const composed: DecodedSourceMap = { sources: inner.sources, names, mappings };
  if (inner.sourcesContent !== undefined) composed.sourcesContent = inner.sourcesContent;
  if (inner.file !== undefined) composed.file = inner.file;
  return composed;
}

/**
 * Where a position of the generated text comes from.
 *
 * @param map Map from the generated text to the source.
 * @param line 0-based line of the generated position.
 * @param column 0-based column of the generated position.
 * @returns The 0-based source line and column of the nearest mapping at or before the position (on
 * its line, else the closest earlier line), or `undefined` when nothing before it is mapped.
 * @internal
 * @since 1.0.0
 */
export function traceBack(
  map: DecodedSourceMap,
  line: number,
  column: number,
): { line: number; column: number } | undefined {
  const here = segmentAt(map.mappings[line], column);
  if (here !== undefined) return { line: here[2], column: here[3] };
  for (let previous = line - 1; previous >= 0; previous -= 1) {
    const row = map.mappings[previous];
    for (let index = (row?.length ?? 0) - 1; index >= 0; index -= 1) {
      const segment = row?.[index];
      if (isMapped(segment)) return { line: segment[2], column: segment[3] };
    }
  }
  return undefined;
}
