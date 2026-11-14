import { flushSync } from "@shadow-js/core";
import { hydrate, render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/compile";
import { cleanupDom } from "./support/dom";

/*
 * `aria-invalid={...}` on an input that a callback child renders (`<Show>`, `<For>`): the value follows its signal in both
 * directions on the client, and the server's markup and the hydrated element agree.
 */

afterEach(cleanupDom);

const SOURCE = `
import { useSignal } from "@shadow-js/core";
import { For, Show } from "@shadow-js/web";
export const state = {};
export function Fields() {
  const [bad, setBad] = useSignal(true);
  state.setBad = setBad;
  return (
    <div>
      <Show when={true}>{() => <input id="a" aria-invalid={bad()} />}</Show>
      <For each={[1]}>{() => <input id="b" aria-invalid={bad()} />}</For>
      <input id="c" aria-invalid={bad()} />
      <Show when={true}>{() => <input id="d" aria-invalid={true} />}</Show>
      <Show when={true}>{() => <input id="e" aria-invalid={bad() ? true : undefined} />}</Show>
    </div>
  );
}
`;

interface Mod {
  Fields: () => unknown;
  state: { setBad(value: boolean): void };
}

const read = (root: Element): (string | null)[] =>
  ["a", "b", "c", "d", "e"].map(
    (id) => root.querySelector(`#${id}`)?.getAttribute("aria-invalid") ?? null,
  );

describe("aria-invalid on an input of a callback child", () => {
  it("[ARIA-INV-1] follows its signal when it is true, false and removed, and a static true stays", async () => {
    const mod = await load<Mod>(SOURCE);
    const host = document.createElement("div");
    document.body.append(host);
    render(() => mod.Fields(), host);
    expect(read(host)).toEqual(["true", "true", "true", "true", "true"]);
    mod.state.setBad(false);
    flushSync();
    expect(read(host)).toEqual(["false", "false", "false", "true", null]);
    mod.state.setBad(true);
    flushSync();
    expect(read(host)).toEqual(["true", "true", "true", "true", "true"]);
  });

  it("[ARIA-INV-2] hydrates onto the server's markup, keeps the attribute, and follows the signal afterward", async () => {
    const mod = await load<Mod>(SOURCE);
    const host = document.createElement("div");
    host.innerHTML =
      '<div data-hk="0-0"><!--[--><input data-hk="0-2" id="a" aria-invalid="true"><!--]--><!--[--><input data-hk="0-4" id="b" aria-invalid="true"><!--]--><input id="c" aria-invalid="true"><!--[--><input data-hk="0-6" id="d" aria-invalid="true"><!--]--><!--[--><input data-hk="0-8" id="e" aria-invalid="true"><!--]--></div>';
    document.body.append(host);
    const a = host.querySelector("#a");
    hydrate(() => mod.Fields(), host);
    expect(host.querySelector("#a")).toBe(a);
    expect(read(host)).toEqual(["true", "true", "true", "true", "true"]);
    mod.state.setBad(false);
    flushSync();
    expect(read(host)).toEqual(["false", "false", "false", "true", null]);
  });
});
