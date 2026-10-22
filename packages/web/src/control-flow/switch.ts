import { type Accessor, type ResolvedChildren, children as resolveChildren } from "@shadow-js/core";
import { createBranches, FALLBACK } from "./branch";

/**
 * Props of {@link Match}. A Match descriptor is the props object itself.
 * @since 1.0.0
 */
export interface MatchProps<T> {
  /** The condition. The first Match whose `when` is truthy is shown. */
  readonly when: T | undefined | null | false | 0 | "";
  /**
   * Same meaning as in {@link ShowLooseProps}: `true` rebuilds the branch when the identity of
   * `when` changes.
   * @default false
   */
  readonly keyed?: boolean;
  /**
   * The branch content: plain content, an accessor, or a callback, as the children of
   * {@link ShowProps}.
   * @default undefined (the selected Match renders nothing)
   */
  readonly children?: unknown;
}

/**
 * Describes one branch of a {@link Switch}. It returns its props unchanged.
 *
 * @param props The condition and the branch content.
 * @returns The same props object, which `Switch` reads.
 * @example
 * import { Match } from "@shadow-js/web";
 *
 * const branch = Match({ when: "ready", children: "Loaded" });
 * console.log(branch.when); // "ready"
 * @see Switch
 * @since 1.0.0
 */
export function Match<T>(props: MatchProps<T>): MatchProps<T> {
  return props;
}

/**
 * Props of {@link Switch}.
 * @since 1.0.0
 */
export interface SwitchProps {
  /**
   * Shown when no Match is truthy. Read lazily.
   * @default undefined (nothing is rendered when no Match is truthy)
   */
  readonly fallback?: unknown;
  /**
   * One or more {@link Match} descriptors. `null`, `undefined` and booleans are ignored.
   * @default undefined (no branches; the fallback is shown)
   */
  readonly children?: unknown;
}

/** A Match descriptor is any object with a `when` key. Anything else is not a Match. */
function isMatch(item: unknown): item is MatchProps<unknown> {
  return typeof item === "object" && item !== null && "when" in item;
}

/** Resolves the children into Match descriptors. Throws for any other kind of child. */
function matchesOf(resolved: ResolvedChildren): MatchProps<unknown>[] {
  const matches: MatchProps<unknown>[] = [];
  for (const item of resolved.toArray()) {
    if (!isMatch(item))
      throw new TypeError(
        __DEV__ ? "ShadowJS Switch: children must be <Match>" : "SHADOW_SWITCH_CHILDREN",
      );
    matches.push(item);
  }
  return matches;
}

/**
 * Shows the first {@link Match} whose `when` is truthy, or the fallback when none is.
 * Re-selecting the same branch with the same truthiness (or, when keyed, the same value) does not
 * rebuild it.
 *
 * @param props See {@link SwitchProps}.
 * @returns An accessor of the selected branch's content.
 * @throws TypeError (production message `SHADOW_SWITCH_CHILDREN`) when a child is neither a Match
 * nor `null`, `undefined` or a boolean.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { Match, Switch } from "@shadow-js/web";
 *
 * function Status() {
 *   const [error] = useSignal<string | null>(null);
 *   const [data] = useSignal<string | null>("ready");
 *   return (
 *     <Switch fallback={<p>Loading...</p>}>
 *       <Match when={error()}>
 *         <p>Failed</p>
 *       </Match>
 *       <Match when={data()}>
 *         <p>Ready</p>
 *       </Match>
 *     </Switch>
 *   );
 * }
 * @see Show
 * @since 1.0.0
 */
export function Switch(props: SwitchProps): Accessor<unknown> {
  const matches = resolveChildren(() => props.children);
  // Validate now, so that a wrong child is reported where the Switch is written.
  matchesOf(matches);
  return createBranches(
    "Switch",
    () => {
      const list = matchesOf(matches);
      for (const [index, match] of list.entries()) {
        const when = match.when;
        if (when) {
          return {
            index,
            keyed: match.keyed === true,
            when,
            read: () => match.when,
            body: () => match.children,
          };
        }
      }
      return {
        index: FALLBACK,
        keyed: false,
        when: undefined,
        read: () => undefined,
        body: () => undefined,
      };
    },
    () => props.fallback,
  );
}
