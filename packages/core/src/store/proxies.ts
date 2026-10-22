import {
  deleteRaw,
  isReservedKey,
  isWrappable,
  nodeOf,
  RAW,
  readRaw,
  trackKeys,
  trackProperty,
  unwrapValue,
  writeRaw,
} from "./nodes";

/**
 * One `setStore` call. Drafts made for it are cached here, so a draft object keeps its identity
 * inside the update, and they stop accepting writes when the call returns.
 */
export class Transaction {
  readonly label: string;
  open: boolean;
  readonly drafts: Map<object, object>;
  readonly handler: ProxyHandler<object>;

  constructor(label: string) {
    this.label = label;
    this.open = true;
    this.drafts = new Map();
    this.handler = draftHandler(this);
  }
}

function readOnly(key: string | symbol): TypeError {
  const name = typeof key === "symbol" ? key.toString() : `"${key}"`;
  return new TypeError(
    __DEV__
      ? `ShadowStore: the store is read-only; ${name} can only be changed inside setStore((draft) => ...)`
      : "SHADOW_STORE_READ_ONLY",
  );
}

/**
 * Returns the value to hand out for `key`: a wrapped object when the value is an own, writable
 * wrappable slot, otherwise the raw value. Frozen slots must return the raw value because a proxy
 * may not report a different value for a non-writable, non-configurable property.
 */
function childOf(
  target: object,
  key: string,
  value: unknown,
  wrap: (raw: object) => object,
): unknown {
  if (!isWrappable(value) || !Object.hasOwn(target, key)) return value;
  const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
  if (
    descriptor !== undefined &&
    descriptor.configurable === false &&
    descriptor.writable === false
  ) {
    return value;
  }
  return wrap(value);
}

/** Descriptor passthrough that wraps the value the same way `get` does. */
function describeChild(
  target: object,
  key: string | symbol,
  wrap: (raw: object) => object,
): PropertyDescriptor | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined || typeof key === "symbol") return descriptor;
  if (descriptor.configurable === false) return descriptor;
  const value: unknown = descriptor.value;
  if (!isWrappable(value)) return descriptor;
  return { ...descriptor, value: wrap(value) };
}

/** `__proto__` is only reachable through the prototype chain, so the store never exposes it. */
function hidesPrototype(target: object, key: string): boolean {
  return key === "__proto__" && !Object.hasOwn(target, key);
}

/** True when `key` resolves to an accessor property (own or inherited). */
function hasGetter(target: object, key: string): boolean {
  for (
    let object: object | null = target;
    object !== null;
    object = Object.getPrototypeOf(object)
  ) {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
    if (descriptor !== undefined) return typeof descriptor.get === "function";
  }
  return false;
}

/** Read-only handler: every read subscribes the running computation to the property it touches. */
const READ_HANDLER: ProxyHandler<object> = {
  get(target, key, receiver) {
    if (typeof key === "symbol") return Reflect.get(target, key);
    if (hidesPrototype(target, key)) return undefined;
    trackProperty(nodeOf(target), key);
    // A getter runs with the store view as `this`, so what it reads is tracked too.
    if (hasGetter(target, key)) return Reflect.get(target, key, receiver);
    return childOf(target, key, readRaw(target, key), readProxyOf);
  },
  has(target, key) {
    if (typeof key !== "symbol") trackProperty(nodeOf(target), key);
    return Reflect.has(target, key);
  },
  ownKeys(target) {
    trackKeys(nodeOf(target));
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, key) {
    return describeChild(target, key, readProxyOf);
  },
  set(_target, key) {
    throw readOnly(key);
  },
  deleteProperty(_target, key) {
    throw readOnly(key);
  },
  defineProperty(_target, key) {
    throw readOnly(key);
  },
  setPrototypeOf() {
    throw readOnly("[[Prototype]]");
  },
  preventExtensions() {
    throw readOnly("[[Extensible]]");
  },
};

/** Draft handler for one transaction: writes go through the notifying helpers. */
function draftHandler(tx: Transaction): ProxyHandler<object> {
  const wrap = (raw: object): object => draftOf(raw, tx);
  /** Throws unless the draft is still inside its update and `key` is a string key. */
  const writable = (key: string | symbol): string => {
    if (!tx.open) {
      throw new TypeError(
        __DEV__
          ? `ShadowStore (${tx.label}): a draft was used after its setStore() call returned; write only inside the update`
          : "SHADOW_STORE_DRAFT_STALE",
      );
    }
    if (typeof key === "symbol") {
      throw new TypeError(
        __DEV__
          ? `ShadowStore (${tx.label}): symbol keys cannot be written`
          : "SHADOW_STORE_SYMBOL_KEY",
      );
    }
    return key;
  };
  return {
    get(target, key) {
      if (typeof key === "symbol") return Reflect.get(target, key);
      if (hidesPrototype(target, key)) return undefined;
      return childOf(target, key, readRaw(target, key), wrap);
    },
    has(target, key) {
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      return describeChild(target, key, wrap);
    },
    set(target, key, value) {
      const name = writable(key);
      if (isReservedKey(name)) {
        throw new TypeError(
          __DEV__
            ? `ShadowStore (${tx.label}): "${name}" cannot be written; it is a reserved key`
            : "SHADOW_STORE_RESERVED_KEY",
        );
      }
      writeRaw(target, name, unwrapValue(value));
      return true;
    },
    deleteProperty(target, key) {
      return deleteRaw(target, writable(key));
    },
    defineProperty(_target, key) {
      throw new TypeError(
        __DEV__
          ? `ShadowStore (${tx.label}): defineProperty is not supported on drafts; assign the property instead (key "${String(key)}")`
          : "SHADOW_STORE_DEFINE_PROPERTY",
      );
    },
    setPrototypeOf() {
      throw new TypeError(
        __DEV__
          ? `ShadowStore (${tx.label}): drafts cannot change their prototype`
          : "SHADOW_STORE_PROTOTYPE",
      );
    },
    preventExtensions() {
      throw new TypeError(
        __DEV__
          ? `ShadowStore (${tx.label}): drafts cannot be made non-extensible`
          : "SHADOW_STORE_NON_EXTENSIBLE",
      );
    },
  };
}

/** Returns the read-only proxy of a raw object. The same raw object always yields the same proxy. */
export function readProxyOf(raw: object): object {
  const node = nodeOf(raw);
  if (node.proxy === null) {
    const proxy = new Proxy(raw, READ_HANDLER);
    RAW.set(proxy, raw);
    node.proxy = proxy;
  }
  return node.proxy;
}

/** Returns the draft proxy of a raw object for one transaction. */
export function draftOf(raw: object, tx: Transaction): object {
  const existing = tx.drafts.get(raw);
  if (existing !== undefined) return existing;
  const proxy = new Proxy(raw, tx.handler);
  RAW.set(proxy, raw);
  tx.drafts.set(raw, proxy);
  return proxy;
}
