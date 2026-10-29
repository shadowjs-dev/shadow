/**
 * Vite's own test for a request that asks for the bytes of a file instead of its module: `?raw` (the
 * text) and `?url` (the address). Same patterns as Vite's `rawRE` and `urlRE`, applied to the query only.
 */
const BYTES_QUERY = /[?&](?:raw|url)(?:&|$)/;

/**
 * Splits a module id from Vite into the file it names and whether a compiler should leave it alone.
 *
 * - A virtual module (Vite's `\0` prefix) belongs to the plugin that made it.
 * - A `?raw` or `?url` request is answered with an `export default "<text or address>"` module; that is
 *   not the source of the file, so compiling it as JSX or MDX would read a string as a program.
 *
 * Every other query (`?v=`, `?t=`, `?import`) is a cache or HMR marker on the same source and is ignored.
 *
 * @param id The module id Vite passes to `transform`.
 * @returns The file part of the id (no query) and `skip`, true when the module is not to be compiled.
 * @internal
 */
export function moduleFile(id: string): { file: string; skip: boolean } {
  const query = id.indexOf("?");
  const file = query === -1 ? id : id.slice(0, query);
  const skip = id.startsWith("\0") || (query !== -1 && BYTES_QUERY.test(id.slice(query)));
  return { file, skip };
}
