import { invalid } from "./errors";

/*
 * Wire format: {"r": <value>, "t": [<entry>, ...]}. Containers (objects, arrays, Map, Set, Date,
 * URL) live in the table and refer to each other by index, so cycles and shared references keep
 * their identity and the walk needs no recursion. A value is a JSON primitive, or a tagged object:
 *   {"$":"u"}                    undefined
 *   {"$":"num","v":"NaN"|"Infinity"|"-Infinity"|"-0"}
 *   {"$":"big","v":"<decimal>"}  bigint
 *   {"$":"ref","i":<index>}      a table entry
 * Table entries are {"$":"obj","e":[[key,value],...]}, {"$":"arr","e":[...]},
 * {"$":"map","e":[[key,value],...]}, {"$":"set","e":[...]}, {"$":"date","v":<number>},
 * {"$":"url","v":"<href>"}. Plain objects are read with own properties only and rebuilt with a
 * null prototype, so "__proto__" or "constructor" keys are ordinary data.
 */

/** Characters that may not appear raw in the output: they would end a script element or a line. */
const UNSAFE_TEXT = /[<>&\u2028\u2029]/g;

/** Escapes text for `<script type="application/json">`: the JSON stays valid, the markup cannot close. */
function escapeForScript(json: string): string {
  return json.replace(
    UNSAFE_TEXT,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Encodes a number that JSON cannot carry exactly. */
function encodeNumber(value: number): unknown {
  if (Number.isFinite(value) && !Object.is(value, -0)) return value;
  return { $: "num", v: Object.is(value, -0) ? "-0" : String(value) };
}

/** Binary types the wire format carries, by the name written on the wire. */
type BinaryConstructor = new (buffer: ArrayBuffer) => ArrayBufferView;
const BINARY_KINDS: ReadonlyMap<string, BinaryConstructor> = new Map<string, BinaryConstructor>([
  ["Int8Array", Int8Array],
  ["Uint8Array", Uint8Array],
  ["Uint8ClampedArray", Uint8ClampedArray],
  ["Int16Array", Int16Array],
  ["Uint16Array", Uint16Array],
  ["Int32Array", Int32Array],
  ["Uint32Array", Uint32Array],
  ["Float32Array", Float32Array],
  ["Float64Array", Float64Array],
  ["BigInt64Array", BigInt64Array],
  ["BigUint64Array", BigUint64Array],
  ["DataView", DataView],
]);

/** Base64 of `bytes`, converted in chunks so a large buffer cannot overflow the call stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Bytes of a base64 text; malformed text throws a TypeError. */
function fromBase64(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw malformed("binary data is not valid base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The wire name of a typed array or DataView, or undefined for anything else. */
function binaryKindOf(value: object): string | undefined {
  for (const [name, ctor] of BINARY_KINDS) {
    if (value instanceof ctor) return name;
  }
  return undefined;
}

/** True for plain objects: prototype is Object.prototype or none. */
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Serializes data for embedding in a page, as JSON that is safe inside a
 * `<script type="application/json">` element. It carries what JSON cannot: undefined, NaN,
 * infinities, -0, bigint, Date, URL, Map, Set, ArrayBuffer, typed arrays and DataView (copied: views
 * that shared a buffer come back as independent copies), plus shared references and cycles between
 * plain objects and arrays. Read it back with {@link deserialize}.
 *
 * @param data The value to serialize.
 * @returns JSON text with `<`, `>`, `&`, U+2028 and U+2029 written as `\u` escapes, so it cannot
 * close the script element.
 * @throws TypeError `UNSERIALIZABLE_VALUE` for a function, a symbol, or an object that is not one of
 * the supported kinds (a class instance, for example).
 * @example
 * import { serialize } from "@shadow-js/web/server";
 *
 * const data = { user: { name: "Ada" }, seen: new Set([1, 2]), at: new Date(0) };
 * const tag = `<script type="application/json" id="data">${serialize(data)}</script>`;
 * @see deserialize
 * @since 1.0.0
 */
export function serialize(data: unknown): string {
  const table: unknown[] = [];
  const index = new Map<object, number>();
  const queue: Array<{ readonly value: object; readonly slot: number }> = [];

  const slotOf = (value: object): number => {
    const existing = index.get(value);
    if (existing !== undefined) return existing;
    const slot = table.length;
    table.push(null);
    index.set(value, slot);
    queue.push({ value, slot });
    return slot;
  };

  const encodeValue = (value: unknown): unknown => {
    if (value === undefined) return { $: "u" };
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "number") return encodeNumber(value);
    if (typeof value === "bigint") return { $: "big", v: value.toString() };
    if (typeof value === "object") return { $: "ref", i: slotOf(value) };
    throw invalid("UNSERIALIZABLE_VALUE", `A ${typeof value} cannot be serialized.`);
  };

  const encodeEntry = (value: object): unknown => {
    if (value instanceof Date) return { $: "date", v: encodeValue(value.getTime()) };
    if (value instanceof ArrayBuffer) return { $: "buf", v: toBase64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) {
      const kind = binaryKindOf(value);
      if (kind !== undefined) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return { $: "bin", k: kind, v: toBase64(bytes) };
      }
    }
    if (value instanceof URL) return { $: "url", v: value.href };
    if (value instanceof Map) {
      const pairs: unknown[] = [];
      for (const [key, item] of value) pairs.push([encodeValue(key), encodeValue(item)]);
      return { $: "map", e: pairs };
    }
    if (value instanceof Set) {
      const items: unknown[] = [];
      for (const item of value) items.push(encodeValue(item));
      return { $: "set", e: items };
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      // An index loop, so holes in a sparse array become undefined instead of being skipped.
      for (let i = 0; i < value.length; i += 1) items.push(encodeValue(value[i]));
      return { $: "arr", e: items };
    }
    if (!isPlainObject(value)) {
      throw invalid(
        "UNSERIALIZABLE_VALUE",
        "Only plain objects, arrays, Map, Set, Date, URL, ArrayBuffer and typed arrays can be serialized.",
      );
    }
    const pairs: unknown[] = [];
    for (const key of Object.keys(value)) pairs.push([key, encodeValue(Reflect.get(value, key))]);
    return { $: "obj", e: pairs };
  };

  const root = encodeValue(data);
  for (let head = 0; head < queue.length; head += 1) {
    const entry = queue[head];
    if (entry === undefined) break;
    table[entry.slot] = encodeEntry(entry.value);
  }
  return escapeForScript(JSON.stringify({ r: root, t: table }));
}

/** Reads an own property of a parsed JSON object; never reaches the prototype chain. */
function own(record: object, key: string): unknown {
  return Object.hasOwn(record, key) ? Reflect.get(record, key) : undefined;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Throws the TypeError for a payload that is not in the wire format. */
function malformed(detail: string): TypeError {
  return new TypeError(`deserialize(): ${detail}`);
}

/** Decodes a value that cannot refer to other entries (used while the table is created). */
function decodeScalar(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (!isRecord(value)) throw malformed("unexpected value.");
  const tag = own(value, "$");
  if (tag === "u") return undefined;
  if (tag === "num") {
    const text = own(value, "v");
    if (text === "NaN") return Number.NaN;
    if (text === "Infinity") return Number.POSITIVE_INFINITY;
    if (text === "-Infinity") return Number.NEGATIVE_INFINITY;
    if (text === "-0") return -0;
    throw malformed("unknown number.");
  }
  if (tag === "big") {
    const text = own(value, "v");
    if (typeof text !== "string") throw malformed("bigint without digits.");
    return BigInt(text);
  }
  throw malformed("unknown tag.");
}

/**
 * Rebuilds a value from the table. Plain objects get a null prototype; their keys are defined as
 * own data properties, so no key can reach or replace a prototype.
 */
function decodeValue(value: unknown, table: readonly unknown[]): unknown {
  if (isRecord(value) && own(value, "$") === "ref") {
    const slot = own(value, "i");
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= table.length) {
      throw malformed("reference outside the table.");
    }
    return table[slot];
  }
  return decodeScalar(value);
}

/** Defines an own data property; never assigns, so no setter or prototype is involved. */
function defineOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Creates an empty container for a table entry, or the value of a scalar entry. */
function createEntry(entry: unknown): unknown {
  if (!isRecord(entry)) throw malformed("table entry is not an object.");
  const tag = own(entry, "$");
  if (tag === "obj") return Object.create(null) as object;
  if (tag === "arr") return [];
  if (tag === "map") return new Map<unknown, unknown>();
  if (tag === "set") return new Set<unknown>();
  if (tag === "date") {
    const time = decodeScalar(own(entry, "v"));
    if (typeof time !== "number") throw malformed("date without a time.");
    return new Date(time);
  }
  if (tag === "buf" || tag === "bin") {
    const text = own(entry, "v");
    if (typeof text !== "string") throw malformed("binary entry without data.");
    const bytes = fromBase64(text);
    // A copy that owns exactly these bytes, so a view never exposes a larger buffer.
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (tag === "buf") return buffer;
    const kind = own(entry, "k");
    const ctor = typeof kind === "string" ? BINARY_KINDS.get(kind) : undefined;
    if (ctor === undefined) throw malformed("unknown binary kind.");
    try {
      return new ctor(buffer as ArrayBuffer);
    } catch {
      throw malformed("binary data does not fit its type.");
    }
  }
  if (tag === "url") {
    const href = own(entry, "v");
    if (typeof href !== "string") throw malformed("url without an href.");
    return new URL(href);
  }
  throw malformed("unknown table entry.");
}

/** Fills one container from its entry list. Date and URL entries are already complete. */
function fillEntry(entry: object, target: unknown, table: readonly unknown[]): void {
  const tag = own(entry, "$");
  if (tag === "date" || tag === "url" || tag === "buf" || tag === "bin") return;
  const items = own(entry, "e");
  if (!Array.isArray(items)) throw malformed("entry without a list.");
  if (tag === "obj" && target !== null && typeof target === "object") {
    for (const pair of items) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
        throw malformed("object entry is not a key and value.");
      }
      defineOwn(target, pair[0], decodeValue(pair[1], table));
    }
  } else if (tag === "arr" && Array.isArray(target)) {
    for (const item of items) target.push(decodeValue(item, table));
  } else if (tag === "map" && target instanceof Map) {
    for (const pair of items) {
      if (!Array.isArray(pair) || pair.length !== 2) throw malformed("map entry is not a pair.");
      target.set(decodeValue(pair[0], table), decodeValue(pair[1], table));
    }
  } else if (tag === "set" && target instanceof Set) {
    for (const item of items) target.add(decodeValue(item, table));
  } else {
    throw malformed("entry does not match its tag.");
  }
}

/**
 * Rebuilds the value {@link serialize} wrote, with its shared references and cycles. Plain objects
 * come back with a null prototype (so a `__proto__` key is ordinary data), and malformed input throws
 * instead of producing a partial value. No code is evaluated.
 *
 * @param text JSON text produced by {@link serialize}.
 * @returns The rebuilt value.
 * @throws SyntaxError when `text` is not JSON; TypeError when the JSON is not in the format
 * `serialize` writes.
 * @example
 * import { deserialize, serialize } from "@shadow-js/web/server";
 *
 * const copy = deserialize(serialize({ tags: new Set(["a"]), total: 10n })) as {
 *   tags: Set<string>;
 *   total: bigint;
 * };
 * copy.tags.has("a"); // true
 * @see serialize
 * @since 1.0.0
 */
export function deserialize(text: string): unknown {
  const payload: unknown = JSON.parse(text);
  if (!isRecord(payload)) throw malformed("payload is not an object.");
  const table = own(payload, "t");
  if (!Array.isArray(table)) throw malformed("payload has no table.");
  const made: unknown[] = [];
  for (const entry of table) made.push(createEntry(entry));
  for (let slot = 0; slot < table.length; slot += 1) {
    const entry = table[slot];
    if (isRecord(entry)) fillEntry(entry, made[slot], made);
  }
  return decodeValue(own(payload, "r"), made);
}
