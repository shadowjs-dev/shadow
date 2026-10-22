import { useRenderEffect } from "./effect";
import { currentOwner, Owner, ShadowError } from "./extend";
import { runWithOwner } from "./ownership";
import { useSignal } from "./signal";

/**
 * A context made by {@link createContext}: a value that a subtree receives from the nearest provider
 * above it. The context is itself the provider component; `Provider` is the same function.
 * @since 1.0.0
 */
export interface Context<T> {
  /**
   * Renders `children` with `value` provided. The value is read once, when the provider is created;
   * provide an accessor or a store for a value that changes. Returns an accessor of the children.
   */
  (props: { value: T; children?: unknown }): unknown;
  /** The unique key the provided value is stored under, described by the context's `name`. */
  readonly id: symbol;
  /** The value {@link useContext} returns without a provider. `undefined` means none: it throws. */
  readonly defaultValue: T | undefined;
  /** The same component, for code written as `<Ctx.Provider value={...}>`. */
  readonly Provider: (props: { value: T; children?: unknown }) => unknown;
}

/**
 * Options of {@link createContext}.
 * @since 1.0.0
 */
export interface ContextOptions {
  /**
   * Label shown in diagnostics and used as the description of the context's `id` symbol.
   * @default "context"
   */
  name?: string;
}

/**
 * Creates a context: a value that components read with {@link useContext} without passing it
 * through props. Render the returned component around a subtree to provide a value. The value is
 * read once; pass a signal accessor or a store to provide something reactive. On the server the
 * provider builds its subtree once.
 *
 * @param defaultValue Returned by `useContext` when no provider is above the reader. Undefined
 * (or omitted) means the context has no default, so reading it without a provider throws.
 * @param options A diagnostics name. Undefined uses the default.
 * @returns The context, which is also its provider component.
 * @example
 * import { createContext, useContext } from "@shadow-js/core";
 *
 * const Theme = createContext<"light" | "dark">("light", { name: "Theme" });
 *
 * function Label() {
 *   return <p>Theme: {useContext(Theme)}</p>;
 * }
 *
 * const app = <Theme.Provider value="dark"><Label /></Theme.Provider>;
 * @see useContext
 * @since 1.0.0
 */
export function createContext<T>(defaultValue?: T, options?: ContextOptions): Context<T> {
  const id = Symbol(options?.name ?? "context");
  const provider = (props: { value: T; children?: unknown }): unknown => {
    const scope = new Owner(currentOwner());
    const inherited = scope.context;
    const next = Object.create(inherited) as Record<symbol, unknown>;
    next[id] = props.value;
    scope.context = next;
    // A render effect, so a children expression that reads signals stays reactive and still sees
    // the provided value. An effect (not a memo) because component setup may legitimately write
    // signals, and errors thrown while building the subtree must reach the error boundaries.
    return runWithOwner(scope, () => {
      if (__SERVER__) {
        // Nothing is reactive on the server: build the subtree once.
        const built = props.children;
        return () => built;
      }
      const [children, setChildren] = useSignal<unknown>(undefined, { equals: false });
      useRenderEffect(
        () => props.children,
        (value) => {
          setChildren(() => value);
        },
      );
      return children;
    });
  };
  return Object.assign(provider, { id, defaultValue, Provider: provider }) as Context<T>;
}

/**
 * Runs `fn` with `value` provided for `context` (as a Provider does), without a render effect: the
 * value is set for the duration of `fn` only, and what `fn` creates sees it. Used where a renderer
 * builds a subtree that must not be re-run by a Provider's effect. `fn` runs untracked, in a new
 * child owner of the current owner that is disposed with it.
 *
 * @param context The context to provide.
 * @param value The value `useContext(context)` returns inside `fn`.
 * @param fn Runs once, synchronously.
 * @returns What `fn` returns.
 * @example
 * import { createContext, useContext } from "@shadow-js/core";
 * import { runWithContext } from "@shadow-js/core/extend";
 *
 * const Theme = createContext("light");
 * const theme = runWithContext(Theme, "dark", () => useContext(Theme));
 * console.log(theme); // "dark"
 * @see createContext
 * @since 1.0.0
 */
export function runWithContext<T, R>(context: Context<T>, value: T, fn: () => R): R {
  const scope = new Owner(currentOwner());
  const next = Object.create(scope.context) as Record<symbol, unknown>;
  next[context.id] = value;
  scope.context = next;
  return runWithOwner(scope, fn);
}

/**
 * Reads the nearest provided value of `context`. Falls back to its default; throws when there is
 * neither a provider nor a default, because no correct value exists. The lookup follows the current
 * owner, so call it while a component runs (or in an effect or memo it creates), not after an
 * `await` or in an event handler. The read is not tracked.
 *
 * @param context A context made by {@link createContext}.
 * @returns The value of the nearest provider above the current owner, else the default value.
 * @throws ShadowError `CONTEXT_MISSING` when no provider is above the current owner and the
 * context's default is `undefined`.
 * @example
 * import { createContext, useContext } from "@shadow-js/core";
 *
 * const User = createContext<{ name: string }>();
 *
 * function Greeting() {
 *   const user = useContext(User); // throws CONTEXT_MISSING without a provider
 *   return <p>Hello, {user.name}</p>;
 * }
 * @see createContext
 * @since 1.0.0
 */
export function useContext<T>(context: Context<T>): T {
  const map = currentOwner()?.context;
  if (map !== null && map !== undefined && context.id in map) return map[context.id] as T;
  if (context.defaultValue === undefined) throw new ShadowError("CONTEXT_MISSING");
  return context.defaultValue;
}
