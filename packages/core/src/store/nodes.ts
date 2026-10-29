import {
  createSignalNode,
  isTracking,
  notify as notifySource,
  type SignalNode,
  track,
} from "../extend";

/** Keys that could reach `Object.prototype` if written; they are never stored as own properties. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Tracking state of one plain object or array. Signals are created lazily, on the first read made
 * inside a tracked computation, so untracked data costs one small record per object.
 */
export interface NodeState {
  /**
   * One signal per property read in a tracked context, keyed by property name. A signal is only a
   * notifier (it holds no value), so one that nothing observes any more is dropped by a sweep (see
   * `signalFor`) and a later read simply makes a new one.
   */
  signals: Map<string, SignalNode<number>> | null;
  /** Notified when a property is added or removed, or an array changes length. */
  keys: SignalNode<number> | null;
  /** The read-only proxy for this object, created on first read. */
  proxy: object | null;
}

/** Raw object -> its tracking state. Keys are the raw data, so nothing is stamped on user objects. */
export const NODES: WeakMap<object, NodeState> = new WeakMap();

/** Any store proxy (read-only or draft) -> the raw object it wraps. */
export const RAW: WeakMap<object, object> = new WeakMap();

/** True for the keys that must never be written as own properties. */
export function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

/** True for the values the store wraps: plain objects (null or Object.prototype) and arrays. */
export function isWrappable(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return true;
  if (value === Object.prototype) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Replaces a store proxy by the raw object it wraps; any other value is returned as is. */
export function unwrapValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  return RAW.get(value) ?? value;
}

/** True when a store proxy (draft or read-only view) sits anywhere inside the plain data `root`. */
function containsProxy(root: object): boolean {
  const seen = new Set<object>([root]);
  const stack: object[] = [root];
  while (stack.length > 0) {
    const container = stack.pop() as object;
    for (const key of Object.keys(container)) {
      const member: unknown = Reflect.get(container, key);
      if (typeof member !== "object" || member === null) continue;
      if (RAW.has(member)) return true;
      if (isWrappable(member) && !seen.has(member)) {
        seen.add(member);
        stack.push(member);
      }
    }
  }
  return false;
}

/**
 * Like {@link unwrapValue}, and also for proxies hidden inside plain data: `draft.todos =
 * draft.todos.filter(...)` assigns an array whose members are drafts, and a draft stored in the
 * data would throw on its next use. Data without proxies is returned as is; otherwise a copy with
 * every proxy replaced by its raw object. Iterative, so nesting depth is not limited by the stack.
 */
export function unwrapDeep(value: unknown): unknown {
  const first = unwrapValue(value);
  if (first !== value || !isWrappable(first) || !containsProxy(first)) return first;
  const copies = new Map<object, object>();
  const copyOf = (source: object): object => {
    const existing = copies.get(source);
    if (existing !== undefined) return existing;
    const made: object = Array.isArray(source) ? [] : Object.create(Object.getPrototypeOf(source));
    copies.set(source, made);
    return made;
  };
  const rootCopy = copyOf(first);
  const queue: object[] = [first];
  for (let head = 0; head < queue.length; head += 1) {
    const source = queue[head] as object;
    const target = copies.get(source) as object;
    for (const key of Object.keys(source)) {
      let member: unknown = Reflect.get(source, key);
      if (typeof member === "object" && member !== null) {
        const raw = RAW.get(member);
        if (raw !== undefined) member = raw;
        else if (isWrappable(member)) {
          const known = copies.has(member);
          member = copyOf(member);
          if (!known) queue.push(Reflect.get(source, key) as object);
        }
      }
      Object.defineProperty(target, key, {
        value: member,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return rootCopy;
}

/** Reads an own or inherited property without tracking and without invoking proxies. */
export function readRaw(target: object, key: string): unknown {
  return Reflect.get(target, key);
}

/** Returns the tracking state of `raw`, creating an empty one on first use. */
export function nodeOf(raw: object): NodeState {
  let node = NODES.get(raw);
  if (node === undefined) {
    node = { signals: null, keys: null, proxy: null };
    NODES.set(raw, node);
  }
  return node;
}

/** The map size at which the first sweep of unobserved key signals runs. */
const SWEEP_AT = 256;

function signalFor(node: NodeState, key: string): SignalNode<number> {
  let signals = node.signals;
  if (signals === null) {
    signals = new Map();
    node.signals = signals;
  }
  let signal = signals.get(key);
  if (signal === undefined) {
    // Reading many transient keys (`store.byId[id]` with churning ids) would keep one signal per key
    // for the life of the store. The sweep runs when the map reaches a power of two from SWEEP_AT on,
    // so its cost is amortized O(1) per new key, and the map stays within about twice the number of
    // keys that are observed at that moment (plus SWEEP_AT).
    const size = signals.size;
    if (size >= SWEEP_AT && (size & (size - 1)) === 0) {
      // Safe at any time: a signal carries no value, and the next read of its key makes a fresh one.
      for (const [other, node] of signals) {
        if ((node.observers?.length ?? 0) === 0) signals.delete(other);
      }
    }
    signal = createSignalNode(0, false);
    signals.set(key, signal);
  }
  return signal;
}

/** Subscribes the running computation (if any) to one property of the object. */
export function trackProperty(node: NodeState, key: string): void {
  if (!isTracking()) return;
  track(signalFor(node, key));
}

/** Subscribes the running computation (if any) to the key set of the object. */
export function trackKeys(node: NodeState): void {
  if (!isTracking()) return;
  if (node.keys === null) node.keys = createSignalNode(0, false);
  track(node.keys);
}

/**
 * Notifies the observers of one signal. The same engine steps as a signal write: mark the
 * observers dirty, then request a flush (which the surrounding batch defers).
 */
function notify(signal: SignalNode<number> | null | undefined): void {
  if (signal === undefined || signal === null) return;
  notifySource(signal);
}

function isIndexKey(key: string): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && String(index) === key;
}

/** Notifies the index signals of an array at or beyond `from` (used when the array shrinks). */
function notifyIndicesFrom(node: NodeState, from: number): void {
  const signals = node.signals;
  if (signals === null) return;
  for (const [key, signal] of signals) {
    if (isIndexKey(key) && Number(key) >= from) notify(signal);
  }
}

/**
 * Writes one property of a raw object and notifies exactly what changed: the property's signal,
 * the key set when a property appears, and the length when an array's length moves. An equal
 * value (Object.is) writes nothing. Returns whether anything changed.
 */
export function writeRaw(target: object, key: string, value: unknown): boolean {
  if (isReservedKey(key)) {
    throw new TypeError(
      __DEV__
        ? `ShadowStore: "${key}" cannot be written; it is a reserved key`
        : "SHADOW_STORE_RESERVED_KEY",
    );
  }
  value = unwrapDeep(value);
  const array = Array.isArray(target);
  const had = Object.hasOwn(target, key);
  if (had && Object.is(readRaw(target, key), value)) return false;
  const before = array ? (target as unknown[]).length : 0;
  if (!Reflect.set(target, key, value)) {
    throw new TypeError(
      __DEV__
        ? `ShadowStore: property "${key}" is read-only and cannot be written`
        : "SHADOW_STORE_PROP_READ_ONLY",
    );
  }
  const node = NODES.get(target);
  if (node === undefined) return true;
  notify(node.signals?.get(key));
  if (!had) notify(node.keys);
  if (array) {
    const after = (target as unknown[]).length;
    if (after !== before) {
      notify(node.signals?.get("length"));
      notify(node.keys);
      if (after < before) notifyIndicesFrom(node, after);
    }
  }
  return true;
}

/** Deletes one own property of a raw object and notifies its signal and the key set. */
export function deleteRaw(target: object, key: string): boolean {
  if (isReservedKey(key)) {
    throw new TypeError(
      __DEV__
        ? `ShadowStore: "${key}" cannot be deleted; it is a reserved key`
        : "SHADOW_STORE_RESERVED_DELETE",
    );
  }
  if (!Object.hasOwn(target, key)) return true;
  if (!Reflect.deleteProperty(target, key)) {
    throw new TypeError(
      __DEV__ ? `ShadowStore: property "${key}" cannot be deleted` : "SHADOW_STORE_DELETE",
    );
  }
  const node = NODES.get(target);
  if (node === undefined) return true;
  notify(node.signals?.get(key));
  notify(node.keys);
  return true;
}
