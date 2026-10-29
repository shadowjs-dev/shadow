import {
  type Accessor,
  getOwner,
  runWithOwner,
  SuspenseContext,
  type SuspenseTracker,
  useContext,
  useMemo,
} from "@shadow-js/core";
import {
  type BoundaryHold,
  createOwner,
  readSignal,
  SignalNode,
  transitionHooks,
  writeSignal,
} from "@shadow-js/core/extend";
import { childScope, nextKey, StreamContext, withScope } from "../extend";
import { ssrRaw } from "../server/element";
// biome-ignore lint/suspicious/noShadowRestrictedNames: `escape` is the compiler's SSR helper name.
import { escape } from "../server/escape";
import { registerInList } from "./suspense-list";

/**
 * Props of {@link Suspense}.
 * @since 1.0.0
 */
export interface SuspenseProps {
  /**
   * Shown while any resource read inside the boundary is loading for the first time.
   * @default undefined (a pending boundary renders nothing)
   */
  fallback?: unknown;
  /**
   * The content. Created once, under the boundary, and kept alive while the fallback is visible.
   * @default undefined (renders nothing)
   */
  children?: unknown;
}

/** What a boundary tracks: its pending reads, and whether a transition holds its content. */
interface Tracking {
  readonly tracker: SuspenseTracker;
  readonly count: () => number;
  /** True while a transition waits for data and the boundary keeps showing its content. */
  readonly holding: () => boolean;
  /** Called when the boundary first shows its content: only then can a transition hold it. */
  readonly revealed: () => void;
}

/**
 * A counter the resources of one boundary report to (see {@link SuspenseTracker}), and the hold a
 * transition takes on the boundary. A transition that reads pending data while the boundary shows
 * content does not bring the fallback back: its readers keep their previous values, the boundary
 * keeps its content, and the readers run again when the count returns to zero.
 */
function createTracker(): Tracking {
  // Counted with an extension-API cell: a resource may be read (and so hold this boundary) while a
  // memo computes, where a plain write would be rejected.
  const pending = new SignalNode<number>(0, Object.is);
  // The hold a transition takes on this boundary. Only a transition read creates it (core keeps the
  // machinery of holds behind its transition hooks); the boundary's memo reads the count before it
  // reads the hold, so it runs again when the count reaches zero (the release).
  let hold: BoundaryHold | undefined;
  let shown = false;
  const adjust = (by: number): void => {
    writeSignal(pending, pending.value + by, { allowInMemo: true });
  };
  const tracker: SuspenseTracker = {
    increment: () => adjust(1),
    decrement: () => {
      adjust(-1);
      if (pending.value === 0) hold?.release();
    },
    hold: (): boolean => {
      if (!shown) return false;
      hold ??= transitionHooks()?.boundaryHold();
      return hold?.engage() === true;
    },
  };
  return {
    tracker,
    count: () => readSignal(pending),
    holding: () => hold?.holding() === true,
    revealed: () => {
      shown = true;
    },
  };
}

/**
 * Shows `fallback` while resources read inside it are loading for the first time. The children
 * are created once and stay alive (with their state) while the fallback is visible; the boundary
 * only switches what is displayed. Nested boundaries each track their own resources.
 *
 * On the server a boundary renders its fallback when its data is not ready (`renderToString`), or
 * streams the content later (`renderToStream`). Content and fallback get their own hydration key
 * space, so what a boundary renders never shifts the keys of its siblings.
 *
 * @param props See {@link SuspenseProps}.
 * @returns An accessor of what the boundary shows: the fallback while a resource is pending, the
 * children otherwise.
 * @example
 * import { useResource } from "@shadow-js/core";
 * import { Suspense } from "@shadow-js/web";
 *
 * function Profile() {
 *   const name = useResource(() => Promise.resolve("Ada"));
 *   return <p>{name()}</p>;
 * }
 *
 * function Page() {
 *   return (
 *     <Suspense fallback={<p>Loading...</p>}>
 *       <Profile />
 *     </Suspense>
 *   );
 * }
 * @see SuspenseList
 * @see ErrorBoundary
 * @since 1.0.0
 */
export function Suspense(props: SuspenseProps): Accessor<unknown> {
  const key = nextKey();
  const { tracker, count, holding, revealed } = createTracker();
  // The content lives under its own owner, whose gate holds back user effects and `onMount` until
  // the boundary has resolved once. Render effects (DOM bindings) are never held.
  // Inside a <SuspenseList> the boundary also waits for its turn to be revealed.
  const slot = __SERVER__ ? null : registerInList(() => count() === 0);
  const boundary = createOwner();
  boundary.gate = () => count() > 0 || (slot !== null && !slot.reveal());
  const content = runWithOwner(boundary, () =>
    withScope(childScope(key), () =>
      SuspenseContext({
        value: tracker,
        get children() {
          return props.children;
        },
      }),
    ),
  );
  if (__SERVER__) return suspenseOnServer(props, key, count, content as () => unknown);
  const fallbackScope = childScope(key === undefined ? undefined : `${key}f`);
  return useMemo<unknown>(
    (previous) => {
      // Read first: the memo depends on the count even while held, so it runs again when the hold ends.
      count();
      // A transition holds the boundary: the content stays as it was (the same value, so no DOM change).
      if (holding() && previous !== undefined) return previous;
      if (slot === null) {
        if (count() > 0) return withScope(fallbackScope, () => props.fallback);
        revealed();
        return (content as () => unknown)();
      }
      if (count() === 0 && slot.reveal()) {
        revealed();
        return (content as () => unknown)();
      }
      return slot.showFallback() ? withScope(fallbackScope, () => props.fallback) : null;
    },
    { allowWrites: true },
  );
}

/** Server behavior: ready content, a fallback, or a fallback plus a deferred stream chunk. */
function suspenseOnServer(
  props: SuspenseProps,
  key: string | undefined,
  count: () => number,
  content: () => unknown,
): Accessor<unknown> {
  const fallbackScope = childScope(key === undefined ? undefined : `${key}f`);
  if (count() === 0) return content;
  const sink = useContext(StreamContext);
  if (sink === null || key === undefined) {
    return () => withScope(fallbackScope, () => props.fallback);
  }
  const owner = getOwner();
  const boundary = {
    id: key,
    rebuild: (): string | null => {
      const next = createTracker();
      const rebuilt = runWithOwner(owner, () =>
        withScope(childScope(key), () =>
          SuspenseContext({
            value: next.tracker,
            get children() {
              return props.children;
            },
          }),
        ),
      );
      if (next.count() > 0) {
        sink.defer(boundary);
        return null;
      }
      return escape((rebuilt as () => unknown)());
    },
  };
  sink.defer(boundary);
  // The markers delimit the region the stream later replaces; hydration strips them.
  return () => [
    ssrRaw(`<!--[b:${key}-->`),
    withScope(fallbackScope, () => props.fallback),
    ssrRaw("<!--]-->"),
  ];
}
