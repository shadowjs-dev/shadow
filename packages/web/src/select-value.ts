/** The values an array stands for, as strings; null and undefined entries are skipped. */
function listed(value: readonly unknown[]): Set<string> {
  const values = new Set<string>();
  for (const item of value) {
    if (item !== null && item !== undefined) values.add(String(item));
  }
  return values;
}

/** The string a single value assigns to `select.value`; null and undefined clear the choice. */
function single(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Selects the options a `value` stands for. The compiler calls it for `<select value={...}>`. A
 * single value behaves like `select.value = value` (`null` and `undefined` are the empty string).
 * On a `<select multiple>` an array selects exactly the options whose value it lists and clears
 * the others. The server writes the same state as `selected` on the options (`ssrSelectValue`).
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
  if (select.multiple && Array.isArray(value)) {
    const wanted = listed(value);
    for (const option of Array.from(select.options)) option.selected = wanted.has(option.value);
    return;
  }
  select.value = single(value);
}

/** True when the select already shows `value` the way {@link setSelectValue} would leave it. @internal */
export function selectShows(select: HTMLSelectElement, value: unknown): boolean {
  if (select.multiple && Array.isArray(value)) {
    const wanted = listed(value);
    return Array.from(select.options).every(
      (option) => option.selected === wanted.has(option.value),
    );
  }
  return select.value === single(value);
}
