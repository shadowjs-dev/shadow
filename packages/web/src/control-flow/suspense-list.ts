import { type Accessor, type Context, createContext, onCleanup, useContext } from "@shadow-js/core";
import { readSignal, SignalNode, writeSignal } from "@shadow-js/core/extend";

/** What a `<Suspense>` inside a list learns about its place: when to show content and a fallback. @internal */
export interface SuspenseListSlot {
  /** True when this boundary may show its content now (it is ready and the order allows it). */
  reveal(): boolean;
  /** True when this boundary should show its fallback while it waits. */
  showFallback(): boolean;
}

/** Provided by `<SuspenseList>` to the boundaries below it. @internal */
export interface SuspenseListState {
  /** Registers a boundary, in creation order; `ready` reports that its own data has loaded. */
  register(ready: () => boolean): SuspenseListSlot;
}

/** The enclosing list, or null. @internal */
export const SuspenseListContext: Context<SuspenseListState | null> =
  /* @__PURE__ */ createContext<SuspenseListState | null>(null, { name: "SuspenseList" });

/**
 * Props of {@link SuspenseList}.
 * @since 1.0.0
 */
export interface SuspenseListProps {
  /**
   * `"forwards"`: boundaries reveal in order, each after the ones before it. `"backwards"`: the
   * same from the last one. `"together"`: all at once, when the last one is ready. Without it each
   * boundary reveals on its own. Read reactively.
   * @default undefined (each boundary reveals as soon as its own data is ready)
   */
  readonly revealOrder?: "forwards" | "backwards" | "together" | undefined;
  /**
   * What the boundaries that are still waiting show: `"collapsed"` only the next fallback in
   * order, `"hidden"` none. Applies to `forwards` and `backwards`; the default shows every fallback.
   * @default undefined (every waiting boundary shows its fallback)
   */
  readonly tail?: "collapsed" | "hidden" | undefined;
  /**
   * The content, with the `<Suspense>` boundaries to coordinate anywhere below it.
   * @default undefined (renders nothing)
   */
  readonly children?: unknown;
}

/**
 * Coordinates the `<Suspense>` boundaries below it so a page of independent loads reveals in a
 * calm order instead of popping in at random.
 *
 * @param props See {@link SuspenseListProps}.
 * @returns An accessor of the children, rendered with the list's coordination in context.
 * @example
 * import { Suspense, SuspenseList } from "@shadow-js/web";
 *
 * function Skeleton() {
 *   return <p>Loading...</p>;
 * }
 *
 * function Profile() {
 *   return <p>Profile</p>;
 * }
 *
 * function Feed() {
 *   return <p>Feed</p>;
 * }
 *
 * function Page() {
 *   return (
 *     <SuspenseList revealOrder="forwards" tail="collapsed">
 *       <Suspense fallback={<Skeleton />}>
 *         <Profile />
 *       </Suspense>
 *       <Suspense fallback={<Skeleton />}>
 *         <Feed />
 *       </Suspense>
 *     </SuspenseList>
 *   );
 * }
 * @see Suspense
 * @since 1.0.0
 */
export function SuspenseList(props: SuspenseListProps): Accessor<unknown> {
  // The set of boundaries changes as they are created and disposed; `changes` tells readers.
  const changes = new SignalNode<number>(0, false);
  const slots: Array<{ readonly ready: () => boolean }> = [];
  const touch = (): void => {
    writeSignal(changes, 0, { allowInMemo: true });
  };

  const state: SuspenseListState = {
    register(ready) {
      const entry = { ready };
      slots.push(entry);
      touch();
      onCleanup(() => {
        const index = slots.indexOf(entry);
        if (index !== -1) slots.splice(index, 1);
        touch();
      });
      const position = (): number => {
        readSignal(changes);
        return slots.indexOf(entry);
      };
      const reveal = (): boolean => {
        const index = position();
        if (index === -1) return false;
        switch (props.revealOrder) {
          case "together":
            return slots.every((slot) => slot.ready());
          case "forwards":
            return slots.slice(0, index + 1).every((slot) => slot.ready());
          case "backwards":
            return slots.slice(index).every((slot) => slot.ready());
          default:
            return ready();
        }
      };
      const showFallback = (): boolean => {
        if (reveal()) return false;
        const order = props.revealOrder;
        const sequential = order === "forwards" || order === "backwards";
        if (!sequential) return true;
        if (props.tail === "hidden") return false;
        if (props.tail !== "collapsed") return true;
        // Only the next boundary in order that is not revealed yet shows its fallback.
        const index = position();
        const ordered = order === "backwards" ? [...slots].reverse() : slots;
        const wanted = order === "backwards" ? slots.length - 1 - index : index;
        for (let i = 0; i < ordered.length; i += 1) {
          const candidate = ordered[i];
          if (candidate !== undefined && !candidate.ready()) return i === wanted;
        }
        return false;
      };
      return { reveal, showFallback };
    },
  };

  return SuspenseListContext({
    value: state,
    get children() {
      return props.children;
    },
  }) as Accessor<unknown>;
}

/** The slot of the nearest list for a boundary created now, or null outside a list. @internal */
export function registerInList(ready: () => boolean): SuspenseListSlot | null {
  const list = useContext(SuspenseListContext);
  return list === null ? null : list.register(ready);
}
