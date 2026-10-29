import { useMemo } from "./memo";
import { untrack } from "./ownership";

/**
 * Keys that never take part in a merge or a split. Reading them through a props object that came
 * from JSON or from user input could reach `Object.prototype`, so they are skipped everywhere.
 */
const UNSAFE_KEYS: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Results of mergeProps (and splitProps over them) that have at least one function source. Their
 * key set can change between reads, so splitProps builds a live rest object for them. A WeakSet is
 * bounded by the garbage collector.
 */
const DYNAMIC_PROPS = new WeakSet<object>();

/** Longest chain of nested accessors that children() follows before it gives up. */
const MAX_FUNCTION_LAYERS = 1000;

/**
 * A value accepted by {@link mergeProps}: an object, a function that returns one (called at every
 * read, so it can be reactive), or `null`, `undefined` or `false`, which are skipped. Use it to type
 * a helper that collects sources before merging them.
 * @since 1.0.0
 */
export type MergeSource = object | null | undefined | false;

/** The props object a source stands for; functions contribute their return type. */
type PropsOf<S> = S extends (...args: never[]) => infer R
  ? Exclude<R, null | undefined | false>
  : S extends null | undefined | false
    ? object
    : S;

/** Later keys replace earlier ones; a later key that may be `undefined` keeps the earlier type too. */
type Overlay<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? K extends keyof A
      ? undefined extends B[K]
        ? Exclude<B[K], undefined> | A[K]
        : B[K]
      : B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

/**
 * The type of `mergeProps(...sources)`, folded left to right: a later source's key replaces an
 * earlier one, and a later key that may be `undefined` keeps the earlier type as well.
 * @since 1.0.0
 */
export type MergeProps<T extends readonly unknown[], Acc = object> = T extends readonly [
  infer Head,
  ...infer Rest,
]
  ? MergeProps<Rest, Overlay<Acc, PropsOf<Head>>>
  : Acc;

/**
 * The type of `splitProps(props, ...keyLists)`: one object per key list, picking those keys, then
 * the rest without any listed key.
 * @since 1.0.0
 */
export type SplitProps<T extends object, K extends readonly (readonly (keyof T)[])[]> = [
  ...{ [I in keyof K]: Pick<T, Extract<K[I][number], keyof T>> },
  Omit<T, K[number][number]>,
];

/**
 * The value returned by {@link children}: calling it yields one leaf, an array of several leaves,
 * or `undefined` for none; `toArray()` always returns an array. The methods mirror React's
 * `Children` helpers.
 * @since 1.0.0
 */
export interface ResolvedChildren {
  /**
   * The current children: one leaf, an array of several leaves, or `undefined` when there is none.
   * The read is tracked like a memo read.
   */
  (): unknown;
  /** A fresh array of the leaves, without `null`, `undefined` or booleans. */
  toArray(): unknown[];
  /** Number of leaves, zero or more (the React `Children.count`). */
  count(): number;
  /** Maps each leaf with its index; the callback runs untracked (React `Children.map`). */
  map<U>(fn: (leaf: unknown, index: number) => U): U[];
  /** Visits each leaf with its index; the callback runs untracked (React `Children.forEach`). */
  forEach(fn: (leaf: unknown, index: number) => void): void;
  /**
   * The single leaf (React `Children.only`). Throws a TypeError (production message
   * `SHADOW_CHILDREN_ONLY`) when there is not exactly one leaf.
   */
  only(): unknown;
}

/** Whether a source stands for nothing and is skipped. */
function isEmptySource(value: unknown): value is null | undefined | false {
  return value === null || value === undefined || value === false;
}

/** Own enumerable string and symbol keys, minus the unsafe ones. Reads no getter. */
function ownEnumerableKeys(source: object): Key[] {
  return Reflect.ownKeys(source).filter(
    (key) => !UNSAFE_KEYS.has(key) && Object.prototype.propertyIsEnumerable.call(source, key),
  );
}

/** Defines an enumerable getter; the target is a fresh object, so this never hits a setter. */
function defineGetter(target: object, key: PropertyKey, read: () => unknown): void {
  Object.defineProperty(target, key, { enumerable: true, configurable: true, get: read });
}

/** The object a source stands for at this moment, or `undefined` when it is skipped. */
function resolveSource(source: object): object | undefined {
  const value: unknown = typeof source === "function" ? (source as () => unknown)() : source;
  if (isEmptySource(value)) return undefined;
  if (typeof value === "object" && value !== null) return value;
  throw new TypeError(
    __DEV__
      ? "mergeProps: a source function must return an object, null, undefined or false"
      : "SHADOW_MERGE_SOURCE",
  );
}

/** The sources that stand for an object right now, in order; skipped ones are dropped. */
function resolveAll(sources: readonly object[]): object[] {
  const resolved: object[] = [];
  for (const source of sources) {
    const object = resolveSource(source);
    if (object !== undefined) resolved.push(object);
  }
  return resolved;
}

/**
 * Reads one merged key: the right-most object that has the key and a value other than `undefined`
 * wins. Each getter is read at most once.
 */
function readMerged(objects: readonly object[], key: Key): unknown {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const source = objects[index];
    if (source === undefined || !(key in source)) continue;
    const value: unknown = Reflect.get(source, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Every merged key in first-occurrence order. Reads no getter. */
function mergedKeys(objects: readonly object[]): Key[] {
  const seen = new Set<Key>();
  const keys: Key[] = [];
  for (const source of objects) {
    for (const key of ownEnumerableKeys(source)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** A property name as a Proxy trap sees it. */
type Key = string | symbol;

/** The key set and the reader that a live view uses for one access. */
interface LiveState {
  readonly keys: ReadonlySet<Key>;
  read(key: Key): unknown;
}

/**
 * The cache of the live views: `readDepth` counts how deep the live reads are running and
 * `readStates` holds the state each live view computed during the outermost read. A view's traps
 * read the views beneath them, and those read the views beneath them: without a cache every trap
 * recomputes each level below, and a few nested components (a chain of `{...props}` forwards) take
 * exponential time. Within one outermost read a view's state is computed once, so a read costs time
 * linear in the number of views. The cache is dropped when that read returns, so each read still
 * sees the current values.
 *
 * These two are module-level scratch state (R-CODE-4, the scratch-array class), and not registers
 * of `internal/state.ts`: this file may import only the public extension API (EXT-01), which has no
 * place for them, and a new public export for two private counters is not worth it. They are safe
 * because every write is undone in `finally` (`duringRead`), so a getter that throws leaves depth 0
 * and an empty map, and because the map holds a view only while one outermost read is running.
 */
let readDepth = 0;
const readStates = new Map<object, LiveState>();

function stateOf(view: object, load: () => LiveState): LiveState {
  const known = readStates.get(view);
  if (known !== undefined) return known;
  const state = load();
  readStates.set(view, state);
  return state;
}

function duringRead<T>(run: () => T): T {
  readDepth += 1;
  try {
    return run();
  } finally {
    readDepth -= 1;
    if (readDepth === 0) readStates.clear();
  }
}

/**
 * A Proxy whose key set and values are recomputed on every access: `load` runs once per trap, so
 * a function source is called once per access. The target is an ordinary object, so prototype
 * lookups keep their usual meaning, and every write is refused because props are read-only.
 */
function liveView(load: () => LiveState): object {
  const target: object = {};
  return new Proxy(target, {
    get(_target, key) {
      return duringRead(() => {
        const state = stateOf(target, load);
        return state.keys.has(key) ? state.read(key) : (Reflect.get(target, key) as unknown);
      });
    },
    has(_target, key) {
      return duringRead(() => stateOf(target, load).keys.has(key) || Reflect.has(target, key));
    },
    ownKeys() {
      return duringRead(() => [...stateOf(target, load).keys]);
    },
    getOwnPropertyDescriptor(_target, key) {
      return duringRead(() => {
        if (!stateOf(target, load).keys.has(key)) return undefined;
        return {
          enumerable: true,
          configurable: true,
          get: () => duringRead(() => stateOf(target, load).read(key)),
        };
      });
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}

/**
 * Merges props objects into one getter-preserving object. Reading a key returns the value from the
 * right-most source that has it, unless that value is `undefined`, in which case the next source
 * to the left is tried. Nothing is copied at merge time, so reads stay reactive. Use it to give
 * component props defaults without reading them in the component body.
 *
 * Sources may be objects, `null`, `undefined` or `false` (skipped), or functions that return an
 * object. A function is called on every read, which is how spreads such as `{...props()}` stay
 * reactive. Keys named `__proto__`, `constructor` or `prototype` are ignored.
 *
 * @param sources The props objects, from lowest to highest priority.
 * @returns A read-only object whose keys are the union of the sources' own enumerable keys. With a
 * function source, the key set is recomputed on every access.
 * @throws TypeError (production message `SHADOW_MERGE_SOURCES`) when a source is not an object, a
 * function, `null`, `undefined` or `false`. A read of the result throws TypeError (production
 * message `SHADOW_MERGE_SOURCE`) when a function source returns anything else.
 * @example
 * import { mergeProps } from "@shadow-js/core";
 *
 * function Button(props: { size?: "sm" | "md"; label: string }) {
 *   const merged = mergeProps({ size: "md" as const }, props);
 *   return <button class={`btn-${merged.size}`}>{merged.label}</button>;
 * }
 * @see splitProps
 * @since 1.0.0
 */
export function mergeProps<T extends readonly MergeSource[]>(...sources: T): MergeProps<T>;
export function mergeProps(...sources: readonly MergeSource[]): object {
  const inputs: object[] = [];
  let dynamic = false;
  for (const source of sources) {
    if (isEmptySource(source)) continue;
    if (typeof source === "function") {
      dynamic = true;
    } else if (typeof source !== "object") {
      throw new TypeError(
        __DEV__
          ? "mergeProps: sources must be objects, functions, or null, undefined or false"
          : "SHADOW_MERGE_SOURCES",
      );
    }
    inputs.push(source);
  }
  if (!dynamic) {
    const objects = resolveAll(inputs);
    const merged: object = {};
    for (const key of mergedKeys(objects)) {
      defineGetter(merged, key, () => readMerged(objects, key));
    }
    return merged;
  }
  const view = liveView(() => {
    const objects = resolveAll(inputs);
    return { keys: new Set(mergedKeys(objects)), read: (key) => readMerged(objects, key) };
  });
  DYNAMIC_PROPS.add(view);
  return view;
}

/**
 * Splits props into one getter-preserving object per key list, followed by an object holding every
 * other key. Each group reads its keys from `props` at access time, so reactivity is preserved. A
 * key listed in two groups appears in both and never in the rest. A listed key that `props` does not
 * have is still present in its group, as `undefined`. Use it to separate the props a component
 * consumes from the ones it forwards to an element.
 *
 * @param props The props to split; plain objects, Proxies and {@link mergeProps} results work.
 * @param keys One or more key lists. Keys named `__proto__`, `constructor` or `prototype` are
 * ignored.
 * @returns `[...groups, rest]`, in the order the key lists were given.
 * @example
 * import { splitProps } from "@shadow-js/core";
 *
 * function Field(props: { label: string; value: string; placeholder?: string }) {
 *   const [own, input] = splitProps(props, ["label"]);
 *   return (
 *     <label>
 *       {own.label}
 *       <input {...input} />
 *     </label>
 *   );
 * }
 * @see mergeProps
 * @since 1.0.0
 */
export function splitProps<T extends object, const K extends readonly (readonly (keyof T)[])[]>(
  props: T,
  ...keys: K
): SplitProps<T, K>;
export function splitProps(props: object, ...keys: readonly (readonly PropertyKey[])[]): object[] {
  const listed = new Set<PropertyKey>();
  const groups: object[] = [];
  for (const group of keys) {
    const picked: object = {};
    for (const key of group) {
      if (UNSAFE_KEYS.has(key)) continue;
      listed.add(key);
      defineGetter(picked, key, () => Reflect.get(props, key) as unknown);
    }
    groups.push(picked);
  }
  const restKeys = (): Key[] => ownEnumerableKeys(props).filter((key) => !listed.has(key));
  const readRest = (key: Key): unknown => Reflect.get(props, key) as unknown;
  if (DYNAMIC_PROPS.has(props)) {
    const rest = liveView(() => ({ keys: new Set(restKeys()), read: readRest }));
    return [...groups, rest];
  }
  const rest: object = {};
  for (const key of restKeys()) defineGetter(rest, key, () => readRest(key));
  return [...groups, rest];
}

/** One level of a children walk: an array being read and the function-layer depth it sits at. */
interface Frame {
  readonly items: readonly unknown[];
  next: number;
  readonly layer: number;
}

/**
 * Resolves children without recursion: arrays flatten in order, accessors are called until a plain
 * value appears, and `null`, `undefined` and booleans are dropped. A cyclic array or more than
 * {@link MAX_FUNCTION_LAYERS} nested accessors is a TypeError.
 */
function flattenChildren(fn: () => unknown): unknown[] {
  const leaves: unknown[] = [];
  const frames: Frame[] = [];
  const open = new Set<readonly unknown[]>();
  let value: unknown = fn;
  let layer = 0;
  for (;;) {
    if (typeof value === "function") {
      if (layer >= MAX_FUNCTION_LAYERS) {
        throw new TypeError(
          __DEV__
            ? `children(): more than ${MAX_FUNCTION_LAYERS} nested accessors; a function child may return itself`
            : "SHADOW_CHILDREN_LAYERS",
        );
      }
      value = (value as () => unknown)();
      layer += 1;
      continue;
    }
    if (Array.isArray(value)) {
      if (open.has(value))
        throw new TypeError(
          __DEV__ ? "children(): an array contains itself" : "SHADOW_CHILDREN_CYCLE",
        );
      open.add(value);
      frames.push({ items: value, next: 0, layer });
    } else if (value !== null && value !== undefined && typeof value !== "boolean") {
      leaves.push(value);
    }
    let advanced = false;
    while (!advanced) {
      const top = frames.at(-1);
      if (top === undefined) return leaves;
      if (top.next < top.items.length) {
        value = top.items[top.next];
        top.next += 1;
        layer = top.layer;
        advanced = true;
      } else {
        frames.pop();
        open.delete(top.items);
      }
    }
  }
}

/**
 * Memoizes a `props.children` getter so that it is read at most once per change of its
 * dependencies. Arrays are flattened, accessors are called, and `null`, `undefined` and booleans
 * are dropped. The memo is created in the current owner, so nodes created while resolving are
 * disposed with it. Use it when a component inspects or rearranges its children.
 *
 * @param fn The lazy children accessor, usually `() => props.children`.
 * @returns A {@link ResolvedChildren} accessor with `toArray()`, `count()`, `map()`, `forEach()`
 * and `only()`.
 * @throws TypeError from the returned accessor and its methods when the children contain an array
 * that contains itself (production message `SHADOW_CHILDREN_CYCLE`) or more than 1000 nested
 * accessors (`SHADOW_CHILDREN_LAYERS`). `only()` throws TypeError (`SHADOW_CHILDREN_ONLY`) unless
 * there is exactly one leaf.
 * @example
 * import { children } from "@shadow-js/core";
 *
 * function Steps(props: { children?: unknown }) {
 *   const steps = children(() => props.children);
 *   return (
 *     <ol aria-label={`${steps.count()} steps`}>
 *       {steps.map((step) => <li>{step as Node | string}</li>)}
 *     </ol>
 *   );
 * }
 * @since 1.0.0
 */
export function children(fn: () => unknown): ResolvedChildren {
  const memo = useMemo(() => flattenChildren(fn), { allowWrites: true });
  const accessor = (): unknown => {
    const leaves = memo();
    if (leaves.length === 1) return leaves[0];
    return leaves.length === 0 ? undefined : leaves;
  };
  return Object.assign(accessor, {
    toArray: (): unknown[] => [...memo()],
    count: (): number => memo().length,
    map: <U>(fn: (leaf: unknown, index: number) => U): U[] =>
      memo().map((leaf, index) => untrack(() => fn(leaf, index))),
    forEach: (fn: (leaf: unknown, index: number) => void): void => {
      memo().forEach((leaf, index) => {
        untrack(() => fn(leaf, index));
      });
    },
    only: (): unknown => {
      const leaves = memo();
      if (leaves.length !== 1) {
        throw new TypeError(
          __DEV__
            ? `children().only(): expected one child, received ${leaves.length}`
            : "SHADOW_CHILDREN_ONLY",
        );
      }
      return leaves[0];
    },
  });
}
