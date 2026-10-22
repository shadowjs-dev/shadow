import type { Accessor } from "@shadow-js/core";
import type { JsxChild } from "../jsx/types";
import { createBranches, FALLBACK } from "./branch";

/** What `when` accepts: the value, or any falsy stand-in (`0` and `""` count as falsy). */
type ShowCondition<T> = T | undefined | null | false | 0 | "";

/** Props shared by both forms of {@link Show}. */
interface ShowBaseProps<T> {
  /** The condition. The children are shown while it is truthy. */
  readonly when: ShowCondition<T>;
  /**
   * Shown while `when` is falsy. Read lazily, only when it is needed.
   * @default undefined (a falsy `when` renders nothing)
   */
  readonly fallback?: unknown;
}

/**
 * Keyed form: the children are rebuilt whenever the identity of `when` changes and a callback
 * child receives the value itself.
 * @since 1.0.0
 */
export interface ShowKeyedProps<T> extends ShowBaseProps<T> {
  /** Must be `true` in this form: a change of the identity of `when` rebuilds the children. */
  readonly keyed: true;
  /**
   * Plain content, an accessor, or a callback `(item) => content` called untracked in the branch.
   * @default undefined (a truthy `when` renders nothing)
   */
  readonly children?: JsxChild | (() => unknown) | ((item: NonNullable<T>) => unknown);
}

/**
 * Default form: the branch is rebuilt only when the truthiness of `when` changes. A callback child
 * receives an accessor of the latest truthy value; reading it after `when` became falsy throws a
 * TypeError, except while the branch is being torn down.
 * @since 1.0.0
 */
export interface ShowAccessorProps<T> extends ShowBaseProps<T> {
  /**
   * Absent or `false` in this form: the children are rebuilt only when the truthiness of `when`
   * changes.
   * @default false
   */
  readonly keyed?: false;
  /**
   * Plain content, an accessor, or a callback `(item) => content` called untracked in the branch.
   * @default undefined (a truthy `when` renders nothing)
   */
  readonly children?: JsxChild | (() => unknown) | ((item: Accessor<NonNullable<T>>) => unknown);
}

/**
 * Props of {@link Show}.
 * @since 1.0.0
 */
export type ShowProps<T> = ShowKeyedProps<T> | ShowAccessorProps<T>;

/**
 * The same props with untyped `children`, for code that forwards children it does not know the
 * shape of (a wrapper component's own `props.children`).
 * @since 1.0.0
 */
export interface ShowLooseProps<T> extends ShowBaseProps<T> {
  /**
   * Same meaning as in {@link ShowKeyedProps}: `true` rebuilds the children when the identity of
   * `when` changes.
   * @default false
   */
  readonly keyed?: boolean;
  /**
   * Plain content, an accessor, or a callback, as in {@link ShowProps}.
   * @default undefined (a truthy `when` renders nothing)
   */
  readonly children?: unknown;
}

/**
 * Shows `children` while `when` is truthy, and `fallback` otherwise. The branch is rebuilt only
 * when the truthiness of `when` changes (or, with `keyed`, when its identity changes).
 *
 * `when` follows JavaScript truthiness: `0`, `""`, `null`, `undefined` and `false` show the
 * fallback. While `fallback` is not given, a falsy `when` renders nothing.
 *
 * @param props See {@link ShowProps}.
 * @returns An accessor of the current branch's content. The DOM runtime's `insert` consumes it.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { Show } from "@shadow-js/web";
 *
 * function Greeting() {
 *   const [user] = useSignal<{ name: string } | null>(null);
 *   return (
 *     <Show when={user()} fallback={<p>Sign in</p>}>
 *       {(u) => <p>Hello {u().name}</p>}
 *     </Show>
 *   );
 * }
 * @see Switch
 * @see ErrorBoundary
 * @since 1.0.0
 */
export function Show<T>(props: ShowProps<T>): Accessor<unknown>;
export function Show<T>(props: ShowLooseProps<T>): Accessor<unknown>;
export function Show<T>(props: ShowLooseProps<T>): Accessor<unknown> {
  return createBranches(
    "Show",
    () => {
      const when = props.when;
      return {
        index: when ? 0 : FALLBACK,
        keyed: props.keyed === true,
        when,
        read: () => props.when,
        body: () => props.children,
      };
    },
    () => props.fallback,
  );
}
