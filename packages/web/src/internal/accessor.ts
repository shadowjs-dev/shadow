/** Longest chain of accessors a single value may hold (a function returning a function ...). */
const MAX_ACCESSOR_DEPTH = 10_000;

/**
 * Calls `value` while it is a function, so an accessor that returns an accessor is followed to the
 * value at its end. `call` runs each function (default: a plain call); `insert` passes one that
 * memoizes. Class and style values use the default, inside the effect that applies them, so the
 * signals an accessor reads are tracked by it.
 * @throws TypeError (production message `SHADOW_INSERT_DEPTH`) after 10,000 functions in a row.
 * @internal
 */
export function unwrap(
  value: unknown,
  call: (fn: () => unknown) => unknown = (fn) => fn(),
): unknown {
  for (let depth = 0; typeof value === "function"; depth += 1) {
    if (depth >= MAX_ACCESSOR_DEPTH)
      throw new TypeError(
        __DEV__
          ? "An accessor returns accessors more than 10,000 levels deep."
          : "SHADOW_INSERT_DEPTH",
      );
    value = call(value as () => unknown);
  }
  return value;
}

/**
 * The leaves of a value made of nested arrays, in order, found without recursion (the nesting depth is
 * the user's): every item goes through {@link unwrap}, an array is entered, anything else is a leaf.
 * `insert` and the class writer share it.
 * @param root The value; an array is entered, any other value is a leaf.
 * @param cycle The message of the `TypeError` thrown when an array contains itself.
 * @param call Passed to {@link unwrap}.
 * @internal
 */
export function leaves(
  root: unknown,
  cycle: string,
  call?: (fn: () => unknown) => unknown,
): unknown[] {
  const found: unknown[] = [];
  const frames: unknown[][] = [[root]];
  const cursors: number[] = [0];
  const active = new Set<unknown[]>();
  while (frames.length > 0) {
    const top = frames.length - 1;
    const frame = frames[top] as unknown[];
    const cursor = cursors[top] as number;
    if (cursor >= frame.length) {
      active.delete(frames.pop() as unknown[]);
      cursors.pop();
      continue;
    }
    cursors[top] = cursor + 1;
    const item = unwrap(frame[cursor], call);
    if (!Array.isArray(item)) found.push(item);
    else if (active.has(item)) throw new TypeError(cycle);
    else {
      active.add(item);
      frames.push(item);
      cursors.push(0);
    }
  }
  return found;
}
