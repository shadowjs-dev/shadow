import { keepWatchingCommits } from "./insert";

/** The value each select was last given, which it takes again when its options change (see {@link setSelectValue}). */
const bound = new WeakMap<HTMLSelectElement, unknown>();

/** The values an array stands for, as strings; null and undefined entries are skipped. */
function listed(value: readonly unknown[]): Set<string> {
  return new Set(value.filter((item) => item !== null && item !== undefined).map(String));
}

/** The string a value assigns to `select.value`, `innerHTML` or `textContent`; null and undefined are empty. @internal */
export function plainText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Selects the options a `value` stands for. The compiler calls it for `<select value={...}>`. A
 * single value behaves like `select.value = value` (`null` and `undefined` are the empty string).
 * On a `<select multiple>` an array selects exactly the options whose value it lists and clears
 * the others. The server writes the same state as `selected` on the options (`ssrSelectValue`). The select
 * takes the value again whenever the nodes inside it change (the options of a `<For>`, a `<Show>` or an optgroup), so
 * options that arrive or are replaced after the value keep it selected.
 *
 * @param select The select element; its options must already be in it.
 * @param value A string or number (written as `String(value)`), or `null`/`undefined` (written as
 * `""`: an option with an empty value is selected, otherwise none). For a `multiple` select, an array of them: `null` and `undefined`
 * entries are skipped. An array on a single select is written as `String(array)`.
 * @example
 * import { setSelectValue } from "@shadow-js/web";
 *
 * const select = document.createElement("select");
 * select.multiple = true;
 * select.append(new Option("A", "a"), new Option("B", "b"), new Option("C", "c"));
 * setSelectValue(select, ["a", "c"]); // A and C selected, B cleared
 * @see ssrSelectValue
 * @since 1.0.0
 */
export function setSelectValue(select: HTMLSelectElement, value: unknown): void {
  // Options that arrive or are replaced after this call (a `<For>` inside the select) leave the browser's own pick, the
  // first option: the select takes its value again after each commit to its children, as React's does.
  if (!bound.has(select)) keepWatchingCommits(select, () => apply(select, bound.get(select)));
  bound.set(select, value);
  apply(select, value);
}

function apply(select: HTMLSelectElement, value: unknown): void {
  if (select.multiple && Array.isArray(value)) {
    const wanted = listed(value);
    for (const option of Array.from(select.options)) option.selected = wanted.has(option.value);
    return;
  }
  select.value = plainText(value);
}
