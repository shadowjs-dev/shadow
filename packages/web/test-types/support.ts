/**
 * Helpers for the JSX type tests. `sink` takes any value, so each JSX expression is type-checked
 * against its element or component types without being used at runtime. Nothing here runs.
 *
 * @since 1.0.0
 */

declare module "@shadow-js/web/jsx-runtime" {
  interface CustomEvents {
    toast: CustomEvent<{ message: string }>;
  }
  interface Directives {
    tooltip: string;
  }
}

/** Accepts any JSX expression; the JSX itself is what the tests check. */
export declare function sink(...values: readonly unknown[]): void;

/** `true` when `X` and `Y` are the same type (strict equality, not assignability). */
export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/** Compile-time assertion: fails the build unless `T` is `true`. */
export type Expect<T extends true> = T;
