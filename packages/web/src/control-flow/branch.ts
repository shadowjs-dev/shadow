import { type Accessor, createRoot, getOwner, onCleanup, untrack, useMemo } from "@shadow-js/core";
import {
  type SlotBranch,
  type SlotOwned,
  type SlotState,
  type SlotSwap,
  transitionHooks,
} from "@shadow-js/core/extend";

/**
 * Branch index meaning "no branch is selected": the fallback is shown.
 * @internal
 */
export const FALLBACK = -1;

/**
 * One selection made by a control-flow component.
 *
 * - `index` names the chosen branch, or {@link FALLBACK}.
 * - `keyed` and `when` decide whether a change of selection rebuilds the branch.
 * - `read` reads the condition reactively; the callback child's accessor argument uses it.
 * - `body` reads the branch's children getter. It is read tracked: a compiled `children` getter
 *   that is a plain reactive expression (`{count()}`) must update the output. Creating child JSX
 *   reads nothing here, because components and bindings track inside their own computations.
 *
 * @internal
 * @since 1.0.0
 */
export interface Choice {
  /** The chosen branch: a zero-based position, or {@link FALLBACK} when no branch is chosen. */
  readonly index: number;
  /** True when a change of `when` (by identity) rebuilds the branch even if `index` is the same. */
  readonly keyed: boolean;
  /** The value of the condition at selection time; a keyed callback child receives it. */
  readonly when: unknown;
  /** Reads the current value of the condition, tracked; backs the callback child's accessor. */
  readonly read: () => unknown;
  /** Reads the chosen branch's children (content, an accessor, or a callback), tracked. */
  readonly body: () => unknown;
}

/** Bookkeeping for the branch that is on screen. */
type Rendered = SlotOwned;

/** A branch on screen, or one a transition builds (see the transition layer in core's concurrency.ts). */
type Live = SlotBranch<Choice>;

/**
 * Whether two selections describe the same rendered output. Non-keyed branches only care about
 * which branch is chosen, which is the same as comparing truthiness of the condition. Keyed
 * branches also rebuild when the condition's identity changes. The fallback never rebuilds.
 */
function sameChoice(a: Choice, b: Choice): boolean {
  if (a.index !== b.index) return false;
  return a.index === FALLBACK || !a.keyed || a.when === b.when;
}

/**
 * Builds the accessor behind `Show` and `Switch`. The selection memo decides which branch is chosen;
 * the output memo commits it.
 *
 * Ordinary changes build the branch inside the output memo: the memo's teardown removes the previous
 * branch first. A change made during a transition, while a branch is on screen, is handled by the
 * transition layer (core's `slotSwap`, reached through `transitionHooks`), created by the first such change: it builds the
 * new branch under a hold and commits it once its reads have settled. Until then the shown branch stays
 * on screen, its DOM untouched, and nothing is built twice. Apps that never change a shown branch in a
 * transition never create that layer.
 *
 * Teardown ordering: the owner of a branch is marked `disposing` before it is torn down, so a cleanup
 * that reads the callback's accessor learns that the branch is going away and gets the last truthy
 * value instead of a stale-accessor error.
 *
 * @param name Component name used in diagnostics.
 * @param select Tracked selection; runs inside the selection memo.
 * @param fallback Reads the fallback lazily, untracked, only when it is shown.
 * @returns The output accessor.
 * @throws TypeError (production message `SHADOW_STALE_ACCESSOR`) from the accessor handed to a
 * callback child, when it is read after its branch was replaced.
 * @internal
 * @since 1.0.0
 */
export function createBranches(
  name: string,
  select: () => Choice,
  fallback: () => unknown,
): Accessor<unknown> {
  /** Selection computed most recently; its `read` is always current, unlike the held value. */
  let latest: Choice | undefined;
  /** The branch on screen, and what the output last returned. The transition layer reads and writes it. */
  const state: SlotState<Choice> = { live: undefined };
  /** The transition layer, created by the first transition that replaces the branch on screen. */
  let swap: SlotSwap<Choice> | undefined;
  /** The slot's owner: the transition layer's holder for the branches it builds lives under it. */
  const owner = getOwner();

  const pick = (): Choice => {
    const next = select();
    latest = next;
    const live: Live | undefined = state.live;
    if (live !== undefined && next.index === live.owned.index) live.owned.value = next.when;
    return next;
  };
  const selection = useMemo<Choice>(pick, { equals: sameChoice });

  const accessorFor = (owned: Rendered): (() => unknown) => {
    return () => {
      if (owned.disposing) return owned.value;
      const current = untrack(selection);
      if (current.index !== owned.index) {
        throw new TypeError(
          __DEV__
            ? `ShadowJS ${name}: stale accessor. The branch was replaced; read the accessor only while its condition is truthy.`
            : "SHADOW_STALE_ACCESSOR",
        );
      }
      return (latest ?? current).read();
    };
  };

  /**
   * The value a branch (or the fallback) produces. `eager` evaluates a zero-argument accessor now (a
   * transition build needs to see whether a read was held); otherwise it is evaluated when rendered.
   */
  const produce = (choice: Choice, owned: Rendered, eager: boolean): unknown => {
    if (choice.index === FALLBACK) return untrack(fallback);
    const body = choice.body();
    if (typeof body !== "function") return body;
    // A zero-argument function is an accessor. Returned as it is, the renderer would call it in an
    // effect outside this branch, so an error it throws would escape the boundary around the Show
    // (STATUS: ErrorBoundary does not catch a Show function child). A memo owned here evaluates it
    // inside the branch, where the nearest error handler applies.
    if (body.length === 0) {
      // Lazy outside a transition: the parent evaluates it when it renders, so a deep chain of
      // branches is built in that render rather than inside this one.
      return useMemo<unknown>(() => (body as () => unknown)(), {
        allowWrites: true,
        lazy: !eager,
      });
    }
    const callback = body as (value: unknown) => unknown;
    return untrack(() => callback(choice.keyed ? choice.when : accessorFor(owned)));
  };

  return useMemo<unknown>(
    () => {
      const choice = selection();
      if (swap === undefined && state.live !== undefined) {
        swap = transitionHooks()?.slotSwap(state, produce, sameChoice, owner);
      }
      if (swap?.step(choice)) return state.live?.result;

      // The usual path: the previous branch was torn down by this memo (its teardown marked it disposing;
      // the flag is cleared again, so a stale accessor throws). Build the next one here.
      if (state.live !== undefined) state.live.owned.disposing = false;
      state.live = undefined;
      const owned: Rendered = { index: choice.index, value: choice.when, disposing: false };
      const result = produce(choice, owned, false);
      // Created last, so it is the newest child: the memo's teardown marks the branch first.
      createRoot(() => {
        onCleanup(() => {
          owned.disposing = true;
        });
      });
      state.live = { choice, owned, result };
      return result;
    },
    { allowWrites: true },
  );
}
