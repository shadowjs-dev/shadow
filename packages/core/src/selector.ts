import { useRenderEffect } from "./effect";
import { isTracking, notify, type SourceNode, track } from "./extend";
import { onCleanup, untrack } from "./ownership";

/**
 * The boolean for one key, shared by every reader that asked about that key. It is a reactive source itself (the
 * shape `track` and `notify` take), so a key costs one object where a separate signal would cost two.
 */
class Entry implements SourceNode {
  /** A source with no sources of its own, like a signal. */
  readonly kind = 0;
  observers: SourceNode["observers"] = null;
  stamp = 0;
  /** Tracked reads whose cleanup has not run yet. The entry is dropped when this reaches 0. */
  subscribers = 0;

  /** The key this entry answers for. */
  readonly key: unknown;
  /** Whether the key matches the selected value. */
  value: boolean;

  constructor(key: unknown, value: boolean) {
    this.key = key;
    this.value = value;
  }
}

/** Writes a key's boolean and notifies its readers only when it actually changed. */
function setEntry(entry: Entry, selected: boolean): void {
  if (entry.value === selected) return;
  entry.value = selected;
  notify(entry);
}

/**
 * Creates a selection set over `source`. `isSelected(key)` answers whether `key` matches the
 * current source value. Reading it inside an effect or memo subscribes only to that key's boolean,
 * so when the source changes from `a` to `b` only the readers of `a` and `b` re-run, with the
 * default equality. A custom `equals` costs one call per registered key per change.
 *
 * The source is tracked by a render-phase effect in the current owner. Create the selector before
 * its consumers, so that each consumer runs once per change. Calling `isSelected` outside a tracked
 * context reads the source directly and creates no subscription. The default equality is `===`,
 * so `NaN` never matches.
 *
 * @param source The value that selects keys. Tracked.
 * @param equals Optional `(key, value) => boolean`. Undefined uses `key === value`.
 * @returns `isSelected(key)`.
 * @throws Nothing itself. When a custom `equals` throws during a change, the other keys are still
 * updated and the error goes to the owner's error handler. In development, a selector created
 * outside any owner warns `NO_OWNER_EFFECT`.
 * @example
 * import { mapArray, useSelector, useSignal } from "@shadow-js/core";
 *
 * function Rows(props: { ids: number[] }) {
 *   const [selectedId, setSelectedId] = useSignal(1);
 *   const isSelected = useSelector(selectedId);
 *   return mapArray(() => props.ids, (id) => (
 *     <li classList={{ active: isSelected(id) }} onClick={() => setSelectedId(id)}>{id}</li>
 *   ));
 * }
 * @see mapArray
 * @since 1.0.0
 */
export function useSelector<T, K = T>(
  source: () => T,
  equals?: (key: K, value: T) => boolean,
): (key: K) => boolean {
  const entries = new Map<unknown, Entry>();
  /** The value the entries were last reconciled against; `null` until the first successful apply. */
  let last: { readonly value: T } | null = null;

  const matches = (key: K, value: T): boolean =>
    equals === undefined ? (key as unknown) === value : equals(key, value);

  const currentValue = (): T => (last === null ? untrack(source) : last.value);

  const release = (entry: Entry): void => {
    entry.subscribers -= 1;
    if (entry.subscribers === 0 && entries.get(entry.key) === entry) entries.delete(entry.key);
  };

  const create = (key: K): Entry => {
    const entry = new Entry(key, matches(key, currentValue()));
    entries.set(key, entry);
    return entry;
  };

  const isSelected = (key: K): boolean => {
    if (!isTracking()) return matches(key, source());
    const entry = entries.get(key) ?? create(key);
    entry.subscribers += 1;
    onCleanup(() => release(entry));
    track(entry);
    return entry.value;
  };

  useRenderEffect(
    () => source(),
    (next) => {
      const previous = last;
      last = { value: next };
      if (previous !== null && equals === undefined) {
        // Default equality: only the entries for the previous and the next key can change.
        if (previous.value === next) return;
        const before = entries.get(previous.value);
        if (before !== undefined) setEntry(before, before.key === next);
        const after = entries.get(next);
        if (after !== undefined) setEntry(after, after.key === next);
        return;
      }
      // Custom equality, or the first successful value: every registered key is checked. A
      // failing equals does not stop the others; its error is rethrown once they are all updated.
      let failed = false;
      let failure: unknown;
      for (const entry of entries.values()) {
        let selected: boolean;
        try {
          selected = matches(entry.key as K, next);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
          continue;
        }
        setEntry(entry, selected);
      }
      if (failed) throw failure;
    },
  );

  return isSelected;
}
